import { randomUUID } from 'crypto'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'http'
import { StringDecoder } from 'string_decoder'
import type { UsageRequestRecord, UsageTimingSnapshot } from '../shared/types'

interface ProxyUsageContext {
  launchId: string
  templateId: string
  templateNameSnapshot: string
  modelPathSnapshot?: string
}

interface ProxyCallbacks {
  onRequestStarted: (path: string) => void
  onRequestFinished: (record: UsageRequestRecord) => void
}

export interface LlamaProxyHandle {
  close: () => Promise<void>
}

export interface StartLlamaProxyOptions extends ProxyCallbacks, ProxyUsageContext {
  publicHost: string
  publicPort: number
  upstreamHost: string
  upstreamPort: number
}

interface ExtractedUsage {
  countedExactly: boolean
  promptTokens: number
  cacheTokens: number
  completionTokens: number
  totalTokens: number
  timings?: UsageTimingSnapshot
}

const TRACKED_PATHS = new Set([
  '/completion',
  '/completions',
  '/responses',
  '/chat/completions',
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/responses',
  '/v1/models'
])

const EXACT_USAGE_PATHS = new Set([
  '/completion',
  '/completions',
  '/responses',
  '/chat/completions',
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/responses'
])

const MAX_NON_STREAM_USAGE_BYTES = 8 * 1024 * 1024
const MAX_NON_STREAM_USAGE_TAIL_BYTES = 512 * 1024
const MAX_SSE_EVENT_CHARACTERS = 256 * 1024
const SSE_BOUNDARY_LOOKBEHIND_CHARACTERS = 3
const SSE_EVENT_BOUNDARY_PATTERN = /\r?\n\r?\n/

function shouldTrackRequest(pathname: string): boolean {
  return TRACKED_PATHS.has(pathname)
}

function isExactUsagePath(method: string, pathname: string): boolean {
  return method === 'POST' && EXACT_USAGE_PATHS.has(pathname)
}

