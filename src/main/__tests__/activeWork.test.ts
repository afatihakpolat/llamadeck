import { describe, it, expect } from 'vitest'
import { hasActiveWork, type ActiveWorkSnapshot } from '../activeWork'

function snapshot(overrides: Partial<ActiveWorkSnapshot> = {}): ActiveWorkSnapshot {
  return {
    sourceUpdateJob: null,
    cancelBackendDl: null,
    downloadTasks: new Map(),
    ...overrides
  }
}

describe('hasActiveWork', () => {
  it('returns false for an empty snapshot', () => {
    expect(hasActiveWork(snapshot())).toBe(false)
  })

  it('returns true when a source update job is in progress', () => {
    const sourceUpdateJob = { cancelled: false, process: { pid: 123 } }
    expect(hasActiveWork(snapshot({ sourceUpdateJob }))).toBe(true)
  })

  it('returns true when a backend download is in progress', () => {
    expect(hasActiveWork(snapshot({ cancelBackendDl: () => {} }))).toBe(true)
  })

  it('returns true when a download task is downloading', () => {
    const downloadTasks = new Map([['a', { phase: 'downloading' as const }]])
    expect(hasActiveWork(snapshot({ downloadTasks }))).toBe(true)
  })

  it('returns true when a download task is paused', () => {
    const downloadTasks = new Map([['a', { phase: 'paused' as const }]])
    expect(hasActiveWork(snapshot({ downloadTasks }))).toBe(true)
  })

  it('returns false when all download tasks are done', () => {
    const downloadTasks = new Map<string, { phase: 'downloading' | 'paused' | 'done' | 'error' | 'cancelled' }>([
      ['a', { phase: 'done' }],
      ['b', { phase: 'error' }],
      ['c', { phase: 'cancelled' }]
    ])
    expect(hasActiveWork(snapshot({ downloadTasks }))).toBe(false)
  })

  it('returns true when any one of multiple tasks is active', () => {
    const downloadTasks = new Map([
      ['a', { phase: 'done' as const }],
      ['b', { phase: 'downloading' as const }],
      ['c', { phase: 'cancelled' as const }]
    ])
    expect(hasActiveWork(snapshot({ downloadTasks }))).toBe(true)
  })

  it('returns true when source update and backend download are both active', () => {
    const sourceUpdateJob = { cancelled: false, process: {} }
    expect(hasActiveWork(snapshot({ sourceUpdateJob, cancelBackendDl: () => {} }))).toBe(true)
  })
})