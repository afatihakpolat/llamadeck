import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { createHash, randomUUID } from 'crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { parse } from 'yaml'
import { z } from 'zod'
import type {
  AgentHarnessId,
  AgentHarnessSnapshot,
  AgentSkillInstallState,
  AgentSkillSource,
  AgentSkillsSnapshot,
  InstalledAgentSkill
} from '../shared/types'
import { AgentSkillNameSchema, AgentSkillSourceIdSchema } from './schemas'

const SKILL_FILE_NAME = 'SKILL.md'
const INSTALL_MARKER_FILE_NAME = '.llamadeck-managed.json'
const SOURCE_MARKER_FILE_NAME = '.llamadeck-source.json'
const MAX_SKILL_FILES = 500
const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024
const MAX_SKILL_TOTAL_BYTES = 10 * 1024 * 1024

const SkillFrontmatterSchema = z.object({
  name: AgentSkillNameSchema,
  description: z.string().trim().min(1).max(1024)
}).passthrough()

const InstallMarkerSchema = z.object({
  version: z.literal(1),
  sourceId: AgentSkillSourceIdSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  installedAt: z.string()
})

interface HarnessDefinition {
  id: AgentHarnessId
  name: string
  command: string
  skillsDirectory: string
  discoveryDirectories: string[]
  configDirectory: string
}

interface SkillFile {
  absolutePath: string
  relativePath: string
  size: number
}

interface SkillDefinition {
  name: string
  description: string
  directory: string
  contentHash: string
  files: SkillFile[]
}

export interface AgentSkillsEnvironment {
  homeDirectory: string
  libraryDirectory: string
  bundledSkillsDirectory: string
  commandExists: (command: string) => boolean
  now?: () => Date
  createId?: () => string
}

export interface AgentSkillsManager {
  getSnapshot: () => AgentSkillsSnapshot
  importSkill: (sourceDirectory: string) => AgentSkillsSnapshot
  installSkill: (harnessId: AgentHarnessId, sourceId: string) => AgentSkillsSnapshot
  removeSkill: (harnessId: AgentHarnessId, skillName: string) => AgentSkillsSnapshot
  deleteSource: (sourceId: string) => AgentSkillsSnapshot
  getFolderPath: (kind: 'library' | 'harness', harnessId?: AgentHarnessId) => string
}

function isChildPath(parentDirectory: string, candidatePath: string): boolean {
  const rel = relative(resolve(parentDirectory), resolve(candidatePath))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function assertChildPath(parentDirectory: string, candidatePath: string): void {
  if (!isChildPath(parentDirectory, candidatePath)) {
    throw new Error(`Refusing to access a path outside ${parentDirectory}.`)
  }
}

function readFrontmatter(skillFilePath: string): { name: string; description: string } {
  const text = readFileSync(skillFilePath, 'utf-8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) {
    throw new Error(`${SKILL_FILE_NAME} must begin with YAML frontmatter.`)
  }

  const parsed = SkillFrontmatterSchema.parse(parse(match[1]))
  return { name: parsed.name, description: parsed.description }
}

function collectSkillFiles(directory: string): SkillFile[] {
  const root = resolve(directory)
  const files: SkillFile[] = []
  let totalBytes = 0

  function visit(currentDirectory: string): void {
    const entries = readdirSync(currentDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (entry.name === INSTALL_MARKER_FILE_NAME || entry.name === SOURCE_MARKER_FILE_NAME) continue

      const absolutePath = join(currentDirectory, entry.name)
      assertChildPath(root, absolutePath)
      const stats = lstatSync(absolutePath)
      if (stats.isSymbolicLink()) {
        throw new Error(`Skill packages cannot contain symbolic links: ${relative(root, absolutePath)}`)
      }
      if (stats.isDirectory()) {
        visit(absolutePath)
        continue
      }
      if (!stats.isFile()) {
        throw new Error(`Skill packages can contain only regular files and folders: ${relative(root, absolutePath)}`)
      }
      if (stats.size > MAX_SKILL_FILE_BYTES) {
        throw new Error(`Skill file exceeds the 2 MB limit: ${relative(root, absolutePath)}`)
      }

      totalBytes += stats.size
      if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
        throw new Error('Skill package exceeds the 10 MB total size limit.')
      }

      files.push({
        absolutePath,
        relativePath: relative(root, absolutePath),
        size: stats.size
      })
      if (files.length > MAX_SKILL_FILES) {
        throw new Error(`Skill package exceeds the ${MAX_SKILL_FILES}-file limit.`)
      }
    }
  }

  visit(root)
  return files
}

