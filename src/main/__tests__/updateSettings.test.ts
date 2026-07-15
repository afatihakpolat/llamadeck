import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  defaultUpdatePreferences,
  loadUpdateSettings,
  saveUpdateSettings,
  resolveUpdateSettingsPath
} from '../updateSettings'

let work: string
let settingsFile: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'hexllama-updatesettings-'))
  mkdirSync(join(work, 'nested'), { recursive: true })
  settingsFile = join(work, 'nested', 'update-settings.json')
})
afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('resolveUpdateSettingsPath', () => {
  it('appends the filename to a directory path', () => {
    expect(resolveUpdateSettingsPath('/tmp/foo')).toBe(join('/tmp/foo', 'update-settings.json'))
  })

  it('strips trailing forward slashes', () => {
    expect(resolveUpdateSettingsPath('/tmp/foo/')).toBe(join('/tmp/foo', 'update-settings.json'))
  })

  it('strips trailing backslashes', () => {
    expect(resolveUpdateSettingsPath('/tmp/foo\\')).toBe(join('/tmp/foo', 'update-settings.json'))
  })

  it('matches the resolved path used at runtime', () => {
    const resolved = resolveUpdateSettingsPath(work)
    expect(resolved).toBe(join(work, 'update-settings.json'))
  })
})

describe('defaultUpdatePreferences', () => {
  it('enables checkOnLaunch', () => {
    expect(defaultUpdatePreferences().checkOnLaunch).toBe(true)
  })

  it('disables autoDownload', () => {
    expect(defaultUpdatePreferences().autoDownload).toBe(false)
  })

  it('has no skippedVersion by default', () => {
    expect(defaultUpdatePreferences().skippedVersion).toBeUndefined()
  })
})

describe('loadUpdateSettings', () => {
  it('returns defaults when the file is missing', () => {
    const prefs = loadUpdateSettings(join(work, 'missing.json'))
    expect(prefs).toEqual(defaultUpdatePreferences())
  })

  it('returns defaults when the JSON is malformed', () => {
    writeFileSync(settingsFile, '{not json', 'utf8')
    const prefs = loadUpdateSettings(settingsFile)
    expect(prefs).toEqual(defaultUpdatePreferences())
  })

  it('returns defaults when the schema is invalid', () => {
    writeFileSync(settingsFile, JSON.stringify({ checkOnLaunch: 'yes', autoDownload: false }), 'utf8')
    const prefs = loadUpdateSettings(settingsFile)
    expect(prefs).toEqual(defaultUpdatePreferences())
  })

  it('returns the parsed preferences for a valid file', () => {
    const stored = { checkOnLaunch: false, autoDownload: true, skippedVersion: '1.2.0' }
    writeFileSync(settingsFile, JSON.stringify(stored), 'utf8')
    const prefs = loadUpdateSettings(settingsFile)
    expect(prefs).toEqual(stored)
  })
})

describe('saveUpdateSettings', () => {
  it('creates the parent directory if missing', () => {
    expect(existsSync(settingsFile)).toBe(false)
    saveUpdateSettings(settingsFile, defaultUpdatePreferences())
    expect(existsSync(settingsFile)).toBe(true)
  })

  it('writes valid JSON that round-trips through loadUpdateSettings', () => {
    const prefs = { checkOnLaunch: false, autoDownload: true, skippedVersion: '1.2.0' }
    saveUpdateSettings(settingsFile, prefs)
    expect(loadUpdateSettings(settingsFile)).toEqual(prefs)
  })

  it('rejects invalid preferences', () => {
    expect(() => saveUpdateSettings(settingsFile, { checkOnLaunch: 'yes' as unknown as boolean, autoDownload: false }))
      .toThrow()
  })

  it('uses atomic write (no .tmp left behind)', () => {
    saveUpdateSettings(settingsFile, defaultUpdatePreferences())
    expect(existsSync(`${settingsFile}.tmp`)).toBe(false)
    expect(existsSync(settingsFile)).toBe(true)
  })

  it('writes pretty-printed JSON', () => {
    saveUpdateSettings(settingsFile, defaultUpdatePreferences())
    const raw = readFileSync(settingsFile, 'utf8')
    expect(raw).toContain('\n')
    expect(JSON.parse(raw)).toEqual(defaultUpdatePreferences())
  })

  it('overwrites an existing file', () => {
    saveUpdateSettings(settingsFile, defaultUpdatePreferences())
    const updated = { checkOnLaunch: false, autoDownload: true, skippedVersion: '9.9.9' }
    saveUpdateSettings(settingsFile, updated)
    expect(loadUpdateSettings(settingsFile)).toEqual(updated)
  })
})