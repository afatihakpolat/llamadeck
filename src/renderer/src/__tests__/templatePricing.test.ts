import { describe, it, expect } from 'vitest'
import type { TemplatePricing, UsageCostSettings, UsageTemplateRollup } from '../../../shared/types'
import {
  getAggregateCostBreakdown,
  getUsageCostBreakdown,
  resolveTemplatePricing,
  ZERO_COST_BREAKDOWN
} from '../utils/templatePricing'

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

type CostRollup = Pick<UsageTemplateRollup, 'templateId' | 'modelPath' | 'promptTokens' | 'cacheTokens' | 'completionTokens'>

function costRollup(overrides: Partial<CostRollup> = {}): CostRollup {
  return {
    templateId: 'tpl-1',
    modelPath: 'C:/models/Qwen3.5-9B/model-Q4.gguf',
    promptTokens: 1_000_000,
    cacheTokens: 1_000_000,
    completionTokens: 1_000_000,
    ...overrides
  }
}

describe('getUsageCostBreakdown', () => {
  it('prices uncached prompt, cache, and completion tokens separately', () => {
    const breakdown = getUsageCostBreakdown(
      { promptTokens: 2_000_000, cacheTokens: 1_000_000, completionTokens: 3_000_000 },
      makeAppSettings()
    )
    expect(breakdown.inputCost).toBeCloseTo(2) // 2M * $1
    expect(breakdown.cacheCost).toBeCloseTo(0.1) // 1M * $0.1
    expect(breakdown.outputCost).toBeCloseTo(6) // 3M * $2
    expect(breakdown.totalCost).toBeCloseTo(8.1)
  })

  it('clamps negative prompt tokens to zero', () => {
    const breakdown = getUsageCostBreakdown({ promptTokens: -5, cacheTokens: 0, completionTokens: 0 }, makeAppSettings())
    expect(breakdown.inputCost).toBe(0)
    expect(breakdown.totalCost).toBe(0)
  })
})

describe('getAggregateCostBreakdown', () => {
  // Emulates the component's resolver: live template -> captured model path
  // -> app-wide, mirroring pricingForTemplate in UsageStatsView.
  function resolverFor(templates: Record<string, { pricing?: TemplatePricing; modelPath?: string }>, settings: UsageCostSettings) {
    return (templateId: string, modelPath?: string) => {
      const template = templates[templateId]
      if (template) return resolveTemplatePricing(template, settings)
      if (modelPath) return resolveTemplatePricing({ pricing: undefined, modelPath }, settings)
      return settings
    }
  }

  it('prices each template rollup with its own model entry and sums', () => {
    const settings = makeAppSettings({
      modelPricing: [
        { model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 },
        { model: 'Mixtral', inputCostPerMillion: 10, cacheCostPerMillion: 1, outputCostPerMillion: 12 }
      ]
    })
    const aggregate = getAggregateCostBreakdown(
      [
        costRollup({ templateId: 'a', modelPath: 'C:/models/Qwen3.5-9B/qwen-Q4.gguf' }),
        costRollup({ templateId: 'b', modelPath: 'C:/models/Mixtral/mixtral-Q4.gguf' })
      ],
      { promptTokens: 2_000_000, cacheTokens: 2_000_000, completionTokens: 2_000_000 },
      resolverFor({}, settings)
    )
    // a: 3 / 0.3 / 4, b: 10 / 1 / 12
    expect(aggregate.inputCost).toBeCloseTo(13)
    expect(aggregate.cacheCost).toBeCloseTo(1.3)
    expect(aggregate.outputCost).toBeCloseTo(16)
    expect(aggregate.totalCost).toBeCloseTo(30.3)
  })

  it('does not price the combined summary at app-wide rates', () => {
    const settings = makeAppSettings({
      modelPricing: [{ model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 }]
    })
    const aggregate = getAggregateCostBreakdown(
      [costRollup({ templateId: 'a', modelPath: 'C:/models/Qwen3.5-9B/qwen-Q4.gguf' })],
      { promptTokens: 1_000_000, cacheTokens: 1_000_000, completionTokens: 1_000_000 },
      resolverFor({}, settings)
    )
    // The old behavior priced the summary at app-wide rates (1 / 0.1 / 2).
    expect(aggregate.inputCost).toBeCloseTo(3)
    expect(aggregate.cacheCost).toBeCloseTo(0.3)
    expect(aggregate.outputCost).toBeCloseTo(4)
    expect(aggregate.totalCost).toBeCloseTo(7.3)
  })

  it('honors model, legacy template, and app-wide tiers within one aggregate', () => {
    const settings = makeAppSettings({
      modelPricing: [{ model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 }]
    })
    const templates = {
      'tpl-model': { modelPath: 'C:/models/Qwen3.5-9B/qwen-Q4.gguf' },
      'tpl-legacy': { pricing: templatePricing(), modelPath: 'C:/models/Llama/llama-Q4.gguf' },
      'tpl-plain': { modelPath: undefined }
    }
    const aggregate = getAggregateCostBreakdown(
      [
        costRollup({ templateId: 'tpl-model' }),
        costRollup({ templateId: 'tpl-legacy' }),
        costRollup({ templateId: 'tpl-plain' })
      ],
      { promptTokens: 3_000_000, cacheTokens: 3_000_000, completionTokens: 3_000_000 },
      resolverFor(templates, settings)
    )
    // model tier 3 / 0.3 / 4, legacy tier 5 / 0.5 / 6, app-wide tier 1 / 0.1 / 2
    expect(aggregate.inputCost).toBeCloseTo(9)
    expect(aggregate.cacheCost).toBeCloseTo(0.9)
    expect(aggregate.outputCost).toBeCloseTo(12)
    expect(aggregate.totalCost).toBeCloseTo(21.9)
  })

  it('resolves pricing from the captured model path when the template no longer exists', () => {
    const settings = makeAppSettings({
      modelPricing: [{ model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 }]
    })
    // Template id "gone" is not in the live map, so pricing must come from the
    // rollup's own captured modelPath, not a template lookup.
    const aggregate = getAggregateCostBreakdown(
      [costRollup({ templateId: 'gone', modelPath: 'C:/models/Qwen3.5-9B/qwen-Q4.gguf' })],
      { promptTokens: 1_000_000, cacheTokens: 1_000_000, completionTokens: 1_000_000 },
      resolverFor({}, settings)
    )
    expect(aggregate.inputCost).toBeCloseTo(3)
    expect(aggregate.cacheCost).toBeCloseTo(0.3)
    expect(aggregate.outputCost).toBeCloseTo(4)
  })

  it('prices the raw summary at app-wide rates when there are no template rollups', () => {
    const settings = makeAppSettings()
    const summary = { promptTokens: 2_000_000, cacheTokens: 1_000_000, completionTokens: 3_000_000 }
    const aggregate = getAggregateCostBreakdown([], summary, resolverFor({}, settings))
    expect(aggregate).toEqual(getUsageCostBreakdown(summary, settings))
  })

  it('returns zero when there are no rollups and no summary', () => {
    const aggregate = getAggregateCostBreakdown([], null, resolverFor({}, makeAppSettings()))
    expect(aggregate).toEqual(ZERO_COST_BREAKDOWN)
  })
})
