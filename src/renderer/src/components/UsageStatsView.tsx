import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, BarChart3, RefreshCw } from 'lucide-react'
import { useStore } from '../store/useStore'
import type {
  Template,
  UsageCostSettings,
  UsageLiveSession,
  UsageRequestRecord,
  UsageSessionRollup,
  UsageSessionStatus,
  UsageStatsQuery,
  UsageStatsSnapshot,
  UsageSummaryRollup
} from '../../../shared/types'
import { resolveTemplatePricing } from '../utils/templatePricing'
import { PricingTab } from './PricingTab'

type UsageStatsWindow = 'today' | '7d' | '30d' | 'month' | 'all' | 'custom'

const STORAGE_KEY = 'llamadeck_usage_stats_query_v1'

function presetToRange(preset: Exclude<UsageStatsWindow, 'custom'>): { fromTimestamp: number; toTimestamp: number } {
  const now = new Date()
  const toTimestamp = now.getTime()
  if (preset === 'all') return { fromTimestamp: 0, toTimestamp }

  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (preset === 'today') return { fromTimestamp: localMidnight, toTimestamp }
  if (preset === '7d') return { fromTimestamp: localMidnight - 6 * 24 * 60 * 60 * 1000, toTimestamp }
  if (preset === '30d') return { fromTimestamp: localMidnight - 29 * 24 * 60 * 60 * 1000, toTimestamp }
  // 'month' is calendar-month-to-date: 1st of current local month at 00:00 -> now
  return { fromTimestamp: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), toTimestamp }
}

function detectPreset(fromTimestamp: number, toTimestamp: number, now: number = Date.now()): UsageStatsWindow {
  for (const preset of ['today', '7d', '30d', 'month', 'all'] as const) {
    const range = presetToRange(preset)
    if (range.fromTimestamp === fromTimestamp && range.toTimestamp === toTimestamp) {
      return preset
    }
  }
  // 'all' has a moving toTimestamp (now). Tolerate close-to-now by allowing within 60s.
  if (fromTimestamp === 0 && Math.abs(toTimestamp - now) < 60_000) return 'all'
  return 'custom'
}

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

function fromDateInputToLocalMidnightStart(value: string): number {
  // value is YYYY-MM-DD; interpret as local-midnight start of that day
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function fromDateInputToLocalEndOfDay(value: string): number {
  // value is YYYY-MM-DD; interpret as end-of-day local (23:59:59.999) on that day
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
}

const WINDOW_OPTIONS: Array<{ label: string; value: Exclude<UsageStatsWindow, 'custom'> }> = [
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'This month', value: 'month' },
  { label: 'All time', value: 'all' }
]

const DEFAULT_QUERY: UsageStatsQuery = (() => {
  const now = new Date()
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return {
    fromTimestamp: localMidnight - 6 * 24 * 60 * 60 * 1000,
    toTimestamp: now.getTime(),
    templateId: null,
    limit: 100
  }
})()

const DEFAULT_USAGE_COST_SETTINGS: UsageCostSettings = {
  currency: 'USD',
  inputCostPerMillion: 0,
  cacheCostPerMillion: 0,
  outputCostPerMillion: 0
}

type UsageStatsTab = 'overview' | 'sessions' | 'cost' | 'pricing'
type UsageSessionGroupBy = 'none' | 'template' | 'status'
type UsageSessionSortBy = 'activity' | 'tokens' | 'requests' | 'duration'
type UsageSessionStatusFilter = 'all' | UsageSessionStatus
type UsageCostSortBy = 'cost' | 'activity' | 'requests' | 'duration'

interface UsageCostBreakdown {
  inputCost: number
  cacheCost: number
  outputCost: number
  totalCost: number
}

const STATS_TAB_OPTIONS: Array<{ label: string; value: UsageStatsTab }> = [
  { label: 'Overview', value: 'overview' },
  { label: 'Sessions', value: 'sessions' },
  { label: 'Cost', value: 'cost' },
  { label: 'Pricing', value: 'pricing' }
]

const SESSION_STATUS_OPTIONS: Array<{ label: string; value: UsageSessionStatusFilter }> = [
  { label: 'All statuses', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Stopped', value: 'stopped' },
  { label: 'Error', value: 'error' }
]

const SESSION_GROUP_OPTIONS: Array<{ label: string; value: UsageSessionGroupBy }> = [
  { label: 'No grouping', value: 'none' },
  { label: 'Group by template', value: 'template' },
  { label: 'Group by status', value: 'status' }
]

const SESSION_SORT_OPTIONS: Array<{ label: string; value: UsageSessionSortBy }> = [
  { label: 'Latest activity', value: 'activity' },
  { label: 'Most tokens', value: 'tokens' },
  { label: 'Most requests', value: 'requests' },
  { label: 'Longest duration', value: 'duration' }
]

const COST_SORT_OPTIONS: Array<{ label: string; value: UsageCostSortBy }> = [
  { label: 'Highest cost', value: 'cost' },
  { label: 'Latest activity', value: 'activity' },
  { label: 'Most requests', value: 'requests' },
  { label: 'Longest duration', value: 'duration' }
]

interface SessionAnalysisGroup extends UsageSummaryRollup {
  key: string
  label: string
  subtitle: string
  sessionCount: number
  lastActivityAt?: string
  durationMs: number
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`
  }

  return `${(durationMs / 1000).toFixed(2)} s`
}

function formatRate(tokensPerSecond?: number): string | null {
  if (typeof tokensPerSecond !== 'number' || !Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
    return null
  }

  return `${tokensPerSecond.toFixed(1)} tok/s`
}

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return 'Never'

  const date = new Date(timestamp)
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toLocaleString([], { hour12: false })
}

function formatCost(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.trim().toUpperCase() || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }).format(value)
  } catch {
    const normalizedCurrency = currency.trim().toUpperCase() || 'USD'
    return `${normalizedCurrency} ${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
  }
}

function getUncachedInputTokens(record: Pick<UsageSummaryRollup, 'promptTokens' | 'cacheTokens'>): number {
  return Math.max(record.promptTokens, 0)
}

function getUsageCostBreakdown(record: Pick<UsageSummaryRollup, 'promptTokens' | 'cacheTokens' | 'completionTokens'>, settings: UsageCostSettings): UsageCostBreakdown {
  const inputCost = (getUncachedInputTokens(record) / 1_000_000) * settings.inputCostPerMillion
  const cacheCost = (record.cacheTokens / 1_000_000) * settings.cacheCostPerMillion
  const outputCost = (record.completionTokens / 1_000_000) * settings.outputCostPerMillion

  return {
    inputCost,
    cacheCost,
    outputCost,
    totalCost: inputCost + cacheCost + outputCost
  }
}

function renderTokenSummary(record: Pick<UsageRequestRecord, 'countedExactly' | 'promptTokens' | 'cacheTokens' | 'completionTokens' | 'totalTokens'>): string {
  if (!record.countedExactly) {
    return 'Not exact'
  }

  const uncachedInputTokens = getUncachedInputTokens(record)

  return `${formatNumber(uncachedInputTokens)} / ${formatNumber(record.cacheTokens)} / ${formatNumber(record.completionTokens)} / ${formatNumber(record.totalTokens)}`
}

function renderTimingLine(label: string, durationMs?: number, tokensPerSecond?: number): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null
  }

  const rate = formatRate(tokensPerSecond)
  return `${label} ${formatDuration(durationMs)}${rate ? ` • ${rate}` : ''}`
}

