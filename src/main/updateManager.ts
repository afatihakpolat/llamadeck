import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdatePreferences, UpdateState } from '../shared/update'
import { hasActiveWork, type ActiveWorkSnapshot } from './activeWork'
import { loadUpdateSettings, saveUpdateSettings, resolveUpdateSettingsPath } from './updateSettings'

function writeInitLog(message: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'update-init.log'), `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // best effort
  }
}

type BroadcastFn = (channel: string, payload: unknown) => void
type AutoDownloadEnabled = () => boolean
type SkippedVersionFn = () => string | undefined

interface ElectronUpdaterModuleShape {
  autoUpdater?: AppUpdater
  default?: { autoUpdater?: AppUpdater }
  'module.exports'?: { autoUpdater?: AppUpdater }
}

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
  const imported: unknown = await import('electron-updater')
  if (typeof imported !== 'object' || imported === null) {
    throw new Error('electron-updater returned an invalid module')
  }

  const mod = imported as ElectronUpdaterModuleShape
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater ?? mod['module.exports']?.autoUpdater
  if (!autoUpdater) {
    throw new Error('electron-updater did not expose autoUpdater')
  }
  return autoUpdater
}

function formatInitError(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err)
  return `In-app updates are not available: ${detail}`
}

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
  writeInitLog('init: starting')
  try {
    autoUpdater = customDeps?.autoUpdater ?? (await loadDefaultAutoUpdater())
    writeInitLog(`init: autoUpdater loaded, type=${autoUpdater ? typeof autoUpdater : 'null'}`)
  } catch (err) {
    writeInitLog(`init: load FAILED: ${err instanceof Error ? err.stack || err.message : String(err)}`)
    console.warn('[update] autoUpdater load failed, in-app updates disabled:', err)
    deps = unavailableDeps(broadcast, getCurrentVersion)
    setStatus({ status: 'error', currentVersion: getCurrentVersion(), error: formatInitError(err) })
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
  writeInitLog(`check: deps=${!!deps}, autoUpdater=${deps ? typeof deps.autoUpdater : 'n/a'}`)
  if (!deps) throw new Error('Update manager not initialized.')
  if (!deps.autoUpdater) throw new Error('In-app updates are not available.')
  if (isUpdaterActive()) throw new Error('An update check or download is already in progress.')
  if (hasActiveWork(deps.getActiveWork())) {
    throw new Error('Updates are blocked while another operation is in progress.')
  }
  await deps.autoUpdater.checkForUpdates()
  return getUpdateState()
}

export async function downloadUpdate(): Promise<void> {
  if (!deps) throw new Error('Update manager not initialized.')
  if (!deps.autoUpdater) throw new Error('In-app updates are not available.')
  if (isUpdaterActive()) throw new Error('An update check or download is already in progress.')
  if (hasActiveWork(deps.getActiveWork())) {
    throw new Error('Updates are blocked while another operation is in progress.')
  }
  await deps.autoUpdater.downloadUpdate()
}

export function quitAndInstall(): void {
  if (!deps) throw new Error('Update manager not initialized.')
  if (!deps.autoUpdater) throw new Error('In-app updates are not available.')
  deps.autoUpdater.quitAndInstall()
}

export function isAutoDownloadAllowed(): boolean {
  return Boolean(deps?.isAutoDownloadEnabled())
}

export function __resetUpdateManagerForTests(): void {
  deps = null
  currentState = null
}
