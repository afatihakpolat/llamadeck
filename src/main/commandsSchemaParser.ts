import { Command } from './schemas'

interface ParsedFlagLine {
  arg: string
  short: string | null
  aliasLongs: string[]
  negationLongs: string[]
  negationShort: string | null
  valuePlaceholder: string | null
  descStart: string
}

const SECTION_HEADER = /^----- (.+) -----$/
const SHORT_PREFIX = /^(-[a-zA-Z0-9-]+),\s+/
const LONG_PREFIX = /^(--[a-zA-Z][\w.-]*),\s+/

function parseFlagLine(rawLine: string): ParsedFlagLine | null {
  const line = rawLine.trimStart()
  if (!line.startsWith('-')) return null

  const tokens: string[] = []
  let rest = line
  while (true) {
    rest = rest.replace(/^\s+/, '')
    const m = rest.match(SHORT_PREFIX) || rest.match(LONG_PREFIX)
    if (!m) break
    tokens.push(m[1])
    rest = rest.slice(m[0].length)
  }
  if (!rest.startsWith('--')) return null
  const longMatch = rest.match(/^(--[a-zA-Z][\w.-]*)(\s+(.+))?$/)
  if (!longMatch) return null
  tokens.push(longMatch[1])

  let valuePlaceholder: string | null = null
  let descStart = ''
  if (longMatch[3]) {
    const tail = longMatch[3]
    const firstTokenMatch = tail.match(/^(\S+)(\s+.*)?$/)
    if (firstTokenMatch && looksLikeValuePlaceholder(firstTokenMatch[1])) {
      valuePlaceholder = firstTokenMatch[1]
      descStart = (firstTokenMatch[2] || '').trimStart()
    } else {
      descStart = tail
    }
  }

  const longs = tokens.filter(t => t.startsWith('--'))
  const shorts = tokens.filter(t => t.startsWith('-') && !t.startsWith('--'))
  const negationLongs = longs.filter(t => t.startsWith('--no-'))
  const positiveLongs = longs.filter(t => !t.startsWith('--no-'))
  const arg = positiveLongs[positiveLongs.length - 1] || longs[longs.length - 1]
  const aliasLongs = positiveLongs.filter(t => t !== arg)
  const negationShort = shorts.find(s => s.startsWith('-no-')) || null
  const short = shorts.find(s => !s.startsWith('-no-')) || shorts[0] || null

  return { arg, short, aliasLongs, negationLongs, negationShort, valuePlaceholder, descStart }
}

function looksLikeValuePlaceholder(token: string): boolean {
  if (!token) return false
  if (/^[A-Z][A-Z0-9_]*$/.test(token)) return true
  if (token.startsWith('[') && token.endsWith(']')) return true
  if (token.startsWith('<')) {
    if (token.endsWith('>') || token.endsWith(']') || token.endsWith('),...')) return true
  }
  if (token.startsWith('{') && token.endsWith('}')) return true
  if (token === 'lo-hi') return true
  if (/,/.test(token) && !/\s/.test(token)) return true
  return false
}

function isIndented(line: string): boolean {
  return line.length > 0 && line.startsWith(' '.repeat(38))
}
function isBlankOrIndented(line: string): boolean {
  return line.trim() === '' || isIndented(line)
}

