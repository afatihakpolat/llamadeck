import { describe, it, expect } from 'vitest'
import { mergeCommandsSchema } from '../commandsSchemaMerger'
import type { Command } from '../schemas'
import type { Overlay } from '../schemas'

function cmd(over: Partial<Command>): Command {
  return { arg: '--foo', description: 'x', type: 'boolean', section: 'common params', ...over }
}

const baseOverlay: Overlay = {
  version: '1.0',
  sectionMap: { 'common params': { name: 'Performance', icon: 'Cpu' } },
  args: {}
}

describe('mergeCommandsSchema — basic merge', () => {
  it('produces one category per distinct (curated or section) group', () => {
    const structural = [cmd({ arg: '--foo' })]
    const merged = mergeCommandsSchema(structural, baseOverlay, null)
    expect(merged.categories).toHaveLength(1)
    expect(merged.categories[0].name).toBe('Performance')
    expect(merged.categories[0].icon).toBe('Cpu')
  })

  it('each merged command has a label (auto-derived when no overlay)', () => {
    const structural = [cmd({ arg: '--n-gpu-layers', type: 'number' })]
    const merged = mergeCommandsSchema(structural, baseOverlay, null)
    expect(merged.categories[0].commands[0].label).toBe('N Gpu Layers')
  })
})

describe('mergeCommandsSchema — overlay fields win for curated args', () => {
  it('uses the overlay label, category, icon, placeholder, min, max', () => {
    const overlay: Overlay = {
      version: '1.0',
      sectionMap: { 'common params': { name: 'Performance', icon: 'Cpu' } },
      args: {
        '--ctx-size': { label: 'Context Size', category: 'Performance', icon: 'Cpu', placeholder: '2048', min: 0, max: 131072 }
      }
    }
    const structural = [cmd({ arg: '--ctx-size', type: 'number', default: 0 })]
    const merged = mergeCommandsSchema(structural, overlay, null)
    const c = merged.categories[0].commands[0]
    expect(c.label).toBe('Context Size')
    expect(c.placeholder).toBe('2048')
    expect(c.min).toBe(0)
    expect(c.max).toBe(131072)
  })
})

describe('mergeCommandsSchema — alias resolution for overlay lookup', () => {
  it('finds overlay data under an aliasLongs key', () => {
    const overlay: Overlay = {
      version: '1.0',
      sectionMap: { 'common params': { name: 'Performance', icon: 'Cpu' } },
      args: { '--gpu-layers': { label: 'GPU Layers', category: 'Performance', icon: 'Cpu' } }
    }
    const structural = [cmd({ arg: '--n-gpu-layers', aliasLongs: ['--gpu-layers'] })]
    const merged = mergeCommandsSchema(structural, overlay, null)
    const c = merged.categories[0].commands[0]
    expect(c.label).toBe('GPU Layers')
  })
})

describe('mergeCommandsSchema — user override', () => {
  it('user override on canonical arg wins over merged value', () => {
    const structural = [cmd({ arg: '--ctx-size', type: 'number', default: 0 })]
    const userOverride = {
      version: 'user', categories: [{
        name: 'Performance', icon: 'Cpu',
        commands: [{ arg: '--ctx-size', label: 'Context Size', description: 'x', type: 'number' as const, default: 4096 }]
      }]
    }
    const merged = mergeCommandsSchema(structural, baseOverlay, userOverride)
    const c = merged.categories[0].commands[0]
    expect(c.default).toBe(4096)
  })

  it('user override on aliasLongs applies to canonical', () => {
    const structural = [cmd({ arg: '--n-gpu-layers', type: 'number', aliasLongs: ['--gpu-layers'] })]
    const userOverride = {
      version: 'user', categories: [{
        name: 'Performance', icon: 'Cpu',
        commands: [{ arg: '--gpu-layers', label: 'GPU Layers', description: 'x', type: 'number' as const, default: 99 }]
      }]
    }
    const merged = mergeCommandsSchema(structural, baseOverlay, userOverride)
    const c = merged.categories[0].commands[0]
    expect(c.arg).toBe('--n-gpu-layers')
    expect(c.default).toBe(99)
  })
})

describe('mergeCommandsSchema — section-based category fallback', () => {
  it('uses the sectionMap when the command is not in the overlay', () => {
    const overlay: Overlay = {
      version: '1.0',
      sectionMap: {
        'common params': { name: 'Performance', icon: 'Cpu' },
        'sampling params': { name: 'Sampling', icon: 'Sliders' }
      },
      args: {}
    }
    const structural = [
      cmd({ arg: '--threads', type: 'number' }),
      cmd({ arg: '--top-k', type: 'number', section: 'sampling params' })
    ]
    const merged = mergeCommandsSchema(structural, overlay, null)
    const byCat = Object.fromEntries(merged.categories.map(c => [c.name, c.commands.map(x => x.arg)]))
    expect(byCat['Performance']).toContain('--threads')
    expect(byCat['Sampling']).toContain('--top-k')
  })
})
