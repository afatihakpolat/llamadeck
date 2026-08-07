import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { OverlaySchema, CommandSchema, StructuralSchema, ArgOverlaySchema } from '../schemas'
import { parseHelpOutput } from '../commandsSchemaParser'

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

  it('ships fractional steps for every known decimal parameter', () => {
    const overlayPath = join(__dirname, '../../../resources/commands/overlay.json')
    const overlay = OverlaySchema.parse(JSON.parse(readFileSync(overlayPath, 'utf-8')))
    for (const fixture of ['b9202-help.txt', 'b9584-help.txt']) {
      const fixturePath = join(__dirname, `fixtures/${fixture}`)
      const commands = parseHelpOutput(readFileSync(fixturePath, 'utf-8'))
      const fractionalCommands = commands.filter(command => command.step !== undefined && command.step < 1)

      expect(fractionalCommands, `${fixture} fractional parameters`).toHaveLength(22)
      for (const command of fractionalCommands) {
        const overlayEntry = [command.arg, ...(command.aliasLongs ?? [])]
          .map(arg => overlay.args[arg])
          .find(entry => entry !== undefined)
        expect(overlayEntry, `${command.arg} must have a legacy-compatible overlay entry`).toBeDefined()
        expect(overlayEntry?.step, `${command.arg} must preserve its inferred fractional step`).toBe(command.step)
      }
    }
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
