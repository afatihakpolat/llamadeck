import type {
  Template,
  UsageCostSettings,
  UsageSummaryRollup,
  UsageTemplateRollup
} from '../../../shared/types'
import { getTemplateModelFolder } from './templateGrouping'

// Strict-group rule: a pricing block either owns all three valid rates or is
// ignored entirely — there is no per-rate mixing. An explicit { 0, 0, 0 } block
// is honored as a real override (a user hard-zeroing a model/template).
interface RateBlock {
  inputCostPerMillion: number
  cacheCostPerMillion: number
  outputCostPerMillion: number
}

function hasValidRates(rates?: RateBlock | null): rates is RateBlock {
  if (!rates) return false
  const { inputCostPerMillion, cacheCostPerMillion, outputCostPerMillion } = rates
  return (
    Number.isFinite(inputCostPerMillion) && inputCostPerMillion >= 0 &&
    Number.isFinite(cacheCostPerMillion) && cacheCostPerMillion >= 0 &&
    Number.isFinite(outputCostPerMillion) && outputCostPerMillion >= 0
  )
}

// The model block is the user-defined override from the Pricing tab. Matching
// is case-insensitive on the folder name; the first valid entry wins (the UI
// never produces duplicates, so this is a defensive tie-break for hand-edited
// settings). Invalid entries are skipped, not fatal.
function findModelPricing(modelPath: string | undefined, appSettings: UsageCostSettings): RateBlock | null {
  const folderName = getTemplateModelFolder(modelPath)
  if (!folderName) return null
  const target = folderName.toLowerCase()
  const entries = Array.isArray(appSettings.modelPricing) ? appSettings.modelPricing : []
  for (const entry of entries) {
    if (!entry || typeof entry.model !== 'string') continue
    if (entry.model.trim().toLowerCase() !== target) continue
    if (hasValidRates(entry)) return entry
  }
  return null
}

// Resolution cascade, most specific first:
//   1. model-level override (defined per model folder in the Pricing tab)
//   2. legacy per-template pricing (template.pricing — editable only via the
//      CLI/editing the template file; honored so existing setups don't change
//      meaning when a model has no defined pricing)
//   3. app-wide defaults
// Currency is always the app-wide currency; per-pricing currencies are not supported.
export function resolveTemplatePricing(
  template: Pick<Template, 'pricing' | 'modelPath'> | null | undefined,
  appSettings: UsageCostSettings
): UsageCostSettings {
  if (template) {
    const modelRates = findModelPricing(template.modelPath, appSettings)
    if (modelRates) {
      return {
        currency: appSettings.currency,
        inputCostPerMillion: modelRates.inputCostPerMillion,
        cacheCostPerMillion: modelRates.cacheCostPerMillion,
        outputCostPerMillion: modelRates.outputCostPerMillion,
        modelPricing: appSettings.modelPricing
      }
    }
    if (hasValidRates(template.pricing)) {
      return {
        currency: appSettings.currency,
        inputCostPerMillion: template.pricing.inputCostPerMillion,
        cacheCostPerMillion: template.pricing.cacheCostPerMillion,
        outputCostPerMillion: template.pricing.outputCostPerMillion,
        modelPricing: appSettings.modelPricing
      }
    }
  }
  return {
    currency: appSettings.currency,
    inputCostPerMillion: appSettings.inputCostPerMillion,
    cacheCostPerMillion: appSettings.cacheCostPerMillion,
    outputCostPerMillion: appSettings.outputCostPerMillion,
    modelPricing: appSettings.modelPricing
  }
}

// Cost math for the Usage Stats screen. Rollup `promptTokens` already exclude
// cached prompt tokens (see normalizeUsageRecord), so "uncached input" is the
// prompt total clamped at zero.
function getUncachedRollupInputTokens(record: Pick<UsageSummaryRollup, 'promptTokens'>): number {
  return Math.max(record.promptTokens, 0)
}

export interface UsageCostBreakdown {
  inputCost: number
  cacheCost: number
  outputCost: number
  totalCost: number
}

export const ZERO_COST_BREAKDOWN: UsageCostBreakdown = {
  inputCost: 0,
  cacheCost: 0,
  outputCost: 0,
  totalCost: 0
}

export function getUsageCostBreakdown(
  record: Pick<UsageSummaryRollup, 'promptTokens' | 'cacheTokens' | 'completionTokens'>,
  settings: UsageCostSettings
): UsageCostBreakdown {
  const inputCost = (getUncachedRollupInputTokens(record) / 1_000_000) * settings.inputCostPerMillion
  const cacheCost = (record.cacheTokens / 1_000_000) * settings.cacheCostPerMillion
  const outputCost = (record.completionTokens / 1_000_000) * settings.outputCostPerMillion

  return {
    inputCost,
    cacheCost,
    outputCost,
    totalCost: inputCost + cacheCost + outputCost
  }
}

// Aggregate for the Cost tab's "Estimated Total Cost / Input / Cache / Output"
// cards. The snapshot `summary` rollup is exactly the sum of the
// `templateRollups` (the main process merges the same per-session window
// summaries into both), so pricing each template rollup with its own resolved
// rates (model -> template -> app-wide cascade) and summing yields the same
// totals the per-row figures show. Pricing the combined summary at app-wide
// rates would ignore per-model and per-template pricing.
export function getAggregateCostBreakdown(
  templateRollups: ReadonlyArray<
    Pick<UsageTemplateRollup, 'templateId' | 'modelPath' | 'promptTokens' | 'cacheTokens' | 'completionTokens'>
  >,
  fallbackSummary: Pick<UsageSummaryRollup, 'promptTokens' | 'cacheTokens' | 'completionTokens'> | null | undefined,
  pricingForTemplate: (templateId: string, modelPath?: string) => UsageCostSettings
): UsageCostBreakdown {
  if (templateRollups.length === 0) {
    // No template rollups means there is no model/template identity to price;
    // price the raw summary at the app-wide rates (the resolver's last resort).
    if (!fallbackSummary) return ZERO_COST_BREAKDOWN
    return getUsageCostBreakdown(fallbackSummary, pricingForTemplate('', undefined))
  }

  return templateRollups.reduce((total, rollup) => {
    const breakdown = getUsageCostBreakdown(rollup, pricingForTemplate(rollup.templateId, rollup.modelPath))
    return {
      inputCost: total.inputCost + breakdown.inputCost,
      cacheCost: total.cacheCost + breakdown.cacheCost,
      outputCost: total.outputCost + breakdown.outputCost,
      totalCost: total.totalCost + breakdown.totalCost
    }
  }, ZERO_COST_BREAKDOWN)
}

