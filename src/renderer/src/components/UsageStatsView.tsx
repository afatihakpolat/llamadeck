import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, BarChart3, ChevronDown, Folder, FolderOpen, RefreshCw } from 'lucide-react'
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
import {
  getAggregateCostBreakdown,
  getUsageCostBreakdown,
  resolveTemplatePricing,
  type UsageCostBreakdown
} from '../utils/templatePricing'
import {
  buildSortedSessionModelGroups,
  buildSortedTemplateModelGroups,
  getModelFileName,
  getSessionActivityTimestamp,
  getSessionDurationMs,
  getUsageTimestampValue,
  mergeSummary,
  sortSessionRollupsBy,
  zeroSummary,
  type UsageSessionModelGroup
} from '../utils/usageModelGrouping'
import {
  LLAMADECK_STORAGE_KEYS,
  readLlamaDeckStorage,
  writeLlamaDeckStorage
} from '../utils/storageMigration'
import { PricingTab } from './PricingTab'

type UsageStatsWindow = 'today' | '7d' | '30d' | 'month' | 'all' | 'custom'

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

function detectPreset(fromTimestamp: number, toTimestamp: number): UsageStatsWindow {
  // All presets recompute their `toTimestamp` to `Date.now()` on every call, so we
  // tolerate a 60-second window for the `toTimestamp` match. The `fromTimestamp` is
  // always a calendar-day boundary (or 0 for "all time") and is compared exactly.
  for (const preset of ['today', '7d', '30d', 'month', 'all'] as const) {
    const range = presetToRange(preset)
    if (range.fromTimestamp === fromTimestamp && Math.abs(range.toTimestamp - toTimestamp) < 60_000) {
      return preset
    }
  }
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
  outputCostPerMillion: 0,
  modelPricing: []
}

type UsageStatsTab = 'overview' | 'sessions' | 'cost' | 'pricing'
type UsageSessionGroupBy = 'none' | 'model' | 'template' | 'status'
type UsageSessionSortBy = 'activity' | 'tokens' | 'requests' | 'duration'
type UsageSessionStatusFilter = 'all' | UsageSessionStatus
type UsageCostSortBy = 'cost' | 'activity' | 'requests' | 'duration'
type UsageTemplateSectionGroupBy = 'model' | 'template'

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
  { label: 'Group by model', value: 'model' },
  { label: 'Group by template', value: 'template' },
  { label: 'Group by status', value: 'status' },
  { label: 'No grouping', value: 'none' }
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
    if (!group.lastActivityAt || getUsageTimestampValue(group.lastActivityAt) < getUsageTimestampValue(sessionActivityAt)) {
      group.lastActivityAt = sessionActivityAt
    }
    groups.set(key, group)
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (sortBy === 'activity') {
      return getUsageTimestampValue(right.lastActivityAt) - getUsageTimestampValue(left.lastActivityAt)
        || right.totalTokens - left.totalTokens
        || right.requestCount - left.requestCount
        || left.label.localeCompare(right.label)
    }

    if (sortBy === 'requests') {
      return right.requestCount - left.requestCount
        || right.totalTokens - left.totalTokens
        || getUsageTimestampValue(right.lastActivityAt) - getUsageTimestampValue(left.lastActivityAt)
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
      || getUsageTimestampValue(right.lastActivityAt) - getUsageTimestampValue(left.lastActivityAt)
      || left.label.localeCompare(right.label)
  })
}

function sortCostSessionRollups(
  sessions: UsageSessionRollup[],
  sortBy: UsageCostSortBy,
  pricingFor: (templateId: string) => UsageCostSettings
): UsageSessionRollup[] {
  if (sortBy !== 'cost') {
    return sortSessionRollupsBy(sessions, sortBy)
  }

  return [...sessions].sort((left, right) => {
    return getUsageCostBreakdown(right, pricingFor(right.templateId)).totalCost - getUsageCostBreakdown(left, pricingFor(left.templateId)).totalCost
      || right.requestCount - left.requestCount
      || getUsageTimestampValue(getSessionActivityTimestamp(right)) - getUsageTimestampValue(getSessionActivityTimestamp(left))
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
      || getUsageTimestampValue(right.lastActivityAt) - getUsageTimestampValue(left.lastActivityAt)
      || left.label.localeCompare(right.label)
  })
}

