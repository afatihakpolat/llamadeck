import React, { useEffect, useRef, useState } from 'react'
import { RefreshCw, Loader2, Download, Upload, Play, Square, Save, Terminal, FileText, Package, AlertCircle } from 'lucide-react'
import type { LiteLlmLogLevel, LiteLlmManagerSnapshot, LiteLlmModelEntry } from '../../../shared/types'

type BusyAction = 'refresh' | 'save-runtime' | 'save-config' | 'install' | 'update' | 'start' | 'stop' | 'test' | 'models' | null

function buildLocalBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

export default function LiteLlmView() {
  const [manager, setManager] = useState<LiteLlmManagerSnapshot | null>(null)
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState(4000)
  const [logLevel, setLogLevel] = useState<LiteLlmLogLevel>('info')
  const [apiKey, setApiKey] = useState('')
  const [configText, setConfigText] = useState('')
  const [managerDraftDirty, setManagerDraftDirty] = useState(false)
  const [configDirty, setConfigDirty] = useState(false)
  const managerDraftDirtyRef = useRef(false)
  const configDirtyRef = useRef(false)
  const [liteLlmModels, setLiteLlmModels] = useState<LiteLlmModelEntry[]>([])
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [managerStatus, setManagerStatus] = useState<{ tone: 'muted' | 'success' | 'danger'; text: string } | null>(null)
  const [proxyStatus, setProxyStatus] = useState<{ tone: 'muted' | 'success' | 'danger'; text: string } | null>(null)

  function applyManagerSnapshot(snapshot: LiteLlmManagerSnapshot, syncDrafts = false) {
    setManager(snapshot)
    if (syncDrafts || !managerDraftDirtyRef.current) {
      setHost(snapshot.settings.host)
      setPort(snapshot.settings.port)
      setLogLevel(snapshot.settings.logLevel)
      setApiKey(snapshot.settings.apiKey)
      setManagerDraftDirty(false)
      managerDraftDirtyRef.current = false
    }
    if (syncDrafts || !configDirtyRef.current) {
      setConfigText(snapshot.configText)
      setConfigDirty(false)
      configDirtyRef.current = false
    }
  }

  async function loadManager(syncDrafts = false) {
    const snapshot = await window.api.getLiteLlmManager()
    applyManagerSnapshot(snapshot, syncDrafts)
  }

  useEffect(() => {
    void loadManager(true)

    const interval = window.setInterval(() => {
      void loadManager(false)
    }, 3000)

    return () => window.clearInterval(interval)
  }, [])

  async function handleRefreshManager() {
    setBusyAction('refresh')
    try {
      await loadManager(true)
      setManagerStatus({ tone: 'success', text: 'LiteLLM status refreshed.' })
    } catch (error) {
      setManagerStatus({ tone: 'danger', text: `Failed to refresh LiteLLM status: ${String(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveRuntime() {
    setBusyAction('save-runtime')
    try {
      const result = await window.api.saveLiteLlmManagerSettings({ host, port, logLevel, apiKey })
      if (!result.success) {
        throw new Error(result.error || 'Failed to save LiteLLM runtime settings.')
      }

      applyManagerSnapshot(result.snapshot, true)
      setManagerStatus({ tone: 'success', text: 'LiteLLM runtime settings saved.' })
    } catch (error) {
      setManagerStatus({ tone: 'danger', text: String(error) })
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveConfig() {
    setBusyAction('save-config')
    try {
      const result = await window.api.saveLiteLlmConfig(configText)
      if (!result.success) {
        throw new Error(result.error || 'Failed to save LiteLLM config.')
      }

      applyManagerSnapshot(result.snapshot, false)
      setConfigDirty(false)
      configDirtyRef.current = false
      setManagerStatus({ tone: 'success', text: 'LiteLLM config saved.' })
    } catch (error) {
      setManagerStatus({ tone: 'danger', text: String(error) })
    } finally {
      setBusyAction(null)
    }
  }

  async function handleInstall(upgrade: boolean) {
    setBusyAction(upgrade ? 'update' : 'install')
    try {
      const result = upgrade ? await window.api.updateLiteLlm() : await window.api.installLiteLlm()
      if (!result.success) {
        throw new Error(result.error || (upgrade ? 'LiteLLM update failed.' : 'LiteLLM installation failed.'))
      }

      applyManagerSnapshot(result.snapshot, false)
      setManagerStatus({ tone: 'success', text: upgrade ? 'LiteLLM updated successfully.' : 'LiteLLM installed successfully.' })
    } catch (error) {
      setManagerStatus({ tone: 'danger', text: String(error) })
      await loadManager(false)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleStartStop() {
    setBusyAction(manager?.running ? 'stop' : 'start')
    try {
      const result = manager?.running ? await window.api.stopLiteLlmProxy() : await window.api.startLiteLlmProxy()
      if (!result.success) {
        throw new Error(result.error || `Failed to ${manager?.running ? 'stop' : 'start'} LiteLLM proxy.`)
      }

      applyManagerSnapshot(result.snapshot, false)
      setManagerStatus({ tone: 'success', text: manager?.running ? 'LiteLLM proxy stopped.' : 'LiteLLM proxy started.' })
    } catch (error) {
      setManagerStatus({ tone: 'danger', text: String(error) })
      await loadManager(false)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleTestProxy() {
    setBusyAction('test')
    try {
      const result = await window.api.testLiteLlmConnection()
      if (!result.success) {
        throw new Error(result.error || 'Connection test failed.')
      }

      setProxyStatus({ tone: 'success', text: `LiteLLM proxy OK. ${result.modelCount} model${result.modelCount === 1 ? '' : 's'} reported.` })
    } catch (error) {
      setProxyStatus({ tone: 'danger', text: String(error) })
    } finally {
      setBusyAction(null)
    }
  }

  async function handleRefreshModels() {
    setBusyAction('models')
    try {
      const result = await window.api.listLiteLlmModels()
      if (!result.success) {
        throw new Error(result.error || 'Failed to load LiteLLM models.')
      }

      setLiteLlmModels(result.models)
      setProxyStatus({ tone: 'success', text: `Loaded ${result.models.length} LiteLLM model${result.models.length === 1 ? '' : 's'}.` })
    } catch (error) {
      setProxyStatus({ tone: 'danger', text: String(error) })
    } finally {
      setBusyAction(null)
    }
  }

  const localBaseUrl = buildLocalBaseUrl(port)
  const activeLocalBaseUrl = buildLocalBaseUrl(manager?.settings.port ?? port)
  const install = manager?.install

  return (
    <div className="max-w-3xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">LiteLLM</h1>
          <p className="page-subtitle">Install, configure, update, and run a LiteLLM proxy from LlamaDeck</p>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title"><Package /> Local Proxy Runtime</div>
        <div className="settings-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span className="version-badge">{install?.installed ? `Installed${install.currentVersion ? ` · ${install.currentVersion}` : ''}` : 'Not Installed'}</span>
            <span className={`version-badge ${manager?.running ? 'active-version' : ''}`}>{manager?.running ? `Running${manager?.pid ? ` · PID ${manager.pid}` : ''}` : 'Stopped'}</span>
            {install?.hasUpdate && install.latestVersion && <span className="version-badge">Update Available · {install.latestVersion}</span>}
          </div>
          <div className="settings-row-sub mono">
            {install?.pythonCommand ? `${install.pythonCommand} · Python ${install.pythonVersion}` : 'Python 3 not detected'}
          </div>
          {install?.error && (
            <div className="text-sm text-danger" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={14} /> {install.error}
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Host</label>
              <input
                type="text"
                className="form-input mono"
                value={host}
                onChange={(event) => { setHost(event.target.value); setManagerDraftDirty(true); managerDraftDirtyRef.current = true }}
                placeholder="127.0.0.1"
              />
              <div className="form-hint">Loopback only. Use `127.0.0.1` or `localhost`.</div>
            </div>
            <div className="form-group">
              <label className="form-label">Port</label>
              <input
                type="number"
                className="form-input mono"
                value={port}
                onChange={(event) => { setPort(Number(event.target.value)); setManagerDraftDirty(true); managerDraftDirtyRef.current = true }}
                min={1}
                max={65535}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Log Level</label>
              <select
                className="form-select"
                value={logLevel}
                onChange={(event) => { setLogLevel(event.target.value as LiteLlmLogLevel); setManagerDraftDirty(true); managerDraftDirtyRef.current = true }}
              >
                <option value="info">Info</option>
                <option value="debug">Debug</option>
                <option value="detailed_debug">Detailed Debug</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Local Proxy API Key</label>
              <input
                type="password"
                className="form-input mono"
                value={apiKey}
                onChange={(event) => { setApiKey(event.target.value); setManagerDraftDirty(true); managerDraftDirtyRef.current = true }}
                placeholder="Leave blank if your local proxy does not require auth"
                autoComplete="off"
              />
              <div className="form-hint">Used for Test Local Proxy and Refresh Models against the managed LiteLLM server. Use the LiteLLM proxy master key here, not an upstream provider API key.</div>
            </div>
          </div>
          <div className="settings-row-sub mono">Config file: {manager?.settings.configPath || 'Loading...'}</div>
          <div className="settings-row-sub">LlamaDeck is currently using the saved local proxy URL {activeLocalBaseUrl}</div>
          {managerDraftDirty && localBaseUrl !== activeLocalBaseUrl && (
            <div className="settings-row-sub">Unsaved runtime draft would switch the local proxy URL to {localBaseUrl}</div>
          )}
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSaveRuntime} disabled={busyAction !== null}>
              {busyAction === 'save-runtime' ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              Save Runtime
            </button>
            {!install?.installed ? (
              <button className="btn btn-secondary btn-sm" onClick={() => void handleInstall(false)} disabled={busyAction !== null || !install?.pythonCommand}>
                {busyAction === 'install' ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                Install LiteLLM
              </button>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => void handleInstall(true)} disabled={busyAction !== null || !install.hasUpdate}>
                {busyAction === 'update' ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                Check / Update LiteLLM
              </button>
            )}
            <button className={`btn btn-sm ${manager?.running ? 'btn-danger' : 'btn-secondary'}`} onClick={handleStartStop} disabled={busyAction !== null || !install?.installed}>
              {busyAction === 'start' || busyAction === 'stop' ? <Loader2 size={14} className="spin" /> : manager?.running ? <Square size={14} /> : <Play size={14} />}
              {manager?.running ? 'Stop Proxy' : 'Start Proxy'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleRefreshManager} disabled={busyAction !== null}>
              {busyAction === 'refresh' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              Refresh Status
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleTestProxy} disabled={busyAction !== null}>
              {busyAction === 'test' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              Test Local Proxy
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleRefreshModels} disabled={busyAction !== null}>
              {busyAction === 'models' ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              Refresh Models
            </button>
            {!install?.pythonCommand && (
              <button className="btn btn-ghost btn-sm" onClick={() => void window.api.openExternal('https://www.python.org/downloads/windows/')} disabled={busyAction !== null}>
                <Download size={14} /> Get Python
              </button>
            )}
          </div>
          {managerStatus && (
            <div className={`text-sm ${managerStatus.tone === 'danger' ? 'text-danger' : ''}`} style={{ color: managerStatus.tone === 'success' ? 'var(--success)' : managerStatus.tone === 'danger' ? 'var(--danger)' : 'var(--text-muted)' }}>
              {managerStatus.text}
            </div>
          )}
          {proxyStatus && (
            <div className={`text-sm ${proxyStatus.tone === 'danger' ? 'text-danger' : ''}`} style={{ color: proxyStatus.tone === 'success' ? 'var(--success)' : proxyStatus.tone === 'danger' ? 'var(--danger)' : 'var(--text-muted)' }}>
              {proxyStatus.text}
            </div>
          )}
          <div>
            <div className="settings-row-label">Discovered Models</div>
            <div className="settings-row-sub">
              {liteLlmModels.length > 0 ? `${liteLlmModels.length} model${liteLlmModels.length === 1 ? '' : 's'} loaded from the managed LiteLLM proxy.` : 'No LiteLLM models loaded yet. Start the local proxy, then use Refresh Models.'}
            </div>
            {liteLlmModels.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {liteLlmModels.slice(0, 12).map((model) => (
                  <span key={model.id} className="version-badge">{model.label}</span>
                ))}
                {liteLlmModels.length > 12 && <span className="version-badge">+{liteLlmModels.length - 12} more</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title"><FileText /> Proxy Config</div>
        <div className="settings-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div className="form-hint" style={{ margin: 0 }}>
            Edit the LiteLLM proxy `config.yaml` used by the local managed process. Save the config before restarting the proxy.
          </div>
          <textarea
            className="form-textarea mono"
            value={configText}
            onChange={(event) => { setConfigText(event.target.value); setConfigDirty(true); configDirtyRef.current = true }}
            rows={16}
            style={{ fontSize: 12, fontFamily: "'SF Mono','Fira Code',monospace" }}
          />
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSaveConfig} disabled={busyAction !== null || !configDirty}>
              {busyAction === 'save-config' ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              Save Config
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleRefreshManager} disabled={busyAction !== null}>
              <RefreshCw size={14} /> Reload From Disk
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title"><Terminal /> Recent Logs</div>
        <div className="settings-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div className="settings-row-sub">Install, update, and runtime output from the managed LiteLLM process appears here.</div>
          <pre style={{ margin: 0, padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text)', maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5 }}>
            {manager?.recentLogs.length ? manager.recentLogs.join('\n') : 'No LiteLLM logs yet.'}
          </pre>
        </div>
      </div>
    </div>
  )
}