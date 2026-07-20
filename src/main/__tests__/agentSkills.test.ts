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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentSkillsManager, inspectSkillDirectory } from '../agentSkills'

function writeSkill(directory: string, name: string, description: string, reference = ''): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nUse this skill.\n`,
    'utf-8'
  )
  if (reference) {
    mkdirSync(join(directory, 'references'), { recursive: true })
    writeFileSync(join(directory, 'references', 'notes.md'), reference, 'utf-8')
  }
}

describe('agent skills manager', () => {
  let root: string
  let homeDirectory: string
  let bundledSkillsDirectory: string
  let libraryDirectory: string
  let idSequence: number

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'llamadeck-agent-skills-'))
    homeDirectory = join(root, 'home')
    bundledSkillsDirectory = join(root, 'bundled')
    libraryDirectory = join(root, 'library')
    mkdirSync(homeDirectory, { recursive: true })
    mkdirSync(bundledSkillsDirectory, { recursive: true })
    idSequence = 0
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function createManager() {
    return createAgentSkillsManager({
      homeDirectory,
      bundledSkillsDirectory,
      libraryDirectory,
      commandExists: () => true,
      now: () => new Date('2026-07-20T12:00:00.000Z'),
      createId: () => `test-${++idSequence}`
    })
  }

  it('validates metadata and hashes all regular skill files', () => {
    const skillDirectory = join(root, 'sample-skill')
    writeSkill(skillDirectory, 'sample-skill', 'A valid sample.', 'Reference material.')

    const inspected = inspectSkillDirectory(skillDirectory)

    expect(inspected.name).toBe('sample-skill')
    expect(inspected.description).toBe('A valid sample.')
    expect(inspected.files.map((file) => file.relativePath).sort()).toEqual([
      'SKILL.md',
      join('references', 'notes.md')
    ])
    expect(inspected.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a folder whose name does not match its skill name', () => {
    const skillDirectory = join(root, 'wrong-folder')
    writeSkill(skillDirectory, 'actual-name', 'A mismatched sample.')

    expect(() => inspectSkillDirectory(skillDirectory)).toThrow(
      'must match frontmatter name "actual-name"'
    )
  })

  it('installs, detects updates, and removes a bundled skill safely', () => {
    const sourceDirectory = join(bundledSkillsDirectory, 'llamadeck-control')
    writeSkill(sourceDirectory, 'llamadeck-control', 'Control LlamaDeck.', 'Version one.')
    const manager = createManager()

    const installed = manager.installSkill('codex', 'bundled:llamadeck-control')
    const codex = installed.harnesses.find((harness) => harness.id === 'codex')
    const gemini = installed.harnesses.find((harness) => harness.id === 'gemini-cli')
    const targetDirectory = join(homeDirectory, '.agents', 'skills', 'llamadeck-control')

    expect(codex?.sourceStates['bundled:llamadeck-control']).toBe('managed')
    expect(gemini?.sourceStates['bundled:llamadeck-control']).toBe('shared')
    expect(existsSync(join(targetDirectory, '.llamadeck-managed.json'))).toBe(true)

    writeFileSync(join(sourceDirectory, 'references', 'notes.md'), 'Version two.', 'utf-8')
    expect(
      manager.getSnapshot().harnesses
        .find((harness) => harness.id === 'codex')
        ?.sourceStates['bundled:llamadeck-control']
    ).toBe('update-available')

    manager.installSkill('codex', 'bundled:llamadeck-control')
    expect(readFileSync(join(targetDirectory, 'references', 'notes.md'), 'utf-8')).toBe('Version two.')

    manager.removeSkill('codex', 'llamadeck-control')
    expect(existsSync(targetDirectory)).toBe(false)
  })

  it('does not overwrite or remove an unmanaged harness skill', () => {
    const sourceDirectory = join(bundledSkillsDirectory, 'llamadeck-control')
    const targetDirectory = join(homeDirectory, '.agents', 'skills', 'llamadeck-control')
    writeSkill(sourceDirectory, 'llamadeck-control', 'Bundled copy.')
    writeSkill(targetDirectory, 'llamadeck-control', 'Personal copy.')
    const manager = createManager()

    expect(() => manager.installSkill('codex', 'bundled:llamadeck-control')).toThrow(
      'is not managed by LlamaDeck'
    )
    expect(() => manager.removeSkill('codex', 'llamadeck-control')).toThrow(
      'is not managed by LlamaDeck'
    )
    expect(readFileSync(join(targetDirectory, 'SKILL.md'), 'utf-8')).toContain('Personal copy.')
  })

  it('requires installed copies to be removed before deleting a library source', () => {
    const importDirectory = join(root, 'custom-skill')
    writeSkill(importDirectory, 'custom-skill', 'A user skill.')
    const manager = createManager()

    const imported = manager.importSkill(importDirectory)
    expect(imported.sources.some((source) => source.id === 'library:custom-skill')).toBe(true)

    manager.installSkill('claude-code', 'library:custom-skill')
    const installedDirectory = join(homeDirectory, '.claude', 'skills', 'custom-skill')
    expect(existsSync(join(installedDirectory, 'SKILL.md'))).toBe(true)

    expect(() => manager.deleteSource('library:custom-skill')).toThrow(
      'Remove "custom-skill" from Claude Code'
    )
    expect(existsSync(join(installedDirectory, 'SKILL.md'))).toBe(true)

    manager.removeSkill('claude-code', 'custom-skill')
    const afterDelete = manager.deleteSource('library:custom-skill')
    expect(afterDelete.sources.some((source) => source.id === 'library:custom-skill')).toBe(false)
    expect(existsSync(join(installedDirectory, 'SKILL.md'))).toBe(false)
  })
})
