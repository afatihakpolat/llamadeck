import http, { type RequestListener, type Server } from 'http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractUsage, startLlamaProxy, type LlamaProxyHandle } from '../llamaProxy'

interface ProxyFixture {
  proxy: LlamaProxyHandle
  proxyPort: number
  upstream: Server
  upstreamPort: number
}

const cleanupTasks: Array<() => Promise<void>> = []

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function listenOnRandomPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not expose a TCP port.'))
        return
      }
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.()
  return new Promise((resolve) => server.close(() => resolve()))
}

async function reservePort(): Promise<number> {
  const server = http.createServer()
  const port = await listenOnRandomPort(server)
  await closeServer(server)
  return port
}

async function createProxyFixture(
  handler: RequestListener,
  callbacks: {
    onRequestFinished?: Parameters<typeof startLlamaProxy>[0]['onRequestFinished']
    onRequestStarted?: Parameters<typeof startLlamaProxy>[0]['onRequestStarted']
  } = {}
): Promise<ProxyFixture> {
  const upstream = http.createServer(handler)
  const upstreamPort = await listenOnRandomPort(upstream)
  const proxyPort = await reservePort()
  const proxy = await startLlamaProxy({
    launchId: 'launch-1',
    onRequestFinished: callbacks.onRequestFinished ?? (() => {}),
    onRequestStarted: callbacks.onRequestStarted ?? (() => {}),
    publicHost: '127.0.0.1',
    publicPort: proxyPort,
    templateId: 'template-1',
    templateNameSnapshot: 'Template 1',
    upstreamHost: '127.0.0.1',
    upstreamPort
  })

  cleanupTasks.push(async () => {
    await proxy.close()
    await closeServer(upstream)
  })

  return { proxy, proxyPort, upstream, upstreamPort }
}

function requestBody(port: number, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const request = http.request({
      agent: false,
      headers: { 'content-type': 'application/json' },
      hostname: '127.0.0.1',
      method: 'POST',
      path,
      port
    }, (response) => {
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.once('error', reject)
      response.once('end', () => resolve(Buffer.concat(chunks)))
    })
    request.once('error', reject)
    request.end('{}')
  })
}

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    await cleanupTasks.pop()?.()
  }
})

describe('extractUsage', () => {
  it('returns non-exact usage without throwing when a response has timings but no token counts', () => {
    expect(extractUsage({ timings: { prompt_ms: 12 } })).toEqual({
      countedExactly: false,
      promptTokens: 0,
      cacheTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      timings: { promptMs: 12 }
    })
  })

  it('normalizes OpenAI usage and cached prompt tokens', () => {
    expect(extractUsage({
      usage: {
        prompt_tokens: 10,
        prompt_tokens_details: { cached_tokens: 4 },
        completion_tokens: 3,
        total_tokens: 13
      }
    })).toEqual({
      countedExactly: true,
      promptTokens: 10,
      cacheTokens: 4,
      completionTokens: 3,
      totalTokens: 13,
      timings: undefined
    })
  })
})

