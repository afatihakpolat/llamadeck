import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Template, UsageCostSettings } from '../../../shared/types'
import { resolveTemplatePricing } from '../utils/templatePricing'

const DEFAULT_USAGE_COST_SETTINGS: UsageCostSettings = {
  currency: 'USD',
  inputCostPerMillion: 0,
  cacheCostPerMillion: 0,
  outputCostPerMillion: 0
}

interface UsageCostDraft {
  currency: string
  inputCostPerMillion: string
  cacheCostPerMillion: string
  outputCostPerMillion: string
}

interface TemplatePricingDraft {
  enabled: boolean
  inputCostPerMillion: string
  cacheCostPerMillion: string
  outputCostPerMillion: string
}

function createUsageCostDraft(settings: UsageCostSettings): UsageCostDraft {
  return {
    currency: settings.currency,
    inputCostPerMillion: String(settings.inputCostPerMillion),
    cacheCostPerMillion: String(settings.cacheCostPerMillion),
    outputCostPerMillion: String(settings.outputCostPerMillion)
  }
}

function createTemplatePricingDraft(template: Template): TemplatePricingDraft {
  return {
    enabled: Boolean(template.pricing),
    inputCostPerMillion: String(template.pricing?.inputCostPerMillion ?? 0),
    cacheCostPerMillion: String(template.pricing?.cacheCostPerMillion ?? 0),
    outputCostPerMillion: String(template.pricing?.outputCostPerMillion ?? 0)
  }
}

function parseNonNegativeRate(rawValue: string, label: string): number {
  const trimmed = rawValue.trim()
  if (!trimmed) return 0
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`)
  }
  return parsed
}

function parseUsageCostDraft(draft: UsageCostDraft): UsageCostSettings {
  return {
    currency: draft.currency.trim().toUpperCase() || DEFAULT_USAGE_COST_SETTINGS.currency,
    inputCostPerMillion: parseNonNegativeRate(draft.inputCostPerMillion, 'Input cost'),
    cacheCostPerMillion: parseNonNegativeRate(draft.cacheCostPerMillion, 'Cache cost'),
    outputCostPerMillion: parseNonNegativeRate(draft.outputCostPerMillion, 'Output cost')
  }
}

function parseTemplatePricingDraft(
  draft: TemplatePricingDraft
): NonNullable<Template['pricing']> {
  return {
    inputCostPerMillion: parseNonNegativeRate(draft.inputCostPerMillion, 'Input cost'),
    cacheCostPerMillion: parseNonNegativeRate(draft.cacheCostPerMillion, 'Cache cost'),
    outputCostPerMillion: parseNonNegativeRate(draft.outputCostPerMillion, 'Output cost')
  }
}

function formatCost(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.trim().toUpperCase() || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }).format(value)
  } catch {
    const fallback = currency.trim().toUpperCase() || 'USD'
    return `${fallback} ${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
  }
}

function formatRatePerMillion(value: number, currency: string): string {
  return `${formatCost(value, currency)} / 1M`
}