function normalizeTimings(timings: unknown): UsageTimingSnapshot | undefined {
  if (!timings || typeof timings !== 'object') return undefined

  const value = timings as Record<string, unknown>
  const normalized: UsageTimingSnapshot = {}
  if (typeof value.cache_n === 'number') normalized.cacheN = value.cache_n
  if (typeof value.prompt_n === 'number') normalized.promptN = value.prompt_n
  if (typeof value.prompt_ms === 'number') normalized.promptMs = value.prompt_ms
  if (typeof value.prompt_per_second === 'number') normalized.promptPerSecond = value.prompt_per_second
  if (typeof value.predicted_n === 'number') normalized.predictedN = value.predicted_n
  if (typeof value.predicted_ms === 'number') normalized.predictedMs = value.predicted_ms
  if (typeof value.predicted_per_second === 'number') normalized.predictedPerSecond = value.predicted_per_second

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

export function extractUsage(payload: unknown): ExtractedUsage {
  const record = asRecord(payload)
  if (!record) {
    return {
      countedExactly: false,
      promptTokens: 0,
      cacheTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  }

  const sources = [record]
  const nestedResponse = asRecord(record.response)
  if (nestedResponse) {
    sources.push(nestedResponse)
  }

  const timingsBySource = sources.map((source) => normalizeTimings(source.timings))
  const fallbackTimings = timingsBySource.find((timings) => Boolean(timings))

  for (const [index, source] of sources.entries()) {
    const usage = asRecord(source.usage)
    if (!usage) {
      continue
    }

    const timings = timingsBySource[index] ?? fallbackTimings
    const promptTokens = typeof usage.prompt_tokens === 'number'
      ? usage.prompt_tokens
      : typeof usage.input_tokens === 'number'
        ? usage.input_tokens
        : 0
    const promptTokenDetails = asRecord(usage.prompt_tokens_details) ?? asRecord(usage.input_tokens_details)
    const usageCacheTokens = typeof promptTokenDetails?.cached_tokens === 'number'
      ? promptTokenDetails.cached_tokens
      : 0
    const timingCacheTokens = typeof timings?.cacheN === 'number'
      ? timings.cacheN
      : 0
    const cacheTokens = Math.max(usageCacheTokens, timingCacheTokens)
    const completionTokens = typeof usage.completion_tokens === 'number'
      ? usage.completion_tokens
      : typeof usage.output_tokens === 'number'
        ? usage.output_tokens
        : 0
    const totalTokens = typeof usage.total_tokens === 'number'
      ? usage.total_tokens
      : promptTokens + completionTokens

    return {
      countedExactly: true,
      promptTokens,
      cacheTokens,
      completionTokens,
      totalTokens,
      timings
    }
  }

  for (const timings of timingsBySource) {
    if (timings && typeof timings.promptN === 'number' && typeof timings.predictedN === 'number') {
      const promptTokens = timings.promptN
      const cacheTokens = typeof timings.cacheN === 'number' ? timings.cacheN : 0
      const completionTokens = timings.predictedN

      return {
        countedExactly: true,
        promptTokens,
        cacheTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        timings
      }
    }
  }

  return {
    countedExactly: false,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    timings: fallbackTimings
  }
}

function buildProxyErrorRecord(context: ProxyUsageContext, method: string, pathname: string, startedAt: string, startTimeMs: number, error: string): UsageRequestRecord {
  const finishedAt = new Date().toISOString()

  return {
    id: randomUUID(),
    launchId: context.launchId,
    templateId: context.templateId,
    templateNameSnapshot: context.templateNameSnapshot,
    modelPathSnapshot: context.modelPathSnapshot,
    method,
    path: pathname,
    statusCode: 502,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startTimeMs,
    stream: false,
    countedExactly: false,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    error
  }
}

function emptyExtractedUsage(): ExtractedUsage {
  return {
    countedExactly: false,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  }
}

function extractSseEventUsage(eventText: string): ExtractedUsage | null {
  const payload = eventText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('')

  if (!payload || payload === '[DONE]' || (!payload.includes('"usage"') && !payload.includes('"timings"'))) {
    return null
  }

  try {
    const extracted = extractUsage(JSON.parse(payload))
    return extracted.countedExactly || extracted.timings ? extracted : null
  } catch {
    return null
  }
}

class SseUsageCollector {
  private readonly decoder = new StringDecoder('utf8')
  private readonly usage = emptyExtractedUsage()
  private buffer = ''
  private droppingOversizedEvent = false

  add(chunk: Buffer): void {
    this.processText(this.decoder.write(chunk), false)
  }

  finish(): ExtractedUsage {
    this.processText(this.decoder.end(), true)
    return this.usage
  }

  private processText(text: string, flush: boolean): void {
    this.buffer += text

    while (this.buffer.length > 0) {
      const boundary = SSE_EVENT_BOUNDARY_PATTERN.exec(this.buffer)
      if (!boundary || boundary.index === undefined) {
        if (flush) {
          if (!this.droppingOversizedEvent && this.buffer.length <= MAX_SSE_EVENT_CHARACTERS) {
            this.captureUsage(this.buffer)
          }
          this.buffer = ''
          this.droppingOversizedEvent = false
        } else if (this.buffer.length > MAX_SSE_EVENT_CHARACTERS) {
          this.buffer = this.buffer.slice(-SSE_BOUNDARY_LOOKBEHIND_CHARACTERS)
          this.droppingOversizedEvent = true
        }
        return
      }

      const eventText = this.buffer.slice(0, boundary.index)
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length)
      if (!this.droppingOversizedEvent && eventText.length <= MAX_SSE_EVENT_CHARACTERS) {
        this.captureUsage(eventText)
      }
      this.droppingOversizedEvent = false
    }
  }

  private captureUsage(eventText: string): void {
    const extracted = extractSseEventUsage(eventText)
    if (!extracted) return

    this.usage.countedExactly = extracted.countedExactly
    this.usage.promptTokens = extracted.promptTokens
    this.usage.cacheTokens = extracted.cacheTokens
    this.usage.completionTokens = extracted.completionTokens
    this.usage.totalTokens = extracted.totalTokens
    this.usage.timings = extracted.timings
  }
}

function isEscapedJsonQuote(text: string, quoteIndex: number): boolean {
  let backslashCount = 0
  for (let index = quoteIndex - 1; index >= 0 && text[index] === '\\'; index -= 1) {
    backslashCount += 1
  }
  return backslashCount % 2 === 1
}

function findJsonObjectEnd(text: string, objectStart: number): number | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = objectStart; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }

  return null
}

