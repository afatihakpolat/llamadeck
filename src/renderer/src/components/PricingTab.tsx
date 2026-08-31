import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { ModelPricing, UsageCostSettings } from '../../../shared/types'
import { getTemplateModelFolder } from '../utils/templateGrouping'

const DEFAULT_USAGE_COST_SETTINGS: UsageCostSettings = {
  currency: 'USD',
  inputCostPerMillion: 0,
  cacheCostPerMillion: 0,
  outputCostPerMillion: 0,
  modelPricing: []
}

// The app-wide section only edits these keys; model pricing is saved by the
// model section below. Saving a partial keeps the other section intact.
interface AppWideCostRate {
  currency: string
  inputCostPerMillion: number
  cacheCostPerMillion: number
  outputCostPerMillion: number
}

interface UsageCostDraft {
  currency: string
  inputCostPerMillion: string
  cacheCostPerMillion: string
  outputCostPerMillion: string
}

interface ModelPricingDraft {
  enabled: boolean
  inputCostPerMillion: string
  cacheCostPerMillion: string
  outputCostPerMillion: string
}

// One row in the per-model table. `model` is the folder name as first seen in
// a template path (what gets saved); `key` is the case-insensitive identity.
interface ModelPricingRow {
  key: string
  model: string
  templateNames: string[]
}

const MODEL_ROW_TEMPLATE_NAME_LIMIT = 3

function createUsageCostDraft(settings: UsageCostSettings): UsageCostDraft {
  return {
    currency: settings.currency,
    inputCostPerMillion: String(settings.inputCostPerMillion),
    cacheCostPerMillion: String(settings.cacheCostPerMillion),
    outputCostPerMillion: String(settings.outputCostPerMillion)
  }
}

function createDisabledModelDraft(): ModelPricingDraft {
  return {
    enabled: false,
    inputCostPerMillion: '0',
    cacheCostPerMillion: '0',
    outputCostPerMillion: '0'
  }
}