function renderLiveSessionTitle(session: UsageLiveSession): string {
  return `${session.templateName} • ${session.publicPort} -> ${session.upstreamPort}`
}

function zeroSummary(): UsageSummaryRollup {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    exactUsageCount: 0,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  }
}

function mergeSummary(target: UsageSummaryRollup, source: UsageSummaryRollup): void {
  target.requestCount += source.requestCount
  target.successCount += source.successCount
  target.errorCount += source.errorCount
  target.exactUsageCount += source.exactUsageCount
  target.promptTokens += source.promptTokens
  target.cacheTokens += source.cacheTokens
  target.completionTokens += source.completionTokens
  target.totalTokens += source.totalTokens
}

function getTimestampValue(timestamp?: string): number {
  if (!timestamp) return 0
  const value = new Date(timestamp).getTime()
  return Number.isFinite(value) ? value : 0
}

function getSessionActivityTimestamp(session: UsageSessionRollup): string {
  return session.windowLastRequestAt ?? session.lastRequestAt ?? session.windowEndedAt ?? session.stoppedAt ?? session.windowStartedAt ?? session.startedAt
}

function getSessionDurationMs(session: UsageSessionRollup): number {
  const startedAt = getTimestampValue(session.windowStartedAt ?? session.startedAt)
  const endedAt = getTimestampValue(session.windowEndedAt ?? session.windowLastRequestAt ?? session.stoppedAt ?? session.lastRequestAt ?? session.windowStartedAt ?? session.startedAt)

  if (!startedAt || !endedAt || endedAt <= startedAt) {
    return 0
  }

  return endedAt - startedAt
}

function formatSessionStatus(status: UsageSessionStatus): string {
  if (status === 'running') return 'Running'
  if (status === 'error') return 'Error'
  return 'Stopped'
}

function getSessionGroupSubtitle(session: UsageSessionRollup): string {
  if (session.modelPath) {
    return session.modelPath.split(/[/\\]/).pop() || session.modelPath
  }

  if (session.backendVersion) {
    return session.backendVersion
  }

  return session.launchId
}

function buildSessionAnalysisGroups(sessions: UsageSessionRollup[], groupBy: UsageSessionGroupBy): SessionAnalysisGroup[] {
  return buildSortedSessionAnalysisGroups(sessions, groupBy, 'tokens')
}

function buildSortedSessionAnalysisGroups(
  sessions: UsageSessionRollup[],
  groupBy: UsageSessionGroupBy,
  sortBy: UsageSessionSortBy
): SessionAnalysisGroup[] {
  const groups = new Map<string, SessionAnalysisGroup>()

  for (const session of sessions) {
    const key = groupBy === 'status' ? session.status : session.templateId
    const label = groupBy === 'status' ? formatSessionStatus(session.status) : session.templateName
    const subtitle = groupBy === 'status'
      ? 'Grouped by final session state'
      : getSessionGroupSubtitle(session)

    const group = groups.get(key) ?? {
      key,
      label,
      subtitle,
      sessionCount: 0,
      lastActivityAt: getSessionActivityTimestamp(session),
      durationMs: 0,
      ...zeroSummary()
    }

    group.sessionCount += 1
    group.durationMs += getSessionDurationMs(session)
    mergeSummary(group, session)
    const sessionActivityAt = getSessionActivityTimestamp(session)
    if (!group.lastActivityAt || getTimestampValue(group.lastActivityAt) < getTimestampValue(sessionActivityAt)) {
      group.lastActivityAt = sessionActivityAt
    }
    groups.set(key, group)
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (sortBy === 'activity') {
      return getTimestampValue(right.lastActivityAt) - getTimestampValue(left.lastActivityAt)
        || right.totalTokens - left.totalTokens
        || right.requestCount - left.requestCount
        || left.label.localeCompare(right.label)
    }

    if (sortBy === 'requests') {
      return right.requestCount - left.requestCount
        || right.totalTokens - left.totalTokens
        || getTimestampValue(right.lastActivityAt) - getTimestampValue(left.lastActivityAt)
        || left.label.localeCompare(right.label)
    }

    if (sortBy === 'duration') {
      return right.durationMs - left.durationMs
        || right.totalTokens - left.totalTokens
        || right.requestCount - left.requestCount
        || left.label.localeCompare(right.label)
    }

    return right.totalTokens - left.totalTokens
      || right.requestCount - left.requestCount
      || getTimestampValue(right.lastActivityAt) - getTimestampValue(left.lastActivityAt)
      || left.label.localeCompare(right.label)
  })
}

