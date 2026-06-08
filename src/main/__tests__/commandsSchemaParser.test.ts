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

describe('parseHelpOutput — b9202 full fixture', () => {
  const full = fixtures('b9202-help.txt')
  const all = parseHelpOutput(full)

  it('parses at least 240 commands', () => {
    expect(all.length).toBeGreaterThanOrEqual(240)
  })

  it('recognizes all 4 sections', () => {
    const sections = new Set(all.map(c => c.section))
    expect(sections).toEqual(new Set([
      'common params', 'sampling params', 'speculative params', 'example-specific params'
    ]))
  })

  it('--ctx-size: number, default 0, env recorded', () => {
    const c = all.find(x => x.arg === '--ctx-size')!
    expect(c.type).toBe('number')
    expect(c.default).toBe(0)
    expect(c.env).toBe('LLAMA_ARG_CTX_SIZE')
    expect(c.description).not.toMatch(/default:/)
  })

  it('--flash-attn: select with [on|off|auto] options', () => {
    const c = all.find(x => x.arg === '--flash-attn')!
    expect(c.type).toBe('select')
    expect(c.options).toEqual(['on', 'off', 'auto'])
  })

  it('--hf-repo: string with angle-bracket placeholder', () => {
    const c = all.find(x => x.arg === '--hf-repo')!
    expect(c.type).toBe('string')
  })

  it('--n-gpu-layers: number, last positive long wins', () => {
    const c = all.find(x => x.arg === '--n-gpu-layers')!
    expect(c.type).toBe('number')
    expect(c.aliasLongs).toContain('--gpu-layers')
  })

  it('--repack: boolean, default enabled coerced to true', () => {
    const c = all.find(x => x.arg === '--repack')!
    expect(c.type).toBe('boolean')
    expect(c.default).toBe(true)
  })

  it('--no-perf: recorded as negation, not separate arg', () => {
    expect(all.find(x => x.arg === '--no-perf')).toBeUndefined()
    const perf = all.find(x => x.arg === '--perf')!
    expect(perf.negationLongs).toContain('--no-perf')
  })

  it('--fim-qwen-1.5b-default: boolean, dot in name', () => {
    const c = all.find(x => x.arg === '--fim-qwen-1.5b-default')!
    expect(c.type).toBe('boolean')
  })

  it('--pooling: select with curly-brace enum', () => {
    const c = all.find(x => x.arg === '--pooling')!
    expect(c.type).toBe('select')
    expect(c.options).toEqual(['none', 'mean', 'cls', 'last', 'rank'])
  })

  it('--spec-type: select with comma-separated enum', () => {
    const c = all.find(x => x.arg === '--spec-type')!
    expect(c.type).toBe('select')
    expect(c.options).toContain('draft-eagle3')
  })

  it('every command has a non-empty description', () => {
    for (const c of all) {
      expect(c.description.length).toBeGreaterThan(0)
    }
  })

  it('no description contains a (default: ...) clause', () => {
    for (const c of all) {
      expect(c.description).not.toMatch(/\(default:/)
    }
  })
})
