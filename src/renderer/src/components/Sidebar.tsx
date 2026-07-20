import React from 'react'
import { useStore } from '../store/useStore'
import { LayoutGrid, Settings, FolderOpen, HardDrive, Search, Globe, Terminal, BarChart3, Sparkles } from 'lucide-react'
import type { BackendBuildMode } from '../../../shared/types'

function getBuildModeLabel(buildMode: BackendBuildMode | null): string {
  if (buildMode === 'single') return 'Single'
  if (buildMode === 'parallel') return 'Parallel'
  return 'Unknown'
}

export default function Sidebar() {
  const { view, setView, backends, activeBackend, setActiveBackend, setCommandsSchema, paths } = useStore()

  async function switchBackend(name: string) {
    const b = backends.find((x) => x.name === name)
    if (!b) return
    setActiveBackend(b)
    const cmds = await window.api.getCommands(name)
    setCommandsSchema(cmds)
  }

  return (
    <nav className="sidebar">
      <span className="nav-section-label">Navigation</span>
      <button
        className={`nav-item ${view === 'cards' ? 'active' : ''}`}
        onClick={() => setView('cards')}
      >
        <LayoutGrid size={16} />
        My Templates
      </button>
      <button
        className={`nav-item ${view === 'models' ? 'active' : ''}`}
        onClick={() => setView('models')}
      >
        <HardDrive size={16} />
        Models
      </button>
      <button
        className={`nav-item ${view === 'hub' ? 'active' : ''}`}
        onClick={() => setView('hub')}
      >
        <Search size={16} />
        Model Hub
      </button>
      <button
        className={`nav-item ${view === 'settings' ? 'active' : ''}`}
        onClick={() => setView('settings')}
      >
        <Settings size={16} />
        Settings
      </button>
      <button
        className={`nav-item ${view === 'litellm' ? 'active' : ''}`}
        onClick={() => setView('litellm')}
      >
        <Globe size={16} />
        LiteLLM
      </button>
      <button
        className={`nav-item ${view === 'agent-skills' ? 'active' : ''}`}
        onClick={() => setView('agent-skills')}
      >
        <Sparkles size={16} />
        Agent Skills
      </button>
      <button
        className={`nav-item ${view === 'live-output' ? 'active' : ''}`}
        onClick={() => setView('live-output')}
      >
        <Terminal size={16} />
        Live View
      </button>
      <button
        className={`nav-item ${view === 'usage-stats' ? 'active' : ''}`}
        onClick={() => setView('usage-stats')}
      >
        <BarChart3 size={16} />
        Usage Stats
      </button>
      {backends.length > 0 && (
        <>
          <span className="nav-section-label" style={{ marginTop: 12 }}>Backend</span>
          {backends.map((b) => (
            <button
              key={b.name}
              className={`nav-item ${activeBackend?.name === b.name ? 'active' : ''}`}
              onClick={() => switchBackend(b.name)}
              title={`${b.path}${b.flavor === 'cuda' ? `\nCUDA scheduler: ${getBuildModeLabel(b.buildMode)}` : ''}`}
            >
              <HardDrive size={16} />
              <span className="backend-nav-name">
                {b.displayName}
              </span>
              {b.flavor === 'cuda' && (
                <span className="backend-nav-mode">{getBuildModeLabel(b.buildMode)}</span>
              )}
            </button>
          ))}
        </>
      )}
      {backends.length === 0 && (
        <>
          <span className="nav-section-label" style={{ marginTop: 12 }}>Backend</span>
          <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            No backend found.<br />Download one in Settings.
          </div>
        </>
      )}
      {paths && (
        <div style={{ marginTop: 'auto', paddingTop: 12 }}>
          <button className="nav-item" onClick={() => window.api.openFolder(paths.backend)} title={paths.backend}>
            <FolderOpen size={16} />
            Open Backend Folder
          </button>
          <button className="nav-item" onClick={() => window.api.openFolder(paths.models)} title={paths.models}>
            <FolderOpen size={16} />
            Open Models Folder
          </button>
        </div>
      )}
    </nav>
  )
}