function pluralize(count: number, singular: string): string {
  return `${formatNumber(count)} ${singular}${count === 1 ? '' : 's'}`
}

function getModelGroupCost(group: UsageSessionModelGroup, pricingFor: (templateId: string, modelPath?: string) => UsageCostSettings): UsageCostBreakdown {
  return group.templates.reduce((total, template) => {
    const cost = getUsageCostBreakdown(template, pricingFor(template.templateId, template.modelPath))
    return {
      inputCost: total.inputCost + cost.inputCost,
      cacheCost: total.cacheCost + cost.cacheCost,
      outputCost: total.outputCost + cost.outputCost,
      totalCost: total.totalCost + cost.totalCost
    }
  }, { inputCost: 0, cacheCost: 0, outputCost: 0, totalCost: 0 })
}

interface NestedSessionTableProps {
  sessions: UsageSessionRollup[]
  showCost: boolean
  pricingFor: (templateId: string, modelPath?: string) => UsageCostSettings
}

function NestedSessionTable({ sessions, showCost, pricingFor }: NestedSessionTableProps) {
  return (
    <div className="usage-request-table-wrapper">
      <table className="usage-request-table usage-session-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Status</th>
            <th>Requests</th>
            {showCost ? <th>Estimated Cost</th> : null}
            <th>Tokens</th>
            {!showCost ? <th>Duration</th> : null}
            <th>Activity</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const sessionPricing = pricingFor(session.templateId, session.modelPath)
            const sessionCost = showCost ? getUsageCostBreakdown(session, sessionPricing) : null

            return (
              <tr key={session.launchId}>
                <td>
                  <div className="usage-request-primary">{typeof session.publicPort === 'number' ? `Port ${session.publicPort}` : 'Port unavailable'}</div>
                  <div className="usage-request-secondary">{session.lastEndpoint || 'No endpoint snapshot'}</div>
                </td>
                <td>
                  <div className={`usage-status-pill usage-session-status ${session.status === 'running' ? 'ok' : session.status === 'error' ? 'error' : ''}`}>{formatSessionStatus(session.status)}</div>
                  <div className="usage-request-secondary">{session.lastEndpoint || 'No endpoint snapshot'}</div>
                </td>
                <td>
                  <div className="usage-request-primary">{formatNumber(session.requestCount)}</div>
                  <div className="usage-request-secondary">{formatNumber(session.successCount)} ok • {formatNumber(session.errorCount)} failed</div>
                </td>
                {showCost && sessionCost ? (
                  <td>
                    <div className="usage-request-primary">{formatCost(sessionCost.totalCost, sessionPricing.currency)}</div>
                    <div className="usage-request-secondary">{formatCost(sessionCost.inputCost, sessionPricing.currency)} input • {formatCost(sessionCost.cacheCost, sessionPricing.currency)} cache • {formatCost(sessionCost.outputCost, sessionPricing.currency)} output</div>
                  </td>
                ) : null}
                <td>
                  <div className="usage-request-primary">{formatNumber(session.totalTokens)}</div>
                  <div className="usage-request-secondary">{formatNumber(getUncachedInputTokens(session))} input • {formatNumber(session.cacheTokens)} cache • {formatNumber(session.completionTokens)} output</div>
                </td>
                {!showCost ? (
                  <td>
                    <div className="usage-request-primary">{formatDuration(getSessionDurationMs(session))}</div>
                    <div className="usage-request-secondary">Window start {formatTimestamp(session.windowStartedAt ?? session.startedAt)}</div>
                  </td>
                ) : null}
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
  )
}

export default function UsageStatsView() {
  const cards = useStore((state) => state.cards)
  const [query, setQuery] = useState<UsageStatsQuery>(() => {
    try {
      const raw = readLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.usageStatsQuery)
      if (!raw) return DEFAULT_QUERY
      const parsed = JSON.parse(raw) as Partial<UsageStatsQuery>
      return {
        fromTimestamp: typeof parsed.fromTimestamp === 'number' && Number.isFinite(parsed.fromTimestamp) ? parsed.fromTimestamp : DEFAULT_QUERY.fromTimestamp,
        toTimestamp: typeof parsed.toTimestamp === 'number' && Number.isFinite(parsed.toTimestamp) ? parsed.toTimestamp : DEFAULT_QUERY.toTimestamp,
        templateId: typeof parsed.templateId === 'string' || parsed.templateId === null ? parsed.templateId : null,
        limit: typeof parsed.limit === 'number' && Number.isFinite(parsed.limit) ? parsed.limit : 100
      }
    } catch (storageError) {
      console.warn('Failed to load saved usage stats query, falling back to defaults:', storageError)
      return DEFAULT_QUERY
    }
  })
  const [activeTab, setActiveTab] = useState<UsageStatsTab>('overview')
  const [sessionStatusFilter, setSessionStatusFilter] = useState<UsageSessionStatusFilter>('all')
  const [sessionGroupBy, setSessionGroupBy] = useState<UsageSessionGroupBy>('model')
  const [sessionSortBy, setSessionSortBy] = useState<UsageSessionSortBy>('activity')
  const [costSessionStatusFilter, setCostSessionStatusFilter] = useState<UsageSessionStatusFilter>('all')
  const [costSessionGroupBy, setCostSessionGroupBy] = useState<UsageSessionGroupBy>('model')
  const [costSessionSortBy, setCostSessionSortBy] = useState<UsageCostSortBy>('cost')
  const [expandedUsageGroups, setExpandedUsageGroups] = useState<Record<string, boolean>>({})
  const [templateSectionGroupBy, setTemplateSectionGroupBy] = useState<UsageTemplateSectionGroupBy>('model')
  const [costTemplateSectionGroupBy, setCostTemplateSectionGroupBy] = useState<UsageTemplateSectionGroupBy>('model')
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

  // `fallbackModelPath` (the session/rollup's own captured model path) lets
  // deleted templates still resolve their model-level pricing, since the
  // rollup snapshot keeps the path even after the template is gone.
  const pricingForTemplate = (templateId: string | null | undefined, fallbackModelPath?: string) => {
    const template = templateId ? templatesById.get(templateId) : undefined
    if (template) return resolveTemplatePricing(template, appSettings)
    if (fallbackModelPath) {
      return resolveTemplatePricing({ pricing: undefined, modelPath: fallbackModelPath }, appSettings)
    }
    return appSettings
  }

  const pricingForGroupKey = (key: string) => {
    if (costSessionGroupBy === 'template') {
      return pricingForTemplate(key)
    }
    return appSettings
  }

  const filteredSessionRollups = sortSessionRollupsBy(
    (snapshot?.sessionRollups ?? []).filter((session) => {
      return sessionStatusFilter === 'all' || session.status === sessionStatusFilter
    }),
    sessionSortBy
  )
  const sessionAnalysisGroups = buildSortedSessionAnalysisGroups(filteredSessionRollups, sessionGroupBy, sessionSortBy)
  const sessionModelGroups = buildSortedSessionModelGroups(filteredSessionRollups, sessionSortBy)
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
  const costSessionModelGroups = buildSortedSessionModelGroups(filteredCostSessionRollups, costSessionSortBy, {
    costOfTemplate: (template) => getUsageCostBreakdown(template, pricingForTemplate(template.templateId, template.modelPath)).totalCost,
    costOfSession: (session) => getUsageCostBreakdown(session, pricingForTemplate(session.templateId, session.modelPath)).totalCost
  })
  const templateRollups = snapshot?.templateRollups ?? []
  const overviewTemplateModelGroups = buildSortedTemplateModelGroups(templateRollups)
  const costTemplateModelGroups = buildSortedTemplateModelGroups(
    templateRollups,
    'cost',
    (rollup) => getUsageCostBreakdown(rollup, pricingForTemplate(rollup.templateId, rollup.modelPath)).totalCost
  )
  // The summary cards must reflect the same model -> template -> app-wide
  // cascade as the rows below them, so aggregate per template rollup instead
  // of pricing the combined summary at app-wide rates.
  const summaryCost = snapshot
    ? getAggregateCostBreakdown(
        snapshot.templateRollups,
        snapshot.summary,
        (templateId, modelPath) => pricingForTemplate(templateId, modelPath)
      )
    : null

  function toggleUsageGroup(groupId: string) {
    setExpandedUsageGroups((current) => ({
      ...current,
      [groupId]: !current[groupId]
    }))
  }

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
      writeLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.usageStatsQuery, JSON.stringify(query))
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
    // When the current range is "all time" (fromTimestamp = 0), toDateInputValue(0) would render
    // the epoch date as 1969 (or 1970 depending on timezone) — fall back to last 7 days instead.
    const isAllTime = query.fromTimestamp === 0
    const fromDateTs = isAllTime ? presetToRange('7d').fromTimestamp : query.fromTimestamp
    setCustomFrom(toDateInputValue(fromDateTs))
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
                    <div className="usage-section-header-start">
                      <h2>{templateSectionGroupBy === 'model' ? 'Models' : 'Templates'}</h2>
                      <div className="usage-mini-toggle" role="group" aria-label="Group templates by">
                        <button
                          type="button"
                          className={templateSectionGroupBy === 'model' ? 'active' : ''}
                          onClick={() => setTemplateSectionGroupBy('model')}
                        >
                          Model
                        </button>
                        <button
                          type="button"
                          className={templateSectionGroupBy === 'template' ? 'active' : ''}
                          onClick={() => setTemplateSectionGroupBy('template')}
                        >
                          Template
                        </button>
                      </div>
                    </div>
                    <span>
                      {templateSectionGroupBy === 'model'
                        ? `${pluralize(overviewTemplateModelGroups.length, 'model')} • ${pluralize(snapshot.templateRollups.length, 'template')}`
                        : `${snapshot.templateRollups.length} template rows`}
                    </span>
                  </div>
                  {snapshot.templateRollups.length === 0 ? (
                    <div className="usage-section-empty">No matching historical usage for the selected filter.</div>
                  ) : templateSectionGroupBy === 'model' ? (
                    <div className="usage-list-table">
                      {overviewTemplateModelGroups.map((group) => {
                        const groupId = `overview-model:${group.key}`
                        const groupExpanded = expandedUsageGroups[groupId] === true

                        return (
                          <div key={group.key} className={`usage-model-group ${groupExpanded ? 'open' : ''}`}>
                            <button
                              type="button"
                              className="usage-model-group-header"
                              aria-expanded={groupExpanded}
                              onClick={() => toggleUsageGroup(groupId)}
                            >
                              <span className="usage-model-group-icon">{groupExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}</span>
                              <span className="usage-model-group-title">
                                <span className="usage-list-title">{group.label}</span>
                                <span className="usage-list-subtitle">{pluralize(group.templateCount, 'template')}</span>
                              </span>
                              <span className="usage-list-metrics">
                                <span>{formatNumber(group.requestCount)} requests</span>
                                <span>{formatNumber(getUncachedInputTokens(group))} input • {formatNumber(group.cacheTokens)} cache • {formatNumber(group.completionTokens)} output</span>
                                <span>{formatNumber(group.totalTokens)} total</span>
                                <span>{group.lastRequestAt ? formatTimestamp(group.lastRequestAt) : 'No recent activity'}</span>
                              </span>
                              <ChevronDown className="usage-model-chevron" size={16} />
                            </button>
                            {groupExpanded && (
                              <div className="usage-model-group-body">
                                {group.templates.map((rollup) => (
                                  <div className="usage-template-row" key={rollup.templateId}>
                                    <div className="usage-template-row-header usage-template-row-static">
                                      <span className="usage-model-group-title">
                                        <span className="usage-list-title">{rollup.templateName}</span>
                                        <span className="usage-list-subtitle">{getModelFileName(rollup.modelPath) ?? 'No model path snapshot'}</span>
                                      </span>
                                      <span className="usage-list-metrics">
                                        <span>{formatNumber(rollup.requestCount)} requests</span>
                                        <span>{formatNumber(getUncachedInputTokens(rollup))} input • {formatNumber(rollup.cacheTokens)} cache • {formatNumber(rollup.completionTokens)} output</span>
                                        <span>{formatNumber(rollup.totalTokens)} total</span>
                                        <span>{rollup.lastRequestAt ? formatTimestamp(rollup.lastRequestAt) : 'No recent activity'}</span>
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="usage-list-table">
                      {snapshot.templateRollups.map((rollup) => (
                        <div className="usage-list-row" key={rollup.templateId}>
                          <div>
                            <div className="usage-list-title">{rollup.templateName}</div>
                            <div className="usage-list-subtitle">{getModelFileName(rollup.modelPath) ?? 'No model path snapshot'}</div>
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
                ) : sessionGroupBy === 'model' ? (
                  <div className="usage-list-table">
                    {sessionModelGroups.map((group) => {
                      const groupId = `sessions-model:${group.key}`
                      const groupExpanded = expandedUsageGroups[groupId] === true

                      return (
                        <div key={group.key} className={`usage-model-group ${groupExpanded ? 'open' : ''}`}>
                          <button
                            type="button"
                            className="usage-model-group-header"
                            aria-expanded={groupExpanded}
                            onClick={() => toggleUsageGroup(groupId)}
                          >
                            <span className="usage-model-group-icon">{groupExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}</span>
                            <span className="usage-model-group-title">
                              <span className="usage-list-title">{group.label}</span>
                              <span className="usage-list-subtitle">{pluralize(group.templateCount, 'template')} • {pluralize(group.sessionCount, 'session')}</span>
                            </span>
                            <span className="usage-list-metrics">
                              <span>{formatNumber(group.requestCount)} requests</span>
                              <span>{formatNumber(getUncachedInputTokens(group))} input • {formatNumber(group.cacheTokens)} cache • {formatNumber(group.completionTokens)} output</span>
                              <span>{formatNumber(group.totalTokens)} total</span>
                              <span>{group.lastActivityAt ? `Last activity ${formatTimestamp(group.lastActivityAt)}` : 'No recent activity'}</span>
                            </span>
                            <ChevronDown className="usage-model-chevron" size={16} />
                          </button>
                          {groupExpanded && (
                            <div className="usage-model-group-body">
                              {group.templates.map((template) => {
                                const templateId = `${groupId}:${template.templateId}`
                                const templateExpanded = expandedUsageGroups[templateId] === true

                                return (
                                  <div key={template.templateId} className={`usage-template-row ${templateExpanded ? 'open' : ''}`}>
                                    <button
                                      type="button"
                                      className="usage-template-row-header"
                                      aria-expanded={templateExpanded}
                                      onClick={() => toggleUsageGroup(templateId)}
                                    >
                                      <span className="usage-model-group-title">
                                        <span className="usage-list-title">{template.templateName}</span>
                                        <span className="usage-list-subtitle">{template.modelFileName ?? 'No model path snapshot'}</span>
                                      </span>
                                      <span className="usage-list-metrics">
                                        <span>{pluralize(template.sessionCount, 'session')}</span>
                                        <span>{formatNumber(template.requestCount)} requests</span>
                                        <span>{formatNumber(template.totalTokens)} tokens</span>
                                        <span>{template.lastActivityAt ? `Last activity ${formatTimestamp(template.lastActivityAt)}` : 'No recent activity'}</span>
                                      </span>
                                      <ChevronDown className="usage-model-chevron" size={14} />
                                    </button>
                                    {templateExpanded && (
                                      <div className="usage-template-row-body">
                                        <NestedSessionTable sessions={template.sessions} showCost={false} pricingFor={pricingForTemplate} />
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
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
                    <span className="usage-section-header-note">Inspect estimated cost by persisted session, or group sessions by model, template, or status.</span>
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
                ) : costSessionGroupBy === 'model' ? (
                  <div className="usage-list-table">
                    {costSessionModelGroups.map((group) => {
                      const groupId = `cost-model:${group.key}`
                      const groupExpanded = expandedUsageGroups[groupId] === true
                      const groupCost = getModelGroupCost(group, pricingForTemplate)

                      return (
                        <div key={group.key} className={`usage-model-group ${groupExpanded ? 'open' : ''}`}>
                          <button
                            type="button"
                            className="usage-model-group-header"
                            aria-expanded={groupExpanded}
                            onClick={() => toggleUsageGroup(groupId)}
                          >
                            <span className="usage-model-group-icon">{groupExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}</span>
                            <span className="usage-model-group-title">
                              <span className="usage-list-title">{group.label}</span>
                              <span className="usage-list-subtitle">{pluralize(group.templateCount, 'template')} • {pluralize(group.sessionCount, 'session')}</span>
                            </span>
                            <span className="usage-list-metrics">
                              <span>{formatNumber(group.requestCount)} requests</span>
                              <span>{formatCost(groupCost.totalCost, appSettings.currency)} total</span>
                              <span>{formatCost(groupCost.inputCost, appSettings.currency)} input • {formatCost(groupCost.cacheCost, appSettings.currency)} cache • {formatCost(groupCost.outputCost, appSettings.currency)} output</span>
                              <span>{group.lastActivityAt ? `Last activity ${formatTimestamp(group.lastActivityAt)}` : 'No recent activity'}</span>
                            </span>
                            <ChevronDown className="usage-model-chevron" size={16} />
                          </button>
                          {groupExpanded && (
                            <div className="usage-model-group-body">
                              {group.templates.map((template) => {
                                 const templateId = `${groupId}:${template.templateId}`
                                 const templateExpanded = expandedUsageGroups[templateId] === true
                                 const templatePricing = pricingForTemplate(template.templateId, template.modelPath)
                                const templateCost = getUsageCostBreakdown(template, templatePricing)

                                return (
                                  <div key={template.templateId} className={`usage-template-row ${templateExpanded ? 'open' : ''}`}>
                                    <button
                                      type="button"
                                      className="usage-template-row-header"
                                      aria-expanded={templateExpanded}
                                      onClick={() => toggleUsageGroup(templateId)}
                                    >
                                      <span className="usage-model-group-title">
                                        <span className="usage-list-title">{template.templateName}</span>
                                        <span className="usage-list-subtitle">{template.modelFileName ?? 'No model path snapshot'}</span>
                                      </span>
                                      <span className="usage-list-metrics">
                                        <span>{pluralize(template.sessionCount, 'session')}</span>
                                        <span>{formatNumber(template.requestCount)} requests</span>
                                        <span>{formatCost(templateCost.totalCost, templatePricing.currency)} total</span>
                                        <span>{formatCost(templateCost.inputCost, templatePricing.currency)} input • {formatCost(templateCost.cacheCost, templatePricing.currency)} cache • {formatCost(templateCost.outputCost, templatePricing.currency)} output</span>
                                        <span>{template.lastActivityAt ? `Last activity ${formatTimestamp(template.lastActivityAt)}` : 'No recent activity'}</span>
                                      </span>
                                      <ChevronDown className="usage-model-chevron" size={14} />
                                    </button>
                                    {templateExpanded && (
                                      <div className="usage-template-row-body">
                                        <NestedSessionTable sessions={template.sessions} showCost pricingFor={pricingForTemplate} />
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
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
                          const sessionPricing = pricingForTemplate(session.templateId, session.modelPath)
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
                    <div className="usage-section-header-start">
                      <h2>{costTemplateSectionGroupBy === 'model' ? 'Model Costs' : 'Template Costs'}</h2>
                      <div className="usage-mini-toggle" role="group" aria-label="Group template costs by">
                        <button
                          type="button"
                          className={costTemplateSectionGroupBy === 'model' ? 'active' : ''}
                          onClick={() => setCostTemplateSectionGroupBy('model')}
                        >
                          Model
                        </button>
                        <button
                          type="button"
                          className={costTemplateSectionGroupBy === 'template' ? 'active' : ''}
                          onClick={() => setCostTemplateSectionGroupBy('template')}
                        >
                          Template
                        </button>
                      </div>
                    </div>
                    <span>
                      {costTemplateSectionGroupBy === 'model'
                        ? `${pluralize(costTemplateModelGroups.length, 'model')} • ${pluralize(snapshot.templateRollups.length, 'template')}`
                        : `${snapshot.templateRollups.length} template rows`}
                    </span>
                  </div>
                  {snapshot.templateRollups.length === 0 ? (
                    <div className="usage-section-empty">No matching historical usage for the selected filter.</div>
                  ) : costTemplateSectionGroupBy === 'model' ? (
                    <div className="usage-list-table">
                      {costTemplateModelGroups.map((group) => {
                        const groupId = `cost-model-row:${group.key}`
                        const groupExpanded = expandedUsageGroups[groupId] === true
                        const groupCost = group.templates.reduce((total, rollup) => {
                          const rollupCost = getUsageCostBreakdown(rollup, pricingForTemplate(rollup.templateId, rollup.modelPath))
                          return {
                            inputCost: total.inputCost + rollupCost.inputCost,
                            cacheCost: total.cacheCost + rollupCost.cacheCost,
                            outputCost: total.outputCost + rollupCost.outputCost,
                            totalCost: total.totalCost + rollupCost.totalCost
                          }
                        }, { inputCost: 0, cacheCost: 0, outputCost: 0, totalCost: 0 })

                        return (
                          <div key={group.key} className={`usage-model-group ${groupExpanded ? 'open' : ''}`}>
                            <button
                              type="button"
                              className="usage-model-group-header"
                              aria-expanded={groupExpanded}
                              onClick={() => toggleUsageGroup(groupId)}
                            >
                              <span className="usage-model-group-icon">{groupExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}</span>
                              <span className="usage-model-group-title">
                                <span className="usage-list-title">{group.label}</span>
                                <span className="usage-list-subtitle">{pluralize(group.templateCount, 'template')}</span>
                              </span>
                              <span className="usage-list-metrics">
                                <span>{formatNumber(group.requestCount)} requests</span>
                                <span>{formatCost(groupCost.totalCost, appSettings.currency)} total</span>
                                <span>{formatCost(groupCost.inputCost, appSettings.currency)} input • {formatCost(groupCost.cacheCost, appSettings.currency)} cache • {formatCost(groupCost.outputCost, appSettings.currency)} output</span>
                                <span>{formatNumber(group.totalTokens)} tokens</span>
                                <span>{group.lastRequestAt ? formatTimestamp(group.lastRequestAt) : 'No recent activity'}</span>
                              </span>
                              <ChevronDown className="usage-model-chevron" size={16} />
                            </button>
                            {groupExpanded && (
                              <div className="usage-model-group-body">
                                {group.templates.map((rollup) => {
                                  const rollupPricing = pricingForTemplate(rollup.templateId, rollup.modelPath)
                                  const rollupCost = getUsageCostBreakdown(rollup, rollupPricing)

                                  return (
                                    <div className="usage-template-row" key={rollup.templateId}>
                                      <div className="usage-template-row-header usage-template-row-static">
                                        <span className="usage-model-group-title">
                                          <span className="usage-list-title">{rollup.templateName}</span>
                                          <span className="usage-list-subtitle">{getModelFileName(rollup.modelPath) ?? 'No model path snapshot'}</span>
                                        </span>
                                        <span className="usage-list-metrics">
                                          <span>{formatNumber(rollup.requestCount)} requests</span>
                                          <span>{formatCost(rollupCost.totalCost, rollupPricing.currency)} total</span>
                                          <span>{formatCost(rollupCost.inputCost, rollupPricing.currency)} input • {formatCost(rollupCost.cacheCost, rollupPricing.currency)} cache • {formatCost(rollupCost.outputCost, rollupPricing.currency)} output</span>
                                          <span>{rollup.lastRequestAt ? formatTimestamp(rollup.lastRequestAt) : 'No recent activity'}</span>
                                        </span>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="usage-list-table">
                      {snapshot.templateRollups.map((rollup) => {
                        const rollupPricing = pricingForTemplate(rollup.templateId, rollup.modelPath)
                        const rollupCost = getUsageCostBreakdown(rollup, rollupPricing)

                        return (
                          <div className="usage-list-row" key={rollup.templateId}>
                            <div>
                              <div className="usage-list-title">{rollup.templateName}</div>
                              <div className="usage-list-subtitle">{getModelFileName(rollup.modelPath) ?? 'No model path snapshot'}</div>
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
                          const requestPricing = pricingForTemplate(record.templateId, record.modelPathSnapshot)
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
