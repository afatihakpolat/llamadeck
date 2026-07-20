import { existsSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'

const CURRENT_USER_DATA_ROOT = app.getPath('userData')
const LEGACY_USER_DATA_CANDIDATES = app.isPackaged
  ? [join(app.getPath('appData'), 'hexllama'), join(app.getPath('appData'), 'Hexllama')]
  : []

function hasExistingUserData(dir: string): boolean {
  if (!existsSync(dir)) return false

  const migrationMarkers = [
    'folder-paths.json',
    'litellm-settings.json',
    'litellm-manager.json',
    'litellm-config.yaml',
    'update-llama-source.ps1',
    'templates',
    'models',
    'backend',
    'Local Storage',
    'Session Storage',
    'Preferences',
    'active-backend.json'
  ]

  return migrationMarkers.some((marker) => existsSync(join(dir, marker)))
}

export const USER_DATA_ROOT = LEGACY_USER_DATA_CANDIDATES.find(hasExistingUserData) ?? CURRENT_USER_DATA_ROOT

if (USER_DATA_ROOT !== CURRENT_USER_DATA_ROOT) {
  app.setPath('userData', USER_DATA_ROOT)
}