export function PricingTab(): JSX.Element {
  const cards = useStore((state) => state.cards)
  const updateCard = useStore((state) => state.updateCard)

  const [appSettings, setAppSettings] = useState<UsageCostSettings>(DEFAULT_USAGE_COST_SETTINGS)
  const [appDraft, setAppDraft] = useState<UsageCostDraft>(createUsageCostDraft(DEFAULT_USAGE_COST_SETTINGS))
  const [appError, setAppError] = useState<string | null>(null)
  const [savingApp, setSavingApp] = useState(false)
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, TemplatePricingDraft>>({})
  const [templateErrors, setTemplateErrors] = useState<Record<string, string | null>>({})
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await window.api.getUsageCostSettings()
        if (cancelled) return
        setAppSettings(next)
        setAppDraft(createUsageCostDraft(next))
        setAppError(null)
      } catch (loadError) {
        if (cancelled) return
        setAppError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setTemplateDrafts((current) => {
      const next: Record<string, TemplatePricingDraft> = {}
      for (const card of cards) {
        next[card.template.id] = current[card.template.id] ?? createTemplatePricingDraft(card.template)
      }
      return next
    })
  }, [cards])

  const effectiveAppSettings = useMemo(() => {
    try {
      return parseUsageCostDraft(appDraft)
    } catch {
      return appSettings
    }
  }, [appDraft, appSettings])

  async function handleSaveAppSettings() {
    try {
      setSavingApp(true)
      const parsed = parseUsageCostDraft(appDraft)
      const result = await window.api.saveUsageCostSettings(parsed)
      if (!result.success) {
        alert(`Failed to save app-wide pricing: ${result.error || 'Unknown error'}`)
        return
      }
      setAppSettings(result.settings)
      setAppDraft(createUsageCostDraft(result.settings))
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSavingApp(false)
    }
  }

  function updateTemplateDraft(templateId: string, patch: Partial<TemplatePricingDraft>) {
    setTemplateDrafts((current) => ({
      ...current,
      [templateId]: { ...current[templateId], ...patch }
    }))
  }

  async function handleSaveTemplatePricing(template: Template) {
    const draft = templateDrafts[template.id]
    if (!draft) return
    try {
      setSavingTemplateId(template.id)
      let nextTemplate: Template
      if (draft.enabled) {
        const pricing = parseTemplatePricingDraft(draft)
        nextTemplate = { ...template, pricing }
      } else {
        const { pricing: _removed, ...rest } = template
        nextTemplate = rest as Template
      }
      const result = await window.api.saveTemplate(nextTemplate as unknown as Record<string, unknown>)
      if (!result || !result.id) {
        throw new Error('Save returned no id')
      }
      updateCard(result.id, nextTemplate)
      setTemplateErrors((current) => ({ ...current, [template.id]: null }))
    } catch (saveError) {
      setTemplateErrors((current) => ({
        ...current,
        [template.id]: saveError instanceof Error ? saveError.message : String(saveError)
      }))
    } finally {
      setSavingTemplateId(null)
    }
  }

  return (
    <div className="pricing-tab">
      <section className="usage-section">
        <div className="usage-section-header usage-section-header-stack">
          <div>
            <h2>App-Wide Pricing</h2>
            <span className="usage-section-header-note">Default rates used by templates that don't override them. Currency is shared across all templates.</span>
          </div>
          <span>Default rates</span>
        </div>
        {appError && <div className="usage-stats-warning">App-wide pricing failed to load: {appError}</div>}
        <div className="usage-cost-config-grid">
          <label className="usage-control-field">
            <span>Currency</span>
            <input
              className="form-input usage-cost-input"
              value={appDraft.currency}
              onChange={(event) => setAppDraft((current) => ({ ...current, currency: event.target.value }))}
              placeholder="USD"
              maxLength={8}
              disabled={savingApp}
            />
          </label>
          <label className="usage-control-field">
            <span>Input / 1M</span>
            <input
              className="form-input usage-cost-input"
              type="number"
              min="0"
              step="0.000001"
              value={appDraft.inputCostPerMillion}
              onChange={(event) => setAppDraft((current) => ({ ...current, inputCostPerMillion: event.target.value }))}
              disabled={savingApp}
            />
          </label>
          <label className="usage-control-field">
            <span>Cache / 1M</span>
            <input
              className="form-input usage-cost-input"
              type="number"
              min="0"
              step="0.000001"
              value={appDraft.cacheCostPerMillion}
              onChange={(event) => setAppDraft((current) => ({ ...current, cacheCostPerMillion: event.target.value }))}
              disabled={savingApp}
            />
          </label>
          <label className="usage-control-field">
            <span>Output / 1M</span>
            <input
              className="form-input usage-cost-input"
              type="number"
              min="0"
              step="0.000001"
              value={appDraft.outputCostPerMillion}
              onChange={(event) => setAppDraft((current) => ({ ...current, outputCostPerMillion: event.target.value }))}
              disabled={savingApp}
            />
          </label>
        </div>
        <div className="usage-cost-config-actions">
          <button className="btn btn-primary" onClick={() => void handleSaveAppSettings()} disabled={savingApp}>
            {savingApp ? 'Saving...' : 'Save Defaults'}
          </button>
          <span className="usage-summary-meta">
            {formatRatePerMillion(effectiveAppSettings.inputCostPerMillion, effectiveAppSettings.currency)} input • {formatRatePerMillion(effectiveAppSettings.cacheCostPerMillion, effectiveAppSettings.currency)} cache • {formatRatePerMillion(effectiveAppSettings.outputCostPerMillion, effectiveAppSettings.currency)} output
          </span>
        </div>
      </section>

      <section className="usage-section">
        <div className="usage-section-header usage-section-header-stack">
          <div>
            <h2>Per-Template Pricing</h2>
            <span className="usage-section-header-note">Override rates for individual templates. Templates without overrides use the app-wide defaults above.</span>
          </div>
          <span>{cards.length} templates</span>
        </div>
        {cards.length === 0 ? (
          <div className="usage-section-empty">No templates yet. Create one from the cards view.</div>
        ) : (
          <div className="usage-request-table-wrapper">
            <table className="usage-request-table">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Override</th>
                  <th>Input / 1M</th>
                  <th>Cache / 1M</th>
                  <th>Output / 1M</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => {
                  const template = card.template
                  const draft = templateDrafts[template.id] ?? createTemplatePricingDraft(template)
                  const resolved = resolveTemplatePricing(template, appSettings)
                  const isSaving = savingTemplateId === template.id
                  const error = templateErrors[template.id]
                  return (
                    <tr key={template.id}>
                      <td>
                        <div className="usage-request-primary">{template.name}</div>
                        <div className="usage-request-secondary">Effective: {formatRatePerMillion(resolved.inputCostPerMillion, resolved.currency)} input • {formatRatePerMillion(resolved.cacheCostPerMillion, resolved.currency)} cache • {formatRatePerMillion(resolved.outputCostPerMillion, resolved.currency)} output</div>
                      </td>
                      <td>
                        <label className="usage-control-field">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) => updateTemplateDraft(template.id, { enabled: event.target.checked })}
                            disabled={isSaving}
                          />
                          <span>{draft.enabled ? 'Custom' : 'Use defaults'}</span>
                        </label>
                      </td>
                      <td>
                        <input
                          className="form-input usage-cost-input"
                          type="number"
                          min="0"
                          step="0.000001"
                          value={draft.inputCostPerMillion}
                          onChange={(event) => updateTemplateDraft(template.id, { inputCostPerMillion: event.target.value })}
                          disabled={!draft.enabled || isSaving}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input usage-cost-input"
                          type="number"
                          min="0"
                          step="0.000001"
                          value={draft.cacheCostPerMillion}
                          onChange={(event) => updateTemplateDraft(template.id, { cacheCostPerMillion: event.target.value })}
                          disabled={!draft.enabled || isSaving}
                        />
                      </td>
                      <td>
                        <input
                          className="form-input usage-cost-input"
                          type="number"
                          min="0"
                          step="0.000001"
                          value={draft.outputCostPerMillion}
                          onChange={(event) => updateTemplateDraft(template.id, { outputCostPerMillion: event.target.value })}
                          disabled={!draft.enabled || isSaving}
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-primary"
                          onClick={() => void handleSaveTemplatePricing(template)}
                          disabled={!draft.enabled || isSaving}
                        >
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                        {error && <div className="usage-stats-warning">{error}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