function extractJsonObjectProperty(text: string, propertyName: string): Record<string, unknown> | null {
  const propertyToken = `"${propertyName}"`
  let propertyIndex = text.lastIndexOf(propertyToken)

  while (propertyIndex >= 0) {
    if (!isEscapedJsonQuote(text, propertyIndex)) {
      let valueStart = propertyIndex + propertyToken.length
      while (/\s/.test(text[valueStart] ?? '')) valueStart += 1
      if (text[valueStart] === ':') {
        valueStart += 1
        while (/\s/.test(text[valueStart] ?? '')) valueStart += 1
        if (text[valueStart] === '{') {
          const valueEnd = findJsonObjectEnd(text, valueStart)
          if (valueEnd !== null) {
            try {
              const value = JSON.parse(text.slice(valueStart, valueEnd))
              return asRecord(value)
            } catch {}
          }
        }
      }
    }

    propertyIndex = text.lastIndexOf(propertyToken, propertyIndex - 1)
  }

  return null
}

function extractUsageFromJsonTail(tail: Buffer): ExtractedUsage {
  const text = tail.toString('utf-8')
  const usage = extractJsonObjectProperty(text, 'usage')
  const timings = extractJsonObjectProperty(text, 'timings')
  return usage || timings ? extractUsage({ usage, timings }) : emptyExtractedUsage()
}

class ResponseUsageCollector {
  private readonly sseCollector: SseUsageCollector | null
  private chunks: Buffer[] = []
  private tail = Buffer.alloc(0)
  private capturedBytes = 0
  private captureExceeded = false

  constructor(stream: boolean) {
    this.sseCollector = stream ? new SseUsageCollector() : null
  }

  add(chunk: Buffer): void {
    if (this.sseCollector) {
      this.sseCollector.add(chunk)
      return
    }

    if (this.captureExceeded) {
      this.appendToTail(chunk)
      return
    }
    if (this.capturedBytes + chunk.length > MAX_NON_STREAM_USAGE_BYTES) {
      const captured = Buffer.concat([...this.chunks, chunk], this.capturedBytes + chunk.length)
      this.tail = Buffer.from(captured.subarray(Math.max(0, captured.length - MAX_NON_STREAM_USAGE_TAIL_BYTES)))
      this.chunks = []
      this.capturedBytes = 0
      this.captureExceeded = true
      return
    }

    this.chunks.push(chunk)
    this.capturedBytes += chunk.length
  }

  finish(): ExtractedUsage {
    if (this.sseCollector) return this.sseCollector.finish()
    if (this.captureExceeded) return extractUsageFromJsonTail(this.tail)

    const chunks = this.chunks
    const capturedBytes = this.capturedBytes
    this.chunks = []
    this.capturedBytes = 0

    try {
      return extractUsage(JSON.parse(Buffer.concat(chunks, capturedBytes).toString('utf-8') || '{}'))
    } catch {
      return emptyExtractedUsage()
    }
  }

