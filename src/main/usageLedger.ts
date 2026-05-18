import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type {
  UsageDailyRollup,
  UsageLiveSession,
  UsageRequestRecord,
  UsageStatsQuery,
  UsageStatsSnapshot,
  UsageSummaryRollup,
  UsageTemplateRollup
} from '../shared/types'

export function getEffectiveCacheTokens(record: Pick<UsageRequestRecord, 'cacheTokens' | 'timings'>): number {
  const timingCacheTokens = typeof record.timings?.cacheN === 'number' ? record.timings.cacheN : 0
  const storedCacheTokens = typeof record.cacheTokens === 'number' ? record.cacheTokens : 0

  return Math.max(storedCacheTokens, timingCacheTokens)
}

function getNonNegativeNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function getEffectivePromptTokens(record: Pick<UsageRequestRecord, 'promptTokens' | 'cacheTokens' | 'completionTokens' | 'totalTokens' | 'timings'>): number {
  const timingPromptTokens = typeof record.timings?.promptN === 'number' ? record.timings.promptN : null
  if (typeof timingPromptTokens === 'number' && Number.isFinite(timingPromptTokens) && timingPromptTokens >= 0) {
    return timingPromptTokens
  }

  const promptTokens = getNonNegativeNumber(record.promptTokens)
  const cacheTokens = getEffectiveCacheTokens(record)
  const completionTokens = getNonNegativeNumber(record.completionTokens)
  const totalTokens = getNonNegativeNumber(record.totalTokens)

  if (promptTokens < cacheTokens) {
    return promptTokens
  }

  if (totalTokens === promptTokens + completionTokens) {
    return Math.max(promptTokens - cacheTokens, 0)
  }

  return promptTokens
}

function getCanonicalTotalTokens(record: Pick<UsageRequestRecord, 'promptTokens' | 'cacheTokens' | 'completionTokens'>): number {
  return getNonNegativeNumber(record.promptTokens) + getNonNegativeNumber(record.cacheTokens) + getNonNegativeNumber(record.completionTokens)
}

export function normalizeUsageSummaryRollup<T extends UsageSummaryRollup>(rollup: T): T {
  const cacheTokens = getNonNegativeNumber(rollup.cacheTokens)
  const completionTokens = getNonNegativeNumber(rollup.completionTokens)
  const storedPromptTokens = getNonNegativeNumber(rollup.promptTokens)
  const storedTotalTokens = getNonNegativeNumber(rollup.totalTokens)

  let promptTokens = storedPromptTokens

  if (storedPromptTokens >= cacheTokens && storedTotalTokens === storedPromptTokens + completionTokens) {
    promptTokens = Math.max(storedPromptTokens - cacheTokens, 0)
  }

  const totalTokens = promptTokens + cacheTokens + completionTokens

  return {
    ...rollup,
    promptTokens,
    cacheTokens,
    completionTokens,
    totalTokens
  }
}

