import { describe, expect, it } from 'vitest'
import { buildManagedLiteLlmBaseUrl, normalizeLiteLlmHost } from '../liteLlmEndpoint'

describe('LiteLLM bind hosts', () => {
  it.each([
    ['127.0.0.1', '127.0.0.1'],
    [' localhost ', '127.0.0.1'],
    ['LOCALHOST', '127.0.0.1'],
    [' 0.0.0.0 ', '0.0.0.0'],
    ['192.168.1.20', '192.168.1.20'],
    ['::', '::'],
    ['[::]', '::'],
    ['0:0:0:0:0:0:0:0', '::'],
    ['[::1]', '::1'],
    ['2001:db8::20', '2001:db8::20'],
    ['My-PC.local', 'my-pc.local']
  ])('normalizes %s to a LiteLLM --host value', (input, expected) => {
    expect(normalizeLiteLlmHost(input)).toBe(expected)
  })

  it.each([
    '', ' ', 'http://192.168.1.20', '127.0.0.1:4000', '[::1]:4000',
    '192.168.1.20/path', 'user@host', '256.1.1.1', '127.1',
    'my pc', '-host', 'host-', 'host..local', '[localhost]', '[127.0.0.1]',
    '::gg', 'host?query', 'host#fragment', 'example.123', '0x7f000001', '0x7f.0.0.1'
  ])('rejects an invalid bind host: %s', (input) => {
    expect(() => normalizeLiteLlmHost(input)).toThrow(/LiteLLM host/)
  })
})

describe('LiteLLM connection endpoints', () => {
  it.each([
    ['127.0.0.1', 'http://127.0.0.1:4000'],
    ['localhost', 'http://127.0.0.1:4000'],
    ['0.0.0.0', 'http://127.0.0.1:4000'],
    ['192.168.1.20', 'http://192.168.1.20:4000'],
    ['::', 'http://[::1]:4000'],
    ['[::]', 'http://[::1]:4000'],
    ['0:0:0:0:0:0:0:0', 'http://[::1]:4000'],
    ['::1', 'http://[::1]:4000'],
    ['2001:db8::20', 'http://[2001:db8::20]:4000'],
    ['my-pc.local', 'http://my-pc.local:4000']
  ])('connects to the correct interface when bound to %s', (host, expected) => {
    expect(buildManagedLiteLlmBaseUrl({ host, port: 4000 })).toBe(expected)
  })

  it('uses the configured port for wildcard listeners', () => {
    expect(buildManagedLiteLlmBaseUrl({ host: '0.0.0.0', port: 8080 })).toBe('http://127.0.0.1:8080')
  })
})
