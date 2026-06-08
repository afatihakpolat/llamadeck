import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseHelpOutput } from '../commandsSchemaParser'

const fixtures = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf-8')

describe('parseHelpOutput — section detection', () => {
  it('detects a single section header', () => {
    const out = parseHelpOutput('----- common params -----\n\n--foo N   bar\n')
    expect(out[0].section).toBe('common params')
  })

  it('groups commands under their section', () => {
    const out = parseHelpOutput(
      '----- common params -----\n\n--foo N   bar\n\n----- sampling params -----\n\n--baz N   qux\n'
    )
    expect(out.find(c => c.arg === '--foo')?.section).toBe('common params')
    expect(out.find(c => c.arg === '--baz')?.section).toBe('sampling params')
  })
})

describe('parseHelpOutput — flag tokenization (help-ctx-size)', () => {
  it('extracts the canonical arg and short flag', () => {
    const out = parseHelpOutput(fixtures('help-ctx-size.txt'))
    expect(out).toHaveLength(1)
    expect(out[0].arg).toBe('--ctx-size')
    expect(out[0].short).toBe('-c')
  })
})

describe('parseHelpOutput — flash-attn (square-bracket value)', () => {
  it('treats [on|off|auto] as a value placeholder and infers select type', () => {
    const out = parseHelpOutput(fixtures('help-flash-attn.txt'))
    expect(out[0].arg).toBe('--flash-attn')
    expect(out[0].short).toBe('-fa')
    expect(out[0].type).toBe('select')
    expect(out[0].options).toEqual(['on', 'off', 'auto'])
  })
})

describe('parseHelpOutput — kv-unified (boolean triple)', () => {
  it('handles a 4-token chain with negation', () => {
    const out = parseHelpOutput(fixtures('help-kv-unified.txt'))
    expect(out[0].arg).toBe('--kv-unified')
    expect(out[0].short).toBe('-kvu')
    expect(out[0].type).toBe('boolean')
    expect(out[0].negationLongs).toContain('--no-kv-unified')
    expect(out[0].negationShort).toBe('-no-kvu')
  })
})

describe('parseHelpOutput — fim-qwen (dot in flag name)', () => {
  it('accepts a flag name with a dot', () => {
    const out = parseHelpOutput(fixtures('help-fim.txt'))
    expect(out[0].arg).toBe('--fim-qwen-1.5b-default')
    expect(out[0].type).toBe('boolean')
  })
})
