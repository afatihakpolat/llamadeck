import { describe, it, expect } from 'vitest'
import {
  UpdateStatusSchema,
  UpdateInfoSchema,
  UpdateProgressSchema,
  UpdateStateSchema,
  UpdatePreferencesSchema
} from '../update'

describe('UpdateStatusSchema', () => {
  it('accepts all known statuses', () => {
    for (const s of ['idle', 'checking', 'available', 'not-available', 'downloading', 'downloaded', 'error']) {
      expect(() => UpdateStatusSchema.parse(s)).not.toThrow()
    }
  })

  it('rejects unknown statuses', () => {
    expect(() => UpdateStatusSchema.parse('pending')).toThrow()
  })
})

describe('UpdateInfoSchema', () => {
  it('accepts a minimal info object', () => {
    expect(() => UpdateInfoSchema.parse({ version: '1.2.0' })).not.toThrow()
  })

  it('accepts full info with optional fields', () => {
    const info = { version: '1.2.0', releaseDate: '2026-07-15', releaseNotes: 'Bug fixes' }
    expect(() => UpdateInfoSchema.parse(info)).not.toThrow()
  })

  it('rejects info missing version', () => {
    expect(() => UpdateInfoSchema.parse({ releaseDate: '2026-07-15' })).toThrow()
  })
})

describe('UpdateProgressSchema', () => {
  it('requires all numeric fields', () => {
    expect(() => UpdateProgressSchema.parse({ percent: 50, bytesPerSecond: 1024, transferred: 512, total: 1024 })).not.toThrow()
    expect(() => UpdateProgressSchema.parse({ percent: 50 })).toThrow()
  })
})

describe('UpdateStateSchema', () => {
  it('accepts the idle baseline', () => {
    expect(() => UpdateStateSchema.parse({ status: 'idle', currentVersion: '1.1.5' })).not.toThrow()
  })

  it('accepts available state with info', () => {
    const state = {
      status: 'available' as const,
      currentVersion: '1.1.5',
      available: { version: '1.2.0' },
      lastCheckedAt: '2026-07-15T10:00:00Z'
    }
    expect(() => UpdateStateSchema.parse(state)).not.toThrow()
  })

  it('accepts downloading state with progress', () => {
    const state = {
      status: 'downloading' as const,
      currentVersion: '1.1.5',
      progress: { percent: 42, bytesPerSecond: 1024, transferred: 512, total: 1024 }
    }
    expect(() => UpdateStateSchema.parse(state)).not.toThrow()
  })

  it('rejects unknown status', () => {
    expect(() => UpdateStateSchema.parse({ status: 'pending', currentVersion: '1.1.5' })).toThrow()
  })
})

describe('UpdatePreferencesSchema', () => {
  it('accepts defaults', () => {
    const prefs = { checkOnLaunch: true, autoDownload: false }
    expect(() => UpdatePreferencesSchema.parse(prefs)).not.toThrow()
  })

  it('accepts skippedVersion as optional', () => {
    const prefs = { checkOnLaunch: false, autoDownload: true, skippedVersion: '1.2.0' }
    expect(() => UpdatePreferencesSchema.parse(prefs)).not.toThrow()
  })

  it('rejects non-boolean flags', () => {
    expect(() => UpdatePreferencesSchema.parse({ checkOnLaunch: 'yes', autoDownload: false })).toThrow()
  })
})