function sortSessionRollups(sessions: UsageSessionRollup[], sortBy: UsageSessionSortBy): UsageSessionRollup[] {
  return [...sessions].sort((left, right) => {
    if (sortBy === 'tokens') {
      return right.totalTokens - left.totalTokens
        || right.requestCount - left.requestCount
        || getTimestampValue(getSessionActivityTimestamp(right)) - getTimestampValue(getSessionActivityTimestamp(left))
    }

    if (sortBy === 'requests') {
      return right.requestCount - left.requestCount
        || right.totalTokens - left.totalTokens
        || getTimestampValue(getSessionActivityTimestamp(right)) - getTimestampValue(getSessionActivityTimestamp(left))
    }

    if (sortBy === 'duration') {
      return getSessionDurationMs(right) - getSessionDurationMs(left)
        || right.totalTokens - left.totalTokens
        || right.requestCount - left.requestCount
    }

    return getTimestampValue(getSessionActivityTimestamp(right)) - getTimestampValue(getSessionActivityTimestamp(left))
      || right.totalTokens - left.totalTokens
      || right.requestCount - left.requestCount
  })
}

function sortCostSessionRollups(
  sessions: UsageSessionRollup[],
  sortBy: UsageCostSortBy,
  pricingFor: (templateId: string) => UsageCostSettings
): UsageSessionRollup[] {
  if (sortBy !== 'cost') {
    return sortSessionRollups(sessions, sortBy)
  }

  return [...sessions].sort((left, right) => {
    return getUsageCostBreakdown(right, pricingFor(right.templateId)).totalCost - getUsageCostBreakdown(left, pricingFor(left.templateId)).totalCost
      || right.requestCount - left.requestCount
      || getTimestampValue(getSessionActivityTimestamp(right)) - getTimestampValue(getSessionActivityTimestamp(left))
  })
}

function sortCostSessionGroups(
  groups: SessionAnalysisGroup[],
  sortBy: UsageCostSortBy,
  pricingFor: (key: string) => UsageCostSettings
): SessionAnalysisGroup[] {
  if (sortBy !== 'cost') {
    return groups
  }

  return [...groups].sort((left, right) => {
    return getUsageCostBreakdown(right, pricingFor(right.key)).totalCost - getUsageCostBreakdown(left, pricingFor(left.key)).totalCost
      || right.requestCount - left.requestCount
      || getTimestampValue(right.lastActivityAt) - getTimestampValue(left.lastActivityAt)
      || left.label.localeCompare(right.label)
  })
}

