import { describe, expect, it } from 'vitest'
import {
  LiteLlmCliLogBuffer,
  redactLiteLlmConfigText,
  redactLiteLlmSecrets
} from '../liteLlmCli'

describe('LiteLLM CLI safety helpers', () => {
  it('redacts exact secrets, bearer tokens, and labeled API keys', () => {
    const output = redactLiteLlmSecrets(
      'saved-key=top-secret\nAuthorization: Bearer abc123\napi_key: sk-upstream',
      ['top-secret']
    )

    expect(output).not.toContain('top-secret')
    expect(output).not.toContain('abc123')
    expect(output).not.toContain('sk-upstream')
    expect(output).toContain('<redacted>')
  })

  it('returns valid redacted YAML without exposing nested secret values', () => {
    const output = redactLiteLlmConfigText([
      'model_list:',
      '  - model_name: local-model',
      '    litellm_params:',
      '      api_key: sk-provider-secret',
      '      max_tokens: 2048',
      'general_settings:',
      '  master_key: proxy-secret',
      '  database_url: sqlite:///safe.db'
    ].join('\n'))

    expect(output).not.toContain('sk-provider-secret')
    expect(output).not.toContain('proxy-secret')
    expect(output).toContain('api_key: <redacted>')
    expect(output).toContain('master_key: <redacted>')
    expect(output).toContain('max_tokens: 2048')
    expect(output).toContain('sqlite:///safe.db')
  })

  it('withholds invalid YAML instead of risking secret disclosure', () => {
    const output = redactLiteLlmConfigText('api_key: secret\nmodel_list: [')

    expect(output).not.toContain('secret')
    expect(output).toContain('withheld')
  })

  it('provides bounded cursor-based redacted log reads', () => {
    const buffer = new LiteLlmCliLogBuffer(2)
    buffer.append('first secret\nsecond', ['secret'], new Date('2026-07-20T00:00:00.000Z'))
    buffer.append('third', [], new Date('2026-07-20T00:00:01.000Z'))

    expect(buffer.recentText(10)).toEqual(['second', 'third'])
    expect(buffer.list(0, 1, true)).toEqual({
      events: [{
        sequence: 2,
        timestamp: '2026-07-20T00:00:00.000Z',
        text: 'second'
      }],
      nextCursor: 2,
      hasMore: true,
      running: true
    })
    expect(buffer.list(2, 10, false)).toMatchObject({
      events: [{ sequence: 3, text: 'third' }],
      nextCursor: 3,
      hasMore: false,
      running: false
    })
  })
})
