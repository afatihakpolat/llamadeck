import { existsSync, writeFileSync, renameSync } from 'fs'
import { spawn } from 'child_process'
import { isAbsolute, join } from 'path'
import { parseHelpOutput } from './commandsSchemaParser'
import { StructuralSchema } from './schemas'
import type { StructuralSchemaType } from './schemas'
import type { BackendVersion } from './../shared/types'

export interface SpawnResult {
  code: number
  stdout: string
}

export type SpawnFn = (exe: string, args: string[], opts: { timeoutMs: number }) => Promise<SpawnResult>

export interface GenerateResult {
  ok: boolean
  error?: string
  path?: string
  commandCount?: number
}

interface GenerateOptions {
  backend: BackendVersion
  spawn?: SpawnFn
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

async function defaultSpawn(exe: string, args: string[], opts: { timeoutMs: number }): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve) => {
    const child = spawn(exe, args, { windowsHide: true })
    let stdout = ''
    const timer = setTimeout(() => child.kill(), opts.timeoutMs)
    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: '' })
    })
  })
}

export async function generateCommandsSchema(opts: GenerateOptions): Promise<GenerateResult> {
  const { backend, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const spawn = opts.spawn ?? defaultSpawn
  // Resolve backend.exe to an absolute path. The IPC contract returns a
  // relative exe (e.g. "bin/llama-server.exe"); we join with backend.path.
  // If exe is already absolute, use it as-is.
  const rawExe = backend.exe ?? join(backend.path, 'bin', 'llama-server.exe')
  const exe = isAbsolute(rawExe) ? rawExe : join(backend.path, rawExe)
  if (!existsSync(exe)) {
    return { ok: false, error: `llama-server.exe not found at ${exe}` }
  }
  const { code, stdout } = await spawn(exe, ['--help'], { timeoutMs })
  if (code !== 0) {
    return { ok: false, error: `llama-server --help exited with code ${code}` }
  }
  const commands = parseHelpOutput(stdout)
  if (commands.length === 0) {
    return { ok: false, error: 'Parser produced zero commands' }
  }
  const sections = [...new Set(commands.map(c => c.section).filter((s): s is string => Boolean(s)))]
  const structural: StructuralSchemaType = {
    version: backend.name,
    generatedAt: new Date().toISOString(),
    categories: sections.map(section => ({
      name: section,
      commands: commands.filter(c => c.section === section)
    }))
  }
  let validated: StructuralSchemaType
  try {
    validated = StructuralSchema.parse(structural)
  } catch (err) {
    return { ok: false, error: `Schema validation failed: ${(err as Error).message}` }
  }
  const target = join(backend.path, 'generated.json')
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(validated, null, 2))
  renameSync(tmp, target)
  return { ok: true, path: target, commandCount: validated.categories.reduce((n, c) => n + c.commands.length, 0) }
}
