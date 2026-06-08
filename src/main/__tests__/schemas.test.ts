import { describe, it, expect } from 'vitest'
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
})

describe('ArgOverlaySchema', () => {
  it('requires label, category, icon', () => {
    expect(() => ArgOverlaySchema.parse({ label: 'Foo', category: 'Performance', icon: 'Cpu' })).not.toThrow()
    expect(() => ArgOverlaySchema.parse({ label: 'Foo' })).toThrow()
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
