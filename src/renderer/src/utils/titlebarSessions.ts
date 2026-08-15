import type { UsageLiveSession } from '../../../shared/types'

export function formatUsageNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

export function formatUsageTimestamp(timestamp?: string): string {
  if (!timestamp) return 'No tracked request yet'

  const date = new Date(timestamp)
  return Number.isNaN(date.getTime())
    ? 'Unknown activity'
    : date.toLocaleTimeString([], { hour12: false })
}

export function getUncachedInputTokens(session: Pick<UsageLiveSession, 'promptTokens' | 'cacheTokens'>): number {
  return Math.max(session.promptTokens - session.cacheTokens, 0)
}

export function hasActiveRequests(session: Pick<UsageLiveSession, 'activeRequests'>): boolean {
  return session.activeRequests > 0
}

function getSessionSortTime(session: UsageLiveSession): number {
  return new Date(session.lastRequestAt ?? session.startedAt).getTime()
}

export function sortLiveSessionsByRecency(sessions: readonly UsageLiveSession[]): UsageLiveSession[] {
  return [...sessions].sort((left, right) => getSessionSortTime(right) - getSessionSortTime(left))
}
