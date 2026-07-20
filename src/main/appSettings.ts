import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import type { AppWindowBehaviorSettings, UsageCostSettings } from '../shared/types'
import { USER_DATA_ROOT } from './userData'

const APP_WINDOW_SETTINGS_FILE = join(USER_DATA_ROOT, 'app-window-settings.json')
const USAGE_COST_SETTINGS_FILE = join(USER_DATA_ROOT, 'usage-cost-settings.json')
const ACTIVE_BACKEND_SETTINGS_FILE = join(USER_DATA_ROOT, 'active-backend.json')
const ActiveBackendSettingsSchema = z.object({
  name: z.string().trim().min(1)
})

const DEFAULT_APP_WINDOW_BEHAVIOR_SETTINGS: AppWindowBehaviorSettings = {
  minimizeToTray: false
}

const DEFAULT_USAGE_COST_SETTINGS: UsageCostSettings = {
  currency: 'USD',
  inputCostPerMillion: 0,
  cacheCostPerMillion: 0,
  outputCostPerMillion: 0
}

function ensureSettingsDirectory(settingsFilePath: string): void {
  const settingsDir = dirname(settingsFilePath)
  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true })
  }
}

export function getAppWindowBehaviorSettings(): AppWindowBehaviorSettings {
  try {
    if (!existsSync(APP_WINDOW_SETTINGS_FILE)) {
      return { ...DEFAULT_APP_WINDOW_BEHAVIOR_SETTINGS }
    }

    const parsed = JSON.parse(readFileSync(APP_WINDOW_SETTINGS_FILE, 'utf-8')) as Record<string, unknown>

    return {
      minimizeToTray: parsed.minimizeToTray === true
    }
  } catch {
    return { ...DEFAULT_APP_WINDOW_BEHAVIOR_SETTINGS }
  }
}

export function saveAppWindowBehaviorSettings(nextSettings: Partial<AppWindowBehaviorSettings>): AppWindowBehaviorSettings {
  const currentSettings = getAppWindowBehaviorSettings()
  const mergedSettings: AppWindowBehaviorSettings = {
    ...currentSettings,
    ...nextSettings,
    minimizeToTray: nextSettings.minimizeToTray === undefined
      ? currentSettings.minimizeToTray
      : nextSettings.minimizeToTray === true
  }

  ensureSettingsDirectory(APP_WINDOW_SETTINGS_FILE)
  writeFileSync(APP_WINDOW_SETTINGS_FILE, JSON.stringify(mergedSettings, null, 2), 'utf-8')

  return mergedSettings
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function normalizeCurrency(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_USAGE_COST_SETTINGS.currency
  }

  const normalized = value.trim().toUpperCase()
  return normalized || DEFAULT_USAGE_COST_SETTINGS.currency
}

export function getUsageCostSettings(): UsageCostSettings {
  try {
    if (!existsSync(USAGE_COST_SETTINGS_FILE)) {
      return { ...DEFAULT_USAGE_COST_SETTINGS }
    }

    const parsed = JSON.parse(readFileSync(USAGE_COST_SETTINGS_FILE, 'utf-8')) as Record<string, unknown>

    return {
      currency: normalizeCurrency(parsed.currency),
      inputCostPerMillion: normalizeNonNegativeNumber(parsed.inputCostPerMillion, DEFAULT_USAGE_COST_SETTINGS.inputCostPerMillion),
      cacheCostPerMillion: normalizeNonNegativeNumber(parsed.cacheCostPerMillion, DEFAULT_USAGE_COST_SETTINGS.cacheCostPerMillion),
      outputCostPerMillion: normalizeNonNegativeNumber(parsed.outputCostPerMillion, DEFAULT_USAGE_COST_SETTINGS.outputCostPerMillion)
    }
  } catch {
    return { ...DEFAULT_USAGE_COST_SETTINGS }
  }
}

export function saveUsageCostSettings(nextSettings: Partial<UsageCostSettings>): UsageCostSettings {
  const currentSettings = getUsageCostSettings()
  const mergedSettings: UsageCostSettings = {
    currency: normalizeCurrency(nextSettings.currency ?? currentSettings.currency),
    inputCostPerMillion: normalizeNonNegativeNumber(nextSettings.inputCostPerMillion, currentSettings.inputCostPerMillion),
    cacheCostPerMillion: normalizeNonNegativeNumber(nextSettings.cacheCostPerMillion, currentSettings.cacheCostPerMillion),
    outputCostPerMillion: normalizeNonNegativeNumber(nextSettings.outputCostPerMillion, currentSettings.outputCostPerMillion)
  }

  ensureSettingsDirectory(USAGE_COST_SETTINGS_FILE)
  writeFileSync(USAGE_COST_SETTINGS_FILE, JSON.stringify(mergedSettings, null, 2), 'utf-8')

  return mergedSettings
}

export function getActiveBackendName(): string | null {
  try {
    if (!existsSync(ACTIVE_BACKEND_SETTINGS_FILE)) return null
    const parsed = ActiveBackendSettingsSchema.safeParse(
      JSON.parse(readFileSync(ACTIVE_BACKEND_SETTINGS_FILE, 'utf-8'))
    )
    return parsed.success ? parsed.data.name : null
  } catch {
    return null
  }
}

export function saveActiveBackendName(name: string): string {
  const parsed = ActiveBackendSettingsSchema.parse({ name })
  ensureSettingsDirectory(ACTIVE_BACKEND_SETTINGS_FILE)
  const temporaryFile = `${ACTIVE_BACKEND_SETTINGS_FILE}.tmp`
  writeFileSync(temporaryFile, JSON.stringify(parsed, null, 2), 'utf-8')
  renameSync(temporaryFile, ACTIVE_BACKEND_SETTINGS_FILE)
  return parsed.name
}
