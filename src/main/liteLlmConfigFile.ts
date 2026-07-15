import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { validateLiteLlmConfig } from '../shared/liteLlmConfig'

export function saveLiteLlmConfigFile(configPath: string, configText: string): void {
  const validation = validateLiteLlmConfig(configText)
  const firstError = validation.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
  if (firstError) {
    throw new Error(`Invalid YAML at line ${firstError.line}, column ${firstError.column}: ${firstError.message}`)
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const tempPath = `${configPath}.tmp`
  writeFileSync(tempPath, configText, 'utf-8')
  renameSync(tempPath, configPath)
}
