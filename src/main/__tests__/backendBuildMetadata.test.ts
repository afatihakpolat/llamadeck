import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readBackendBuildMode, writeBackendBuildMetadata } from '../backendBuildMetadata'

let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'hexllama-build-mode-'))
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('backend build metadata', () => {
  it('persists and reads the selected CUDA build mode', () => {
    const backendPath = join(work, 'b9202')
    mkdirSync(backendPath, { recursive: true })

    writeBackendBuildMetadata(backendPath, 'single')

    expect(readBackendBuildMode(backendPath, 'cuda')).toBe('single')
    expect(existsSync(join(backendPath, 'llamadeck-build.json.tmp'))).toBe(false)
  })

  it('detects a legacy single build from its CMake cache', () => {
    const backendPath = join(work, 'b9202')
    mkdirSync(backendPath, { recursive: true })
    writeFileSync(
      join(backendPath, 'CMakeCache.txt'),
      'GGML_CUDA:BOOL=ON\nGGML_SCHED_MAX_COPIES:UNINITIALIZED=1\n'
    )

    expect(readBackendBuildMode(backendPath, 'cuda')).toBe('single')
  })

  it('detects a legacy parallel build when no scheduler override was configured', () => {
    const backendPath = join(work, 'b9202')
    mkdirSync(backendPath, { recursive: true })
    writeFileSync(join(backendPath, 'CMakeCache.txt'), 'GGML_CUDA:BOOL=ON\n')

    expect(readBackendBuildMode(backendPath, 'cuda')).toBe('parallel')
  })

  it('falls back to the CMake cache when metadata is invalid', () => {
    const backendPath = join(work, 'b9202')
    mkdirSync(backendPath, { recursive: true })
    writeFileSync(join(backendPath, 'llamadeck-build.json'), '{not-json')
    writeFileSync(join(backendPath, 'CMakeCache.txt'), 'GGML_CUDA:BOOL=ON\n')

    expect(readBackendBuildMode(backendPath, 'cuda')).toBe('parallel')
  })

  it('returns unknown when a CUDA backend has no build evidence', () => {
    expect(readBackendBuildMode(work, 'cuda')).toBeNull()
  })

  it('does not report a scheduler mode for CPU builds', () => {
    writeFileSync(join(work, 'CMakeCache.txt'), 'GGML_SCHED_MAX_COPIES:UNINITIALIZED=1\n')

    expect(readBackendBuildMode(work, 'cpu')).toBeNull()
  })
})
