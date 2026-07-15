import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { UpdatePreferencesSchema, type UpdatePreferences } from '../shared/update'

export const UPDATE_SETTINGS_FILENAME = 'update-settings.json'

export function defaultUpdatePreferences(): UpdatePreferences {
  return {
    checkOnLaunch: true,
    autoDownload: false
  }
}

export function loadUpdateSettings(filePath: string): UpdatePreferences {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return defaultUpdatePreferences()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultUpdatePreferences()
  }

  const result = UpdatePreferencesSchema.safeParse(parsed)
  if (!result.success) {
    return defaultUpdatePreferences()
  }
  return result.data
}

export function saveUpdateSettings(filePath: string, prefs: UpdatePreferences): UpdatePreferences {
  const validated = UpdatePreferencesSchema.parse(prefs)
  mkdirSync(dirname(filePath), { recursive: true })

  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(validated, null, 2), 'utf8')
  renameSync(tmp, filePath)
  return validated
}

export function resolveUpdateSettingsPath(userDataDir: string): string {
  const trimmed = userDataDir.replace(/[\\/]+$/, '')
  return join(trimmed, UPDATE_SETTINGS_FILENAME)
}