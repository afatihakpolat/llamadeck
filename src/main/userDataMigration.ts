import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve
} from 'path'

const USER_DATA_MARKERS = [
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

const TRANSIENT_PROFILE_ENTRIES = [
  'cli-endpoint.json',
  'cli-endpoint.json.tmp',
  'lockfile'
]

const RESIDUAL_PROFILE_ENTRIES = new Set([
  ...TRANSIENT_PROFILE_ENTRIES,
  'litellm-config.yaml'
])

export const PROFILE_MIGRATION_MARKER_FILE = '.llamadeck-profile-migrated'

export type UserDataMigrationResult =
  | { status: 'not-needed' }
  | { status: 'in-use'; legacyDir: string }
  | { status: 'migrated'; legacyDir: string; backupDir?: string }

export interface UserDataRepairResult {
  referencesRebased: boolean
  removedResidualDirs: string[]
}

interface UserDataMigrationOptions {
  isProcessAlive?: (pid: number) => boolean
  now?: () => Date
}

function normalizePath(path: string): string {
  return resolve(path).toLowerCase()
}

function hasMigrationMarker(dir: string): boolean {
  return existsSync(join(dir, PROFILE_MIGRATION_MARKER_FILE))
}

export function hasExistingUserData(dir: string): boolean {
  if (!existsSync(dir)) return false
  return USER_DATA_MARKERS.some((marker) => existsSync(join(dir, marker)))
}

function isPathWithin(parentDir: string, targetPath: string): boolean {
  const relativePath = relative(resolve(parentDir), resolve(targetPath))
  return relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function rebaseLegacyPath(
  storedPath: string,
  currentDir: string,
  legacyCandidates: string[]
): string | null {
  for (const legacyDir of legacyCandidates) {
    if (!isPathWithin(legacyDir, storedPath)) continue
    return join(currentDir, relative(resolve(legacyDir), resolve(storedPath)))
  }

  return null
}

function writeJsonAtomically(filePath: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryFile = `${filePath}.tmp`
  writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
  renameSync(temporaryFile, filePath)
}

function writeMigrationMarker(currentDir: string): void {
  const markerPath = join(currentDir, PROFILE_MIGRATION_MARKER_FILE)
  const temporaryPath = `${markerPath}.tmp`
  writeFileSync(temporaryPath, '1\n', 'utf-8')
  renameSync(temporaryPath, markerPath)
}

function rebaseLiteLlmConfigPath(
  currentDir: string,
  legacyCandidates: string[]
): boolean {
  const managerFile = join(currentDir, 'litellm-manager.json')
  if (!existsSync(managerFile)) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(managerFile, 'utf-8')) as unknown
  } catch {
    return false
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('configPath' in parsed) ||
    typeof parsed.configPath !== 'string'
  ) {
    return false
  }

  const rebasedPath = rebaseLegacyPath(parsed.configPath, currentDir, legacyCandidates)
  if (!rebasedPath || normalizePath(rebasedPath) === normalizePath(parsed.configPath)) {
    return false
  }

  const currentConfigDir = dirname(rebasedPath)
  if (!existsSync(rebasedPath) && existsSync(parsed.configPath)) {
    mkdirSync(currentConfigDir, { recursive: true })
    renameSync(parsed.configPath, rebasedPath)
  }

  writeJsonAtomically(managerFile, {
    ...(parsed as Record<string, unknown>),
    configPath: rebasedPath
  })
  return true
}

function isResidualProfileDir(dir: string): boolean {
  if (!existsSync(dir)) return false
  return readdirSync(dir).every((entry) => RESIDUAL_PROFILE_ENTRIES.has(entry))
}