export function normalizeUsageRecord(record: UsageRequestRecord): UsageRequestRecord {
  const cacheTokens = getEffectiveCacheTokens(record)
  const completionTokens = getNonNegativeNumber(record.completionTokens)
  const promptTokens = getEffectivePromptTokens(record)

  return {
    ...record,
    promptTokens,
    cacheTokens,
    completionTokens,
    totalTokens: getCanonicalTotalTokens({ promptTokens, cacheTokens, completionTokens })
  }
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

function accumulateSummary(target: UsageSummaryRollup, record: Pick<UsageRequestRecord, 'statusCode' | 'countedExactly' | 'promptTokens' | 'cacheTokens' | 'completionTokens' | 'totalTokens'>): void {
  target.requestCount += 1
  if ((record.statusCode ?? 500) < 400) target.successCount += 1
  else target.errorCount += 1
  if (record.countedExactly) {
    target.exactUsageCount += 1
    target.promptTokens += record.promptTokens
    target.cacheTokens += record.cacheTokens
    target.completionTokens += record.completionTokens
    target.totalTokens += record.totalTokens
  }
}

function getWindowStart(window: UsageStatsQuery['window']): number {
  const now = new Date()
  if (window === 'all') return 0
  if (window === '7d') return Date.now() - (7 * 24 * 60 * 60 * 1000)

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

function toDayKey(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeRecord(raw: unknown): UsageRequestRecord | null {
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Partial<UsageRequestRecord>
  if (typeof record.id !== 'string' || typeof record.launchId !== 'string' || typeof record.templateId !== 'string' || typeof record.templateNameSnapshot !== 'string') {
    return null
  }

  if (typeof record.method !== 'string' || typeof record.path !== 'string' || typeof record.startedAt !== 'string' || typeof record.finishedAt !== 'string') {
    return null
  }

  const normalizedRecord = {
    id: record.id,
    launchId: record.launchId,
    templateId: record.templateId,
    templateNameSnapshot: record.templateNameSnapshot,
    modelPathSnapshot: typeof record.modelPathSnapshot === 'string' ? record.modelPathSnapshot : undefined,
    method: record.method,
    path: record.path,
    statusCode: typeof record.statusCode === 'number' ? record.statusCode : null,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : 0,
    stream: record.stream === true,
    countedExactly: record.countedExactly === true,
    promptTokens: typeof record.promptTokens === 'number' ? record.promptTokens : 0,
    cacheTokens: typeof record.cacheTokens === 'number' ? record.cacheTokens : 0,
    completionTokens: typeof record.completionTokens === 'number' ? record.completionTokens : 0,
    totalTokens: typeof record.totalTokens === 'number' ? record.totalTokens : 0,
    timings: record.timings,
    error: typeof record.error === 'string' ? record.error : undefined
  } satisfies UsageRequestRecord

  return normalizeUsageRecord(normalizedRecord)
}

export function loadUsageLedger(filePath: string): UsageRequestRecord[] {
  if (!existsSync(filePath)) return []

  const lines = readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const records: UsageRequestRecord[] = []

  for (const line of lines) {
    try {
      const parsed = normalizeRecord(JSON.parse(line))
      if (parsed) {
        records.push(parsed)
      }
    } catch {}
  }

  return records.sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
}

export function appendUsageLedgerRecord(filePath: string, record: UsageRequestRecord): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(normalizeUsageRecord(record))}\n`, { encoding: 'utf-8', flag: 'a' })
}

export function buildUsageStatsSnapshot(
  records: UsageRequestRecord[],
  liveSessions: UsageLiveSession[],
  query: UsageStatsQuery
): UsageStatsSnapshot {
  const normalizedQuery: UsageStatsQuery = {
    window: query.window,
    templateId: query.templateId ?? null,
    limit: query.limit ?? 100
  }
  const windowStart = getWindowStart(normalizedQuery.window)
  const filteredRecords = records.filter((record) => {
    if (normalizedQuery.templateId && record.templateId !== normalizedQuery.templateId) return false
    return new Date(record.finishedAt).getTime() >= windowStart
  })

  const summary = zeroSummary()
  const templateRollups = new Map<string, UsageTemplateRollup>()
  const dailyRollups = new Map<string, UsageDailyRollup>()

  for (const record of filteredRecords) {
    accumulateSummary(summary, record)

    const templateRollup = templateRollups.get(record.templateId) ?? {
      templateId: record.templateId,
      templateName: record.templateNameSnapshot,
      modelPath: record.modelPathSnapshot,
      lastRequestAt: record.finishedAt,
      ...zeroSummary()
    }
    accumulateSummary(templateRollup, record)
    if (!templateRollup.lastRequestAt || templateRollup.lastRequestAt < record.finishedAt) {
      templateRollup.lastRequestAt = record.finishedAt
    }
    if (!templateRollup.modelPath && record.modelPathSnapshot) {
      templateRollup.modelPath = record.modelPathSnapshot
    }
    templateRollups.set(record.templateId, templateRollup)

    const dayKey = toDayKey(record.finishedAt)
    const dailyRollup = dailyRollups.get(dayKey) ?? {
      day: dayKey,
      ...zeroSummary()
    }
    accumulateSummary(dailyRollup, record)
    dailyRollups.set(dayKey, dailyRollup)
  }

  const filteredLiveSessions = normalizedQuery.templateId
    ? liveSessions.filter((session) => session.templateId === normalizedQuery.templateId)
    : liveSessions

  return {
    query: normalizedQuery,
    summary,
    liveSessions: [...filteredLiveSessions].sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    recentRequests: filteredRecords.slice(0, normalizedQuery.limit),
    templateRollups: Array.from(templateRollups.values()).sort((left, right) => {
      return right.totalTokens - left.totalTokens || right.requestCount - left.requestCount || left.templateName.localeCompare(right.templateName)
    }),
    dailyRollups: Array.from(dailyRollups.values()).sort((left, right) => right.day.localeCompare(left.day))
  }
}