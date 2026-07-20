import { app } from 'electron'
import { join } from 'path'
import {
  findLegacyUserDataDir,
  migrateLegacyUserData
} from './userDataMigration'

const CURRENT_USER_DATA_ROOT = app.getPath('userData')
const LEGACY_USER_DATA_CANDIDATES = app.isPackaged
  ? [join(app.getPath('appData'), 'hexllama'), join(app.getPath('appData'), 'Hexllama')]
  : []

let resolvedUserDataRoot = CURRENT_USER_DATA_ROOT

if (app.isPackaged) {
  const legacyDir = findLegacyUserDataDir(CURRENT_USER_DATA_ROOT, LEGACY_USER_DATA_CANDIDATES)

  try {
    const result = migrateLegacyUserData(
      CURRENT_USER_DATA_ROOT,
      LEGACY_USER_DATA_CANDIDATES
    )

    if (result.status === 'migrated') {
      console.info(
        `[profile] migrated user data to ${CURRENT_USER_DATA_ROOT}` +
        (result.backupDir ? `; previous LlamaDeck profile preserved at ${result.backupDir}` : '')
      )
    } else if (result.status === 'in-use') {
      resolvedUserDataRoot = result.legacyDir
    }
  } catch (error) {
    console.error('[profile] user-data migration failed; keeping the existing profile for this launch:', error)
    if (legacyDir) resolvedUserDataRoot = legacyDir
  }
}

export const USER_DATA_ROOT = resolvedUserDataRoot

if (USER_DATA_ROOT !== CURRENT_USER_DATA_ROOT) {
  app.setPath('userData', USER_DATA_ROOT)
}