  private appendToTail(chunk: Buffer): void {
    if (chunk.length >= MAX_NON_STREAM_USAGE_TAIL_BYTES) {
      this.tail = Buffer.from(chunk.subarray(chunk.length - MAX_NON_STREAM_USAGE_TAIL_BYTES))
      return
    }

    const retainedTailBytes = Math.min(this.tail.length, MAX_NON_STREAM_USAGE_TAIL_BYTES - chunk.length)
    const retainedTail = this.tail.subarray(this.tail.length - retainedTailBytes)
    this.tail = Buffer.concat([retainedTail, chunk], retainedTailBytes + chunk.length)
  }
}

function getRequestPathname(requestTarget: string): string {
  try {
    return new URL(requestTarget, 'http://127.0.0.1').pathname
  } catch {
    const [pathname] = requestTarget.split('?', 1)
    return pathname || '/'
  }
}

function writeProxyResponseHeaders(clientResponse: ServerResponse, upstreamResponse: IncomingMessage): void {
  const headers = { ...upstreamResponse.headers }
  clientResponse.writeHead(upstreamResponse.statusCode ?? 502, headers)
}

function createProxyServer(options: StartLlamaProxyOptions): Server {
  return http.createServer((clientRequest, clientResponse) => {
    const requestTarget = clientRequest.url || '/'
    const pathname = getRequestPathname(requestTarget)
    const method = (clientRequest.method || 'GET').toUpperCase()
    const trackRequest = shouldTrackRequest(pathname)
    const startTimeMs = Date.now()
    const startedAt = new Date(startTimeMs).toISOString()
    let finished = false
    let upstreamSettled = false
    let clientDisconnected = false
    let upstreamResponseRef: IncomingMessage | null = null
    let finalizeTrackedResponse: ((override?: Partial<UsageRequestRecord>) => void) | null = null
    let clearResponseBackpressure: (() => void) | null = null

    if (trackRequest) {
      options.onRequestStarted(pathname)
    }

    const upstreamRequest = http.request({
      hostname: options.upstreamHost,
      port: options.upstreamPort,
      path: requestTarget,
      method,
      headers: {
        ...clientRequest.headers,
        host: `${options.upstreamHost}:${options.upstreamPort}`
      }
    }, (upstreamResponse) => {
      upstreamResponseRef = upstreamResponse
      const contentType = `${upstreamResponse.headers['content-type'] || ''}`.toLowerCase()
      const stream = contentType.includes('text/event-stream')
      const shouldExtractUsage = trackRequest && isExactUsagePath(method, pathname)
      const usageCollector = shouldExtractUsage ? new ResponseUsageCollector(stream) : null
      let waitingForDrain = false

      const finalizeTrackedRequest = (override: Partial<UsageRequestRecord> = {}) => {
        if (!trackRequest || finished) {
          return
        }

        finished = true
        const extracted = usageCollector?.finish() ?? emptyExtractedUsage()

        options.onRequestFinished({
          id: randomUUID(),
          launchId: options.launchId,
          templateId: options.templateId,
          templateNameSnapshot: options.templateNameSnapshot,
          modelPathSnapshot: options.modelPathSnapshot,
          method,
          path: pathname,
          statusCode: upstreamResponse.statusCode ?? null,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startTimeMs,
          stream,
          countedExactly: extracted.countedExactly,
          promptTokens: extracted.promptTokens,
          cacheTokens: extracted.cacheTokens,
          completionTokens: extracted.completionTokens,
          totalTokens: extracted.totalTokens,
          timings: extracted.timings,
          error: (upstreamResponse.statusCode ?? 500) >= 400 ? `HTTP ${upstreamResponse.statusCode ?? 500}` : undefined,
          ...override
        })
      }
      finalizeTrackedResponse = finalizeTrackedRequest

      const resumeUpstream = () => {
        waitingForDrain = false
        if (!upstreamSettled && !clientDisconnected && !upstreamResponse.destroyed) {
          upstreamResponse.resume()
        }
      }

      const clearDrainWait = () => {
        if (!waitingForDrain) return
        waitingForDrain = false
        clientResponse.off('drain', resumeUpstream)
      }
      clearResponseBackpressure = clearDrainWait

      const endClientResponse = () => {
        if (!clientResponse.destroyed && !clientResponse.writableEnded) {
          clientResponse.end()
        }
      }

      const settleUpstreamResponse = (error?: string) => {
        if (upstreamSettled) return
        upstreamSettled = true
        clearDrainWait()
        endClientResponse()
        finalizeTrackedRequest(error ? { error } : {})
      }

      if (!clientResponse.destroyed) {
        writeProxyResponseHeaders(clientResponse, upstreamResponse)
      }

      upstreamResponse.on('data', (chunk: Buffer) => {
        if (upstreamSettled) return
        usageCollector?.add(chunk)
        if (clientResponse.destroyed || clientResponse.writableEnded) return

        if (!clientResponse.write(chunk) && !waitingForDrain) {
          waitingForDrain = true
          upstreamResponse.pause()
          clientResponse.once('drain', resumeUpstream)
        }
      })

      upstreamResponse.on('end', () => {
        settleUpstreamResponse()
      })

      upstreamResponse.on('aborted', () => {
        settleUpstreamResponse('Upstream response terminated unexpectedly.')
      })

      upstreamResponse.on('error', (error) => {
        settleUpstreamResponse(error instanceof Error ? error.message : String(error))
      })

      upstreamResponse.on('close', () => {
        settleUpstreamResponse('Upstream response closed before completion.')
      })
    })

    upstreamRequest.on('error', (error) => {
      if (upstreamSettled) return
      upstreamSettled = true
      clearResponseBackpressure?.()
      const message = error instanceof Error ? error.message : String(error)
      const errorBody = JSON.stringify({ error: { message: `Upstream request failed: ${message}` } })

      if (!clientResponse.destroyed && !clientResponse.headersSent) {
        clientResponse.writeHead(502, { 'Content-Type': 'application/json' })
      }
      if (!clientResponse.destroyed && !clientResponse.writableEnded) {
        clientResponse.end(clientResponse.headersSent && upstreamResponseRef ? undefined : errorBody)
      }

      if (!trackRequest || finished) {
        return
      }

      if (finalizeTrackedResponse) {
        finalizeTrackedResponse({ error: message })
      } else {
        finished = true
        options.onRequestFinished(buildProxyErrorRecord(options, method, pathname, startedAt, startTimeMs, message))
      }
      upstreamResponseRef?.destroy()
    })

    const handleClientDisconnect = () => {
      if (clientDisconnected || upstreamSettled || clientResponse.writableFinished) return

      clientDisconnected = true
      upstreamSettled = true
      clearResponseBackpressure?.()
      const message = 'Client disconnected before the response completed.'

      if (trackRequest && !finished) {
        if (finalizeTrackedResponse) {
          finalizeTrackedResponse({ error: message })
        } else {
          finished = true
          options.onRequestFinished(buildProxyErrorRecord(options, method, pathname, startedAt, startTimeMs, message))
        }
      }

      upstreamResponseRef?.destroy()
      upstreamRequest.destroy()
    }

    clientRequest.on('aborted', handleClientDisconnect)
    clientResponse.on('error', handleClientDisconnect)
    clientResponse.on('close', handleClientDisconnect)

    clientRequest.pipe(upstreamRequest)
  })
}

export function startLlamaProxy(options: StartLlamaProxyOptions): Promise<LlamaProxyHandle> {
  const server = createProxyServer(options)
  const sockets = new Set<import('net').Socket>()

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })

  return new Promise((resolve, reject) => {
    let closed = false

    server.once('error', reject)
    server.listen(options.publicPort, options.publicHost, () => {
      server.off('error', reject)
      resolve({
        close: () => new Promise<void>((closeResolve) => {
          if (closed) {
            closeResolve()
            return
          }

          closed = true
          for (const socket of sockets) {
            socket.destroy()
          }
          server.close(() => closeResolve())
        })
      })
    })
  })
}