function extractAndStripDefault(s: string): { default: string | null; cleaned: string } {
  if (!s) return { default: null, cleaned: s }
  const m = s.match(/\(default:\s*([^,)]+)/)
  if (!m) return { default: null, cleaned: s }
  return { default: m[1].trim(), cleaned: s.replace(/\s*\(default:.*$/, '').trim() }
}

function coerceDefault(raw: string, type: Command['type']): string | number | boolean | null {
  if (type === 'number' || type === 'boolean') {
    const n = Number(raw)
    if (!Number.isNaN(n)) return n
    if (/^(enabled|true|on)$/i.test(raw)) return true
    if (/^(disabled|false|off)$/i.test(raw)) return false
    return null
  }
  return raw.replace(/^['"]|['"]$/g, '')
}

export function parseHelpOutput(stdout: string): Command[] {
  const lines = stdout.split(/\r?\n/)
  const sections: { name: string; lines: string[] }[] = []
  let current: { name: string; lines: string[] } | null = null
  for (const line of lines) {
    if (SECTION_HEADER.test(line)) {
      const name = line.match(SECTION_HEADER)![1].trim()
      current = { name, lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    }
  }

  const out: Command[] = []
  for (const section of sections) {
    let i = 0
    while (i < section.lines.length) {
      const line = section.lines[i]
      if (!line.trim()) { i++; continue }
      if (isIndented(line)) { i++; continue }
      const flag = parseFlagLine(line)
      if (!flag) { i++; continue }

      const cont: string[] = []
      i++
      while (i < section.lines.length && isBlankOrIndented(section.lines[i])) {
        cont.push(section.lines[i])
        i++
      }

      let descLines = [flag.descStart]
      let defaults: string[] = []
      let envs: string[] = []
      let allowedValues: string[] | null = null
      let deprecated = false
      let deprecationNote: string | null = null
      let validRange: { min: number; max: number } | null = null

      const inline = extractAndStripDefault(flag.descStart)
      if (inline.default) defaults.push(inline.default)
      descLines = [inline.cleaned]

      for (const cl of cont) {
        const trimmed = cl.trim()
        if (!trimmed) continue
        if (trimmed.startsWith('(default:')) {
          const m = trimmed.match(/^\(default:\s*([^,)]+)/)
          if (m) defaults.push(m[1].trim())
          continue
        }
        if (trimmed.startsWith('(env:')) {
          const m = trimmed.match(/^\(env:\s*([A-Z_][A-Z0-9_]*)\)\s*$/)
          if (m) envs.push(m[1])
          continue
        }
        if (trimmed.startsWith('allowed values:')) {
          const m = trimmed.match(/^allowed values:\s*(.+?)\s*$/)
          if (m) allowedValues = m[1].split(',').map(s => s.trim()).filter(Boolean)
          continue
        }
        if (trimmed.startsWith('the argument has been removed')) {
          deprecated = true
          deprecationNote = trimmed
          continue
        }
        if (trimmed.startsWith('[DEPRECATED:')) {
          deprecated = true
          deprecationNote = trimmed
          continue
        }
        const rangeMatch = trimmed.match(/valid range\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i)
        if (rangeMatch && !validRange) {
          validRange = { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) }
        }
        descLines.push(trimmed.replace(/\s*\(default:.*$/, ''))
      }

      const joined = descLines.join(' ').replace(/\s+/g, ' ').trim()
      // Final pass: strip a (default: ...) clause that may have wrapped across
      // the flag line and a continuation line, and capture its value.
      const wrappedDefault = joined.match(/\(default:\s*([^)]+)\)\s*$/)
      let description = joined
      if (wrappedDefault) {
        if (defaults.length === 0) defaults.push(wrappedDefault[1].trim())
        description = joined.replace(/\s*\(default:[^)]*\)\s*$/, '').trim()
      } else {
        description = joined
      }

      let type: Command['type'] = 'string'
      let options: string[] | undefined
      if (flag.valuePlaceholder === null) {
        type = 'boolean'
      } else if (validRange) {
        type = 'number'
      } else if (allowedValues) {
        type = 'select'
        options = allowedValues
      } else if (flag.valuePlaceholder === 'N' || /^<\d+(\.\.\.| \|)\d+>$/.test(flag.valuePlaceholder)) {
        type = 'number'
      } else if (/^\{[^}]+\}$/.test(flag.valuePlaceholder)) {
        type = 'select'
        options = flag.valuePlaceholder.slice(1, -1).split(',').map(s => s.trim())
      } else if (/^\[.+\]$/.test(flag.valuePlaceholder)) {
        type = 'select'
        options = flag.valuePlaceholder.slice(1, -1).split('|').map(s => s.trim()).filter(Boolean)
      } else if (/,/.test(flag.valuePlaceholder)) {
        type = 'select'
        options = flag.valuePlaceholder.split(',').map(s => s.trim()).filter(Boolean)
      }

      const cmd: Command = {
        arg: flag.arg,
        description,
        type,
        section: section.name
      }
      if (flag.short) cmd.short = flag.short
      if (flag.aliasLongs.length > 0) cmd.aliasLongs = flag.aliasLongs
      if (flag.negationLongs.length > 0) cmd.negationLongs = flag.negationLongs
      if (flag.negationShort) cmd.negationShort = flag.negationShort
      if (defaults.length > 0) {
        const coerced = coerceDefault(defaults[0], type)
        if (coerced !== null) cmd.default = coerced
      }
      if (envs.length > 0) cmd.env = envs[0]
      if (options) cmd.options = options
      if (deprecated) {
        cmd.deprecated = true
        if (deprecationNote) cmd.deprecationNote = deprecationNote
      }
      out.push(cmd)
    }
  }
  return out
}