export function repairMigratedUserData(
  currentDir: string,
  legacyCandidates: string[]
): UserDataRepairResult {
  if (!hasExistingUserData(currentDir) && !hasMigrationMarker(currentDir)) {
    return { referencesRebased: false, removedResidualDirs: [] }
  }

  const referencesRebased = rebaseLiteLlmConfigPath(currentDir, legacyCandidates)
  const removedResidualDirs: string[] = []
  const currentConfig = join(currentDir, 'litellm-config.yaml')
  const seen = new Set<string>()

  for (const legacyDir of legacyCandidates) {
    const legacyKey = normalizePath(legacyDir)
    if (legacyKey === normalizePath(currentDir) || seen.has(legacyKey)) continue
    seen.add(legacyKey)
    if (!isResidualProfileDir(legacyDir)) continue

    const legacyConfig = join(legacyDir, 'litellm-config.yaml')
    if (!existsSync(currentConfig) && existsSync(legacyConfig)) {
      mkdirSync(dirname(currentConfig), { recursive: true })
      renameSync(legacyConfig, currentConfig)
    }
    if (existsSync(currentConfig)) {
      rmSync(legacyDir, { recursive: true, force: true })
      removedResidualDirs.push(legacyDir)
    }
  }

  if (referencesRebased || removedResidualDirs.length > 0) {
    writeMigrationMarker(currentDir)
  }

  return { referencesRebased, removedResidualDirs }
}

export function findLegacyUserDataDir(
  currentDir: string,
  legacyCandidates: string[]
): string | null {
  const currentKey = normalizePath(currentDir)
  const seen = new Set<string>()

  for (const candidate of legacyCandidates) {
    const candidateKey = normalizePath(candidate)
    if (candidateKey === currentKey || seen.has(candidateKey)) continue
    seen.add(candidateKey)
    if (hasExistingUserData(candidate)) return candidate
  }

  return null
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readEndpointPid(dir: string): number | null {
  const endpointFile = join(dir, 'cli-endpoint.json')
  if (!existsSync(endpointFile)) return null

  try {
    const parsed = JSON.parse(readFileSync(endpointFile, 'utf-8')) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'pid' in parsed &&
      typeof parsed.pid === 'number' &&
      Number.isSafeInteger(parsed.pid) &&
      parsed.pid > 0
    ) {
      return parsed.pid
    }
  } catch {
    // A malformed descriptor is stale and should not block migration.
  }

  return null
}

function removeTransientProfileEntries(dir: string): void {
  for (const entry of TRANSIENT_PROFILE_ENTRIES) {
    try {
      rmSync(join(dir, entry), { force: true })
    } catch {
      // The CLI server overwrites these files, so cleanup is best-effort.
    }
  }
}

function isDirectoryEmpty(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).length === 0
}

function createBackupDir(currentDir: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-')
  const parentDir = dirname(currentDir)
  const baseName = `${basename(currentDir)}-profile-backup-${timestamp}`
  let candidate = join(parentDir, baseName)
  let suffix = 2

  while (existsSync(candidate)) {
    candidate = join(parentDir, `${baseName}-${suffix}`)
    suffix += 1
  }

  return candidate
}

export function migrateLegacyUserData(
  currentDir: string,
  legacyCandidates: string[],
  options: UserDataMigrationOptions = {}
): UserDataMigrationResult {
  if (hasMigrationMarker(currentDir)) return { status: 'not-needed' }

  const legacyDir = findLegacyUserDataDir(currentDir, legacyCandidates)
  if (!legacyDir) return { status: 'not-needed' }

  const endpointPid = readEndpointPid(legacyDir)
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive
  if (endpointPid !== null && isProcessAlive(endpointPid)) {
    return { status: 'in-use', legacyDir }
  }

  removeTransientProfileEntries(currentDir)
  removeTransientProfileEntries(legacyDir)

  let backupDir: string | undefined
  if (existsSync(currentDir)) {
    if (isDirectoryEmpty(currentDir)) {
      rmSync(currentDir, { recursive: true, force: true })
    } else {
      backupDir = createBackupDir(currentDir, (options.now ?? (() => new Date()))())
      renameSync(currentDir, backupDir)
    }
  }

  try {
    renameSync(legacyDir, currentDir)
  } catch (error) {
    if (backupDir && !existsSync(currentDir) && existsSync(backupDir)) {
      renameSync(backupDir, currentDir)
    }
    throw error
  }

  removeTransientProfileEntries(currentDir)
  rebaseLiteLlmConfigPath(currentDir, legacyCandidates)
  writeMigrationMarker(currentDir)
  return backupDir
    ? { status: 'migrated', legacyDir, backupDir }
    : { status: 'migrated', legacyDir }
}
