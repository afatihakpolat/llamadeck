import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync
} from 'fs'
import { basename, dirname, join, resolve } from 'path'

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

export type UserDataMigrationResult =
  | { status: 'not-needed' }
  | { status: 'in-use'; legacyDir: string }
  | { status: 'migrated'; legacyDir: string; backupDir?: string }

interface UserDataMigrationOptions {
  isProcessAlive?: (pid: number) => boolean
  now?: () => Date
}

function normalizePath(path: string): string {
  return resolve(path).toLowerCase()
}

export function hasExistingUserData(dir: string): boolean {
  if (!existsSync(dir)) return false
  return USER_DATA_MARKERS.some((marker) => existsSync(join(dir, marker)))
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
  return backupDir
    ? { status: 'migrated', legacyDir, backupDir }
    : { status: 'migrated', legacyDir }
}
