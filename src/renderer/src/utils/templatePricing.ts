import type { Template, UsageCostSettings } from '../../../shared/types'

// Strict-group rule: a template either owns all three valid rates or falls back
// entirely to the app-wide rates — there is no per-rate mixing. An explicit
// { 0, 0, 0 } block is honored as a real override (a user hard-zeroing a template).
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
): UsageCostSettings {
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
