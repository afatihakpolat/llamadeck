import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'

const STICKY_THRESHOLD_PX = 32

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)

  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : date.toLocaleTimeString([], { hour12: false })
}

export default function LiveOutputView() {
  const {
    cards,
    modelOutput,
    selectedModelOutputId,
    setSelectedModelOutputId,
    clearModelOutput
  } = useStore()
  const viewportRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)

  const sessions = useMemo(() => {
    return cards.filter((card) => (modelOutput[card.template.id]?.length || 0) > 0 || card.status === 'running')
  }, [cards, modelOutput])

  const selectedId = selectedModelOutputId && sessions.some((card) => card.template.id === selectedModelOutputId)
    ? selectedModelOutputId
    : sessions[0]?.template.id ?? null

  useEffect(() => {
    if (selectedId !== selectedModelOutputId) {
      setSelectedModelOutputId(selectedId)
    }
  }, [selectedId, selectedModelOutputId, setSelectedModelOutputId])

  const selectedCard = selectedId ? cards.find((card) => card.template.id === selectedId) ?? null : null
  const entries = selectedId ? modelOutput[selectedId] || [] : []

  // Switching sessions always snaps to the bottom of the new session.
  useEffect(() => {
    if (!viewportRef.current) return
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    stickyRef.current = true
    setIsAtBottom(true)
    setUnreadCount(0)
  }, [selectedId])

  // New entries: scroll to bottom only if the user is still following; otherwise count.
  useEffect(() => {
    if (entries.length === 0) {
      setUnreadCount(0)
      return
    }
    if (stickyRef.current) {
      if (!viewportRef.current) return
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    } else {
      setUnreadCount((current) => current + 1)
    }
  }, [entries.length])

  const handleScroll = useCallback(() => {
    if (!viewportRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = viewportRef.current
    const atBottom = scrollTop + clientHeight >= scrollHeight - STICKY_THRESHOLD_PX
    stickyRef.current = atBottom
    setIsAtBottom(atBottom)
    if (atBottom) {
      setUnreadCount(0)
    }
  }, [])

  const handleJumpToBottom = useCallback(() => {
    if (!viewportRef.current) return
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    stickyRef.current = true
    setIsAtBottom(true)
    setUnreadCount(0)
  }, [])

  return (
    <div className="live-output-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Live Output</h1>
          <p className="page-subtitle">Live stdout and stderr from running llama.cpp processes. This stays in memory only and is not written to disk.</p>
        </div>
        {selectedId && (
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={() => clearModelOutput(selectedId)}>
              <Trash2 size={15} />
              Clear View
            </button>
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Terminal size={28} />
          </div>
          <h3>No live output yet</h3>
          <p>Start a model and this page will show its terminal output live.</p>
        </div>
      ) : (
        <div className="live-output-layout">
          <div className="live-output-sidebar">
            {sessions.map((card) => {
              const isSelected = card.template.id === selectedId
              const entryCount = modelOutput[card.template.id]?.length || 0

              return (
                <button
                  key={card.template.id}
                  className={`live-output-session ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedModelOutputId(card.template.id)}
                >
                  <div className="live-output-session-header">
                    <span className="live-output-session-name">{card.template.name}</span>
                    <span className={`status-dot ${card.status === 'running' ? 'running' : card.status === 'error' ? 'error' : 'idle'}`} />
                  </div>
                  <div className="live-output-session-sub">
                    {entryCount} chunk{entryCount === 1 ? '' : 's'}
                    {card.template.serverPort ? ` • port ${card.template.serverPort}` : ''}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="live-output-panel">
            <div className="live-output-toolbar">
              <div>
                <div className="live-output-title">{selectedCard?.template.name || 'No session selected'}</div>
                <div className="live-output-subtitle">{selectedCard?.template.modelPath?.split(/[/\\]/).pop() || 'Waiting for output'}</div>
              </div>
            </div>

            <div className="live-output-viewport" ref={viewportRef} onScroll={handleScroll}>
              {entries.length === 0 ? (
                <div className="live-output-empty">Waiting for process output...</div>
              ) : (
                entries.map((entry, index) => (
                  <div key={`${entry.timestamp}-${index}`} className={`live-output-line ${entry.stream}`}>
                    <span className="live-output-time">{formatTime(entry.timestamp)}</span>
                    <span className={`live-output-stream ${entry.stream}`}>{entry.stream}</span>
                    <span className="live-output-text">{entry.text}</span>
                  </div>
                ))
              )}
              {!isAtBottom && unreadCount > 0 && (
                <button type="button" className="live-output-jump-bottom" onClick={handleJumpToBottom}>
                  {unreadCount} new chunk{unreadCount === 1 ? '' : 's'} ↓
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}