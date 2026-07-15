import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.1.5',
    getPath: (key: string) => key === 'userData' ? process.env.HEXLLAMA_TEST_USER_DATA || process.cwd() : process.cwd()
  }
}))

const defaultUpdaterModule = vi.hoisted(() => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn().mockResolvedValue(null),
    downloadUpdate: vi.fn().mockResolvedValue([]),
    quitAndInstall: vi.fn(),
    on: vi.fn()
  }
}))

vi.mock('electron-updater', () => ({ autoUpdater: undefined, default: defaultUpdaterModule }))

type UpdateManagerModule = typeof import('../updateManager')

class FakeAutoUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  checkForUpdates = vi.fn().mockResolvedValue(null)
  downloadUpdate = vi.fn().mockResolvedValue([])
  quitAndInstall = vi.fn()
}

let updateManager: UpdateManagerModule
let autoDownloadEnabled = false
let skippedVersion: string | undefined
let broadcasts: { channel: string; payload: unknown }[]
let fakeUpdater: FakeAutoUpdater
let work: string

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  defaultUpdaterModule.autoUpdater.autoDownload = true
  defaultUpdaterModule.autoUpdater.autoInstallOnAppQuit = true
  updateManager = await import('../updateManager')
  work = mkdtempSync(join(tmpdir(), 'hexllama-updatemanager-'))
  autoDownloadEnabled = false
  skippedVersion = undefined
  broadcasts = []
  fakeUpdater = new FakeAutoUpdater()
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

type ActiveWorkSnapshotLike = Parameters<typeof updateManager.checkForUpdates>[0] extends never
  ? {
      sourceUpdateJob: { cancelled: boolean; process: { pid?: number } } | null
      cancelBackendDl: (() => void) | null
      downloadTasks: Map<string, { phase: 'downloading' | 'paused' | 'done' | 'error' | 'cancelled' }>
    }
  : never

function makeActiveWork(overrides: Partial<ActiveWorkSnapshotLike> = {}): ActiveWorkSnapshotLike {
  return {
    sourceUpdateJob: null,
    cancelBackendDl: null,
    downloadTasks: new Map(),
    ...overrides
  } as ActiveWorkSnapshotLike
}

function initWith(activeWork: ActiveWorkSnapshotLike = makeActiveWork()): Promise<void> {
  return updateManager.initUpdateManager({
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    getCurrentVersion: () => '1.1.5',
    getActiveWork: () => activeWork,
    isAutoDownloadEnabled: () => autoDownloadEnabled,
    getSkippedVersion: () => skippedVersion,
    autoUpdater: fakeUpdater as unknown as NonNullable<Parameters<typeof updateManager.initUpdateManager>[0]> extends infer D
      ? D extends { autoUpdater?: infer A }
        ? A
        : never
      : never
  })
}