describe('startLlamaProxy', () => {
  it('tracks a recognized endpoint with a query string while forwarding the original target', async () => {
    let upstreamTarget = ''
    const onRequestStarted = vi.fn()
    const onRequestFinished = vi.fn()
    const fixture = await createProxyFixture((request, response) => {
      upstreamTarget = request.url ?? ''
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 3,
          total_tokens: 13
        }
      }))
    }, { onRequestFinished, onRequestStarted })

    await requestBody(fixture.proxyPort, '/v1/chat/completions?stream=false')

    expect(upstreamTarget).toBe('/v1/chat/completions?stream=false')
    expect(onRequestStarted).toHaveBeenCalledWith('/v1/chat/completions')
    expect(onRequestFinished).toHaveBeenCalledWith(expect.objectContaining({
      countedExactly: true,
      path: '/v1/chat/completions',
      promptTokens: 10,
      completionTokens: 3,
      totalTokens: 13
    }))
  })

  it('preserves fragmented SSE output and extracts terminal usage', async () => {
    const onRequestFinished = vi.fn()
    const expectedBody = [
      'data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n',
      'data: {"usage":{"prompt_tokens":7,',
      '"completion_tokens":2,"total_tokens":9}}\r\n\r\n',
      'data: [DONE]\r\n\r\n'
    ]
    const fixture = await createProxyFixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const chunk of expectedBody) response.write(chunk)
      response.end()
    }, { onRequestFinished })

    const body = await requestBody(fixture.proxyPort, '/v1/chat/completions')

    expect(body.toString('utf-8')).toBe(expectedBody.join(''))
    expect(onRequestFinished).toHaveBeenCalledWith(expect.objectContaining({
      countedExactly: true,
      promptTokens: 7,
      completionTokens: 2,
      totalTokens: 9
    }))
  })

  it('extracts usage from the bounded tail of a large non-stream response', async () => {
    const onRequestFinished = vi.fn()
    const responseBody = JSON.stringify({
      choices: [{ message: { content: 'x'.repeat(8 * 1024 * 1024) } }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 30,
        total_tokens: 50
      }
    })
    const fixture = await createProxyFixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(responseBody)
    }, { onRequestFinished })

    const body = await requestBody(fixture.proxyPort, '/v1/chat/completions')

    expect(body.byteLength).toBe(Buffer.byteLength(responseBody))
    expect(onRequestFinished).toHaveBeenCalledWith(expect.objectContaining({
      countedExactly: true,
      promptTokens: 20,
      completionTokens: 30,
      totalTokens: 50
    }))
  })

  it('propagates downstream backpressure instead of draining the full upstream response', async () => {
    const totalBytes = 32 * 1024 * 1024
    const chunk = Buffer.alloc(64 * 1024, 120)
    let upstreamAcceptedBytes = 0
    let resolveUpstreamClosed: (() => void) | undefined
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveUpstreamClosed = resolve
    })
    const fixture = await createProxyFixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.once('close', () => resolveUpstreamClosed?.())

      const pump = () => {
        while (upstreamAcceptedBytes < totalBytes) {
          upstreamAcceptedBytes += chunk.length
          if (!response.write(chunk)) {
            response.once('drain', pump)
            return
          }
        }
        response.end()
      }
      pump()
    })

    const downstreamResponse = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = http.get({ agent: false, hostname: '127.0.0.1', path: '/health', port: fixture.proxyPort }, resolve)
      request.once('error', reject)
    })
    downstreamResponse.pause()
    await delay(100)
    const acceptedWhilePaused = upstreamAcceptedBytes
    downstreamResponse.destroy()
    await Promise.race([upstreamClosed, delay(1_000)])

    expect(acceptedWhilePaused).toBeLessThan(totalBytes)
  })

  it('stops the upstream response and records completion when the client disconnects', async () => {
    const totalChunks = 200
    let chunksWritten = 0
    let resolveUpstreamClosed: (() => void) | undefined
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveUpstreamClosed = resolve
    })
    const onRequestFinished = vi.fn()
    const fixture = await createProxyFixture((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const timer = setInterval(() => {
        chunksWritten += 1
        response.write(`data: {"chunk":${chunksWritten}}\n\n`)
        if (chunksWritten === totalChunks) {
          clearInterval(timer)
          response.end()
        }
      }, 2)
      response.once('close', () => {
        clearInterval(timer)
        resolveUpstreamClosed?.()
      })
    }, { onRequestFinished })

    const downstreamResponse = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = http.get({ agent: false, hostname: '127.0.0.1', path: '/v1/chat/completions', port: fixture.proxyPort }, resolve)
      request.once('error', reject)
    })
    await new Promise<void>((resolve) => downstreamResponse.once('data', () => resolve()))
    downstreamResponse.destroy()
    await Promise.race([upstreamClosed, delay(1_000)])
    await delay(20)

    expect(chunksWritten).toBeLessThan(totalChunks)
    expect(onRequestFinished).toHaveBeenCalledTimes(1)
    expect(onRequestFinished).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Client disconnected before the response completed.'
    }))
  })
})
