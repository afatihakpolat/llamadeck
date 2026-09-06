import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { BackendBuildFlavor, BackendBuildMode } from '../shared/types'
import { BackendBuildMetadataSchema } from './schemas'

const BUILD_METADATA_FILE = 'llamadeck-build.json'
const CMAKE_CACHE_FILE = 'CMakeCache.txt'
const SCHEDULER_COPIES_PATTERN = /^GGML_SCHED_MAX_COPIES(?::[^=]+)?=(\d+)\s*$/m

function inferBuildModeFromCmakeCache(backendPath: string): BackendBuildMode | null {
  const cachePath = join(backendPath, CMAKE_CACHE_FILE)
  if (!existsSync(cachePath)) return null

  try {
    const cache = readFileSync(cachePath, 'utf-8')
    const configuredCopies = cache.match(SCHEDULER_COPIES_PATTERN)
    if (!configuredCopies) return 'parallel'

    const copies = Number(configuredCopies[1])
    if (copies === 1) return 'single'
    if (copies > 1) return 'parallel'
  } catch {
    return null
  }

  return null
}

export function readBackendBuildMode(
  backendPath: string,
  flavor: BackendBuildFlavor
): BackendBuildMode | null {
  const metadataPath = join(backendPath, BUILD_METADATA_FILE)
  if (existsSync(metadataPath)) {
    try {
      const parsed = BackendBuildMetadataSchema.safeParse(
        JSON.parse(readFileSync(metadataPath, 'utf-8'))
      )
      if (parsed.success) return parsed.data.buildMode
    } catch {
      // Fall through to CMake cache detection for legacy or damaged metadata.
    }
  }

  // Preserve old behaviour: a CPU-only build with no metadata is reported as
  // unknown rather than the cmake-cache "parallel" default, which would imply
  // a scheduler override that CPU builds typically do not set.
  if (flavor === 'cpu') return null

  return inferBuildModeFromCmakeCache(backendPath)
}

export function writeBackendBuildMetadata(
  backendPath: string,
  buildMode: BackendBuildMode,
  flavor: BackendBuildFlavor = 'cuda'
): void {
  const metadata = BackendBuildMetadataSchema.parse({
    version: 1,
    flavor,
    buildMode
  })
  const metadataPath = join(backendPath, BUILD_METADATA_FILE)
  const temporaryPath = `${metadataPath}.tmp`

  writeFileSync(temporaryPath, JSON.stringify(metadata, null, 2), 'utf-8')
  renameSync(temporaryPath, metadataPath)
}
