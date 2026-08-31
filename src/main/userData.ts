import { app } from 'electron'
import { isAbsolute, join } from 'path'
import {
  findLegacyUserDataDir,
  migrateLegacyUserData,
  repairMigratedUserData
} from './userDataMigration'

const PACKAGED_SMOKE_USER_DATA = process.env['LLAMADECK_SMOKE_USER_DATA']?.trim()
if (PACKAGED_SMOKE_USER_DATA) {
  if (!isAbsolute(PACKAGED_SMOKE_USER_DATA)) {
    throw new Error('LLAMADECK_SMOKE_USER_DATA must be an absolute path.')
  }
  app.setPath('userData', PACKAGED_SMOKE_USER_DATA)
}

const CURRENT_USER_DATA_ROOT = app.getPath('userData')
const LEGACY_USER_DATA_CANDIDATES = app.isPackaged && !PACKAGED_SMOKE_USER_DATA
  ? [join(app.getPath('appData'), 'hexllama'), join(app.getPath('appData'), 'Hexllama')]
  : []

let resolvedUserDataRoot = CURRENT_USER_DATA_ROOT

if (app.isPackaged && !PACKAGED_SMOKE_USER_DATA) {
  const repair = repairMigratedUserData(
    CURRENT_USER_DATA_ROOT,
    LEGACY_USER_DATA_CANDIDATES
  )
  if (repair.referencesRebased || repair.removedResidualDirs.length > 0) {
    console.info(
      `[profile] repaired migrated settings in ${CURRENT_USER_DATA_ROOT}` +
      (repair.removedResidualDirs.length > 0
        ? `; removed ${repair.removedResidualDirs.length} residual profile director${repair.removedResidualDirs.length === 1 ? 'y' : 'ies'}`
        : '')
    )
  }

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
