import { describe, it, expect } from 'vitest'
import {
  parseExtraCmakeFlags,
  previewSourceBuildCommands,
  type BackendBuildOptions
} from '../types'

function baseOptions(overrides: Partial<BackendBuildOptions> = {}): BackendBuildOptions {
  return {
    accelerator: 'cuda',
    enableRpc: false,
    buildMode: 'parallel',
    buildType: 'Release',
    cudaArch: 'native',
    faAllQuants: true,
    serverOnly: true,
    compiler: 'cl',
    extraFlags: [],
    ...overrides
  }
}

describe('previewSourceBuildCommands', () => {
  it('previews default CUDA server-only build', () => {
    const preview = previewSourceBuildCommands('b10819', baseOptions())
    expect(preview.buildFolder).toBe('b10819')
    expect(preview.configureCommand).toBe(
      'cmake -S . -B b10819 -G Ninja -DCMAKE_BUILD_TYPE=Release ' +
      '-DCMAKE_C_COMPILER=<cl.exe> -DCMAKE_CXX_COMPILER=<cl.exe> ' +
      '-DGGML_CUDA=ON -DCMAKE_CUDA_HOST_COMPILER=<cl.exe> ' +
      '-DGGML_CUDA_FA_ALL_QUANTS=ON -DCMAKE_CUDA_ARCHITECTURES=native'
    )
    expect(preview.buildCommand).toBe(
      'cmake --build b10819 --config Release --target llama-server -j'
    )
  })

  it('previews CPU full build with single scheduler mode', () => {
    const preview = previewSourceBuildCommands('b10819', baseOptions({
      accelerator: 'cpu',
      buildMode: 'single',
      serverOnly: false
    }))
    expect(preview.buildFolder).toBe('b10819-cpu')
    expect(preview.configureCommand).toContain('-DGGML_SCHED_MAX_COPIES=1')
    expect(preview.configureCommand).toContain('-DGGML_CUDA=OFF')
    expect(preview.configureCommand).not.toContain('GGML_CUDA=ON')
    expect(preview.buildCommand).toBe('cmake --build b10819-cpu --config Release -j')
  })

  it('previews Vulkan RPC folder suffix and flags', () => {
    const preview = previewSourceBuildCommands('b10819', baseOptions({
      accelerator: 'vulkan',
      enableRpc: true
    }))
    expect(preview.buildFolder).toBe('b10819-vulkan-rpc')
    expect(preview.configureCommand).toContain('-DGGML_CUDA=OFF')
    expect(preview.configureCommand).toContain('-DGGML_VULKAN=ON')
    expect(preview.configureCommand).toContain('-DGGML_RPC=ON')
  })

  it('shows placeholder when CUDA arch is blank (filled in by main process before build)', () => {
    const preview = previewSourceBuildCommands('b10819', baseOptions({ cudaArch: '  ' }))
    expect(preview.configureCommand).toContain('-DCMAKE_CUDA_ARCHITECTURES=<resolved-at-launch>')
  })

  it('omits FA quants flag when disabled and respects build type', () => {
    const preview = previewSourceBuildCommands('b10819', baseOptions({
      faAllQuants: false,
      buildType: 'Debug'
    }))
    expect(preview.configureCommand).not.toContain('FA_ALL_QUANTS')
    expect(preview.configureCommand).toContain('-DCMAKE_BUILD_TYPE=Debug')
    expect(preview.buildCommand).toContain('--config Debug')
  })

  it('previews CUDA RPC folder without -cpu suffix', () => {
    const preview = previewSourceBuildCommands('b10819', baseOptions({ enableRpc: true }))
    expect(preview.buildFolder).toBe('b10819-cuda-rpc')
    expect(preview.configureCommand).toContain('-DGGML_RPC=ON')
  })

  it('previews clang-cl compiler with extra AVX512 flags', () => {
    const preview = previewSourceBuildCommands('b10819', baseOptions({
      compiler: 'clang-cl',
      extraFlags: ['-DGGML_NATIVE=OFF', '-DGGML_AVX512=ON', '-DGGML_AVX512_BF16=ON', '-DGGML_AVX512_VNNI=ON', '-DGGML_AVX512_VBMI=ON']
    }))
    expect(preview.configureCommand).toContain('-DCMAKE_C_COMPILER=<clang-cl>')
    expect(preview.configureCommand).toContain('-DCMAKE_CXX_COMPILER=<clang-cl>')
    expect(preview.configureCommand).toContain('-DCMAKE_CUDA_HOST_COMPILER=<clang-cl>')
    expect(preview.configureCommand).toContain('-DGGML_NATIVE=OFF -DGGML_AVX512=ON -DGGML_AVX512_BF16=ON -DGGML_AVX512_VNNI=ON -DGGML_AVX512_VBMI=ON')
  })
})

describe('parseExtraCmakeFlags', () => {
  it('splits lines, drops blanks and hash comments', () => {
    expect(parseExtraCmakeFlags('# tune cpu kernels\n-DGGML_NATIVE=OFF\n\n  -DGGML_AVX512=ON  \n')).toEqual({
      flags: ['-DGGML_NATIVE=OFF', '-DGGML_AVX512=ON'],
      invalid: []
    })
  })

  it('collects malformed lines as invalid', () => {
    expect(parseExtraCmakeFlags('-DGOOD=1\n--config Release\nplain\n-D SPACED')).toEqual({
      flags: ['-DGOOD=1'],
      invalid: ['--config Release', 'plain', '-D SPACED']
    })
  })

  it('returns empty lists for empty input', () => {
    expect(parseExtraCmakeFlags('  \n')).toEqual({ flags: [], invalid: [] })
  })

  it('flags over-long lines as invalid like the schema does', () => {
    const long = `-D${'A'.repeat(260)}=ON`
    expect(parseExtraCmakeFlags(`${long}\n-DOK=1`)).toEqual({
      flags: ['-DOK=1'],
      invalid: [long]
    })
  })
})
