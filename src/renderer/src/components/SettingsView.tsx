import React, { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { HardDrive, Download, Trash, RefreshCw, Loader2, ChevronDown, Terminal, Bell, BellOff, FolderOpen, Moon, Sun, Monitor } from 'lucide-react'
import CommandsEditor from './CommandsEditor'
import UpdateSettings from './UpdateSettings'
import type { AppWindowBehaviorSettings, BackendBuildFlavor, BackendVersion, Template } from '../../../shared/types'
import type { ModelFileInfo, ThemeMode } from '../store/useStore'

const NOTIF_KEY = 'hexllama_update_notify'

type FolderKind = 'models' | 'backend'

interface FilesystemSnapshot {
  paths: { models: string; templates: string; backend: string }
  models: ModelFileInfo[]
  backends: BackendVersion[]
}

interface BackendSourceUpdateResult {
  snapshot: FilesystemSnapshot
  templates: Template[]
  activeBackendName: string
}

function hasInstalledBuild(backends: BackendVersion[], tagName: string, flavor: BackendBuildFlavor): boolean {
  const expectedBackendName = flavor === 'cpu' ? `${tagName}-cpu` : tagName
  return backends.some((backend) => backend.name === expectedBackendName)
}

function formatUpdateProgress(progress: { percent: number; phase: string } | null): string {
  if (!progress) return ''

  const labels: Record<string, string> = {
    starting: 'Starting source update',
    environment: 'Loading build environment',
    fetching: 'Fetching upstream changes',
    resetting: 'Resetting repository',
    configuring: 'Configuring build',
    building: 'Compiling source',
    finalizing: 'Finalizing build',
    done: 'Build complete',
    cancelled: 'Update cancelled'
  }

  const label = labels[progress.phase] || progress.phase
  if (progress.phase === 'done' || progress.phase === 'cancelled') return label
  return `${label}... ${progress.percent || 0}%`
}

function getNotifPref(): 'banner' | 'manual' {
  return (localStorage.getItem(NOTIF_KEY) as 'banner' | 'manual') || 'banner'
}

export default function SettingsView() {
  const {
    backends, activeBackend, setActiveBackend, setCommandsSchema, setBackends,
    setModels, setCards, paths, setPaths, modelDownloads,
    releaseInfo, checkingUpdate, downloadProgress, setDownloadProgress, setCheckingUpdate, setReleaseInfo,
    themeMode, setThemeMode
  } = useStore()
  const [updatingSource, setUpdatingSource] = useState(false)
  const [expandedEditor, setExpandedEditor] = useState<string | null>(null)
  const [notifPref, setNotifPref] = useState<'banner' | 'manual'>(getNotifPref())
  const [appVersion, setAppVersion] = useState<string>('')
  useEffect(() => {
    window.api.getAppVersion().then((res) => { if (res.version) setAppVersion(res.version) }).catch(() => {})
  }, [])
  const [changingFolder, setChangingFolder] = useState<FolderKind | null>(null)
  const [windowBehaviorSettings, setWindowBehaviorSettings] = useState<AppWindowBehaviorSettings>({ minimizeToTray: false })
  const [loadingWindowBehaviorSettings, setLoadingWindowBehaviorSettings] = useState(true)
  const latestTagName = releaseInfo?.tagName?.trim() || ''
  const hasCpuBuild = latestTagName ? hasInstalledBuild(backends, latestTagName, 'cpu') : false
  const hasCudaBuild = latestTagName ? hasInstalledBuild(backends, latestTagName, 'cuda') : false
  const canBuildCpu = Boolean(latestTagName) && !hasCpuBuild
  const canBuildCuda = Boolean(latestTagName) && !hasCudaBuild

  useEffect(() => {
    void window.api.getAppWindowBehaviorSettings().then((settings) => {
      setWindowBehaviorSettings(settings)
      setLoadingWindowBehaviorSettings(false)
    }).catch(() => {
      setLoadingWindowBehaviorSettings(false)
    })
  }, [])

  const hasActiveDownloads = updatingSource || !!downloadProgress || Object.values(modelDownloads).some((download) => !['done', 'error', 'cancelled'].includes(download.phase))

  function handleNotifPref(pref: 'banner' | 'manual') {
    setNotifPref(pref)
    localStorage.setItem(NOTIF_KEY, pref)
  }

  function handleThemeMode(mode: ThemeMode) {
    setThemeMode(mode)
  }

  async function handleMinimizeToTrayChange(minimizeToTray: boolean) {
    setLoadingWindowBehaviorSettings(true)
    const result = await window.api.saveAppWindowBehaviorSettings({ minimizeToTray })
    if (!result.success) {
      setLoadingWindowBehaviorSettings(false)
      alert(`Failed to update window behavior: ${result.error || 'Unknown error'}`)
      return
    }

    setWindowBehaviorSettings(result.settings)
    setLoadingWindowBehaviorSettings(false)
  }


  async function applyFilesystemSnapshot(snapshot: FilesystemSnapshot) {
    setPaths(snapshot.paths)
    setModels(snapshot.models)
    setBackends(snapshot.backends)

    const nextActiveBackend = snapshot.backends.find((backend) => backend.name === activeBackend?.name) ?? snapshot.backends[0] ?? null
    setActiveBackend(nextActiveBackend)

    const commands = nextActiveBackend
      ? await window.api.getCommands(nextActiveBackend.name)
      : await window.api.getCommands('')

    setCommandsSchema(commands)
  }

  async function applyBackendUpdateResult(result: BackendSourceUpdateResult) {
    const currentActiveBackend = useStore.getState().activeBackend

    setPaths(result.snapshot.paths)
    setModels(result.snapshot.models)
    setBackends(result.snapshot.backends)
    setCards(result.templates.map((template) => ({ template, status: 'idle', expanded: false })))

    const nextActiveBackend = currentActiveBackend
      ? result.snapshot.backends.find((backend) => backend.name === currentActiveBackend.name) ?? currentActiveBackend
      : result.snapshot.backends.find((backend) => backend.name === result.activeBackendName) ?? result.snapshot.backends[0] ?? null

    if (nextActiveBackend) {
      setActiveBackend(nextActiveBackend)
    }

    const commands = nextActiveBackend
      ? await window.api.getCommands(nextActiveBackend.name)
      : await window.api.getCommands('')

    setCommandsSchema(commands)
    setReleaseInfo(await window.api.checkUpdates())
  }

  async function handleChangeFolder(kind: FolderKind) {
    if (hasActiveDownloads) {
      alert('Finish or cancel active downloads before changing storage folders.')
      return
    }

    const selectedPath = await window.api.chooseAppFolder(kind)
    if (!selectedPath) return

    setChangingFolder(kind)
    try {
      const result = await window.api.setAppFolder(kind, selectedPath)
      if (!result.success) {
        alert(`Failed to update ${kind} folder: ${result.error || 'Unknown error'}`)
        return
      }

      await applyFilesystemSnapshot(result.snapshot)
    } finally {
      setChangingFolder(null)
    }
  }

  async function handleSwitchBackend(name: string) {
    const b = backends.find(x => x.name === name)
    if (!b) return
    setActiveBackend(b)
    const cmds = await window.api.getCommands(name)
    setCommandsSchema(cmds)
  }

  async function handleDeleteBackend(name: string) {
    if (!confirm(`Delete backend "${name}"? This will remove all files in that folder.`)) return
    const res = await window.api.deleteBackend(name)
    if (res.success) {
      const updated = await window.api.listBackends()
      setBackends(updated)
    } else alert('Delete failed: ' + res.error)
  }

  async function handleCheckUpdates() {
    setCheckingUpdate(true)
    try {
      const info = await window.api.checkUpdates()
      setReleaseInfo(info)
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleSourceUpdate = async (flavor: BackendBuildFlavor) => {
    if (!releaseInfo?.tagName) return

    setUpdatingSource(true)
    try {
      const res = await window.api.updateBackendSource(releaseInfo.tagName, flavor)
      if (res.success) {
        await applyBackendUpdateResult(res.result)
      } else if (res.cancelled) {
        return
      } else {
        alert(`Source update failed: ${res.error}`)
      }
    } catch (error) {
      alert(`Source update failed: ${String(error)}`)
    } finally {
      setUpdatingSource(false)
      setDownloadProgress(null)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage llama.cpp backends and configurations</p>
        </div>
        {appVersion && <span className="version-badge">LlamaDeck v{appVersion}</span>}
      </div>

      <div className="settings-section">
        <div className="settings-section-title"><Moon /> Appearance</div>
        <div className="settings-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Choose how LlamaDeck should render its interface. System follows your OS preference, while Light and Dark stay fixed.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className={`launch-mode-btn ${themeMode === 'system' ? 'active' : ''}`}
              onClick={() => handleThemeMode('system')}
            >
              <Monitor size={13} />
              System
            </button>
            <button
              className={`launch-mode-btn ${themeMode === 'light' ? 'active' : ''}`}
              onClick={() => handleThemeMode('light')}
            >
              <Sun size={13} />
              Light
            </button>
            <button
              className={`launch-mode-btn ${themeMode === 'dark' ? 'active' : ''}`}
              onClick={() => handleThemeMode('dark')}
            >
              <Moon size={13} />
              Dark
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            The theme is saved locally and applies to the main UI and chat windows.
          </p>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title"><Monitor /> Window Behavior</div>
        <div className="settings-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Control what happens when you click the main window close button.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className={`launch-mode-btn ${windowBehaviorSettings.minimizeToTray ? 'active' : ''}`}
              onClick={() => void handleMinimizeToTrayChange(true)}
              disabled={loadingWindowBehaviorSettings}
            >
              Minimize To Tray
            </button>
            <button
              className={`launch-mode-btn ${!windowBehaviorSettings.minimizeToTray ? 'active' : ''}`}
              onClick={() => void handleMinimizeToTrayChange(false)}
              disabled={loadingWindowBehaviorSettings}
            >
              Close Normally
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {loadingWindowBehaviorSettings
              ? 'Loading current window behavior...'
              : 'When enabled, clicking X hides the app to the system tray instead of quitting. Use the tray icon to reopen or quit.'}
          </p>
        </div>
      </div>

      {}
      <div className="settings-section">
        <div className="settings-section-title"><Bell /> Update Notifications</div>
        <div className="settings-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Choose how you'd like to be informed when a new version of llama.cpp is available.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`launch-mode-btn ${notifPref === 'banner' ? 'active' : ''}`}
              onClick={() => handleNotifPref('banner')}
            >
              <Bell size={13} />
              Show Banner Automatically
            </button>
            <button
              className={`launch-mode-btn ${notifPref === 'manual' ? 'active' : ''}`}
              onClick={() => handleNotifPref('manual')}
            >
              <BellOff size={13} />
              Check Manually Only
            </button>
          </div>
          {notifPref === 'manual' && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              The update banner will not be shown automatically. Use "Check Now" below anytime.
            </p>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title"><FolderOpen /> Storage Locations</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Models Folder</div>
            <div className="settings-row-sub mono">{paths?.models || 'Loading...'}</div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleChangeFolder('models')}
              disabled={!paths || hasActiveDownloads || changingFolder !== null}
            >
              {changingFolder === 'models' ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
              Browse
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => paths && window.api.openFolder(paths.models)}
              disabled={!paths}
              title={paths?.models}
            >
              Open
            </button>
          </div>
        </div>
        <div className="settings-row" style={{ borderBottom: 'none' }}>
          <div>
            <div className="settings-row-label">Backend Folder</div>
            <div className="settings-row-sub mono">{paths?.backend || 'Loading...'}</div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleChangeFolder('backend')}
              disabled={!paths || hasActiveDownloads || changingFolder !== null}
            >
              {changingFolder === 'backend' ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
              Browse
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => paths && window.api.openFolder(paths.backend)}
              disabled={!paths}
              title={paths?.backend}
            >
              Open
            </button>
          </div>
        </div>
        {hasActiveDownloads && (
          <p style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            Storage folders are locked while downloads are active.
          </p>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title"><HardDrive /> Installed Backends</div>
        {backends.length === 0 ? (
          <div className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
            No backends installed. Download one below.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {backends.map((b) => (
              <div key={b.name}>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label flex items-center gap-2">
                      {b.displayName}
                      <span className="version-badge">{b.flavor.toUpperCase()}</span>
                      {activeBackend?.name === b.name && <span className="version-badge active-version">Active</span>}
                    </div>
                    <div className="settings-row-sub mono">{b.name} · {b.exe || 'No executable found'}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleSwitchBackend(b.name)}
                      disabled={activeBackend?.name === b.name}
                    >
                      Set Active
                    </button>
                    <button
                      className={`btn btn-ghost btn-sm flex items-center gap-1 ${expandedEditor === b.name ? 'btn-primary' : ''}`}
                      onClick={() => setExpandedEditor(expandedEditor === b.name ? null : b.name)}
                      title="Edit commands.json"
                    >
                      <Terminal size={13} />
                      <ChevronDown size={12} style={{ transform: expandedEditor === b.name ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon text-danger"
                      onClick={() => handleDeleteBackend(b.name)}
                      title="Delete backend"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
                {expandedEditor === b.name && (
                  <div className="ce-panel">
                    <CommandsEditor backendName={b.name} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {}
      <div className="settings-section">
        <div className="settings-section-title"><Download /> Available Updates</div>
        {checkingUpdate ? (
          <div className="flex items-center gap-2 text-sm py-4" style={{ color: 'var(--text-muted)' }}>
            <RefreshCw size={14} className="spin" /> Checking upstream git tags...
          </div>
        ) : releaseInfo ? (
          releaseInfo.error ? (
            <div className="text-danger text-sm py-2">Error: {releaseInfo.error}</div>
          ) : (
            <div className="settings-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div className="settings-row-label">{releaseInfo.name || releaseInfo.tagName}</div>
                <div className="settings-row-sub">
                  {releaseInfo.publishedAt ? `Published: ${new Date(releaseInfo.publishedAt).toLocaleDateString()}` : 'Checked against upstream git tags'}
                  {releaseInfo.isNewer === false && <span style={{ marginLeft: 8, color: 'var(--success)' }}>✓ Up to date</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 w-full">
                {updatingSource || downloadProgress ? (
                  <div className="text-sm flex items-center gap-3" style={{ color: 'var(--text-muted)' }}>
                    <Loader2 size={14} className="spin" />
                    {formatUpdateProgress(downloadProgress)}
                    <button 
                      className="btn btn-ghost btn-sm text-danger" 
                      onClick={() => { void window.api.cancelBackendDownload() }}
                      style={{ padding: '0 8px' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : canBuildCpu || canBuildCuda ? (
                  <>
                    {canBuildCpu && <button className="btn btn-secondary btn-sm" onClick={() => void handleSourceUpdate('cpu')}>Build CPU Only</button>}
                    {canBuildCuda && <button className="btn btn-primary btn-sm" onClick={() => void handleSourceUpdate('cuda')}>Build CUDA</button>}
                  </>
                ) : null
                }
              </div>
            </div>
          )
        ) : (
          <div className="text-sm py-4" style={{ color: 'var(--text-muted)' }}>Click "Check Now" to query GitHub.</div>
        )}
        <div className="mt-4 pt-4 border-t">
          <button className="btn btn-secondary w-full justify-center" onClick={handleCheckUpdates} disabled={checkingUpdate || updatingSource}>
            <RefreshCw size={14} className={checkingUpdate ? 'spin' : ''} /> Check Now
          </button>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title"><Download /> App Updates</div>
        <UpdateSettings />
      </div>
    </div>
  )
}
