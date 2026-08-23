import { describe, it, expect } from 'vitest'
import type { TemplatePricing, UsageCostSettings } from '../../../shared/types'
import { resolveTemplatePricing } from '../utils/templatePricing'

function makeAppSettings(overrides: Partial<UsageCostSettings> = {}): UsageCostSettings {
  return {
    currency: 'USD',
    inputCostPerMillion: 1,
    cacheCostPerMillion: 0.1,
    outputCostPerMillion: 2,
    modelPricing: [],
    ...overrides
  }
}

function templatePricing(overrides: Partial<TemplatePricing> = {}): TemplatePricing {
  return {
    inputCostPerMillion: 5,
    cacheCostPerMillion: 0.5,
    outputCostPerMillion: 6,
    ...overrides
  }
}

describe('resolveTemplatePricing', () => {
  it('falls back to app-wide rates when there is no template', () => {
    const resolved = resolveTemplatePricing(null, makeAppSettings())
    expect(resolved).toEqual(makeAppSettings())
  })

  it('falls back to app-wide rates when the template has no pricing and no model entry', () => {
    const resolved = resolveTemplatePricing({ pricing: undefined, modelPath: 'C:/models/Mixtral/Mixtral-8x7B-Q4.K_M.gguf' }, makeAppSettings())
    expect(resolved.inputCostPerMillion).toBe(1)
    expect(resolved.cacheCostPerMillion).toBe(0.1)
    expect(resolved.outputCostPerMillion).toBe(2)
  })

  it('honors legacy per-template pricing when the model has no entry', () => {
    const settings = makeAppSettings()
    const resolved = resolveTemplatePricing({ pricing: templatePricing(), modelPath: 'C:/models/Qwen3.5/Qwen3.5-9B-Q4.gguf' }, settings)
    expect(resolved.inputCostPerMillion).toBe(5)
    expect(resolved.cacheCostPerMillion).toBe(0.5)
    expect(resolved.outputCostPerMillion).toBe(6)
  })

  it('ignores invalid legacy template pricing (negative rate) and uses app-wide', () => {
    const resolved = resolveTemplatePricing(
      { pricing: templatePricing({ inputCostPerMillion: -1 }), modelPath: undefined },
      makeAppSettings()
    )
    expect(resolved.inputCostPerMillion).toBe(1)
  })

  it('applies the model entry, matched case-insensitively on the folder name', () => {
    const settings = makeAppSettings({
      modelPricing: [{ model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 }]
    })
    const resolved = resolveTemplatePricing(
      { pricing: undefined, modelPath: 'D:\\Models\\qwen3.5-9b\\Qwen3.5-9B-Q8_0.gguf' },
      settings
    )
    expect(resolved.inputCostPerMillion).toBe(3)
    expect(resolved.cacheCostPerMillion).toBe(0.3)
    expect(resolved.outputCostPerMillion).toBe(4)
  })

  it('lets the model entry win over legacy per-template pricing', () => {
    const settings = makeAppSettings({
      modelPricing: [{ model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 }]
    })
    const resolved = resolveTemplatePricing(
      { pricing: templatePricing(), modelPath: '/home/user/models/Qwen3.5-9B/model-Q4.gguf' },
      settings
    )
    expect(resolved.inputCostPerMillion).toBe(3)
    expect(resolved.outputCostPerMillion).toBe(4)
  })

  it('ignores a model entry that names a different model', () => {
    const settings = makeAppSettings({
      modelPricing: [{ model: 'Mixtral', inputCostPerMillion: 9, cacheCostPerMillion: 9, outputCostPerMillion: 9 }]
    })
    const resolved = resolveTemplatePricing(
      { pricing: templatePricing(), modelPath: 'C:/models/Qwen3.5-9B/model.gguf' },
      settings
    )
    expect(resolved.inputCostPerMillion).toBe(5)
  })

  it('skips an invalid model entry and falls back to legacy template pricing', () => {
    const settings = makeAppSettings({
      modelPricing: [{ model: 'Qwen3.5-9B', inputCostPerMillion: -2, cacheCostPerMillion: 0, outputCostPerMillion: 0 }]
    })
    const resolved = resolveTemplatePricing(
      { pricing: templatePricing(), modelPath: 'C:/models/Qwen3.5-9B/model.gguf' },
      settings
    )
    expect(resolved.inputCostPerMillion).toBe(5)
  })

  it('uses the first entry when duplicate case-variants exist', () => {
    const settings = makeAppSettings({
      modelPricing: [
        { model: 'qwen3.5-9b', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 },
        { model: 'QWEN3.5-9B', inputCostPerMillion: 7, cacheCostPerMillion: 0.7, outputCostPerMillion: 8 }
      ]
    })
    const resolved = resolveTemplatePricing(
      { pricing: undefined, modelPath: 'C:/models/qwen3.5-9B/model.gguf' },
      settings
    )
    expect(resolved.inputCostPerMillion).toBe(3)
  })

  it('never applies a model entry when the template has no usable model folder', () => {
    const settings = makeAppSettings({
      modelPricing: [{ model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 }]
    })
    // Root-level file (no parent folder): getTemplateModelFolder returns null.
    const resolved = resolveTemplatePricing(
      { pricing: templatePricing(), modelPath: 'C:/model.gguf' },
      settings
    )
    expect(resolved.inputCostPerMillion).toBe(5)
  })

  it('always reports the app-wide currency', () => {
    const settings = makeAppSettings({
      currency: 'EUR',
      modelPricing: [{ model: 'Qwen', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 }]
    })
    const resolved = resolveTemplatePricing({ pricing: undefined, modelPath: 'C:/models/Qwen/model.gguf' }, settings)
    expect(resolved.currency).toBe('EUR')
  })
})
