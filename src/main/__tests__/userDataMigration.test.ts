import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findLegacyUserDataDir,
  migrateLegacyUserData
} from '../userDataMigration'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createWorkDir(): string {
  const workDir = mkdtempSync(join(tmpdir(), 'llamadeck-profile-migration-'))
  tempDirs.push(workDir)
  return workDir
}

describe('userDataMigration', () => {
  it('ignores legacy directories without user-data markers', () => {
    const workDir = createWorkDir()
    const currentDir = join(workDir, 'llamadeck')
    const legacyDir = join(workDir, 'hexllama')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'cli-endpoint.json'), '{}', 'utf-8')

    expect(findLegacyUserDataDir(currentDir, [legacyDir])).toBeNull()
    expect(migrateLegacyUserData(currentDir, [legacyDir])).toEqual({ status: 'not-needed' })
  })

  it('moves the canonical legacy profile and removes transient files', () => {
    const workDir = createWorkDir()
    const currentDir = join(workDir, 'llamadeck')
    const legacyDir = join(workDir, 'hexllama')
    mkdirSync(join(legacyDir, 'templates'), { recursive: true })
    writeFileSync(join(legacyDir, 'templates', 'agent.json'), '{"name":"Agent"}', 'utf-8')
    writeFileSync(
      join(legacyDir, 'cli-endpoint.json'),
      JSON.stringify({ pid: 1234 }),
      'utf-8'
    )
    writeFileSync(join(legacyDir, 'lockfile'), '', 'utf-8')

    const result = migrateLegacyUserData(currentDir, [legacyDir], {
      isProcessAlive: () => false
    })

    expect(result).toEqual({ status: 'migrated', legacyDir })
    expect(existsSync(legacyDir)).toBe(false)
    expect(readFileSync(join(currentDir, 'templates', 'agent.json'), 'utf-8')).toBe('{"name":"Agent"}')
    expect(existsSync(join(currentDir, 'cli-endpoint.json'))).toBe(false)
    expect(existsSync(join(currentDir, 'lockfile'))).toBe(false)
  })

  it('preserves an existing LlamaDeck profile as a timestamped backup', () => {
    const workDir = createWorkDir()
    const currentDir = join(workDir, 'llamadeck')
    const legacyDir = join(workDir, 'hexllama')
    mkdirSync(join(currentDir, 'templates'), { recursive: true })
    mkdirSync(join(legacyDir, 'templates'), { recursive: true })
    writeFileSync(join(currentDir, 'templates', 'development.json'), 'development', 'utf-8')
    writeFileSync(join(legacyDir, 'templates', 'canonical.json'), 'canonical', 'utf-8')

    const result = migrateLegacyUserData(currentDir, [legacyDir], {
      now: () => new Date('2026-07-20T18:00:00.000Z')
    })

    expect(result).toEqual({
      status: 'migrated',
      legacyDir,
      backupDir: join(workDir, 'llamadeck-profile-backup-2026-07-20T18-00-00-000Z')
    })
    if (result.status !== 'migrated' || !result.backupDir) {
      throw new Error('Expected a migration backup')
    }
    expect(readFileSync(join(currentDir, 'templates', 'canonical.json'), 'utf-8')).toBe('canonical')
    expect(readFileSync(join(result.backupDir, 'templates', 'development.json'), 'utf-8')).toBe('development')
    expect(existsSync(legacyDir)).toBe(false)
  })

  it('does not move a profile owned by a running app process', () => {
    const workDir = createWorkDir()
    const currentDir = join(workDir, 'llamadeck')
    const legacyDir = join(workDir, 'hexllama')
    mkdirSync(join(legacyDir, 'templates'), { recursive: true })
    writeFileSync(
      join(legacyDir, 'cli-endpoint.json'),
      JSON.stringify({ pid: 5678 }),
      'utf-8'
    )

    expect(migrateLegacyUserData(currentDir, [legacyDir], {
      isProcessAlive: (pid) => pid === 5678
    })).toEqual({ status: 'in-use', legacyDir })
    expect(existsSync(legacyDir)).toBe(true)
    expect(existsSync(currentDir)).toBe(false)
  })
})
