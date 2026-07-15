import React, { useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { UpdatePreferences } from '../../../shared/update'
import { Download, RefreshCw, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

function statusLabel(state: { status: string; currentVersion?: string; available?: { version?: string } } | null): string {
  if (!state) return 'Idle'
  switch (state.status) {
    case 'idle': return 'Idle'
    case 'checking': return 'Checking for updates...'
    case 'available': return `Update available: v${state.available?.version || '?'}`
    case 'not-available': return `You're on v${state.currentVersion || '?'} (latest)`
    case 'downloading': return 'Downloading update...'
    case 'downloaded': return 'Update ready to install'
    case 'error': return 'Update check failed'
    default: return state.status
  }
}

export default function UpdateSettings() {
  const appUpdateState = useStore((s) => s.appUpdateState)
  const appUpdatePreferences = useStore((s) => s.appUpdatePreferences)
  const setAppUpdateState = useStore((s) => s.setAppUpdateState)
  const setAppUpdatePreferences = useStore((s) => s.setAppUpdatePreferences)

  useEffect(() => {
    if (appUpdateState) return
    void window.api.updateGetState().then((state) => setAppUpdateState(state as never))
    void window.api.updateGetPreferences().then((prefs) => setAppUpdatePreferences(prefs as never))
  }, [appUpdateState, setAppUpdateState, setAppUpdatePreferences])

  async function handleCheck() {
    const res = await window.api.updateCheck()
    if (!res.success && res.error) {
      setAppUpdateState({ status: 'error', currentVersion: appUpdateState?.currentVersion || '?', error: res.error })
    }
  }

  async function handleDownload() {
    const res = await window.api.updateDownload()
    if (!res.success && res.error) {
      setAppUpdateState({ status: 'error', currentVersion: appUpdateState?.currentVersion || '?', error: res.error })
    }
  }

  async function handleInstall() {
    await window.api.updateInstallAndRestart()
  }

  async function handlePrefChange<K extends keyof UpdatePreferences>(key: K, value: UpdatePreferences[K]) {
    if (!appUpdatePreferences) return
    const next: UpdatePreferences = { ...appUpdatePreferences, [key]: value }
    const saved = await window.api.updateSetPreferences(next)
    setAppUpdatePreferences(saved as never)
  }

  const state = appUpdateState
  const prefs = appUpdatePreferences
  const isChecking = state?.status === 'checking'
  const isAvailable = state?.status === 'available'
  const isDownloading = state?.status === 'downloading'
  const isDownloaded = state?.status === 'downloaded'
  const isError = state?.status === 'error'
  const isBusy = isChecking || isDownloading

  return (
    <div className="update-settings">
      <div className="settings-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <div className="flex items-center gap-2">
          <Download size={14} />
          <span className="settings-row-label">App updates</span>
        </div>
        <div className="settings-row-sub">
          {state ? statusLabel(state as never) : 'Loading update status...'}
        </div>

        {isError && state?.error && (
          <div className="text-danger text-sm flex items-center gap-2">
            <AlertCircle size={14} /> {state.error}
          </div>
        )}

        {isDownloading && state?.progress && (
          <div className="update-progress w-full">
            <div className="update-progress-bar">
              <div className="update-progress-fill" style={{ width: `${Math.round(state.progress.percent)}%` }} />
            </div>
            <div className="update-progress-label">
              {Math.round(state.progress.percent)}% · {(state.progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s
            </div>
          </div>
        )}

        {isDownloaded && (
          <div className="text-sm flex items-center gap-2" style={{ color: 'var(--success)' }}>
            <CheckCircle2 size={14} /> Ready to install
          </div>
        )}

        {state?.available?.releaseNotes && isAvailable && (
          <details className="update-notes w-full">
            <summary className="text-sm" style={{ cursor: 'pointer' }}>Release notes</summary>
            <pre className="text-sm" style={{ whiteSpace: 'pre-wrap', marginTop: 8, padding: 8, background: 'var(--bg-elevated)', borderRadius: 6 }}>
              {state.available.releaseNotes}
            </pre>
          </details>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => void handleCheck()}
          disabled={isBusy}
        >
          {isChecking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          Check for updates
        </button>
        {isAvailable && (
          <button className="btn btn-primary btn-sm" onClick={() => void handleDownload()} disabled={isBusy}>
            {isDownloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            Download
          </button>
        )}
        {isDownloaded && (
          <button className="btn btn-primary btn-sm" onClick={() => void handleInstall()}>
            <Download size={14} /> Restart to install
          </button>
        )}
      </div>

      {prefs && (
        <div className="settings-row mt-3" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.checkOnLaunch}
              onChange={(e) => void handlePrefChange('checkOnLaunch', e.target.checked)}
            />
            Check for updates on launch
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.autoDownload}
              onChange={(e) => void handlePrefChange('autoDownload', e.target.checked)}
            />
            Automatically download updates (you will still be asked to install)
          </label>
        </div>
      )}
    </div>
  )
}