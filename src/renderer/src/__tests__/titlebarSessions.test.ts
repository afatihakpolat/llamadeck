import { describe, expect, it } from 'vitest'
import type { UsageLiveSession } from '../../../shared/types'
import {
  formatUsageNumber,
  formatUsageTimestamp,
  getUncachedInputTokens,
  hasActiveRequests,
  sortLiveSessionsByRecency
} from '../utils/titlebarSessions'

function createSession(overrides: Partial<UsageLiveSession> = {}): UsageLiveSession {
  return {
    launchId: 'launch-1',
    templateId: 'template-1',
    templateName: 'Template',
    publicPort: 8080,
    upstreamPort: 8081,
    startedAt: '2026-08-15T10:00:00.000Z',
    status: 'running',
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    exactUsageCount: 0,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    activeRequests: 0,
    ...overrides
  }
}

describe('formatUsageNumber', () => {
  it('groups large numbers with the locale thousands separator', () => {
    expect(formatUsageNumber(1234)).toBe('1,234')
    expect(formatUsageNumber(0)).toBe('0')
  })
})

describe('formatUsageTimestamp', () => {
  it('reports the no-data fallback when there is no timestamp', () => {
    expect(formatUsageTimestamp(undefined)).toBe('No tracked request yet')
    expect(formatUsageTimestamp('')).toBe('No tracked request yet')
  })

  it('reports an unknown-activity fallback for an unparseable timestamp', () => {
    expect(formatUsageTimestamp('not-a-date')).toBe('Unknown activity')
  })

  it('formats a valid timestamp as a clock string', () => {
    expect(formatUsageTimestamp('2026-08-15T10:00:00.000Z')).toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })
})

describe('getUncachedInputTokens', () => {
  it('subtracts cached tokens from the prompt total', () => {
    expect(getUncachedInputTokens({ promptTokens: 100, cacheTokens: 30 })).toBe(70)
  })

  it('never goes below zero when caching exceeds the prompt total', () => {
    expect(getUncachedInputTokens({ promptTokens: 10, cacheTokens: 50 })).toBe(0)
  })
})

describe('hasActiveRequests', () => {
  it('is false at zero and true above zero', () => {
    expect(hasActiveRequests({ activeRequests: 0 })).toBe(false)
    expect(hasActiveRequests({ activeRequests: 3 })).toBe(true)
  })
})

describe('sortLiveSessionsByRecency', () => {
  it('orders by the most recent activity first', () => {
    const oldest = createSession({ launchId: 'a', lastRequestAt: '2026-08-15T08:00:00.000Z' })
    const newest = createSession({ launchId: 'b', lastRequestAt: '2026-08-15T12:00:00.000Z' })
    const middle = createSession({ launchId: 'c', lastRequestAt: '2026-08-15T10:00:00.000Z' })

    expect(sortLiveSessionsByRecency([oldest, newest, middle]).map((s) => s.launchId)).toEqual(['b', 'c', 'a'])
  })

  it('falls back to startedAt when a session has no lastRequestAt yet', () => {
    const startedLate = createSession({ launchId: 'late', startedAt: '2026-08-15T11:00:00.000Z', lastRequestAt: undefined })
    const startedEarly = createSession({ launchId: 'early', startedAt: '2026-08-15T09:00:00.000Z', lastRequestAt: undefined })

    expect(sortLiveSessionsByRecency([startedEarly, startedLate]).map((s) => s.launchId)).toEqual(['late', 'early'])
  })

  it('prefers lastRequestAt over an earlier startedAt', () => {
    const startedLaterButIdle = createSession({ launchId: 'idle', startedAt: '2026-08-15T12:00:00.000Z', lastRequestAt: undefined })
    const startedEarlierButBusy = createSession({ launchId: 'busy', startedAt: '2026-08-15T09:00:00.000Z', lastRequestAt: '2026-08-15T13:00:00.000Z' })

    expect(sortLiveSessionsByRecency([startedLaterButIdle, startedEarlierButBusy]).map((s) => s.launchId)).toEqual(['busy', 'idle'])
  })

  it('does not mutate the input array', () => {
    const input = [
      createSession({ launchId: 'a', lastRequestAt: '2026-08-15T08:00:00.000Z' }),
      createSession({ launchId: 'b', lastRequestAt: '2026-08-15T12:00:00.000Z' })
    ]
    const orderBefore = input.map((s) => s.launchId)

    sortLiveSessionsByRecency(input)

    expect(input.map((s) => s.launchId)).toEqual(orderBefore)
  })
})
