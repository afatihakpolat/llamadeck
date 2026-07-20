import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Check,
  Code2,
  FolderOpen,
  Gem,
  Library,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2
} from 'lucide-react'
import type {
  AgentHarnessId,
  AgentHarnessSnapshot,
  AgentSkillInstallState,
  AgentSkillSource,
  AgentSkillsSnapshot
} from '../../../shared/types'

type BusyAction = string | null
type Notice = { tone: 'success' | 'danger' | 'muted'; text: string }

const HARNESS_ICONS: Record<AgentHarnessId, React.ComponentType<{ size?: number }>> = {
  codex: Code2,
  'claude-code': Sparkles,
  'gemini-cli': Gem,
  opencode: Bot
}

const STATE_LABELS: Record<AgentSkillInstallState, string> = {
  'not-installed': 'Not installed',
  managed: 'Installed',
  'update-available': 'Update available',
  unmanaged: 'Name conflict',
  shared: 'Available (shared)'
}

function actionLabel(state: AgentSkillInstallState): string {
  if (state === 'managed') return 'Remove'
  if (state === 'update-available') return 'Update'
  if (state === 'unmanaged') return 'Resolve in folder'
  if (state === 'shared') return 'Already available'
  return 'Install'
}

function shortError(error: unknown): string {
  return String(error).replace(/^Error:\s*/, '')
}

