import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { MoreHorizontal, RefreshCw, Square } from 'lucide-react'
import type { UsageLiveSession } from '../../../shared/types'
import {
  formatUsageNumber,
  formatUsageTimestamp,
  getUncachedInputTokens,
  hasActiveRequests,
  sortLiveSessionsByRecency
} from '../utils/titlebarSessions'

const LIVE_SESSION_REFRESH_DELAY_MS = 200

interface Props {
  onCheckUpdates: () => void
}

export default function Titlebar({ onCheckUpdates }: Props) {
  const checkingUpdate = useStore((state) => state.checkingUpdate)
  const setCardStatus = useStore((state) => state.setCardStatus)
  const [liveSessions, setLiveSessions] = useState<UsageLiveSession[]>([])
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(() => new Set())
  const [detailsOpen, setDetailsOpen] = useState(false)
  const liveStripRef = useRef<HTMLDivElement | null>(null)

  const sessions = useMemo(() => sortLiveSessionsByRecency(liveSessions), [liveSessions])

  useEffect(() => {
    let active = true
    let refreshTimer: number | null = null

    async function loadLiveSessions() {
      try {
        const snapshot = await window.api.getUsageStats({ limit: 1 })
        if (active) {
          setLiveSessions(snapshot.liveSessions)
        }
      } catch {
        if (active) {
          setLiveSessions([])
        }
      }
    }

    void loadLiveSessions()
    const unsubscribe = window.api.onUsageUpdated(() => {
      if (refreshTimer !== null) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void loadLiveSessions()
      }, LIVE_SESSION_REFRESH_DELAY_MS)
    })

    return () => {
      active = false
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!detailsOpen) return

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setDetailsOpen(false)
      }
    }
    function handlePointerDown(event: MouseEvent): void {
      if (liveStripRef.current && !liveStripRef.current.contains(event.target as Node)) {
        setDetailsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [detailsOpen])

  function markStopping(templateId: string, stopping: boolean): void {
    setStoppingIds((current) => {
      const next = new Set(current)
      if (stopping) {
        next.add(templateId)
      } else {
        next.delete(templateId)
      }
      return next
    })
  }

  async function stopSession(session: UsageLiveSession): Promise<void> {
    if (stoppingIds.has(session.templateId)) {
      return
    }

    markStopping(session.templateId, true)

    try {
      const result = await window.api.stopModel(session.templateId)
      if (result.success) {
        setCardStatus(session.templateId, 'idle')
        setLiveSessions((current) => current.filter((other) => other.templateId !== session.templateId))
      } else {
        useStore.getState().pushNotification({
          tone: 'danger',
          title: 'Template could not stop',
          message: result.error || session.templateName
        })
      }
    } finally {
      markStopping(session.templateId, false)
    }
  }

  async function stopAllRunningSessions(): Promise<void> {
    if (stoppingIds.size > 0 || sessions.length === 0) {
      return
    }

    const targets = sessions
    setStoppingIds(new Set(targets.map((session) => session.templateId)))

    const results = await Promise.all(
      targets.map(async (session) => {
        try {
          const result = await window.api.stopModel(session.templateId)
          return { templateId: session.templateId, success: result.success, error: result.error }
        } catch (error) {
          return {
            templateId: session.templateId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      })
    )

    const successfulIds = new Set<string>(results.flatMap((result) => (result.success ? [result.templateId] : [])))
    const failures = results.filter((result) => !result.success)

    successfulIds.forEach((templateId) => setCardStatus(templateId, 'idle'))
    setLiveSessions((current) => current.filter((session) => !successfulIds.has(session.templateId)))
    setStoppingIds((current) => {
      const next = new Set(current)
      targets.forEach((session) => next.delete(session.templateId))
      return next
    })

    if (failures.length > 0) {
      useStore.getState().pushNotification({
        tone: 'danger',
        title: `${failures.length} running template${failures.length > 1 ? 's' : ''} could not stop`,
        message: failures.map((failure) => failure.error || 'Unknown error').join('; ')
      })
    }
  }

  function renderSessionMeta(session: UsageLiveSession): React.ReactNode {
    return (
      <>
        <span className="titlebar-session-meta">{formatUsageNumber(session.requestCount)} req</span>
        <span className="titlebar-session-meta">{formatUsageNumber(session.activeRequests)} active</span>
        <span className="titlebar-session-meta">{formatUsageNumber(getUncachedInputTokens(session))} in</span>
        <span className="titlebar-session-meta">{formatUsageNumber(session.completionTokens)} out</span>
        <span className="titlebar-session-meta">Last {formatUsageTimestamp(session.lastRequestAt)}</span>
      </>
    )
  }

  return (
    <header className="titlebar">
      <div className="titlebar-logo">
        <img
          src="./icon.png"
          alt="LlamaDeck"
          className="titlebar-logo-icon brand-logo-img"
          draggable={false}
        />
        <span className="titlebar-brand-text">LlamaDeck</span>
      </div>

      {sessions.length === 1 && (
        <div className="titlebar-session-strip">
          <div className="titlebar-session-copy" title={sessions[0].templateName}>
            <span className="titlebar-session-label">Running</span>
            <span className="titlebar-session-name">{sessions[0].templateName}</span>
            {renderSessionMeta(sessions[0])}
          </div>
          <button
            className="btn btn-danger btn-sm titlebar-session-stop"
            onClick={() => void stopSession(sessions[0])}
            disabled={stoppingIds.size > 0}
            title={`Stop ${sessions[0].templateName}`}
          >
            <Square size={12} />
            {stoppingIds.size > 0 ? 'Stopping' : 'Stop'}
          </button>
        </div>
      )}

      {sessions.length > 1 && (
        <div className="titlebar-session-strip titlebar-live-strip" ref={liveStripRef}>
          <div className="titlebar-live-chips">
            {sessions.map((session) => (
              <div key={session.launchId} className="titlebar-live-chip">
                <span
                  className={`titlebar-live-chip-dot${hasActiveRequests(session) ? '' : ' no-pulse'}`}
                />
                <span className="titlebar-live-chip-name" title={session.templateName}>
                  {session.templateName}
                </span>
                {hasActiveRequests(session) && (
                  <span className="titlebar-live-chip-active">{formatUsageNumber(session.activeRequests)} act</span>
                )}
                <button
                  className="titlebar-live-chip-stop"
                  onClick={() => void stopSession(session)}
                  disabled={stoppingIds.has(session.templateId)}
                  title={`Stop ${session.templateName}`}
                >
                  <Square size={9} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn btn-ghost btn-icon titlebar-live-details-toggle"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            title="Live session details"
          >
            <MoreHorizontal size={15} />
          </button>
          {detailsOpen && (
            <div className="titlebar-live-popover">
              <div className="titlebar-live-popover-header">
                <span className="titlebar-live-popover-title">
                  {sessions.length} running
                </span>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => void stopAllRunningSessions()}
                  disabled={stoppingIds.size > 0}
                >
                  Stop all
                </button>
              </div>
              <ul className="titlebar-live-popover-list">
                {sessions.map((session) => (
                  <li key={session.launchId} className="titlebar-live-popover-row">
                    <div className="titlebar-live-popover-name">
                      <span
                        className={`titlebar-live-chip-dot${hasActiveRequests(session) ? '' : ' no-pulse'}`}
                      />
                      <span className="titlebar-live-popover-name-text" title={session.templateName}>
                        {session.templateName}
                      </span>
                      {session.lastError && (
                        <span className="titlebar-live-popover-error" title={session.lastError}>
                          {session.lastError}
                        </span>
                      )}
                    </div>
                    <button
                      className="btn btn-danger btn-sm titlebar-live-popover-stop"
                      onClick={() => void stopSession(session)}
                      disabled={stoppingIds.has(session.templateId)}
                      title={`Stop ${session.templateName}`}
                    >
                      <Square size={12} />
                      {stoppingIds.has(session.templateId) ? 'Stopping' : 'Stop'}
                    </button>
                    <div className="titlebar-live-popover-meta">{renderSessionMeta(session)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="titlebar-drag-region" />
      <div className="titlebar-actions">
        <button
          className={`btn btn-ghost btn-icon ${checkingUpdate ? 'spin-btn' : ''}`}
          onClick={onCheckUpdates}
          title="Check for llama.cpp updates"
          disabled={checkingUpdate}
        >
          <RefreshCw size={15} className={checkingUpdate ? 'spin' : ''} />
        </button>
      </div>
    </header>
  )
}
