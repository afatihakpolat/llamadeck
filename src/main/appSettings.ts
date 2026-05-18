import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AppWindowBehaviorSettings } from '../shared/types'
import { USER_DATA_ROOT } from './userData'

const APP_WINDOW_SETTINGS_FILE = join(USER_DATA_ROOT, 'app-window-settings.json')

const DEFAULT_APP_WINDOW_BEHAVIOR_SETTINGS: AppWindowBehaviorSettings = {
  minimizeToTray: false
}

function ensureSettingsDirectory(): void {
  const settingsDir = dirname(APP_WINDOW_SETTINGS_FILE)
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

  ensureSettingsDirectory()
  writeFileSync(APP_WINDOW_SETTINGS_FILE, JSON.stringify(mergedSettings, null, 2), 'utf-8')

  return mergedSettings
}