function createModelDraftFromEntry(entry: ModelPricing | undefined): ModelPricingDraft {
  if (!entry) return createDisabledModelDraft()
  return {
    enabled: true,
    inputCostPerMillion: String(entry.inputCostPerMillion),
    cacheCostPerMillion: String(entry.cacheCostPerMillion),
    outputCostPerMillion: String(entry.outputCostPerMillion)
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

function parseAppWideCostDraft(draft: UsageCostDraft): AppWideCostRate {
  return {
    currency: draft.currency.trim().toUpperCase() || DEFAULT_USAGE_COST_SETTINGS.currency,
    inputCostPerMillion: parseNonNegativeRate(draft.inputCostPerMillion, 'Input cost'),
    cacheCostPerMillion: parseNonNegativeRate(draft.cacheCostPerMillion, 'Cache cost'),
    outputCostPerMillion: parseNonNegativeRate(draft.outputCostPerMillion, 'Output cost')
  }
}

function parseModelRateDraft(draft: ModelPricingDraft): Omit<ModelPricing, 'model'> {
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

interface PricingTabProps {
  appSettings: UsageCostSettings
  onAppSettingsChange: (next: UsageCostSettings) => void
}

export function PricingTab({ appSettings, onAppSettingsChange }: PricingTabProps): JSX.Element {
  const cards = useStore((state) => state.cards)

  const [appDraft, setAppDraft] = useState<UsageCostDraft>(createUsageCostDraft(appSettings))
  const [savingApp, setSavingApp] = useState(false)
  const [appError, setAppError] = useState<string | null>(null)
  const [modelDrafts, setModelDrafts] = useState<Record<string, ModelPricingDraft>>({})
  const [modelErrors, setModelErrors] = useState<Record<string, string | null>>({})
  const [savingModelKey, setSavingModelKey] = useState<string | null>(null)

  // Model rows are derived from the templates' model paths. Templates without
  // a usable model folder cannot participate in model-level pricing and are
  // skipped (they stay on the app-wide defaults).
  const modelRows = useMemo<ModelPricingRow[]>(() => {
    const map = new Map<string, ModelPricingRow>()
    for (const card of cards) {
      const folderName = getTemplateModelFolder(card.template.modelPath)
      if (!folderName) continue
      const key = folderName.toLowerCase()
      const existingRow = map.get(key)
      if (existingRow) {
        existingRow.templateNames.push(card.template.name)
        continue
      }
      map.set(key, { key, model: folderName, templateNames: [card.template.name] })
    }
    return Array.from(map.values()).sort((left, right) =>
      left.model.localeCompare(right.model, undefined, { sensitivity: 'base' })
    )
  }, [cards])

  useEffect(() => {
    setAppDraft(createUsageCostDraft(appSettings))
  }, [appSettings])

  // Hydrate drafts for newly appeared model rows without clobbering in-flight
  // edits (same fill-missing-keys pattern the cards list uses elsewhere).
  useEffect(() => {
    setModelDrafts((current) => {
      const rowKeys = modelRows.map((row) => row.key)
      const currentKeys = Object.keys(current)
      const allPresent = rowKeys.length === currentKeys.length && rowKeys.every((key) => currentKeys.includes(key))
      if (allPresent) {
        return current
      }
      const saved = (appSettings.modelPricing ?? [])
      const next: Record<string, ModelPricingDraft> = {}
      for (const row of modelRows) {
        next[row.key] =
          current[row.key] ??
          createModelDraftFromEntry(saved.find((entry) => entry.model.trim().toLowerCase() === row.key))
      }
      return next
    })
  }, [modelRows])

  const effectiveAppSettings = useMemo<AppWideCostRate>(() => {
    try {
      return parseAppWideCostDraft(appDraft)
    } catch {
      return {
        currency: appSettings.currency,
        inputCostPerMillion: appSettings.inputCostPerMillion,
        cacheCostPerMillion: appSettings.cacheCostPerMillion,
        outputCostPerMillion: appSettings.outputCostPerMillion
      }
    }
  }, [appDraft, appSettings])

  async function handleSaveAppSettings() {
    try {
      setSavingApp(true)
      const parsed = parseAppWideCostDraft(appDraft)
      const result = await window.api.saveUsageCostSettings(parsed)
      if (!result.success) {
        const message = `Failed to save app-wide pricing: ${result.error || 'Unknown error'}`
        setAppError(message)
        useStore.getState().pushNotification({
          tone: 'danger',
          title: 'Pricing was not saved',
          message
        })
        return
      }
      setAppError(null)
      onAppSettingsChange(result.settings)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setAppError(message)
      useStore.getState().pushNotification({
        tone: 'danger',
        title: 'Pricing was not saved',
        message
      })
    } finally {
      setSavingApp(false)
    }
  }

  function updateModelDraft(modelKey: string, patch: Partial<ModelPricingDraft>) {
    setModelDrafts((current) => ({
      ...current,
      [modelKey]: { ...current[modelKey], ...patch }
    }))
  }

  async function handleSaveModelPricing(rowKey: string) {
    // Saving one row persists the whole model list, so every enabled row must
    // parse; the first invalid row owns the error.
    const nextModelPricing: ModelPricing[] = []
    let failedKey: string | null = null
    let failedMessage: string | null = null
    for (const row of modelRows) {
      const draft = modelDrafts[row.key]
      if (!draft || !draft.enabled) continue
      try {
        nextModelPricing.push({ model: row.model, ...parseModelRateDraft(draft) })
      } catch (saveError) {
        failedKey = row.key
        failedMessage = saveError instanceof Error ? saveError.message : String(saveError)
        break
      }
    }
    if (failedKey && failedMessage) {
      setModelErrors(Object.fromEntries(modelRows.map((row) => [row.key, row.key === failedKey ? failedMessage : null])))
      return
    }
    try {
      setSavingModelKey(rowKey)
      const result = await window.api.saveUsageCostSettings({ modelPricing: nextModelPricing })
      if (!result.success) {
        const message = `Failed to save model pricing: ${result.error || 'Unknown error'}`
        setModelErrors((current) => ({ ...current, [rowKey]: message }))
        return
      }
      setModelErrors((current) => ({ ...current, [rowKey]: null }))
      onAppSettingsChange(result.settings)
    } catch (saveError) {
      setModelErrors((current) => ({
        ...current,
        [rowKey]: saveError instanceof Error ? saveError.message : String(saveError)
      }))
    } finally {
      setSavingModelKey(null)
    }
  }

  function effectiveRatesFor(modelKey: string): AppWideCostRate {
    const draft = modelDrafts[modelKey]
    if (draft?.enabled) {
      try {
        return { ...parseModelRateDraft(draft), currency: effectiveAppSettings.currency }
      } catch {
        // Invalid in-flight input falls through to the app-wide defaults.
      }
    }
    return effectiveAppSettings
  }

  return (
    <>
      <section className="usage-section">
        <div className="usage-section-header usage-section-header-stack">
          <div>
            <h2>App-Wide Pricing</h2>
            <span className="usage-section-header-note">Fallback rates used when no model-level override applies. Currency is shared everywhere.</span>
          </div>
          <span>Default rates</span>
        </div>
        {appError && <div className="usage-stats-warning">{appError}</div>}
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
            <h2>Per-Model Pricing</h2>
            <span className="usage-section-header-note">Rates apply per model folder (the folder holding the model's GGUF files) and are shared by every template under it. Models without an override fall back to the app-wide defaults; templates with no model folder selected can only use the defaults.</span>
          </div>
          <span>{modelRows.length} models</span>
        </div>
        {modelRows.length === 0 ? (
          <div className="usage-section-empty">No models yet — set a model path on a template and its folder will appear here.</div>
        ) : (
          <div className="usage-request-table-wrapper">
            <table className="usage-request-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Override</th>
                  <th>Input / 1M</th>
                  <th>Cache / 1M</th>
                  <th>Output / 1M</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {modelRows.map((row) => {
                  const draft = modelDrafts[row.key] ?? createDisabledModelDraft()
                  const effective = effectiveRatesFor(row.key)
                  const isSaving = savingModelKey === row.key
                  const error = modelErrors[row.key]
                  const visibleNames = row.templateNames.slice(0, MODEL_ROW_TEMPLATE_NAME_LIMIT).join(', ')
                  const extraCount = row.templateNames.length - MODEL_ROW_TEMPLATE_NAME_LIMIT
                  return (
                    <tr key={row.key}>
                      <td>
                        <div className="usage-request-primary">{row.model}</div>
                        <div className="usage-request-secondary">{row.templateNames.length} template{row.templateNames.length === 1 ? '' : 's'}: {visibleNames}{extraCount > 0 ? ` (+${extraCount} more)` : ''}</div>
                        <div className="usage-request-secondary">Effective: {formatRatePerMillion(effective.inputCostPerMillion, effective.currency)} input • {formatRatePerMillion(effective.cacheCostPerMillion, effective.currency)} cache • {formatRatePerMillion(effective.outputCostPerMillion, effective.currency)} output</div>
                      </td>
                      <td>
                        <label className="usage-control-field">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) => updateModelDraft(row.key, { enabled: event.target.checked })}
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
                          onChange={(event) => updateModelDraft(row.key, { inputCostPerMillion: event.target.value })}
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
                          onChange={(event) => updateModelDraft(row.key, { cacheCostPerMillion: event.target.value })}
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
                          onChange={(event) => updateModelDraft(row.key, { outputCostPerMillion: event.target.value })}
                          disabled={!draft.enabled || isSaving}
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-primary"
                          onClick={() => void handleSaveModelPricing(row.key)}
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
    </>
  )
}
