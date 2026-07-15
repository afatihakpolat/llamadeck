import { app } from 'electron'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdatePreferences, UpdateState } from '../shared/update'
import { hasActiveWork, type ActiveWorkSnapshot } from './activeWork'
import { loadUpdateSettings, saveUpdateSettings, resolveUpdateSettingsPath } from './updateSettings'

type BroadcastFn = (channel: string, payload: unknown) => void
type AutoDownloadEnabled = () => boolean
type SkippedVersionFn = () => string | undefined

export interface UpdateManagerDeps {
  broadcast: BroadcastFn
  getCurrentVersion: () => string
  getActiveWork: () => ActiveWorkSnapshot
  isAutoDownloadEnabled: AutoDownloadEnabled
  getSkippedVersion: SkippedVersionFn
  autoUpdater: AppUpdater | null
}

let deps: UpdateManagerDeps | null = null
let currentState: UpdateState | null = null

function makeInitialState(currentVersion: string): UpdateState {
  return { status: 'idle', currentVersion }
}

function setStatus(next: UpdateState): void {
  currentState = next
  deps?.broadcast('update:state-changed', next)
}

function isUpdaterActive(): boolean {
  const au = deps?.autoUpdater
  return Boolean(au && typeof au.isUpdaterActive === 'function' && au.isUpdaterActive())
}

function defaultBroadcast(_channel: string, _payload: unknown): void {
  void _channel
  void _payload
}

async function loadDefaultAutoUpdater(): Promise<AppUpdater> {
  const mod = await import('electron-updater')
  return mod.autoUpdater
}

const NOT_AVAILABLE_ERROR = 'In-app updates are not available.'

function unavailableDeps(broadcast: BroadcastFn, getCurrentVersion: () => string): UpdateManagerDeps {
  return {
    broadcast,
    getCurrentVersion,
    getActiveWork: () => ({ sourceUpdateJob: null, cancelBackendDl: null, downloadTasks: new Map() }),
    isAutoDownloadEnabled: () => false,
    getSkippedVersion: () => undefined,
    autoUpdater: null
  }
}

export async function initUpdateManager(customDeps?: Partial<UpdateManagerDeps>): Promise<void> {
  const broadcast = customDeps?.broadcast ?? defaultBroadcast
  const getCurrentVersion = customDeps?.getCurrentVersion ?? (() => app.getVersion())

  let autoUpdater: AppUpdater | null = null
  try {
    autoUpdater = customDeps?.autoUpdater ?? (await loadDefaultAutoUpdater())
  } catch (err) {
    console.warn('[update] autoUpdater load failed, in-app updates disabled:', err)
    deps = unavailableDeps(broadcast, getCurrentVersion)
    setStatus({ status: 'error', currentVersion: getCurrentVersion(), error: NOT_AVAILABLE_ERROR })
    return
  }

  deps = {
    broadcast,
    getCurrentVersion,
    getActiveWork: customDeps?.getActiveWork ?? (() => ({ sourceUpdateJob: null, cancelBackendDl: null, downloadTasks: new Map() })),
    isAutoDownloadEnabled: customDeps?.isAutoDownloadEnabled ?? (() => false),
    getSkippedVersion: customDeps?.getSkippedVersion ?? (() => undefined),
    autoUpdater
  }
  setStatus(makeInitialState(deps.getCurrentVersion()))

  const au = deps.autoUpdater
  if (!au) return

  au.autoDownload = false
  au.autoInstallOnAppQuit = false

  au.on('checking-for-update', () => {
    if (!currentState) return
    setStatus({ ...currentState, status: 'checking', error: undefined })
  })

  au.on('update-available', (info: UpdateInfo) => {
    if (!currentState) return
    if (info.version === deps!.getSkippedVersion()) {
      setStatus({ ...currentState, status: 'not-available', available: undefined })
      return
    }
    setStatus({
      ...currentState,
      status: 'available',
      available: {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
      },
      error: undefined
    })
  })

  au.on('update-not-available', () => {
    if (!currentState) return
    setStatus({ ...currentState, status: 'not-available', available: undefined })
  })

  au.on('download-progress', (progress: ProgressInfo) => {
    if (!currentState) return
    setStatus({
      ...currentState,
      status: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      }
    })
  })

  au.on('update-downloaded', () => {
    if (!currentState) return
    setStatus({ ...currentState, status: 'downloaded', progress: undefined })
  })

  au.on('error', (error: Error) => {
    if (!currentState) return
    setStatus({ ...currentState, status: 'error', error: error.message, progress: undefined })
  })
}

export function getUpdateState(): UpdateState {
  return currentState ?? makeInitialState(deps?.getCurrentVersion() ?? app.getVersion())
}

export function getUpdatePreferences(): UpdatePreferences {
  return loadUpdateSettings(resolveUpdateSettingsPath(app.getPath('userData')))
}

export function setUpdatePreferences(prefs: UpdatePreferences): UpdatePreferences {
  return saveUpdateSettings(resolveUpdateSettingsPath(app.getPath('userData')), prefs)
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!deps) throw new Error('Update manager not initialized.')
  if (!deps.autoUpdater) throw new Error(NOT_AVAILABLE_ERROR)
  if (isUpdaterActive()) throw new Error('An update check or download is already in progress.')
  if (hasActiveWork(deps.getActiveWork())) {
    throw new Error('Updates are blocked while another operation is in progress.')
  }
  await deps.autoUpdater.checkForUpdates()
  return getUpdateState()
}

export async function downloadUpdate(): Promise<void> {
  if (!deps) throw new Error('Update manager not initialized.')
  if (!deps.autoUpdater) throw new Error(NOT_AVAILABLE_ERROR)
  if (isUpdaterActive()) throw new Error('An update check or download is already in progress.')
  if (hasActiveWork(deps.getActiveWork())) {
    throw new Error('Updates are blocked while another operation is in progress.')
  }
  await deps.autoUpdater.downloadUpdate()
}

export function quitAndInstall(): void {
  if (!deps) throw new Error('Update manager not initialized.')
  if (!deps.autoUpdater) throw new Error(NOT_AVAILABLE_ERROR)
  deps.autoUpdater.quitAndInstall()
}

export function isAutoDownloadAllowed(): boolean {
  return Boolean(deps?.isAutoDownloadEnabled())
}

export function __resetUpdateManagerForTests(): void {
  deps = null
  currentState = null
}