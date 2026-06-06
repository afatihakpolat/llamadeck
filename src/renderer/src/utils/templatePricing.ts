import type { Template, UsageCostSettings } from '../../../shared/types'

export type { TemplatePricing } from '../../../shared/types'

export interface ResolvedPricing {
  currency: string
  inputCostPerMillion: number
  cacheCostPerMillion: number
  outputCostPerMillion: number
}

const FALLBACK_PRICING: Omit<ResolvedPricing, 'currency'> = {
  inputCostPerMillion: 0,
  cacheCostPerMillion: 0,
  outputCostPerMillion: 0
}

function hasValidPricing(
  pricing: Template['pricing']
): pricing is NonNullable<Template['pricing']> {
  if (!pricing) return false
  const { inputCostPerMillion, cacheCostPerMillion, outputCostPerMillion } = pricing
  return (
    Number.isFinite(inputCostPerMillion) && inputCostPerMillion >= 0 &&
    Number.isFinite(cacheCostPerMillion) && cacheCostPerMillion >= 0 &&
    Number.isFinite(outputCostPerMillion) && outputCostPerMillion >= 0
  )
}

export function resolveTemplatePricing(
  template: Pick<Template, 'pricing'> | null | undefined,
  appSettings: UsageCostSettings
): ResolvedPricing {
  if (template && hasValidPricing(template.pricing)) {
    return {
      currency: appSettings.currency,
      inputCostPerMillion: template.pricing.inputCostPerMillion,
      cacheCostPerMillion: template.pricing.cacheCostPerMillion,
      outputCostPerMillion: template.pricing.outputCostPerMillion
    }
  }
  return {
    currency: appSettings.currency,
    inputCostPerMillion: appSettings.inputCostPerMillion,
    cacheCostPerMillion: appSettings.cacheCostPerMillion,
    outputCostPerMillion: appSettings.outputCostPerMillion
  }
}

export const EMPTY_PRICING: ResolvedPricing = {
  currency: 'USD',
  ...FALLBACK_PRICING
}
