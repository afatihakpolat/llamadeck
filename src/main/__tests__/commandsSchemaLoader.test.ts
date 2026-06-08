import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, utimesSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadMergedSchema, resetLoaderCache } from '../commandsSchemaLoader'

let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'hexllama-loader-'))
  resetLoaderCache()
})
afterEach(() => { rmSync(work, { recursive: true, force: true }) })

function writeJSON(rel: string, obj: unknown) {
  const p = join(work, rel)
  mkdirSync(join(work, rel, '..'), { recursive: true })
  writeFileSync(p, JSON.stringify(obj))
  return p
}

function makeOverlay() {
  return {
    version: '1.0' as const,
    sectionMap: { 'common params': { name: 'Performance', icon: 'Cpu' } },
    args: { '--ctx-size': { label: 'Context Size', category: 'Performance', icon: 'Cpu' } }
  }
}

function makeStructural() {
  return {
    version: 'b9202',
    categories: [{ name: 'common params', commands: [{ arg: '--ctx-size', description: 'x', type: 'number' as const, default: 0, section: 'common params' }] }]
  }
}

describe('loadMergedSchema — sources', () => {
  it('returns null when no structural source exists', async () => {
    const overlay = makeOverlay()
    const result = await loadMergedSchema({ buildTag: 'b9202', backendDir: work, overlay })
    expect(result).toBeNull()
  })

  it('reads <backendDir>/<buildTag>/generated.json when present', async () => {
    writeJSON('b9202/generated.json', makeStructural())
    const overlay = makeOverlay()
    const result = await loadMergedSchema({ buildTag: 'b9202', backendDir: work, overlay })
    expect(result).not.toBeNull()
    expect(result!.categories[0].commands[0].label).toBe('Context Size')
  })

  it('falls back to <bundledDir>/<buildTag>.json when per-build is missing', async () => {
    writeJSON('bundled/b9202.json', makeStructural())
    const overlay = makeOverlay()
    const result = await loadMergedSchema({ buildTag: 'b9202', backendDir: work, bundledDir: join(work, 'bundled'), overlay })
    expect(result).not.toBeNull()
  })

  it('applies user override at <backendDir>/<buildTag>/commands.json', async () => {
    writeJSON('b9202/generated.json', makeStructural())
    writeJSON('b9202/commands.json', {
      version: 'user',
      categories: [{ name: 'Performance', icon: 'Cpu', commands: [{ arg: '--ctx-size', label: 'Ctx', description: 'x', type: 'number' as const, default: 4096 }] }]
    })
    const overlay = makeOverlay()
    const result = await loadMergedSchema({ buildTag: 'b9202', backendDir: work, overlay })
    expect(result!.categories[0].commands[0].default).toBe(4096)
  })
})

describe('loadMergedSchema — caching', () => {
  it('returns the same instance when called twice with no changes', async () => {
    writeJSON('b9202/generated.json', makeStructural())
    const overlay = makeOverlay()
    const a = await loadMergedSchema({ buildTag: 'b9202', backendDir: work, overlay })
    const b = await loadMergedSchema({ buildTag: 'b9202', backendDir: work, overlay })
    expect(a).toBe(b) // reference equality
  })

  it('invalidates when generated.json mtime changes', async () => {
    const p = writeJSON('b9202/generated.json', makeStructural())
    const overlay = makeOverlay()
    const a = await loadMergedSchema({ buildTag: 'b9202', backendDir: work, overlay })
    // Bump mtime by 2 seconds.
    const future = new Date(Date.now() + 2000)
    utimesSync(p, future, future)
    const b = await loadMergedSchema({ buildTag: 'b9202', backendDir: work, overlay })
    expect(a).not.toBe(b)
  })
})
