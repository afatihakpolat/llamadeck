import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveLiteLlmConfigFile } from '../liteLlmConfigFile'

const workDirs: string[] = []

function makeWorkDir(): string {
  const work = mkdtempSync(join(tmpdir(), 'hexllama-litellm-config-'))
  workDirs.push(work)
  return work
}

afterEach(() => {
  for (const work of workDirs.splice(0)) {
    rmSync(work, { recursive: true, force: true })
  }
})

describe('saveLiteLlmConfigFile', () => {
  it('writes a valid config atomically and clears the temporary file', () => {
    const configPath = join(makeWorkDir(), 'nested', 'litellm-config.yaml')
    const configText = 'model_list:\n  - model_name: local-model\n'

    saveLiteLlmConfigFile(configPath, configText)

    expect(readFileSync(configPath, 'utf-8')).toBe(configText)
    expect(existsSync(`${configPath}.tmp`)).toBe(false)
  })

  it('preserves the saved config when replacement YAML is invalid', () => {
    const configPath = join(makeWorkDir(), 'litellm-config.yaml')
    const savedText = 'model_list: []\n'
    writeFileSync(configPath, savedText, 'utf-8')

    expect(() => saveLiteLlmConfigFile(configPath, 'model_list: [broken\n')).toThrow(/Invalid YAML/)
    expect(readFileSync(configPath, 'utf-8')).toBe(savedText)
    expect(existsSync(`${configPath}.tmp`)).toBe(false)
  })
})
