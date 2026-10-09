import { z } from 'zod'
import type { LiteLlmManagerSettings } from './types'

const MAX_HOSTNAME_LENGTH = 253
const HOSTNAME_LABEL_PATTERN = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i
const IPV4_HOST_SCHEMA = z.ipv4()
const IPV6_HOST_SCHEMA = z.ipv6()

export function normalizeLiteLlmHost(value: string): string {
  let host = value.trim()
  if (!host) {
    throw new Error('LiteLLM host is required')
  }

  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
    if (!IPV6_HOST_SCHEMA.safeParse(host).success) {
      throw new Error('LiteLLM host must be a valid IP address or hostname, without a URL, port, or path.')
    }
  }

  if (host.toLowerCase() === 'localhost') return '127.0.0.1'
  if (IPV4_HOST_SCHEMA.safeParse(host).success) return host
  if (IPV6_HOST_SCHEMA.safeParse(host).success) {
    return new URL(`http://[${host}]`).hostname.slice(1, -1)
  }

  if (
    host.length <= MAX_HOSTNAME_LENGTH &&
    !/^[\d.]+$/.test(host) &&
    host.split('.').every((label) => HOSTNAME_LABEL_PATTERN.test(label))
  ) {
    try {
      const url = new URL(`http://${host}`)
      if (url.hostname === host.toLowerCase()) return url.hostname
    } catch {
      // Numeric hostnames can be interpreted as malformed IPv4 addresses by URL clients.
    }
  }

  throw new Error('LiteLLM host must be a valid IP address or hostname, without a URL, port, or path.')
}

export function buildManagedLiteLlmBaseUrl(settings: Pick<LiteLlmManagerSettings, 'host' | 'port'>): string {
  const bindHost = normalizeLiteLlmHost(settings.host)
  const connectHost = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost === '::' ? '::1' : bindHost
  const urlHost = connectHost.includes(':') ? `[${connectHost}]` : connectHost
  return `http://${urlHost}:${settings.port}`
}
