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
  migrateLegacyUserData,
  PROFILE_MIGRATION_MARKER_FILE,
  repairMigratedUserData
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
    expect(existsSync(join(currentDir, PROFILE_MIGRATION_MARKER_FILE))).toBe(true)
  })

  it('rebases a saved LiteLLM config path during the profile move', () => {
    const workDir = createWorkDir()
    const currentDir = join(workDir, 'llamadeck')
    const legacyDir = join(workDir, 'hexllama')
    const legacyConfig = join(legacyDir, 'litellm-config.yaml')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(legacyConfig, 'model_list:\n  - model_name: real\n', 'utf-8')
    writeFileSync(join(legacyDir, 'litellm-manager.json'), JSON.stringify({
      host: '127.0.0.1',
      port: 4000,
      configPath: legacyConfig,
      logLevel: 'info'
    }), 'utf-8')

    expect(migrateLegacyUserData(currentDir, [legacyDir])).toEqual({
      status: 'migrated',
      legacyDir
    })

    const manager = JSON.parse(
      readFileSync(join(currentDir, 'litellm-manager.json'), 'utf-8')
    ) as { configPath: string }
    expect(manager.configPath).toBe(join(currentDir, 'litellm-config.yaml'))
    expect(readFileSync(manager.configPath, 'utf-8')).toContain('model_name: real')
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

  it('repairs the residual profile state produced by version 1.5.1', () => {
    const workDir = createWorkDir()
    const currentDir = join(workDir, 'llamadeck')
    const legacyDir = join(workDir, 'hexllama')
    const currentConfig = join(currentDir, 'litellm-config.yaml')
    mkdirSync(join(currentDir, 'templates'), { recursive: true })
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(currentDir, 'templates', 'canonical.json'), 'canonical', 'utf-8')
    writeFileSync(currentConfig, 'model_list:\n  - model_name: real\n', 'utf-8')
    writeFileSync(join(legacyDir, 'litellm-config.yaml'), 'model_list: []\n', 'utf-8')
    writeFileSync(join(currentDir, 'litellm-manager.json'), JSON.stringify({
      configPath: join(legacyDir, 'litellm-config.yaml')
    }), 'utf-8')

    expect(repairMigratedUserData(currentDir, [legacyDir])).toEqual({
      referencesRebased: true,
      removedResidualDirs: [legacyDir]
    })

    const manager = JSON.parse(
      readFileSync(join(currentDir, 'litellm-manager.json'), 'utf-8')
    ) as { configPath: string }
    expect(manager.configPath).toBe(currentConfig)
    expect(readFileSync(currentConfig, 'utf-8')).toContain('model_name: real')
    expect(existsSync(legacyDir)).toBe(false)
    expect(existsSync(join(currentDir, PROFILE_MIGRATION_MARKER_FILE))).toBe(true)
  })

  it('does not replace a marked migrated profile with a later legacy directory', () => {
    const workDir = createWorkDir()
    const currentDir = join(workDir, 'llamadeck')
    const legacyDir = join(workDir, 'hexllama')
    mkdirSync(join(currentDir, 'templates'), { recursive: true })
    mkdirSync(join(legacyDir, 'templates'), { recursive: true })
    writeFileSync(join(currentDir, 'templates', 'canonical.json'), 'canonical', 'utf-8')
    writeFileSync(join(currentDir, PROFILE_MIGRATION_MARKER_FILE), '1\n', 'utf-8')
    writeFileSync(join(legacyDir, 'templates', 'unexpected.json'), 'unexpected', 'utf-8')

    expect(migrateLegacyUserData(currentDir, [legacyDir])).toEqual({ status: 'not-needed' })
    expect(readFileSync(join(currentDir, 'templates', 'canonical.json'), 'utf-8')).toBe('canonical')
    expect(existsSync(join(legacyDir, 'templates', 'unexpected.json'))).toBe(true)
  })
})
