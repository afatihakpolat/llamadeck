import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { mergeCommandsSchema } from './commandsSchemaMerger'
import type { Command, Overlay, MergedSchemaType } from './schemas'

interface LoadOptions {
  buildTag: string
  backendDir: string       // <userData>/backends
  bundledDir?: string      // app's resources/commands dir
  overlay: Overlay
}

interface CacheEntry {
  mtimeHash: string
  result: MergedSchemaType | null
}

const cache = new Map<string, CacheEntry>()

export function resetLoaderCache(): void {
  cache.clear()
}

function readJSON<T>(p: string): T | null {
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch {
    return null
  }
}

function structuralToCommands(raw: any): Command[] {
  if (!raw || !Array.isArray(raw.categories)) return []
  const out: Command[] = []
  for (const cat of raw.categories) {
    for (const cmd of cat.commands || []) {
      out.push({ ...cmd, section: cmd.section || cat.name })
    }
  }
  return out
}

function hashMtimes(paths: string[]): string {
  const h = createHash('sha1')
  for (const p of paths) {
    if (existsSync(p)) {
      h.update(p)
      h.update(statSync(p).mtimeMs.toString())
      h.update('|')
    } else {
      h.update(p)
      h.update('-|')
    }
  }
  return h.digest('hex')
}

export async function loadMergedSchema(opts: LoadOptions): Promise<MergedSchemaType | null> {
  const perBuildPath = join(opts.backendDir, opts.buildTag, 'generated.json')
  const bundledPath = opts.bundledDir ? join(opts.bundledDir, `${opts.buildTag}.json`) : null
  const userOverridePath = join(opts.backendDir, opts.buildTag, 'commands.json')

  const mtimeHash = hashMtimes([perBuildPath, bundledPath || '', userOverridePath])
  const cached = cache.get(opts.buildTag)
  if (cached && cached.mtimeHash === mtimeHash) return cached.result

  const structuralRaw = readJSON<any>(perBuildPath) || (bundledPath ? readJSON<any>(bundledPath) : null)
  if (!structuralRaw) {
    cache.set(opts.buildTag, { mtimeHash, result: null })
    return null
  }
  const structural = structuralToCommands(structuralRaw)
  const userOverride = readJSON<any>(userOverridePath)
  const result = mergeCommandsSchema(structural, opts.overlay, userOverride)
  cache.set(opts.buildTag, { mtimeHash, result })
  return result
}
