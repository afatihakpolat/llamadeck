import { describe, expect, it } from 'vitest'
import { extractUsage } from '../llamaProxy'

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