describe('initUpdateManager', () => {
  it('loads autoUpdater from the CommonJS default export', async () => {
    await updateManager.initUpdateManager({ getCurrentVersion: () => '1.1.5' })

    expect(updateManager.getUpdateState().status).toBe('idle')
    expect(defaultUpdaterModule.autoUpdater.autoDownload).toBe(false)
    expect(defaultUpdaterModule.autoUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('initializes state to idle with the current version', async () => {
    await initWith()
    const state = updateManager.getUpdateState()
    expect(state.status).toBe('idle')
    expect(state.currentVersion).toBe('1.1.5')
  })

  it('disables autoDownload and autoInstallOnAppQuit', async () => {
    await initWith()
    expect(fakeUpdater.autoDownload).toBe(false)
    expect(fakeUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('broadcasts the initial state', async () => {
    await initWith()
    expect(broadcasts.length).toBeGreaterThan(0)
    expect(broadcasts[broadcasts.length - 1].channel).toBe('update:state-changed')
  })
})

describe('event handling', () => {
  beforeEach(async () => {
    await initWith()
  })

  it('transitions idle → checking on checking-for-update', () => {
    fakeUpdater.emit('checking-for-update')
    expect(updateManager.getUpdateState().status).toBe('checking')
  })

  it('transitions to available on update-available with version info', () => {
    const info: UpdateInfo = { version: '1.2.0', releaseDate: '2026-07-15', releaseNotes: 'Bug fixes' }
    fakeUpdater.emit('update-available', info)
    const state = updateManager.getUpdateState()
    expect(state.status).toBe('available')
    expect(state.available?.version).toBe('1.2.0')
    expect(state.available?.releaseNotes).toBe('Bug fixes')
  })

  it('skips available broadcast when version matches skippedVersion', async () => {
    skippedVersion = '1.2.0'
    await initWith()
    const info: UpdateInfo = { version: '1.2.0' }
    fakeUpdater.emit('update-available', info)
    const state = updateManager.getUpdateState()
    expect(state.status).toBe('not-available')
    expect(state.available).toBeUndefined()
  })

  it('transitions to not-available on update-not-available', () => {
    fakeUpdater.emit('update-not-available')
    expect(updateManager.getUpdateState().status).toBe('not-available')
  })

  it('transitions to downloading on download-progress', () => {
    const progress: ProgressInfo = { percent: 42, bytesPerSecond: 1024, transferred: 512, total: 1024 }
    fakeUpdater.emit('download-progress', progress)
    const state = updateManager.getUpdateState()
    expect(state.status).toBe('downloading')
    expect(state.progress?.percent).toBe(42)
  })

  it('transitions to downloaded on update-downloaded', () => {
    fakeUpdater.emit('update-downloaded')
    expect(updateManager.getUpdateState().status).toBe('downloaded')
  })

  it('transitions to error on error event with message', () => {
    fakeUpdater.emit('error', new Error('boom'))
    const state = updateManager.getUpdateState()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })
})

describe('checkForUpdates', () => {
  it('invokes autoUpdater.checkForUpdates', async () => {
    await initWith()
    await updateManager.checkForUpdates()
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('rejects a second operation while a check is genuinely in progress', async () => {
    await initWith()
    let finishCheck: (() => void) | undefined
    fakeUpdater.checkForUpdates.mockImplementationOnce(() => new Promise<null>((resolve) => {
      finishCheck = () => resolve(null)
    }))

    const firstCheck = updateManager.checkForUpdates()
    await expect(updateManager.checkForUpdates()).rejects.toThrow(/already in progress/)
    await expect(updateManager.downloadUpdate()).rejects.toThrow(/already in progress/)

    finishCheck?.()
    await firstCheck
  })

  it('allows another check after a failed check releases the operation lock', async () => {
    await initWith()
    fakeUpdater.checkForUpdates.mockRejectedValueOnce(new Error('network unavailable'))

    await expect(updateManager.checkForUpdates()).rejects.toThrow('network unavailable')
    await expect(updateManager.checkForUpdates()).resolves.toMatchObject({ currentVersion: '1.1.5' })
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('rejects when active work is in progress', async () => {
    const activeWork = makeActiveWork({
      sourceUpdateJob: { cancelled: false, process: {} }
    })
    await initWith(activeWork)
    await expect(updateManager.checkForUpdates()).rejects.toThrow(/blocked/)
  })
})

describe('downloadUpdate', () => {
  it('invokes autoUpdater.downloadUpdate', async () => {
    await initWith()
    await updateManager.downloadUpdate()
    expect(fakeUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('rejects when active work is in progress', async () => {
    const activeWork = makeActiveWork({
      downloadTasks: new Map([['a', { phase: 'downloading' as const }]])
    })
    await initWith(activeWork)
    await expect(updateManager.downloadUpdate()).rejects.toThrow(/blocked/)
  })
})

describe('quitAndInstall', () => {
  it('invokes autoUpdater.quitAndInstall', async () => {
    await initWith()
    updateManager.quitAndInstall()
    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})

describe('preferences', () => {
  beforeEach(() => {
    process.env.HEXLLAMA_TEST_USER_DATA = work
  })

  it('returns defaults when no settings file exists', async () => {
    await initWith()
    const prefs = updateManager.getUpdatePreferences()
    expect(prefs.checkOnLaunch).toBe(true)
    expect(prefs.autoDownload).toBe(false)
  })

  it('round-trips preferences through save/getUpdatePreferences', async () => {
    await initWith()
    updateManager.setUpdatePreferences({ checkOnLaunch: false, autoDownload: true, skippedVersion: '1.2.0' })
    const prefs = updateManager.getUpdatePreferences()
    expect(prefs).toEqual({ checkOnLaunch: false, autoDownload: true, skippedVersion: '1.2.0' })
  })

  it('reads pre-existing settings file', async () => {
    const path = join(work, 'update-settings.json')
    writeFileSync(path, JSON.stringify({ checkOnLaunch: false, autoDownload: true, skippedVersion: '9.9.9' }), 'utf8')
    await initWith()
    const prefs = updateManager.getUpdatePreferences()
    expect(prefs).toEqual({ checkOnLaunch: false, autoDownload: true, skippedVersion: '9.9.9' })
  })
})

describe('isAutoDownloadAllowed', () => {
  it('reflects the deps.isAutoDownloadEnabled accessor', async () => {
    autoDownloadEnabled = false
    await initWith()
    expect(updateManager.isAutoDownloadAllowed()).toBe(false)
  })
})