function hashSkillFiles(files: SkillFile[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath.replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(file.absolutePath))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function inspectSkillDirectory(directory: string): SkillDefinition {
  const resolvedDirectory = resolve(directory)
  const stats = lstatSync(resolvedDirectory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Select a regular skill folder.')
  }

  const skillFilePath = join(resolvedDirectory, SKILL_FILE_NAME)
  if (!existsSync(skillFilePath)) {
    throw new Error(`The selected folder does not contain ${SKILL_FILE_NAME}.`)
  }

  const frontmatter = readFrontmatter(skillFilePath)
  if (basename(resolvedDirectory) !== frontmatter.name) {
    throw new Error(`Skill folder "${basename(resolvedDirectory)}" must match frontmatter name "${frontmatter.name}".`)
  }

  const files = collectSkillFiles(resolvedDirectory)
  return {
    ...frontmatter,
    directory: resolvedDirectory,
    contentHash: hashSkillFiles(files),
    files
  }
}

function copySkillFiles(skill: SkillDefinition, targetDirectory: string): void {
  mkdirSync(targetDirectory, { recursive: true })
  for (const file of skill.files) {
    const targetPath = join(targetDirectory, file.relativePath)
    assertChildPath(targetDirectory, targetPath)
    mkdirSync(dirname(targetPath), { recursive: true })
    copyFileSync(file.absolutePath, targetPath)
  }
}

function replaceDirectory(
  skill: SkillDefinition,
  targetDirectory: string,
  rootDirectory: string,
  createId: () => string,
  writeMarker?: (directory: string) => void
): void {
  assertChildPath(rootDirectory, targetDirectory)
  mkdirSync(rootDirectory, { recursive: true })

  const suffix = createId()
  const stagingDirectory = join(rootDirectory, `.${basename(targetDirectory)}.${suffix}.tmp`)
  const backupDirectory = join(rootDirectory, `.${basename(targetDirectory)}.${suffix}.bak`)
  assertChildPath(rootDirectory, stagingDirectory)
  assertChildPath(rootDirectory, backupDirectory)

  try {
    copySkillFiles(skill, stagingDirectory)
    writeMarker?.(stagingDirectory)

    if (existsSync(targetDirectory)) {
      renameSync(targetDirectory, backupDirectory)
    }

    try {
      renameSync(stagingDirectory, targetDirectory)
    } catch (error) {
      if (existsSync(backupDirectory) && !existsSync(targetDirectory)) {
        renameSync(backupDirectory, targetDirectory)
      }
      throw error
    }

    if (existsSync(backupDirectory)) {
      rmSync(backupDirectory, { recursive: true, force: true })
    }
  } finally {
    if (existsSync(stagingDirectory)) {
      rmSync(stagingDirectory, { recursive: true, force: true })
    }
  }
}

function readInstallMarker(skillDirectory: string): z.infer<typeof InstallMarkerSchema> | null {
  const markerPath = join(skillDirectory, INSTALL_MARKER_FILE_NAME)
  if (!existsSync(markerPath)) return null

  try {
    return InstallMarkerSchema.parse(JSON.parse(readFileSync(markerPath, 'utf-8')))
  } catch {
    return null
  }
}

function createHarnessDefinitions(homeDirectory: string): HarnessDefinition[] {
  const sharedSkillsDirectory = join(homeDirectory, '.agents', 'skills')
  const claudeSkillsDirectory = join(homeDirectory, '.claude', 'skills')
  const geminiSkillsDirectory = join(homeDirectory, '.gemini', 'skills')
  const openCodeSkillsDirectory = join(homeDirectory, '.config', 'opencode', 'skills')

  return [
    {
      id: 'codex',
      name: 'Codex',
      command: 'codex',
      configDirectory: join(homeDirectory, '.codex'),
      skillsDirectory: sharedSkillsDirectory,
      discoveryDirectories: [sharedSkillsDirectory]
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      command: 'claude',
      configDirectory: join(homeDirectory, '.claude'),
      skillsDirectory: claudeSkillsDirectory,
      discoveryDirectories: [claudeSkillsDirectory]
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      command: 'gemini',
      configDirectory: join(homeDirectory, '.gemini'),
      skillsDirectory: geminiSkillsDirectory,
      discoveryDirectories: [geminiSkillsDirectory, sharedSkillsDirectory]
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      command: 'opencode',
      configDirectory: join(homeDirectory, '.config', 'opencode'),
      skillsDirectory: openCodeSkillsDirectory,
      discoveryDirectories: [openCodeSkillsDirectory, claudeSkillsDirectory, sharedSkillsDirectory]
    }
  ]
}

function scanInstalledSkills(skillsDirectory: string): InstalledAgentSkill[] {
  if (!existsSync(skillsDirectory)) return []

  const skills: InstalledAgentSkill[] = []
  for (const entry of readdirSync(skillsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const skillDirectory = join(skillsDirectory, entry.name)
    const skillFilePath = join(skillDirectory, SKILL_FILE_NAME)
    if (!existsSync(skillFilePath)) continue

    try {
      const definition = inspectSkillDirectory(skillDirectory)
      const marker = readInstallMarker(skillDirectory)
      skills.push({
        name: definition.name,
        description: definition.description,
        path: skillDirectory,
        managed: marker !== null,
        sourceId: marker?.sourceId ?? null
      })
    } catch {
      skills.push({
        name: entry.name,
        description: 'This skill could not be validated.',
        path: skillDirectory,
        managed: false,
        sourceId: null
      })
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

function scanDiscoveredSkills(directories: string[]): InstalledAgentSkill[] {
  const skillsByName = new Map<string, InstalledAgentSkill>()
  for (const directory of directories) {
    for (const skill of scanInstalledSkills(directory)) {
      if (!skillsByName.has(skill.name)) {
        skillsByName.set(skill.name, skill)
      }
    }
  }
  return Array.from(skillsByName.values()).sort((left, right) => left.name.localeCompare(right.name))
}

function hasValidSkill(directory: string, skillName: string): boolean {
  const skillDirectory = join(directory, skillName)
  if (!existsSync(skillDirectory)) return false
  try {
    return inspectSkillDirectory(skillDirectory).name === skillName
  } catch {
    return false
  }
}

function sourceIdFor(kind: 'bundled' | 'imported', name: string): string {
  return `${kind === 'bundled' ? 'bundled' : 'library'}:${name}`
}

function scanSources(directory: string, kind: 'bundled' | 'imported'): Array<AgentSkillSource & { directory: string }> {
  if (!existsSync(directory)) return []

  const sources: Array<AgentSkillSource & { directory: string }> = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    try {
      const definition = inspectSkillDirectory(join(directory, entry.name))
      sources.push({
        id: sourceIdFor(kind, definition.name),
        name: definition.name,
        description: definition.description,
        kind,
        contentHash: definition.contentHash,
        fileCount: definition.files.length,
        directory: definition.directory
      })
    } catch {
      // Invalid library folders are ignored until the user imports a valid skill.
    }
  }

  return sources
}

export function createAgentSkillsManager(environment: AgentSkillsEnvironment): AgentSkillsManager {
  const now = environment.now ?? (() => new Date())
  const createId = environment.createId ?? randomUUID
  const harnesses = createHarnessDefinitions(resolve(environment.homeDirectory))
  const libraryDirectory = resolve(environment.libraryDirectory)
  const bundledSkillsDirectory = resolve(environment.bundledSkillsDirectory)

  function findHarness(harnessId: AgentHarnessId): HarnessDefinition {
    const harness = harnesses.find((candidate) => candidate.id === harnessId)
    if (!harness) throw new Error(`Unsupported harness: ${harnessId}`)
    return harness
  }

  function getSources(): Array<AgentSkillSource & { directory: string }> {
    const bundled = scanSources(bundledSkillsDirectory, 'bundled')
    const imported = scanSources(libraryDirectory, 'imported')
    const bundledNames = new Set(bundled.map((source) => source.name))
    return [
      ...bundled,
      ...imported.filter((source) => !bundledNames.has(source.name))
    ].sort((left, right) => left.name.localeCompare(right.name))
  }

  function getSnapshot(): AgentSkillsSnapshot {
    const sources = getSources()
    const harnessSnapshots: AgentHarnessSnapshot[] = harnesses.map((harness) => {
      const installedSkills = scanDiscoveredSkills(harness.discoveryDirectories)
      const sourceStates: Record<string, AgentSkillInstallState> = {}

      for (const source of sources) {
        const targetDirectory = join(harness.skillsDirectory, source.name)
        const sharedTargetExists = harness.discoveryDirectories
          .filter((directory) => directory !== harness.skillsDirectory)
          .some((directory) => hasValidSkill(directory, source.name))
        const marker = existsSync(targetDirectory) ? readInstallMarker(targetDirectory) : null
        if (!existsSync(targetDirectory) && sharedTargetExists) {
          sourceStates[source.id] = 'shared'
        } else if (!existsSync(targetDirectory)) {
          sourceStates[source.id] = 'not-installed'
        } else if (!marker) {
          sourceStates[source.id] = 'unmanaged'
        } else if (marker.sourceId !== source.id || marker.sourceHash !== source.contentHash) {
          sourceStates[source.id] = 'update-available'
        } else {
          sourceStates[source.id] = 'managed'
        }
      }

      return {
        id: harness.id,
        name: harness.name,
        command: harness.command,
        detected: environment.commandExists(harness.command) || existsSync(harness.configDirectory),
        skillsDirectory: harness.skillsDirectory,
        installedSkills,
        sourceStates
      }
    })

    return {
      sources: sources.map(({ directory: _directory, ...source }) => source),
      harnesses: harnessSnapshots,
      libraryDirectory
    }
  }

  function importSkill(sourceDirectory: string): AgentSkillsSnapshot {
    const skill = inspectSkillDirectory(sourceDirectory)
    if (scanSources(bundledSkillsDirectory, 'bundled').some((source) => source.name === skill.name)) {
      throw new Error(`"${skill.name}" is bundled with LlamaDeck and cannot be replaced by an imported source.`)
    }
    const targetDirectory = join(libraryDirectory, skill.name)
    replaceDirectory(skill, targetDirectory, libraryDirectory, createId, (directory) => {
      writeFileSync(join(directory, SOURCE_MARKER_FILE_NAME), JSON.stringify({
        version: 1,
        importedAt: now().toISOString()
      }, null, 2), 'utf-8')
    })
    return getSnapshot()
  }

  function installSkill(harnessId: AgentHarnessId, sourceId: string): AgentSkillsSnapshot {
    const parsedSourceId = AgentSkillSourceIdSchema.parse(sourceId)
    const harness = findHarness(harnessId)
    const source = getSources().find((candidate) => candidate.id === parsedSourceId)
    if (!source) throw new Error('Skill source not found.')

    const targetDirectory = join(harness.skillsDirectory, source.name)
    if (existsSync(targetDirectory) && !readInstallMarker(targetDirectory)) {
      throw new Error(`"${source.name}" already exists in ${harness.name} and is not managed by LlamaDeck.`)
    }

    const skill = inspectSkillDirectory(source.directory)
    replaceDirectory(skill, targetDirectory, harness.skillsDirectory, createId, (directory) => {
      writeFileSync(join(directory, INSTALL_MARKER_FILE_NAME), JSON.stringify({
        version: 1,
        sourceId: source.id,
        sourceHash: source.contentHash,
        installedAt: now().toISOString()
      }, null, 2), 'utf-8')
    })
    return getSnapshot()
  }

  function removeSkill(harnessId: AgentHarnessId, skillName: string): AgentSkillsSnapshot {
    const parsedSkillName = AgentSkillNameSchema.parse(skillName)
    const harness = findHarness(harnessId)
    const targetDirectory = join(harness.skillsDirectory, parsedSkillName)
    assertChildPath(harness.skillsDirectory, targetDirectory)

    if (!existsSync(targetDirectory)) return getSnapshot()
    if (!readInstallMarker(targetDirectory)) {
      throw new Error(`"${parsedSkillName}" is not managed by LlamaDeck and was not removed.`)
    }

    rmSync(targetDirectory, { recursive: true, force: true })
    return getSnapshot()
  }

  function deleteSource(sourceId: string): AgentSkillsSnapshot {
    const parsedSourceId = AgentSkillSourceIdSchema.parse(sourceId)
    if (!parsedSourceId.startsWith('library:')) {
      throw new Error('Bundled skills cannot be removed from the library.')
    }

    const skillName = AgentSkillNameSchema.parse(parsedSourceId.slice('library:'.length))
    const installedIn = harnesses
      .filter((harness, index, candidates) => (
        candidates.findIndex((candidate) => candidate.skillsDirectory === harness.skillsDirectory) === index
      ))
      .filter((harness) => {
        const marker = readInstallMarker(join(harness.skillsDirectory, skillName))
        return marker?.sourceId === parsedSourceId
      })
      .map((harness) => harness.name)
    if (installedIn.length > 0) {
      throw new Error(`Remove "${skillName}" from ${installedIn.join(', ')} before deleting its library source.`)
    }

    const targetDirectory = join(libraryDirectory, skillName)
    assertChildPath(libraryDirectory, targetDirectory)
    if (existsSync(targetDirectory)) {
      rmSync(targetDirectory, { recursive: true, force: true })
    }
    return getSnapshot()
  }

  function getFolderPath(kind: 'library' | 'harness', harnessId?: AgentHarnessId): string {
    if (kind === 'library') {
      mkdirSync(libraryDirectory, { recursive: true })
      return libraryDirectory
    }

    if (!harnessId) throw new Error('A harness is required.')
    const harness = findHarness(harnessId)
    mkdirSync(harness.skillsDirectory, { recursive: true })
    return harness.skillsDirectory
  }

  return {
    getSnapshot,
    importSkill,
    installSkill,
    removeSkill,
    deleteSource,
    getFolderPath
  }
}
