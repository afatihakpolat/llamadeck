import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { OverlaySchema, CommandSchema, StructuralSchema, ArgOverlaySchema } from '../schemas'

describe('CommandSchema', () => {
  it('accepts a minimal command', () => {
    const cmd = { arg: '--foo', description: 'does foo', type: 'boolean' as const }
    expect(() => CommandSchema.parse(cmd)).not.toThrow()
  })

  it('rejects an unknown type', () => {
    const cmd = { arg: '--foo', description: 'x', type: 'hex' }
    expect(() => CommandSchema.parse(cmd)).toThrow()
  })

  it('accepts a positive numeric step and rejects invalid steps', () => {
    const cmd = { arg: '--foo', description: 'x', type: 'number' as const }
    expect(() => CommandSchema.parse({ ...cmd, step: 0.01 })).not.toThrow()
    expect(() => CommandSchema.parse({ ...cmd, step: 0 })).toThrow()
    expect(() => CommandSchema.parse({ ...cmd, step: Number.POSITIVE_INFINITY })).toThrow()
  })
})

describe('ArgOverlaySchema', () => {
  it('requires label, category, icon', () => {
    expect(() => ArgOverlaySchema.parse({ label: 'Foo', category: 'Performance', icon: 'Cpu', step: 0.01 })).not.toThrow()
    expect(() => ArgOverlaySchema.parse({ label: 'Foo' })).toThrow()
    expect(() => ArgOverlaySchema.parse({ label: 'Foo', category: 'Performance', icon: 'Cpu', step: 0 })).toThrow()
  })
})

describe('OverlaySchema', () => {
  it('accepts the expected shape', () => {
    const o = {
      version: '1.0',
      sectionMap: { 'common params': { name: 'Performance', icon: 'Cpu' } },
      args: { '--ctx-size': { label: 'Context Size', category: 'Performance', icon: 'Cpu', min: 0 } }
    }
    expect(() => OverlaySchema.parse(o)).not.toThrow()
  })

  it('ships a fractional step for repeat penalty', () => {
    const overlayPath = join(__dirname, '../../../resources/commands/overlay.json')
    const overlay = OverlaySchema.parse(JSON.parse(readFileSync(overlayPath, 'utf-8')))
    expect(overlay.args['--repeat-penalty'].step).toBe(0.01)
  })
})

describe('StructuralSchema', () => {
  it('wraps commands under section categories', () => {
    const s = {
      version: 'b9202',
      categories: [
        { name: 'common params', commands: [{ arg: '--foo', description: 'x', type: 'boolean' as const }] }
      ]
    }
    expect(() => StructuralSchema.parse(s)).not.toThrow()
  })
})
