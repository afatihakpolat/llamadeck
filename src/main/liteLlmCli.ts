import { parseDocument, stringify } from 'yaml'

const REDACTED_VALUE = '<redacted>'

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, '').toLowerCase()
  return normalized.endsWith('apikey')
    || normalized.endsWith('masterkey')
    || normalized.endsWith('token')
    || normalized.endsWith('secret')
    || normalized.endsWith('password')
    || normalized === 'authorization'
}

export interface CliLiteLlmLogEntry {
  sequence: number
  timestamp: string
  text: string
}

export interface CliLiteLlmLogsResult {
  events: CliLiteLlmLogEntry[]
  nextCursor: number
  hasMore: boolean
  running: boolean
}

function redactStructuredValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactStructuredValue(item, seen))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  if (seen.has(value)) {
    return REDACTED_VALUE
  }

  seen.add(value)
  const source = value as Record<string, unknown>
  const redacted = Object.create(null) as Record<string, unknown>
  for (const [key, item] of Object.entries(source)) {
    redacted[key] = isSensitiveKey(key)
      ? REDACTED_VALUE
      : redactStructuredValue(item, seen)
  }
  return redacted
}

export function redactLiteLlmSecrets(text: string, exactSecrets: string[] = []): string {
  let redacted = text
  for (const secret of exactSecrets) {
    if (secret) {
      redacted = redacted.split(secret).join(REDACTED_VALUE)
    }
  }

  return redacted
    .replace(/\b(Bearer)\s+[^\s"',;]+/gi, `$1 ${REDACTED_VALUE}`)
    .replace(
      /((?:api[_-]?key|master[_-]?key|authorization|token|secret|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      `$1${REDACTED_VALUE}`
    )
}

export function redactLiteLlmConfigText(configText: string): string {
  const document = parseDocument(configText, { prettyErrors: false, uniqueKeys: true })
  if (document.errors.length > 0) {
    return '# Config text withheld because invalid YAML could not be safely redacted.\n'
  }

  const redacted = redactStructuredValue(document.toJS(), new WeakSet<object>())
  return stringify(redacted)
}

export class LiteLlmCliLogBuffer {
  private readonly entries: CliLiteLlmLogEntry[] = []
  private nextSequence = 1

  constructor(private readonly capacity: number) {}

  append(chunk: string, exactSecrets: string[] = [], now = new Date()): void {
    const lines = redactLiteLlmSecrets(chunk, exactSecrets)
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
    const timestamp = now.toISOString()

    for (const text of lines) {
      this.entries.push({
        sequence: this.nextSequence,
        timestamp,
        text
      })
      this.nextSequence += 1
    }

    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity)
    }
  }

  recentText(limit: number): string[] {
    return this.entries.slice(-limit).map((entry) => entry.text)
  }

  list(afterSequence: number, limit: number, running: boolean): CliLiteLlmLogsResult {
    const available = this.entries.filter((entry) => entry.sequence > afterSequence)
    const events = available.slice(0, limit)
    const nextCursor = events.at(-1)?.sequence ?? afterSequence

    return {
      events,
      nextCursor,
      hasMore: available.length > events.length,
      running
    }
  }
}
