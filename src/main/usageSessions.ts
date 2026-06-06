import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type {
  UsageDailyRollup,
  UsageLiveSession,
  UsageRequestRecord,
  UsageSessionRollup,
  UsageSessionStatus,
  UsageStatsQuery,
  UsageStatsSnapshot,
  UsageSummaryRollup,
  UsageTemplateRollup
} from '../shared/types'
import { loadUsageLedger, normalizeUsageRecord, normalizeUsageSummaryRollup } from './usageLedger'

export interface UsagePersistedSession extends UsageSummaryRollup {
  launchId: string
  templateId: string
  templateName: string
  modelPath?: string
  backendVersion?: string
  publicPort?: number
  upstreamPort?: number
  startedAt: string
  stoppedAt?: string
  lastRequestAt?: string
  lastEndpoint?: string
  lastError?: string
  status: UsageSessionStatus
  dailyRollups: UsageDailyRollup[]
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

function accumulateRequestSummary(target: UsageSummaryRollup, record: Pick<UsageRequestRecord, 'statusCode' | 'countedExactly' | 'promptTokens' | 'cacheTokens' | 'completionTokens' | 'totalTokens'>): void {
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

function toDayKey(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDayTimestamp(day: string): number {
  const [yearText, monthText, dayText] = day.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const date = Number(dayText)

  return new Date(year, month - 1, date).getTime()
}

function toDayEndTimestamp(day: string): number {
  const [yearText, monthText, dayText] = day.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const date = Number(dayText)

  return new Date(year, month - 1, date + 1).getTime() - 1
}

function buildSummaryFromDailyRollups(dailyRollups: UsageDailyRollup[]): UsageSummaryRollup {
  const summary = zeroSummary()
  for (const dailyRollup of dailyRollups) {
    mergeSummary(summary, dailyRollup)
  }

  return summary
}

function getSessionSortKey(session: UsagePersistedSession): string {
  return session.lastRequestAt ?? session.stoppedAt ?? session.startedAt
}

function sortPersistedSessions(sessions: UsagePersistedSession[]): UsagePersistedSession[] {
  return sessions.sort((left, right) => getSessionSortKey(right).localeCompare(getSessionSortKey(left)))
}

function sortTemplateRollups(rollups: UsageTemplateRollup[]): UsageTemplateRollup[] {
  return rollups.sort((left, right) => {
    return right.totalTokens - left.totalTokens
      || right.requestCount - left.requestCount
      || left.templateName.localeCompare(right.templateName)
  })
}

function sortDailyRollups(rollups: UsageDailyRollup[]): UsageDailyRollup[] {
  return rollups.sort((left, right) => right.day.localeCompare(left.day))
}

function sortSessionRollups(rollups: UsageSessionRollup[]): UsageSessionRollup[] {
  return rollups.sort((left, right) => {
    return right.totalTokens - left.totalTokens
      || right.requestCount - left.requestCount
      || getSessionSortKey(right).localeCompare(getSessionSortKey(left))
  })
}

function normalizeDailyRollup(raw: unknown): UsageDailyRollup | null {
  if (!raw || typeof raw !== 'object') return null

  const value = raw as Partial<UsageDailyRollup>
  if (typeof value.day !== 'string') return null

  return normalizeUsageSummaryRollup({
    day: value.day,
    requestCount: typeof value.requestCount === 'number' ? value.requestCount : 0,
    successCount: typeof value.successCount === 'number' ? value.successCount : 0,
    errorCount: typeof value.errorCount === 'number' ? value.errorCount : 0,
    exactUsageCount: typeof value.exactUsageCount === 'number' ? value.exactUsageCount : 0,
    promptTokens: typeof value.promptTokens === 'number' ? value.promptTokens : 0,
    cacheTokens: typeof value.cacheTokens === 'number' ? value.cacheTokens : 0,
    completionTokens: typeof value.completionTokens === 'number' ? value.completionTokens : 0,
    totalTokens: typeof value.totalTokens === 'number' ? value.totalTokens : 0
  })
}

function normalizePersistedSession(raw: unknown): UsagePersistedSession | null {
  if (!raw || typeof raw !== 'object') return null

  const session = raw as Partial<UsagePersistedSession>
  if (typeof session.launchId !== 'string' || typeof session.templateId !== 'string' || typeof session.templateName !== 'string' || typeof session.startedAt !== 'string') {
    return null
  }

  const dailyRollups = Array.isArray(session.dailyRollups)
    ? session.dailyRollups.map(normalizeDailyRollup).filter((value): value is UsageDailyRollup => value !== null)
    : []

  return normalizeUsageSummaryRollup({
    launchId: session.launchId,
    templateId: session.templateId,
    templateName: session.templateName,
    modelPath: typeof session.modelPath === 'string' ? session.modelPath : undefined,
    backendVersion: typeof session.backendVersion === 'string' ? session.backendVersion : undefined,
    publicPort: typeof session.publicPort === 'number' ? session.publicPort : undefined,
    upstreamPort: typeof session.upstreamPort === 'number' ? session.upstreamPort : undefined,
    startedAt: session.startedAt,
    stoppedAt: typeof session.stoppedAt === 'string' ? session.stoppedAt : undefined,
    lastRequestAt: typeof session.lastRequestAt === 'string' ? session.lastRequestAt : undefined,
    lastEndpoint: typeof session.lastEndpoint === 'string' ? session.lastEndpoint : undefined,
    lastError: typeof session.lastError === 'string' ? session.lastError : undefined,
    status: session.status === 'running' || session.status === 'error' ? session.status : 'stopped',
    dailyRollups: sortDailyRollups(dailyRollups),
    requestCount: typeof session.requestCount === 'number' ? session.requestCount : 0,
    successCount: typeof session.successCount === 'number' ? session.successCount : 0,
    errorCount: typeof session.errorCount === 'number' ? session.errorCount : 0,
    exactUsageCount: typeof session.exactUsageCount === 'number' ? session.exactUsageCount : 0,
    promptTokens: typeof session.promptTokens === 'number' ? session.promptTokens : 0,
    cacheTokens: typeof session.cacheTokens === 'number' ? session.cacheTokens : 0,
    completionTokens: typeof session.completionTokens === 'number' ? session.completionTokens : 0,
    totalTokens: typeof session.totalTokens === 'number' ? session.totalTokens : 0
  })
}

function updateSessionDailyRollups(session: UsagePersistedSession, record: UsageRequestRecord): void {
  const day = toDayKey(record.finishedAt)
  const dailyRollup = session.dailyRollups.find((entry) => entry.day === day)

  if (dailyRollup) {
    accumulateRequestSummary(dailyRollup, record)
    return
  }

  const nextDailyRollup: UsageDailyRollup = {
    day,
    ...zeroSummary()
  }
  accumulateRequestSummary(nextDailyRollup, record)
  session.dailyRollups.push(nextDailyRollup)
  sortDailyRollups(session.dailyRollups)
}

function buildPersistedSessionFromRecord(record: UsageRequestRecord): UsagePersistedSession {
  const normalizedRecord = normalizeUsageRecord(record)
  const session: UsagePersistedSession = {
    launchId: normalizedRecord.launchId,
    templateId: normalizedRecord.templateId,
    templateName: normalizedRecord.templateNameSnapshot,
    modelPath: normalizedRecord.modelPathSnapshot,
    startedAt: normalizedRecord.startedAt,
    lastRequestAt: normalizedRecord.finishedAt,
    lastEndpoint: normalizedRecord.path,
    lastError: normalizedRecord.error,
    status: (normalizedRecord.statusCode ?? 500) >= 400 ? 'error' : 'stopped',
    dailyRollups: [],
    ...zeroSummary()
  }

  return applyRequestToPersistedSession(session, normalizedRecord)
}

function getSessionFilePath(sessionsDir: string, launchId: string): string {
  return join(sessionsDir, `${launchId}.json`)
}

export function createUsageSessionFromLive(session: UsageLiveSession): UsagePersistedSession {
  return {
    launchId: session.launchId,
    templateId: session.templateId,
    templateName: session.templateName,
    modelPath: session.modelPath,
    backendVersion: session.backendVersion,
    publicPort: session.publicPort,
    upstreamPort: session.upstreamPort,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    lastRequestAt: session.lastRequestAt,
    lastEndpoint: session.lastEndpoint,
    lastError: session.lastError,
    status: session.status,
    dailyRollups: [],
    ...zeroSummary()
  }
}

export function applyRequestToPersistedSession(session: UsagePersistedSession, record: UsageRequestRecord): UsagePersistedSession {
  const normalizedRecord = normalizeUsageRecord(record)

  accumulateRequestSummary(session, normalizedRecord)
  updateSessionDailyRollups(session, normalizedRecord)
  session.lastRequestAt = normalizedRecord.finishedAt
  session.lastEndpoint = normalizedRecord.path
  session.lastError = normalizedRecord.error
  if ((normalizedRecord.statusCode ?? 500) >= 400) {
    session.status = 'error'
  }

  return session
}

export function finalizePersistedSession(session: UsagePersistedSession, status: UsageSessionStatus, stoppedAt = new Date().toISOString(), lastError?: string): UsagePersistedSession {
  session.status = status
  session.stoppedAt = stoppedAt
  if (lastError) {
    session.lastError = lastError
  }

  return session
}

export function loadUsageSessions(sessionsDir: string): UsagePersistedSession[] {
  if (!existsSync(sessionsDir)) return []

  const sessions: UsagePersistedSession[] = []
  for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue

    try {
      const parsed = normalizePersistedSession(JSON.parse(readFileSync(join(sessionsDir, entry.name), 'utf-8')))
      if (parsed) {
        sessions.push(parsed)
      }
    } catch {}
  }

  return sortPersistedSessions(sessions)
}

export function saveUsageSession(sessionsDir: string, session: UsagePersistedSession): void {
  mkdirSync(sessionsDir, { recursive: true })
  writeFileSync(getSessionFilePath(sessionsDir, session.launchId), JSON.stringify(session, null, 2), 'utf-8')
}

export function migrateLegacyUsageLedger(legacyLedgerPath: string, sessionsDir: string, markerPath: string): void {
  if (!existsSync(legacyLedgerPath) || existsSync(markerPath)) {
    return
  }

  const records = loadUsageLedger(legacyLedgerPath)
    .slice()
    .sort((left, right) => left.finishedAt.localeCompare(right.finishedAt))
  const sessionsByLaunchId = new Map<string, UsagePersistedSession>()

  for (const record of records) {
    const existing = sessionsByLaunchId.get(record.launchId)
    if (existing) {
      applyRequestToPersistedSession(existing, record)
      continue
    }

    sessionsByLaunchId.set(record.launchId, buildPersistedSessionFromRecord(record))
  }

  for (const session of sessionsByLaunchId.values()) {
    const targetPath = getSessionFilePath(sessionsDir, session.launchId)
    if (existsSync(targetPath)) continue
    saveUsageSession(sessionsDir, session)
  }

  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, new Date().toISOString(), 'utf-8')
}

function getWindowedDailyRollups(session: UsagePersistedSession, fromTimestamp: number, toTimestamp: number): UsageDailyRollup[] {
  if (fromTimestamp === 0 && toTimestamp >= Date.now()) {
    return session.dailyRollups
  }

  return session.dailyRollups.filter((dailyRollup) => {
    const dayTs = toDayTimestamp(dailyRollup.day)
    return dayTs >= fromTimestamp && dayTs <= toTimestamp
  })
}

function getSessionWindowTimestamps(
  session: UsagePersistedSession,
  windowedDailyRollups: UsageDailyRollup[],
  fromTimestamp: number
): Pick<UsageSessionRollup, 'windowStartedAt' | 'windowEndedAt' | 'windowLastRequestAt'> {
  if (fromTimestamp === 0) {
    return {
      windowStartedAt: session.startedAt,
      windowEndedAt: session.stoppedAt,
      windowLastRequestAt: session.lastRequestAt
    }
  }

  if (windowedDailyRollups.length === 0) {
    return {}
  }

  const firstDay = windowedDailyRollups[windowedDailyRollups.length - 1]?.day
  const lastDay = windowedDailyRollups[0]?.day
  if (!firstDay || !lastDay) {
    return {}
  }

  const sessionStartedAt = new Date(session.startedAt).getTime()
  const sessionStoppedAt = session.stoppedAt ? new Date(session.stoppedAt).getTime() : null
  const sessionLastRequestAt = session.lastRequestAt ? new Date(session.lastRequestAt).getTime() : null
  const windowStartedAt = new Date(Math.max(sessionStartedAt, toDayTimestamp(firstDay))).toISOString()
  const lastWindowTimestamp = toDayEndTimestamp(lastDay)
  const windowLastRequestAt = sessionLastRequestAt
    ? new Date(Math.min(sessionLastRequestAt, lastWindowTimestamp)).toISOString()
    : new Date(lastWindowTimestamp).toISOString()
  const windowEndedAt = sessionStoppedAt
    ? new Date(Math.min(sessionStoppedAt, lastWindowTimestamp)).toISOString()
    : undefined

  return {
    windowStartedAt,
    windowEndedAt,
    windowLastRequestAt
  }
}

export function buildUsageStatsSnapshotFromSessions(
  sessions: UsagePersistedSession[],
  liveSessions: UsageLiveSession[],
  recentRequests: UsageRequestRecord[],
  query: UsageStatsQuery
): UsageStatsSnapshot {
  const normalizedQuery: UsageStatsQuery = {
    fromTimestamp: query.fromTimestamp,
    toTimestamp: query.toTimestamp,
    templateId: query.templateId ?? null,
    limit: Math.min(query.limit ?? 20, 20)
  }

  const summary = zeroSummary()
  const templateRollups = new Map<string, UsageTemplateRollup>()
  const dailyRollups = new Map<string, UsageDailyRollup>()
  const sessionRollups: UsageSessionRollup[] = []

  for (const session of sessions) {
    if (normalizedQuery.templateId && session.templateId !== normalizedQuery.templateId) {
      continue
    }

    const windowedDailyRollups = getWindowedDailyRollups(session, normalizedQuery.fromTimestamp, normalizedQuery.toTimestamp)
    const sessionWindowSummary = normalizedQuery.fromTimestamp === 0
      ? session
      : buildSummaryFromDailyRollups(windowedDailyRollups)

    if (sessionWindowSummary.requestCount === 0) {
      continue
    }

    mergeSummary(summary, sessionWindowSummary)
    const sessionWindowTimestamps = getSessionWindowTimestamps(session, windowedDailyRollups, normalizedQuery.fromTimestamp)
    sessionRollups.push({
      launchId: session.launchId,
      templateId: session.templateId,
      templateName: session.templateName,
      modelPath: session.modelPath,
      backendVersion: session.backendVersion,
      publicPort: session.publicPort,
      upstreamPort: session.upstreamPort,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
      lastRequestAt: session.lastRequestAt,
      ...sessionWindowTimestamps,
      lastEndpoint: session.lastEndpoint,
      lastError: session.lastError,
      status: session.status,
      ...sessionWindowSummary
    })

    const templateRollup = templateRollups.get(session.templateId) ?? {
      templateId: session.templateId,
      templateName: session.templateName,
      modelPath: session.modelPath,
      lastRequestAt: session.lastRequestAt,
      ...zeroSummary()
    }
    mergeSummary(templateRollup, sessionWindowSummary)
    if (!templateRollup.lastRequestAt || (session.lastRequestAt && templateRollup.lastRequestAt < session.lastRequestAt)) {
      templateRollup.lastRequestAt = session.lastRequestAt
    }
    if (!templateRollup.modelPath && session.modelPath) {
      templateRollup.modelPath = session.modelPath
    }
    templateRollups.set(session.templateId, templateRollup)

    for (const windowedDailyRollup of windowedDailyRollups) {
      const dailyRollup = dailyRollups.get(windowedDailyRollup.day) ?? {
        day: windowedDailyRollup.day,
        ...zeroSummary()
      }
      mergeSummary(dailyRollup, windowedDailyRollup)
      dailyRollups.set(windowedDailyRollup.day, dailyRollup)
    }
  }

  const filteredLiveSessions = normalizedQuery.templateId
    ? liveSessions.filter((session) => session.templateId === normalizedQuery.templateId)
    : liveSessions
  const filteredRecentRequests = recentRequests.filter((record) => {
    if (normalizedQuery.templateId && record.templateId !== normalizedQuery.templateId) return false
    const finishedAt = new Date(record.finishedAt).getTime()
    return finishedAt >= normalizedQuery.fromTimestamp && finishedAt <= normalizedQuery.toTimestamp
  }).slice(0, normalizedQuery.limit)

  return {
    query: normalizedQuery,
    summary,
    liveSessions: [...filteredLiveSessions].sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    recentRequests: filteredRecentRequests,
    templateRollups: sortTemplateRollups(Array.from(templateRollups.values())),
    dailyRollups: sortDailyRollups(Array.from(dailyRollups.values())),
    sessionRollups: sortSessionRollups(sessionRollups)
  }
}
