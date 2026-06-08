import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadMergedSchema, resetLoaderCache } from '../commandsSchemaLoader'

let work: string
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'hexllama-ipc-'))
  resetLoaderCache()
})
afterEach(() => { rmSync(work, { recursive: true, force: true }) })

describe('IPC get-commands path (via loader)', () => {
  it('returns a merged schema when per-build file exists', async () => {
    const overlay = {
      version: '1.0' as const,
      sectionMap: { 'common params': { name: 'Performance', icon: 'Cpu' } },
      args: { '--ctx-size': { label: 'Context Size', category: 'Performance', icon: 'Cpu' } }
    }
    mkdirSync(join(work, 'b9202'), { recursive: true })
    writeFileSync(join(work, 'b9202', 'generated.json'), JSON.stringify({
      version: 'b9202', categories: [{
        name: 'common params', commands: [{ arg: '--ctx-size', description: 'x', type: 'number' as const, section: 'common params' }]
      }]
    }))
    const merged = await loadMergedSchema({ buildTag: 'b9202', backendDir: work, overlay })
    expect(merged).not.toBeNull()
    expect(merged!.categories[0].commands[0].label).toBe('Context Size')
  })

  it('returns null when no structural source is available (renderer handles empty editor)', async () => {
    const overlay = {
      version: '1.0' as const,
      sectionMap: {}, args: {}
    }
    const merged = await loadMergedSchema({ buildTag: 'b9999', backendDir: work, overlay })
    expect(merged).toBeNull()
  })
})