export default function AgentSkillsView() {
  const [snapshot, setSnapshot] = useState<AgentSkillsSnapshot | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [busyAction, setBusyAction] = useState<BusyAction>('load')
  const [notice, setNotice] = useState<Notice | null>(null)

  const selectedSource = useMemo(
    () => snapshot?.sources.find((source) => source.id === selectedSourceId) ?? snapshot?.sources[0] ?? null,
    [selectedSourceId, snapshot]
  )

  function applySnapshot(nextSnapshot: AgentSkillsSnapshot): void {
    setSnapshot(nextSnapshot)
    if (!nextSnapshot.sources.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(nextSnapshot.sources[0]?.id ?? '')
    }
  }

  async function refresh(showNotice = false): Promise<void> {
    setBusyAction('refresh')
    try {
      applySnapshot(await window.api.getAgentSkills())
      if (showNotice) setNotice({ tone: 'success', text: 'Harnesses and installed skills refreshed.' })
    } catch (error) {
      setNotice({ tone: 'danger', text: `Could not load agent skills: ${shortError(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  useEffect(() => {
    void refresh(false)
  }, [])

  async function importSkill(): Promise<void> {
    setBusyAction('import')
    try {
      const result = await window.api.importAgentSkill()
      if (!result) return
      if (!result.success) throw new Error(result.error || 'Import failed.')
      applySnapshot(result.snapshot)
      const imported = result.snapshot.sources.find((source) => source.kind === 'imported' && !snapshot?.sources.some((current) => current.id === source.id))
      if (imported) setSelectedSourceId(imported.id)
      setNotice({ tone: 'success', text: 'Skill added to the LlamaDeck library. Choose a harness to install it.' })
    } catch (error) {
      setNotice({ tone: 'danger', text: `Could not import skill: ${shortError(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  async function installOrRemove(harness: AgentHarnessSnapshot, source: AgentSkillSource): Promise<void> {
    const state = harness.sourceStates[source.id] ?? 'not-installed'
    if (state === 'unmanaged') {
      await openHarnessFolder(harness.id)
      return
    }

    if (state === 'managed') {
      const confirmed = window.confirm(`Remove "${source.name}" from ${harness.name}? Other copies of the skill will not be changed.`)
      if (!confirmed) return
    }

    const action = state === 'managed' ? 'remove' : 'install'
    setBusyAction(`${action}:${harness.id}`)
    try {
      const result = state === 'managed'
        ? await window.api.removeAgentSkill({ harnessId: harness.id, skillName: source.name })
        : await window.api.installAgentSkill({ harnessId: harness.id, sourceId: source.id })
      if (!result.success) throw new Error(result.error || `Could not ${action} skill.`)
      applySnapshot(result.snapshot)
      setNotice({
        tone: 'success',
        text: state === 'managed'
          ? `Removed ${source.name} from ${harness.name}.`
          : `${state === 'update-available' ? 'Updated' : 'Installed'} ${source.name} for ${harness.name}. Reload skills or start a new agent session if it is already open.`
      })
    } catch (error) {
      setNotice({ tone: 'danger', text: `${harness.name}: ${shortError(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  async function deleteSource(source: AgentSkillSource): Promise<void> {
    if (source.kind !== 'imported') return
    const confirmed = window.confirm(`Remove "${source.name}" from the LlamaDeck library? LlamaDeck will ask you to uninstall managed copies first.`)
    if (!confirmed) return

    setBusyAction(`delete:${source.id}`)
    try {
      const result = await window.api.deleteAgentSkillSource({ sourceId: source.id })
      if (!result.success) throw new Error(result.error || 'Could not remove skill source.')
      applySnapshot(result.snapshot)
      setNotice({ tone: 'success', text: `Removed ${source.name} from the LlamaDeck library.` })
    } catch (error) {
      setNotice({ tone: 'danger', text: shortError(error) })
    } finally {
      setBusyAction(null)
    }
  }

  async function openHarnessFolder(harnessId: AgentHarnessId): Promise<void> {
    const result = await window.api.openAgentSkillsFolder({ kind: 'harness', harnessId })
    if (!result.success) setNotice({ tone: 'danger', text: result.error || 'Could not open the skills folder.' })
  }

  async function openLibraryFolder(): Promise<void> {
    const result = await window.api.openAgentSkillsFolder({ kind: 'library' })
    if (!result.success) setNotice({ tone: 'danger', text: result.error || 'Could not open the skill library.' })
  }

  if (!snapshot) {
    return (
      <div className={`agent-skills-loading ${busyAction === null ? 'failed' : ''}`}>
        {busyAction !== null ? (
          <>
            <Loader2 size={18} className="spin" />
            Detecting agent harnesses…
          </>
        ) : (
          <>
            <AlertTriangle size={18} />
            <span>{notice?.text || 'Could not load agent skills.'}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => void refresh(false)}>Try again</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="agent-skills-page">
      <div className="page-header agent-skills-header">
        <div>
          <h1 className="page-title">Agent Skills</h1>
          <p className="page-subtitle">Teach your local agent tools how to operate LlamaDeck—or add your own reusable skills.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => void refresh(true)} disabled={busyAction !== null}>
            {busyAction === 'refresh' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void importSkill()} disabled={busyAction !== null}>
            {busyAction === 'import' ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            Import skill
          </button>
        </div>
      </div>

      {notice && (
        <div className={`agent-skills-notice ${notice.tone}`} role="status">
          {notice.tone === 'success' ? <Check size={15} /> : notice.tone === 'danger' ? <AlertTriangle size={15} /> : null}
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
        </div>
      )}

      <section className="agent-skills-switchboard" aria-label="Skill deployment">
        <div className="agent-skills-source-panel">
          <div className="agent-skills-eyebrow"><Library size={13} /> Skill library</div>
          {snapshot?.sources.length ? (
            <>
              <label className="agent-skills-source-picker">
                <span>Deploy</span>
                <select
                  className="form-select"
                  value={selectedSource?.id ?? ''}
                  onChange={(event) => setSelectedSourceId(event.target.value)}
                >
                  {snapshot.sources.map((source) => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))}
                </select>
              </label>
              {selectedSource && (
                <div className="agent-skills-source-copy">
                  <h2>{selectedSource.name}</h2>
                  <p>{selectedSource.description}</p>
                  <div className="agent-skills-meta">
                    <span>{selectedSource.kind === 'bundled' ? 'Bundled with LlamaDeck' : 'Imported'}</span>
                    <span>{selectedSource.fileCount} file{selectedSource.fileCount === 1 ? '' : 's'}</span>
                    <span className="mono">{selectedSource.contentHash.slice(0, 8)}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="agent-skills-empty-copy">
              No valid skills found. Import a folder containing a matching `SKILL.md`.
            </div>
          )}
        </div>

        <div className="agent-skills-rail" aria-hidden="true">
          <span />
          <Sparkles size={18} />
          <span />
        </div>

        <div className="agent-skills-harness-grid">
          {snapshot?.harnesses.map((harness) => {
            const Icon = HARNESS_ICONS[harness.id]
            const state = selectedSource ? harness.sourceStates[selectedSource.id] ?? 'not-installed' : 'not-installed'
            const busy = busyAction?.endsWith(`:${harness.id}`) ?? false
            const installedCount = harness.installedSkills.length

            return (
              <article key={harness.id} className={`agent-harness-card ${harness.detected ? 'detected' : ''}`}>
                <div className="agent-harness-heading">
                  <div className="agent-harness-icon"><Icon size={17} /></div>
                  <div>
                    <h3>{harness.name}</h3>
                    <span className={harness.detected ? 'is-detected' : ''}>
                      <i /> {harness.detected ? 'Detected' : 'Not detected'}
                    </span>
                  </div>
                </div>
                <div className={`agent-skill-state ${state}`}>
                  <span>{STATE_LABELS[state]}</span>
                  {state === 'unmanaged' && <small>An existing copy is protected.</small>}
                  {state === 'shared' && <small>Found in another compatible folder.</small>}
                </div>
                <div className="agent-harness-path mono" title={harness.skillsDirectory}>{harness.skillsDirectory}</div>
                {installedCount > 0 && (
                  <div
                    className="agent-harness-skills"
                    title={harness.installedSkills.map((skill) => skill.name).join(', ')}
                  >
                    {harness.installedSkills.slice(0, 2).map((skill) => skill.name).join(', ')}
                    {installedCount > 2 ? ` +${installedCount - 2}` : ''}
                  </div>
                )}
                <div className="agent-harness-footer">
                  <button
                    className={`btn btn-sm ${state === 'managed' ? 'btn-ghost' : 'btn-secondary'}`}
                    onClick={() => selectedSource && void installOrRemove(harness, selectedSource)}
                    disabled={!selectedSource || !harness.detected || busyAction !== null || state === 'shared'}
                  >
                    {busy ? <Loader2 size={13} className="spin" /> : state === 'managed' ? <Trash2 size={13} /> : <Plus size={13} />}
                    {actionLabel(state)}
                  </button>
                  <button
                    className="agent-folder-button"
                    onClick={() => void openHarnessFolder(harness.id)}
                    title={`Open ${harness.name} skills folder`}
                    aria-label={`Open ${harness.name} skills folder`}
                  >
                    <FolderOpen size={15} />
                  </button>
                  <span>{installedCount} skill{installedCount === 1 ? '' : 's'}</span>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="agent-skills-library-section">
        <div className="agent-skills-section-heading">
          <div>
            <h2>Library</h2>
            <p>Bundled and imported sources available to install. Imported scripts remain dormant until an agent uses the skill.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void openLibraryFolder()}>
            <FolderOpen size={14} /> Open library
          </button>
        </div>
        <div className="agent-skills-library-list">
          {snapshot?.sources.map((source) => (
            <div
              key={source.id}
              className={`agent-skill-library-row ${selectedSource?.id === source.id ? 'selected' : ''}`}
            >
              <button
                type="button"
                className="agent-skill-library-select"
                onClick={() => setSelectedSourceId(source.id)}
              >
                <span className="agent-skill-library-mark"><Sparkles size={15} /></span>
                <span className="agent-skill-library-copy">
                  <strong>{source.name}</strong>
                  <small>{source.description}</small>
                </span>
                <span className="agent-skill-library-kind">{source.kind === 'bundled' ? 'Built in' : 'Imported'}</span>
              </button>
              {source.kind === 'imported' && (
                <button
                  type="button"
                  className="agent-skill-source-delete"
                  aria-label={`Remove ${source.name} from library`}
                  onClick={() => void deleteSource(source)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="agent-skills-security-note">
          <AlertTriangle size={15} />
          <span>Review imported skill instructions and scripts before installing them. Skills can tell an agent to run commands or access files when activated.</span>
        </div>
      </section>
    </div>
  )
}
