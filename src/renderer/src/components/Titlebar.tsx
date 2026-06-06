import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { RefreshCw, Square } from 'lucide-react'
import type { UsageLiveSession } from '../../../shared/types'

interface Props {
  onCheckUpdates: () => void
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return 'No tracked request yet'

  const date = new Date(timestamp)
  return Number.isNaN(date.getTime())
    ? 'Unknown activity'
    : date.toLocaleTimeString([], { hour12: false })
}

function getUncachedInputTokens(session: Pick<UsageLiveSession, 'promptTokens' | 'cacheTokens'>): number {
  return Math.max(session.promptTokens - session.cacheTokens, 0)
}

function getSessionSortTime(session: UsageLiveSession): number {
  return new Date(session.lastRequestAt ?? session.startedAt).getTime()
}

export default function Titlebar({ onCheckUpdates }: Props) {
  const { checkingUpdate, setCardStatus } = useStore()
  const [liveSessions, setLiveSessions] = useState<UsageLiveSession[]>([])
  const [stoppingTemplateId, setStoppingTemplateId] = useState<string | null>(null)

  const featuredSession = useMemo(() => {
    return [...liveSessions].sort((left, right) => getSessionSortTime(right) - getSessionSortTime(left))[0] ?? null
  }, [liveSessions])

  useEffect(() => {
    let active = true

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
      void loadLiveSessions()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  async function handleStopRunningTemplate(): Promise<void> {
    if (!featuredSession || stoppingTemplateId) {
      return
    }

    setStoppingTemplateId(featuredSession.templateId)

    try {
      const result = await window.api.stopModel(featuredSession.templateId)
      if (result.success) {
        setCardStatus(featuredSession.templateId, 'idle')
        setLiveSessions((current) => current.filter((session) => session.templateId !== featuredSession.templateId))
      } else {
        alert(`Failed to stop: ${result.error || 'Unknown error'}`)
      }
    } finally {
      setStoppingTemplateId(null)
    }
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

      {featuredSession && (
        <div className="titlebar-session-strip">
          <div className="titlebar-session-copy" title={featuredSession.templateName}>
            <span className="titlebar-session-label">Running</span>
            <span className="titlebar-session-name">{featuredSession.templateName}</span>
            {liveSessions.length > 1 && (
              <span className="titlebar-session-extra">+{liveSessions.length - 1}</span>
            )}
            <span className="titlebar-session-meta">{formatNumber(featuredSession.requestCount)} req</span>
            <span className="titlebar-session-meta">{formatNumber(featuredSession.activeRequests)} active</span>
            <span className="titlebar-session-meta">{formatNumber(getUncachedInputTokens(featuredSession))} in</span>
            <span className="titlebar-session-meta">{formatNumber(featuredSession.completionTokens)} out</span>
            <span className="titlebar-session-meta">Last {formatTimestamp(featuredSession.lastRequestAt)}</span>
          </div>
          <button
            className="btn btn-danger btn-sm titlebar-session-stop"
            onClick={() => void handleStopRunningTemplate()}
            disabled={stoppingTemplateId !== null}
            title={`Stop ${featuredSession.templateName}`}
          >
            <Square size={12} />
            {stoppingTemplateId ? 'Stopping' : 'Stop'}
          </button>
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
