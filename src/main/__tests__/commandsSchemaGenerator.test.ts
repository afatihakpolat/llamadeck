import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { generateCommandsSchema } from '../commandsSchemaGenerator'

let work: string
let spawnMock: any

const HELP_OUTPUT = readFileSync(join(__dirname, 'fixtures', 'help-ctx-size.txt'), 'utf-8')

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'hexllama-gen-'))
  mkdirSync(join(work, 'bin'), { recursive: true })
  // Create a placeholder exe so existsSync passes for the default fakeBackend.
  // The "does not exist" test overrides exe to a non-existent path.
  writeFileSync(join(work, 'bin', 'llama-server.exe'), '')
  spawnMock = vi.fn()
})
afterEach(() => { rmSync(work, { recursive: true, force: true }) })

function fakeBackend() {
  return {
    name: 'b9202',
    displayName: 'b9202',
    flavor: 'cuda' as const,
    path: work,
    hasCommands: false,
    exe: join(work, 'bin', 'llama-server.exe')
  }
}

describe('generateCommandsSchema', () => {
  it('spawns llama-server.exe --help and writes generated.json', async () => {
    spawnMock.mockResolvedValue({ code: 0, stdout: HELP_OUTPUT })
    const result = await generateCommandsSchema({
      backend: fakeBackend(),
      spawn: spawnMock
    })
    expect(result.ok).toBe(true)
    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringContaining('llama-server.exe'),
      ['--help'],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
    const out = JSON.parse(readFileSync(join(work, 'generated.json'), 'utf-8'))
    expect(out.categories[0].commands[0].arg).toBe('--ctx-size')
  })

  it('returns { ok: false } when the binary does not exist', async () => {
    const result = await generateCommandsSchema({
      backend: { ...fakeBackend(), exe: join(work, 'does-not-exist.exe') },
      spawn: spawnMock
    })
    expect(result.ok).toBe(false)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('returns { ok: false } when spawn returns non-zero', async () => {
    spawnMock.mockResolvedValue({ code: 1, stdout: '' })
    const result = await generateCommandsSchema({ backend: fakeBackend(), spawn: spawnMock })
    expect(result.ok).toBe(false)
  })

  it('returns { ok: false } when parser produces zero commands', async () => {
    spawnMock.mockResolvedValue({ code: 0, stdout: '' })
    const result = await generateCommandsSchema({ backend: fakeBackend(), spawn: spawnMock })
    expect(result.ok).toBe(false)
  })

  it('writes atomically (no leftover .tmp on success)', async () => {
    spawnMock.mockResolvedValue({ code: 0, stdout: HELP_OUTPUT })
    await generateCommandsSchema({ backend: fakeBackend(), spawn: spawnMock })
    expect(existsSync(join(work, 'generated.json.tmp'))).toBe(false)
    expect(existsSync(join(work, 'generated.json'))).toBe(true)
  })
})
