import { isMap, parseDocument } from 'yaml'

export type LiteLlmConfigDiagnosticSeverity = 'error' | 'warning'

export interface LiteLlmConfigDiagnostic {
  severity: LiteLlmConfigDiagnosticSeverity
  message: string
  line: number
  column: number
  from: number
  to: number
}

export interface LiteLlmConfigValidation {
  valid: boolean
  diagnostics: LiteLlmConfigDiagnostic[]
}

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(offset, length))
}

export function validateLiteLlmConfig(configText: string): LiteLlmConfigValidation {
  const document = parseDocument(configText, { prettyErrors: false, uniqueKeys: true })
  const diagnostics: LiteLlmConfigDiagnostic[] = [
    ...document.errors.map((error): LiteLlmConfigDiagnostic => {
      const from = clampOffset(error.pos[0], configText.length)
      const to = clampOffset(Math.max(error.pos[1], from + 1), configText.length)
      return {
        severity: 'error',
        message: error.message,
        line: error.linePos?.[0]?.line ?? 1,
        column: error.linePos?.[0]?.col ?? 1,
        from,
        to
      }
    }),
    ...document.warnings.map((warning): LiteLlmConfigDiagnostic => {
      const from = clampOffset(warning.pos[0], configText.length)
      const to = clampOffset(Math.max(warning.pos[1], from + 1), configText.length)
      return {
        severity: 'warning',
        message: warning.message,
        line: warning.linePos?.[0]?.line ?? 1,
        column: warning.linePos?.[0]?.col ?? 1,
        from,
        to
      }
    })
  ]

  if (document.errors.length === 0 && !isMap(document.contents)) {
    diagnostics.push({
      severity: 'error',
      message: configText.trim() ? 'The config must use YAML key-value sections at the top level.' : 'The config cannot be empty.',
      line: 1,
      column: 1,
      from: 0,
      to: Math.min(1, configText.length)
    })
  }

  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    diagnostics
  }
}
