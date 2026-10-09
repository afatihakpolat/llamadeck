import http from 'http'
import { describe, expect, it } from 'vitest'
import { buildManagedLiteLlmBaseUrl, normalizeLiteLlmHost } from '../../shared/liteLlmEndpoint'

describe('LiteLLM interface connectivity', () => {
  it.each(['0.0.0.0', '127.0.0.2', '::'])('can probe a listener bound to %s', async (inputHost) => {
    const host = normalizeLiteLlmHost(inputHost)
    const server = http.createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url !== '/v1/models') {
        response.writeHead(404).end()
        return
      }
      response.end(JSON.stringify({ data: [{ id: 'local-model' }] }))
    })

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, host, resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
      const endpoint = buildManagedLiteLlmBaseUrl({ host, port: address.port })
      const response = await new Promise<string>((resolve, reject) => {
        const request = http.get(`${endpoint}/v1/models`, { agent: false }, (response) => {
          let body = ''
          response.on('data', (chunk: Buffer) => { body += chunk.toString() })
          response.on('error', reject)
          response.on('end', () => resolve(body))
        })
        request.setTimeout(1000, () => request.destroy(new Error('Interface probe timed out')))
        request.on('error', reject)
      })

      expect(JSON.parse(response)).toEqual({ data: [{ id: 'local-model' }] })
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve())
        })
      }
    }
  })
})