export default function UsageStatsView() {
  const cards = useStore((state) => state.cards)
  const [query, setQuery] = useState<UsageStatsQuery>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return DEFAULT_QUERY
      const parsed = JSON.parse(raw) as Partial<UsageStatsQuery>
      return {
        fromTimestamp: typeof parsed.fromTimestamp === 'number' && Number.isFinite(parsed.fromTimestamp) ? parsed.fromTimestamp : DEFAULT_QUERY.fromTimestamp,
        toTimestamp: typeof parsed.toTimestamp === 'number' && Number.isFinite(parsed.toTimestamp) ? parsed.toTimestamp : DEFAULT_QUERY.toTimestamp,
        templateId: typeof parsed.templateId === 'string' || parsed.templateId === null ? parsed.templateId : null,
        limit: typeof parsed.limit === 'number' ? parsed.limit : 100
      }
    } catch (storageError) {
      console.warn('Failed to load saved usage stats query, falling back to defaults:', storageError)
      return DEFAULT_QUERY
    }
  })
  const [activeTab, setActiveTab] = useState<UsageStatsTab>('overview')
  const [sessionStatusFilter, setSessionStatusFilter] = useState<UsageSessionStatusFilter>('all')
  const [sessionGroupBy, setSessionGroupBy] = useState<UsageSessionGroupBy>('none')
  const [sessionSortBy, setSessionSortBy] = useState<UsageSessionSortBy>('activity')
  const [costSessionStatusFilter, setCostSessionStatusFilter] = useState<UsageSessionStatusFilter>('all')
  const [costSessionGroupBy, setCostSessionGroupBy] = useState<UsageSessionGroupBy>('none')
  const [costSessionSortBy, setCostSessionSortBy] = useState<UsageCostSortBy>('cost')
  const [appSettings, setAppSettings] = useState<UsageCostSettings>(DEFAULT_USAGE_COST_SETTINGS)
  const [snapshot, setSnapshot] = useState<UsageStatsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [costSettingsError, setCostSettingsError] = useState<string | null>(null)
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const queryRef = useRef(query)

  queryRef.current = query

  const templateOptions = [...cards]
    .reduce((accumulator, card) => {
      accumulator.set(card.template.id, card.template.name)
      return accumulator
    }, new Map<string, string>())

  snapshot?.templateRollups.forEach((rollup) => {
    templateOptions.set(rollup.templateId, rollup.templateName)
  })

  snapshot?.recentRequests.forEach((record) => {
    templateOptions.set(record.templateId, record.templateNameSnapshot)
  })

  const orderedTemplateOptions = Array.from(templateOptions.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name))

  const templatesById = useMemo(() => {
    const map = new Map<string, Template>()
    for (const card of cards) {
      map.set(card.template.id, card.template)
    }
    return map
  }, [cards])

  const pricingForTemplate = (templateId: string | null | undefined) => {
    if (!templateId) return appSettings
    return resolveTemplatePricing(templatesById.get(templateId), appSettings)
  }

  const pricingForGroupKey = (key: string) => {
    if (costSessionGroupBy === 'template') {
      return pricingForTemplate(key)
    }
    return appSettings
  }

  const filteredSessionRollups = sortSessionRollups(
    (snapshot?.sessionRollups ?? []).filter((session) => {
      return sessionStatusFilter === 'all' || session.status === sessionStatusFilter
    }),
    sessionSortBy
  )
  const sessionAnalysisGroups = buildSortedSessionAnalysisGroups(filteredSessionRollups, sessionGroupBy, sessionSortBy)
  const filteredCostSessionRollups = sortCostSessionRollups(
    (snapshot?.sessionRollups ?? []).filter((session) => {
      return costSessionStatusFilter === 'all' || session.status === costSessionStatusFilter
    }),
    costSessionSortBy,
    pricingForTemplate
  )
  const costSessionAnalysisGroups = sortCostSessionGroups(
    buildSortedSessionAnalysisGroups(
      filteredCostSessionRollups,
      costSessionGroupBy,
      costSessionSortBy === 'cost' ? 'tokens' : costSessionSortBy
    ),
    costSessionSortBy,
    pricingForGroupKey
  )
  const summaryCost = snapshot ? getUsageCostBreakdown(snapshot.summary, appSettings) : null

  async function loadSnapshot(nextQuery: UsageStatsQuery, mode: 'initial' | 'refresh' = 'refresh') {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }

    try {
      const nextSnapshot = await window.api.getUsageStats(nextQuery)
      setSnapshot(nextSnapshot)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadSnapshot(query, 'initial')
  }, [query.fromTimestamp, query.toTimestamp, query.templateId])

  useEffect(() => {
    let cancelled = false
    void window.api.getUsageCostSettings()
      .then((next) => {
        if (cancelled) return
        setAppSettings(next)
        setCostSettingsError(null)
      })
      .catch((loadError) => {
        console.warn('Failed to load app-wide usage cost settings:', loadError)
        if (cancelled) return
        setCostSettingsError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.onUsageUpdated(() => {
      void loadSnapshot(queryRef.current)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(query))
    } catch (storageError) {
      console.warn('Failed to persist usage stats query:', storageError)
    }
  }, [query])

  const activePreset: UsageStatsWindow = detectPreset(query.fromTimestamp, query.toTimestamp)
  const customRangeValid = (() => {
    if (!customFrom || !customTo) return false
    const fromTs = fromDateInputToLocalMidnightStart(customFrom)
    const toTs = fromDateInputToLocalEndOfDay(customTo)
    return Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs <= toTs
  })()

  function handlePresetClick(preset: Exclude<UsageStatsWindow, 'custom'>) {
    const range = presetToRange(preset)
    setQuery((current) => ({ ...current, fromTimestamp: range.fromTimestamp, toTimestamp: range.toTimestamp }))
    setCustomRangeOpen(false)
  }

  function openCustomRange() {
    // Pre-fill the inputs with the current query range so the user has a sensible starting point.
    setCustomFrom(toDateInputValue(query.fromTimestamp))
    setCustomTo(toDateInputValue(query.toTimestamp))
    setCustomRangeOpen(true)
  }

  function applyCustomRange() {
    if (!customFrom || !customTo) return
    const fromDate = new Date(customFrom)
    const toDate = new Date(customTo)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return
    const fromTimestamp = fromDateInputToLocalMidnightStart(customFrom)
    const toTimestamp = fromDateInputToLocalEndOfDay(customTo)
    if (fromTimestamp > toTimestamp) return
    setQuery((current) => ({ ...current, fromTimestamp, toTimestamp }))
    setCustomRangeOpen(false)
  }

  return (
    <div className="usage-stats-page">
      {costSettingsError && (
        <div className="usage-stats-warning">
          Cost settings failed to load: {costSettingsError}. The Cost tab will show zero-cost totals until the next successful load.
        </div>
      )}
      <div className="page-header usage-stats-header">
        <div>
          <h1 className="page-title">Usage Stats</h1>
          <p className="page-subtitle">Live and historical API usage for proxied llama.cpp sessions. History is stored as compact per-session summaries, while Recent Requests keeps only the last 20 tracked requests in memory for the current app run. Exact token totals only appear when llama.cpp returns usage or timings.</p>
        </div>
        <div className="page-actions usage-stats-actions">
          <div className="usage-stats-filter-group">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`usage-window-chip ${activePreset === option.value ? 'active' : ''}`}
                onClick={() => handlePresetClick(option.value)}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              className={`usage-window-chip ${activePreset === 'custom' ? 'active' : ''}`}
              onClick={openCustomRange}
            >
              Custom
            </button>
          </div>
          {customRangeOpen && (
            <div className="usage-stats-custom-range">
              <label className="usage-control-field">
                <span>From</span>
                <input
                  className="form-input"
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </label>
              <label className="usage-control-field">
                <span>To</span>
                <input
                  className="form-input"
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                  min={customFrom || undefined}
                />
              </label>
              <div className="usage-stats-custom-range-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={applyCustomRange}
                  disabled={!customRangeValid}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCustomRangeOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <select
            className="form-select usage-template-select"
            value={query.templateId ?? ''}
            onChange={(event) => {
              const value = event.target.value.trim()
              setQuery((current) => ({ ...current, templateId: value || null }))
            }}
          >
            <option value="">All templates</option>
            {orderedTemplateOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={() => void loadSnapshot(queryRef.current)} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="usage-stats-tab-row">
        {STATS_TAB_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`usage-tab-chip ${activeTab === option.value ? 'active' : ''}`}
            onClick={() => setActiveTab(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading && !snapshot ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <BarChart3 size={28} />
          </div>
          <h3>Loading usage history</h3>
          <p>Reading local usage sessions and active proxy sessions.</p>
        </div>
      ) : error && !snapshot ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Activity size={28} />
          </div>
          <h3>Could not load usage stats</h3>
          <p>{error}</p>
        </div>
      ) : snapshot ? (
        <>
          {error && <div className="usage-stats-warning">Refresh failed: {error}</div>}

          <div className="usage-summary-grid">
            <div className="usage-summary-card">
              <span className="usage-summary-label">Requests</span>
              <strong>{formatNumber(snapshot.summary.requestCount)}</strong>
              <span className="usage-summary-meta">{formatNumber(snapshot.summary.successCount)} ok • {formatNumber(snapshot.summary.errorCount)} failed</span>
            </div>
            <div className="usage-summary-card">
              <span className="usage-summary-label">Exact Usage Rows</span>
              <strong>{formatNumber(snapshot.summary.exactUsageCount)}</strong>
              <span className="usage-summary-meta">Only rows with upstream usage or timings</span>
            </div>
            <div className="usage-summary-card">
              <span className="usage-summary-label">Exact Tokens</span>
              <strong>{formatNumber(snapshot.summary.totalTokens)}</strong>
              <span className="usage-summary-meta">{formatNumber(getUncachedInputTokens(snapshot.summary))} input • {formatNumber(snapshot.summary.cacheTokens)} cache • {formatNumber(snapshot.summary.completionTokens)} output</span>
            </div>
            <div className="usage-summary-card">
              <span className="usage-summary-label">Live Sessions</span>
              <strong>{formatNumber(snapshot.liveSessions.length)}</strong>
              <span className="usage-summary-meta">{formatNumber(snapshot.liveSessions.reduce((total, session) => total + session.activeRequests, 0))} active API calls</span>
            </div>
          </div>

          {activeTab === 'overview' ? (
            <>
              <section className="usage-section">
                <div className="usage-section-header">
                  <h2>Live Sessions</h2>
                  <span>{snapshot.liveSessions.length === 0 ? 'No running proxies' : `${snapshot.liveSessions.length} active`}</span>
                </div>
                {snapshot.liveSessions.length === 0 ? (
                  <div className="usage-section-empty">Start an API-capable template and this section will update in real time.</div>
                ) : (
                  <div className="usage-live-grid">
                    {snapshot.liveSessions.map((session) => (
                      <div className="usage-live-card" key={session.launchId}>
                        <div className="usage-live-title">{renderLiveSessionTitle(session)}</div>
                        <div className="usage-live-subtitle">{session.modelPath?.split(/[/\\]/).pop() || 'Model path unavailable'}</div>
                        <div className="usage-live-metrics">
                          <span><strong>{formatNumber(session.requestCount)}</strong> requests</span>
                          <span><strong>{formatNumber(session.activeRequests)}</strong> active</span>
                          <span><strong>{formatNumber(getUncachedInputTokens(session))}</strong> input</span>
                          <span><strong>{formatNumber(session.cacheTokens)}</strong> cache</span>
                          <span><strong>{formatNumber(session.completionTokens)}</strong> output</span>
                          <span><strong>{formatNumber(session.totalTokens)}</strong> total</span>
                        </div>
                        <div className="usage-live-footer">
                          <span>Started {formatTimestamp(session.startedAt)}</span>
                          <span>{session.lastRequestAt ? `Last request ${formatTimestamp(session.lastRequestAt)}` : 'No tracked API request yet'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="usage-rollups-grid">
                <section className="usage-section">
                  <div className="usage-section-header">
                    <h2>Templates</h2>
                    <span>{snapshot.templateRollups.length} template rows</span>
                  </div>
                  {snapshot.templateRollups.length === 0 ? (
                    <div className="usage-section-empty">No matching historical usage for the selected filter.</div>
                  ) : (
                    <div className="usage-list-table">
                      {snapshot.templateRollups.map((rollup) => (
                        <div className="usage-list-row" key={rollup.templateId}>
                          <div>
                            <div className="usage-list-title">{rollup.templateName}</div>
                            <div className="usage-list-subtitle">{rollup.modelPath?.split(/[/\\]/).pop() || 'No model path snapshot'}</div>
                          </div>
                          <div className="usage-list-metrics">
                            <span>{formatNumber(rollup.requestCount)} requests</span>
                            <span>{formatNumber(getUncachedInputTokens(rollup))} input • {formatNumber(rollup.cacheTokens)} cache • {formatNumber(rollup.completionTokens)} output</span>
                            <span>{formatNumber(rollup.totalTokens)} total</span>
                            <span>{rollup.lastRequestAt ? formatTimestamp(rollup.lastRequestAt) : 'No recent activity'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="usage-section">
                  <div className="usage-section-header">
                    <h2>By Day</h2>
                    <span>{snapshot.dailyRollups.length} day rows</span>
                  </div>
                  {snapshot.dailyRollups.length === 0 ? (
                    <div className="usage-section-empty">No persisted requests in this time window yet.</div>
                  ) : (
                    <div className="usage-list-table">
                      {snapshot.dailyRollups.map((rollup) => (
                        <div className="usage-list-row" key={rollup.day}>
                          <div>
                            <div className="usage-list-title">{rollup.day}</div>
                            <div className="usage-list-subtitle">{formatNumber(rollup.exactUsageCount)} exact rows</div>
                          </div>
                          <div className="usage-list-metrics">
                            <span>{formatNumber(rollup.requestCount)} requests</span>
                            <span>{formatNumber(getUncachedInputTokens(rollup))} input • {formatNumber(rollup.cacheTokens)} cache • {formatNumber(rollup.completionTokens)} output</span>
                            <span>{formatNumber(rollup.totalTokens)} total</span>
                            <span>{formatNumber(rollup.errorCount)} failed</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <section className="usage-section">
                <div className="usage-section-header">
                  <h2>Recent Requests</h2>
                  <span>{snapshot.recentRequests.length} rows shown</span>
                </div>
                {snapshot.recentRequests.length === 0 ? (
                  <div className="usage-section-empty">No tracked requests are buffered in this app run yet. This section is in-memory only and is capped to the last 20 requests.</div>
                ) : (
                  <div className="usage-request-table-wrapper">
                    <table className="usage-request-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Template</th>
                          <th>Endpoint</th>
                          <th>Status</th>
                          <th>Duration</th>
                          <th>Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.recentRequests.map((record) => (
                          <tr key={record.id}>
                            <td>
                              <div className="usage-request-primary">{formatTimestamp(record.finishedAt)}</div>
                              <div className="usage-request-secondary">{record.stream ? 'stream' : 'json'}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{record.templateNameSnapshot}</div>
                              <div className="usage-request-secondary">{record.modelPathSnapshot?.split(/[/\\]/).pop() || 'No model snapshot'}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{record.path}</div>
                              <div className="usage-request-secondary">{record.method}</div>
                            </td>
                            <td>
                              <div className={`usage-status-pill ${(record.statusCode ?? 500) < 400 ? 'ok' : 'error'}`}>{record.statusCode ?? 'ERR'}</div>
                              <div className="usage-request-secondary">{record.error || (record.countedExactly ? 'exact usage' : 'non-exact row')}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatDuration(record.durationMs)}</div>
                              {renderTimingLine('pp', record.timings?.promptMs, record.timings?.promptPerSecond) && (
                                <div className="usage-request-secondary usage-request-metric-line">{renderTimingLine('pp', record.timings?.promptMs, record.timings?.promptPerSecond)}</div>
                              )}
                              {renderTimingLine('tg', record.timings?.predictedMs, record.timings?.predictedPerSecond) && (
                                <div className="usage-request-secondary usage-request-metric-line">{renderTimingLine('tg', record.timings?.predictedMs, record.timings?.predictedPerSecond)}</div>
                              )}
                            </td>
                            <td>
                              <div className="usage-request-primary">{renderTokenSummary(record)}</div>
                              <div className="usage-request-secondary">input / cache / output / total</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : activeTab === 'sessions' ? (
            <>
              <section className="usage-section">
                <div className="usage-section-header usage-section-header-stack">
                  <div>
                    <h2>Session Analysis</h2>
                    <span className="usage-section-header-note">Analyze persisted sessions for the selected window and template.</span>
                  </div>
                  <span>{filteredSessionRollups.length} sessions match</span>
                </div>
                <div className="usage-session-controls">
                  <label className="usage-control-field">
                    <span>Status</span>
                    <select
                      className="form-select usage-analysis-select"
                      value={sessionStatusFilter}
                      onChange={(event) => setSessionStatusFilter(event.target.value as UsageSessionStatusFilter)}
                    >
                      {SESSION_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="usage-control-field">
                    <span>Group</span>
                    <select
                      className="form-select usage-analysis-select"
                      value={sessionGroupBy}
                      onChange={(event) => setSessionGroupBy(event.target.value as UsageSessionGroupBy)}
                    >
                      {SESSION_GROUP_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="usage-control-field">
                    <span>Sort</span>
                    <select
                      className="form-select usage-analysis-select"
                      value={sessionSortBy}
                      onChange={(event) => setSessionSortBy(event.target.value as UsageSessionSortBy)}
                    >
                      {SESSION_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {filteredSessionRollups.length === 0 ? (
                  <div className="usage-section-empty">No persisted sessions match the current filters yet.</div>
                ) : sessionGroupBy === 'none' ? (
                  <div className="usage-request-table-wrapper">
                    <table className="usage-request-table usage-session-table">
                      <thead>
                        <tr>
                          <th>Session</th>
                          <th>Status</th>
                          <th>Requests</th>
                          <th>Tokens</th>
                          <th>Duration</th>
                          <th>Activity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSessionRollups.map((session) => (
                          <tr key={session.launchId}>
                            <td>
                              <div className="usage-request-primary">{session.templateName}</div>
                              <div className="usage-request-secondary">{getSessionGroupSubtitle(session)}</div>
                            </td>
                            <td>
                              <div className={`usage-status-pill usage-session-status ${session.status === 'running' ? 'ok' : session.status === 'error' ? 'error' : ''}`}>{formatSessionStatus(session.status)}</div>
                              <div className="usage-request-secondary">{session.lastEndpoint || 'No endpoint snapshot'}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatNumber(session.requestCount)}</div>
                              <div className="usage-request-secondary">{formatNumber(session.successCount)} ok • {formatNumber(session.errorCount)} failed</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatNumber(session.totalTokens)}</div>
                              <div className="usage-request-secondary">{formatNumber(getUncachedInputTokens(session))} input • {formatNumber(session.cacheTokens)} cache • {formatNumber(session.completionTokens)} output</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatDuration(getSessionDurationMs(session))}</div>
                              <div className="usage-request-secondary">Window start {formatTimestamp(session.windowStartedAt ?? session.startedAt)}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatTimestamp(getSessionActivityTimestamp(session))}</div>
                              <div className="usage-request-secondary">{session.windowEndedAt ? `Window end ${formatTimestamp(session.windowEndedAt)}` : 'Still running or open'}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="usage-list-table">
                    {sessionAnalysisGroups.map((group) => (
                      <div className="usage-list-row" key={group.key}>
                        <div>
                          <div className="usage-list-title">{group.label}</div>
                          <div className="usage-list-subtitle">{group.subtitle}</div>
                        </div>
                        <div className="usage-list-metrics">
                          <span>{formatNumber(group.sessionCount)} sessions</span>
                          <span>{formatNumber(group.requestCount)} requests</span>
                          <span>{formatNumber(getUncachedInputTokens(group))} input • {formatNumber(group.cacheTokens)} cache • {formatNumber(group.completionTokens)} output</span>
                          <span>{formatNumber(group.totalTokens)} total</span>
                          <span>{group.lastActivityAt ? `Last activity ${formatTimestamp(group.lastActivityAt)}` : 'No recent activity'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : activeTab === 'cost' ? (
            <>
              <div className="usage-summary-grid">
                <div className="usage-summary-card">
                  <span className="usage-summary-label">Estimated Total Cost</span>
                  <strong>{formatCost(summaryCost?.totalCost ?? 0, appSettings.currency)}</strong>
                  <span className="usage-summary-meta">For the selected window and template filter</span>
                </div>
                <div className="usage-summary-card">
                  <span className="usage-summary-label">Input Cost</span>
                  <strong>{formatCost(summaryCost?.inputCost ?? 0, appSettings.currency)}</strong>
                  <span className="usage-summary-meta">{formatNumber(getUncachedInputTokens(snapshot.summary))} uncached prompt tokens</span>
                </div>
                <div className="usage-summary-card">
                  <span className="usage-summary-label">Cache Cost</span>
                  <strong>{formatCost(summaryCost?.cacheCost ?? 0, appSettings.currency)}</strong>
                  <span className="usage-summary-meta">{formatNumber(snapshot.summary.cacheTokens)} cached prompt tokens</span>
                </div>
                <div className="usage-summary-card">
                  <span className="usage-summary-label">Output Cost</span>
                  <strong>{formatCost(summaryCost?.outputCost ?? 0, appSettings.currency)}</strong>
                  <span className="usage-summary-meta">{formatNumber(snapshot.summary.completionTokens)} generated tokens</span>
                </div>
              </div>

              <section className="usage-section">
                <div className="usage-section-header usage-section-header-stack">
                  <div>
                    <h2>Session Cost Analysis</h2>
                    <span className="usage-section-header-note">Inspect estimated cost by persisted session, or group sessions by template or status.</span>
                  </div>
                  <span>{filteredCostSessionRollups.length} sessions match</span>
                </div>
                <div className="usage-session-controls">
                  <label className="usage-control-field">
                    <span>Status</span>
                    <select
                      className="form-select usage-analysis-select"
                      value={costSessionStatusFilter}
                      onChange={(event) => setCostSessionStatusFilter(event.target.value as UsageSessionStatusFilter)}
                    >
                      {SESSION_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="usage-control-field">
                    <span>Group</span>
                    <select
                      className="form-select usage-analysis-select"
                      value={costSessionGroupBy}
                      onChange={(event) => setCostSessionGroupBy(event.target.value as UsageSessionGroupBy)}
                    >
                      {SESSION_GROUP_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="usage-control-field">
                    <span>Sort</span>
                    <select
                      className="form-select usage-analysis-select"
                      value={costSessionSortBy}
                      onChange={(event) => setCostSessionSortBy(event.target.value as UsageCostSortBy)}
                    >
                      {COST_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {filteredCostSessionRollups.length === 0 ? (
                  <div className="usage-section-empty">No persisted sessions match the current filters yet.</div>
                ) : costSessionGroupBy === 'none' ? (
                  <div className="usage-request-table-wrapper">
                    <table className="usage-request-table usage-session-table">
                      <thead>
                        <tr>
                          <th>Session</th>
                          <th>Status</th>
                          <th>Requests</th>
                          <th>Estimated Cost</th>
                          <th>Tokens</th>
                          <th>Activity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCostSessionRollups.map((session) => {
                          const sessionPricing = pricingForTemplate(session.templateId)
                          const sessionCost = getUsageCostBreakdown(session, sessionPricing)

                          return (
                            <tr key={session.launchId}>
                              <td>
                                <div className="usage-request-primary">{session.templateName}</div>
                                <div className="usage-request-secondary">{getSessionGroupSubtitle(session)}</div>
                              </td>
                              <td>
                                <div className={`usage-status-pill usage-session-status ${session.status === 'running' ? 'ok' : session.status === 'error' ? 'error' : ''}`}>{formatSessionStatus(session.status)}</div>
                                <div className="usage-request-secondary">{session.lastEndpoint || 'No endpoint snapshot'}</div>
                              </td>
                              <td>
                                <div className="usage-request-primary">{formatNumber(session.requestCount)}</div>
                                <div className="usage-request-secondary">{formatNumber(session.successCount)} ok • {formatNumber(session.errorCount)} failed</div>
                              </td>
                              <td>
                                <div className="usage-request-primary">{formatCost(sessionCost.totalCost, sessionPricing.currency)}</div>
                                <div className="usage-request-secondary">{formatCost(sessionCost.inputCost, sessionPricing.currency)} input • {formatCost(sessionCost.cacheCost, sessionPricing.currency)} cache • {formatCost(sessionCost.outputCost, sessionPricing.currency)} output</div>
                              </td>
                              <td>
                                <div className="usage-request-primary">{formatNumber(session.totalTokens)}</div>
                                <div className="usage-request-secondary">{formatNumber(getUncachedInputTokens(session))} input • {formatNumber(session.cacheTokens)} cache • {formatNumber(session.completionTokens)} output</div>
                              </td>
                              <td>
                                <div className="usage-request-primary">{formatTimestamp(getSessionActivityTimestamp(session))}</div>
                                <div className="usage-request-secondary">{session.windowEndedAt ? `Window end ${formatTimestamp(session.windowEndedAt)}` : 'Still running or open'}</div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="usage-list-table">
                    {costSessionAnalysisGroups.map((group) => {
                      const groupPricing = pricingForGroupKey(group.key)
                      const groupCost = getUsageCostBreakdown(group, groupPricing)

                      return (
                        <div className="usage-list-row" key={group.key}>
                          <div>
                            <div className="usage-list-title">{group.label}</div>
                            <div className="usage-list-subtitle">{group.subtitle}</div>
                          </div>
                          <div className="usage-list-metrics">
                            <span>{formatNumber(group.sessionCount)} sessions</span>
                            <span>{formatNumber(group.requestCount)} requests</span>
                            <span>{formatCost(groupCost.totalCost, groupPricing.currency)} total</span>
                            <span>{formatCost(groupCost.inputCost, groupPricing.currency)} input • {formatCost(groupCost.cacheCost, groupPricing.currency)} cache • {formatCost(groupCost.outputCost, groupPricing.currency)} output</span>
                            <span>{group.lastActivityAt ? `Last activity ${formatTimestamp(group.lastActivityAt)}` : 'No recent activity'}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              <div className="usage-rollups-grid">
                <section className="usage-section">
                  <div className="usage-section-header">
                    <h2>Template Costs</h2>
                    <span>{snapshot.templateRollups.length} template rows</span>
                  </div>
                  {snapshot.templateRollups.length === 0 ? (
                    <div className="usage-section-empty">No matching historical usage for the selected filter.</div>
                  ) : (
                    <div className="usage-list-table">
                      {snapshot.templateRollups.map((rollup) => {
                        const rollupPricing = pricingForTemplate(rollup.templateId)
                        const rollupCost = getUsageCostBreakdown(rollup, rollupPricing)

                        return (
                          <div className="usage-list-row" key={rollup.templateId}>
                            <div>
                              <div className="usage-list-title">{rollup.templateName}</div>
                              <div className="usage-list-subtitle">{rollup.modelPath?.split(/[/\\]/).pop() || 'No model path snapshot'}</div>
                            </div>
                            <div className="usage-list-metrics">
                              <span>{formatNumber(rollup.requestCount)} requests</span>
                              <span>{formatCost(rollupCost.totalCost, rollupPricing.currency)} total</span>
                              <span>{formatCost(rollupCost.inputCost, rollupPricing.currency)} input • {formatCost(rollupCost.cacheCost, rollupPricing.currency)} cache • {formatCost(rollupCost.outputCost, rollupPricing.currency)} output</span>
                              <span>{rollup.lastRequestAt ? formatTimestamp(rollup.lastRequestAt) : 'No recent activity'}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>

                <section className="usage-section">
                  <div className="usage-section-header">
                    <h2>Daily Costs</h2>
                    <span>{snapshot.dailyRollups.length} day rows</span>
                  </div>
                  {snapshot.dailyRollups.length === 0 ? (
                    <div className="usage-section-empty">No persisted requests in this time window yet.</div>
                  ) : (
                    <div className="usage-list-table">
                      {snapshot.dailyRollups.map((rollup) => {
                        const rollupCost = getUsageCostBreakdown(rollup, appSettings)

                        return (
                          <div className="usage-list-row" key={rollup.day}>
                            <div>
                              <div className="usage-list-title">{rollup.day}</div>
                              <div className="usage-list-subtitle">{formatNumber(rollup.exactUsageCount)} exact rows</div>
                            </div>
                            <div className="usage-list-metrics">
                              <span>{formatNumber(rollup.requestCount)} requests</span>
                              <span>{formatCost(rollupCost.totalCost, appSettings.currency)} total</span>
                              <span>{formatCost(rollupCost.inputCost, appSettings.currency)} input • {formatCost(rollupCost.cacheCost, appSettings.currency)} cache • {formatCost(rollupCost.outputCost, appSettings.currency)} output</span>
                              <span>{formatNumber(rollup.errorCount)} failed</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              </div>

              <section className="usage-section">
                <div className="usage-section-header">
                  <h2>Recent Request Costs</h2>
                  <span>{snapshot.recentRequests.length} rows shown</span>
                </div>
                {snapshot.recentRequests.length === 0 ? (
                  <div className="usage-section-empty">No tracked requests are buffered in this app run yet. This section is in-memory only and is capped to the last 20 requests.</div>
                ) : (
                  <div className="usage-request-table-wrapper">
                    <table className="usage-request-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Template</th>
                          <th>Endpoint</th>
                          <th>Status</th>
                          <th>Estimated Cost</th>
                          <th>Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.recentRequests.map((record) => {
                          const requestPricing = pricingForTemplate(record.templateId)
                          const requestCost = record.countedExactly ? getUsageCostBreakdown(record, requestPricing) : null

                          return (
                            <tr key={record.id}>
                              <td>
                                <div className="usage-request-primary">{formatTimestamp(record.finishedAt)}</div>
                                <div className="usage-request-secondary">{record.stream ? 'stream' : 'json'}</div>
                              </td>
                              <td>
                                <div className="usage-request-primary">{record.templateNameSnapshot}</div>
                                <div className="usage-request-secondary">{record.modelPathSnapshot?.split(/[/\\]/).pop() || 'No model snapshot'}</div>
                              </td>
                              <td>
                                <div className="usage-request-primary">{record.path}</div>
                                <div className="usage-request-secondary">{record.method}</div>
                              </td>
                              <td>
                                <div className={`usage-status-pill ${(record.statusCode ?? 500) < 400 ? 'ok' : 'error'}`}>{record.statusCode ?? 'ERR'}</div>
                                <div className="usage-request-secondary">{record.error || (record.countedExactly ? 'exact usage' : 'non-exact row')}</div>
                              </td>
                              <td>
                                <div className="usage-request-primary">{requestCost ? formatCost(requestCost.totalCost, requestPricing.currency) : 'Not exact'}</div>
                                <div className="usage-request-secondary">{requestCost ? `${formatCost(requestCost.inputCost, requestPricing.currency)} input • ${formatCost(requestCost.cacheCost, requestPricing.currency)} cache • ${formatCost(requestCost.outputCost, requestPricing.currency)} output` : 'Cost requires exact token data'}</div>
                              </td>
                              <td>
                                <div className="usage-request-primary">{renderTokenSummary(record)}</div>
                                <div className="usage-request-secondary">input / cache / output / total</div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : activeTab === 'pricing' ? (
            <PricingTab appSettings={appSettings} onAppSettingsChange={setAppSettings} />
          ) : null}
        </>
      ) : null}
    </div>
  )
}