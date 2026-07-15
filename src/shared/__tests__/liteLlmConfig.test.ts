import { describe, expect, it } from 'vitest'
import { validateLiteLlmConfig } from '../liteLlmConfig'

describe('validateLiteLlmConfig', () => {
  it('accepts a LiteLLM YAML mapping', () => {
    const result = validateLiteLlmConfig(`model_list:
  - model_name: local-model
    litellm_params:
      model: openai/local-model
`)

    expect(result.valid).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  it('reports malformed YAML with a source location', () => {
    const result = validateLiteLlmConfig('model_list:\n  - model_name: [broken\n')

    expect(result.valid).toBe(false)
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error' })
    expect(result.diagnostics[0].line).toBeGreaterThan(0)
    expect(result.diagnostics[0].column).toBeGreaterThan(0)
  })

  it('rejects duplicate keys', () => {
    const result = validateLiteLlmConfig('model_list: []\nmodel_list: []\n')

    expect(result.valid).toBe(false)
    expect(result.diagnostics[0].message).toMatch(/unique/i)
  })

  it('rejects an empty document and a scalar root', () => {
    expect(validateLiteLlmConfig('').diagnostics[0].message).toMatch(/empty/i)
    expect(validateLiteLlmConfig('just-a-string').diagnostics[0].message).toMatch(/top level/i)
  })
})
