import { z } from 'zod'
import type {
  BackendVersion,
  LiteLlmInstallStatus,
  LiteLlmModelEntry,
  ModelOutputEvent,
  Template,
  UsageLiveSession
} from '../shared/types'
import type { LiteLlmConfigValidation } from '../shared/liteLlmConfig'
import type { CliLiteLlmLogsResult } from './liteLlmCli'
import { CLI_PROTOCOL_VERSION } from './cliProtocol'
import type { CliRequest, CliResponse } from './cliProtocol'

export interface CliTemplateStartResult {
  id: string
  name: string
  pid?: number
  port: number
  backend: string
}

const TemplateArgValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const TemplateArgsSchema = z.record(z.string(), TemplateArgValueSchema)
const TemplatePricingSchema = z.object({
  inputCostPerMillion: z.number().finite().nonnegative(),
  cacheCostPerMillion: z.number().finite().nonnegative(),
  outputCostPerMillion: z.number().finite().nonnegative()
}).strict()

const TemplateIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'ID may contain only letters, numbers, periods, underscores, and hyphens.')

export const CliTemplateCreateInputSchema = z.object({
  id: TemplateIdSchema.optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  backendVersion: z.string().trim().min(1).max(200).optional(),
  modelPath: z.string().trim().min(1).max(4096).optional(),
  serverPort: z.number().int().min(1).max(65535).default(8080),
  args: TemplateArgsSchema.default({}),
  launchMode: z.enum(['chat', 'api']).default('chat'),
  pricing: TemplatePricingSchema.optional()
}).strict()

export type CliTemplateCreateInput = z.infer<typeof CliTemplateCreateInputSchema>

export const CliTemplateUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  backendVersion: z.string().trim().min(1).max(200).nullable().optional(),
  modelPath: z.string().trim().min(1).max(4096).nullable().optional(),
  serverPort: z.number().int().min(1).max(65535).optional(),
  args: TemplateArgsSchema.optional(),
  launchMode: z.enum(['chat', 'api']).optional(),
  pricing: TemplatePricingSchema.nullable().optional()
}).strict()

export type CliTemplateUpdateInput = z.infer<typeof CliTemplateUpdateInputSchema>

export interface CliTemplateValidationResult {
  valid: boolean
  templateId?: string
  errors: string[]
  warnings: string[]
  resolved?: {
    backend?: string
    modelPath?: string
    launchArgs?: string[]
  }
}

export interface CliModelOutputEntry extends ModelOutputEvent {
  sequence: number
}

export interface CliTemplateLogsResult {
  id: string
  name: string
  events: CliModelOutputEntry[]
  nextCursor: number
  hasMore: boolean
  running: boolean
}

export interface CliTemplateReadyResult {
  id: string
  name: string
  ready: true
  url: string
  waitedMs: number
  statusCode: number
}

export interface CliLiteLlmStatus {
  running: boolean
  pid: number | null
  endpoint: string
  settings: {
    host: string
    port: number
    configPath: string
    logLevel: string
    apiKeyConfigured: boolean
  }
  install: LiteLlmInstallStatus
  config: LiteLlmConfigValidation & {
    path: string
  }
  recentLogCount: number
}

export interface CliLiteLlmConfigResult extends LiteLlmConfigValidation {
  path: string
  text: string
  redacted: true
}

export interface CliCommandDependencies {
  getVersion: () => string
  listTemplates: () => Template[]
  listRunningSessions: () => UsageLiveSession[]
  listBackends: () => BackendVersion[]
  getActiveBackendName: () => string | null
  showApp: () => void
  createTemplate: (input: CliTemplateCreateInput) => Promise<Template>
  updateTemplate: (template: Template, input: CliTemplateUpdateInput) => Promise<Template>
  deleteTemplate: (template: Template) => Promise<void>
  validateTemplate: (template: Template | CliTemplateCreateInput) => Promise<CliTemplateValidationResult>
  getTemplateLogs: (template: Template, afterSequence: number, limit: number) => CliTemplateLogsResult
  waitForTemplateReady: (template: Template, timeoutMs: number) => Promise<CliTemplateReadyResult>
  startTemplate: (template: Template) => Promise<CliTemplateStartResult>
  stopTemplate: (template: Template) => Promise<void>
  useBackend: (backend: BackendVersion) => Promise<void>
  getLiteLlmStatus: () => Promise<CliLiteLlmStatus>
  startLiteLlm: () => Promise<CliLiteLlmStatus>
  stopLiteLlm: () => Promise<CliLiteLlmStatus>
  installLiteLlm: (upgrade: boolean) => Promise<{ status: CliLiteLlmStatus; output: string }>
  testLiteLlm: () => Promise<{ connected: true; modelCount: number; endpoint: string }>
  listLiteLlmModels: () => Promise<LiteLlmModelEntry[]>
  getLiteLlmLogs: (afterSequence: number, limit: number) => CliLiteLlmLogsResult
  getLiteLlmConfig: () => CliLiteLlmConfigResult
  validateLiteLlmConfig: (configText: string) => LiteLlmConfigValidation
  setLiteLlmConfig: (configText: string) => Promise<{ status: CliLiteLlmStatus; restartRequired: boolean }>
}

const EXIT_FAILURE = 1
const EXIT_INVALID_INPUT = 2
const EXIT_NOT_FOUND = 3
const EXIT_AMBIGUOUS = 4
const EXIT_CONFLICT = 5
const DEFAULT_LOG_LIMIT = 200
const MAX_LOG_LIMIT = 2000
const DEFAULT_READY_TIMEOUT_MS = 120_000
const MAX_READY_TIMEOUT_MS = 3_600_000

export class CliCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode = EXIT_FAILURE,
    readonly code = 'OPERATION_FAILED'
  ) {
    super(message)
    this.name = 'CliCommandError'
  }
}

function errorResponse(error: string, exitCode = EXIT_FAILURE, code = 'OPERATION_FAILED'): CliResponse {
  return { ok: false, error, exitCode, code }
}

function resolveTemplate(templates: Template[], selector: string): CliResponse | Template {
  const normalizedSelector = selector.trim()
  if (!normalizedSelector) {
    return errorResponse('A template ID or name is required.', EXIT_INVALID_INPUT, 'INVALID_INPUT')
  }

  const exactId = templates.find((template) => template.id === normalizedSelector)
  if (exactId) return exactId

  const nameMatches = templates.filter(
    (template) => template.name.localeCompare(normalizedSelector, undefined, { sensitivity: 'accent' }) === 0
  )
  if (nameMatches.length === 1) return nameMatches[0]
  if (nameMatches.length > 1) {
    const ids = nameMatches.map((template) => template.id).join(', ')
    return errorResponse(
      `Template name "${normalizedSelector}" is ambiguous. Use one of these IDs: ${ids}`,
      EXIT_AMBIGUOUS,
      'AMBIGUOUS'
    )
  }

  return errorResponse(`Template not found: ${normalizedSelector}`, EXIT_NOT_FOUND, 'NOT_FOUND')
}

function isCliResponse(value: CliResponse | Template): value is CliResponse {
  return 'ok' in value
}

function resolveBackend(backends: BackendVersion[], selector: string): CliResponse | BackendVersion {
  const normalizedSelector = selector.trim()
  if (!normalizedSelector) {
    return errorResponse('A backend name is required.', EXIT_INVALID_INPUT, 'INVALID_INPUT')
  }

  const exactName = backends.find((backend) => backend.name === normalizedSelector)
  if (exactName) return exactName

  const matches = backends.filter((backend) => {
    return backend.name.localeCompare(normalizedSelector, undefined, { sensitivity: 'accent' }) === 0
      || backend.displayName.localeCompare(normalizedSelector, undefined, { sensitivity: 'accent' }) === 0
  })
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    return errorResponse(
      `Backend selector "${normalizedSelector}" is ambiguous. Use one of these names: ${matches.map((backend) => backend.name).join(', ')}`,
      EXIT_AMBIGUOUS,
      'AMBIGUOUS'
    )
  }

  return errorResponse(`Backend not found: ${normalizedSelector}`, EXIT_NOT_FOUND, 'NOT_FOUND')
}

function parseJsonDocument(rawDocument: string): unknown {
  try {
    return JSON.parse(rawDocument) as unknown
  } catch {
    throw new CliCommandError('Template document is not valid JSON.', EXIT_INVALID_INPUT, 'INVALID_INPUT')
  }
}

function formatValidationIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'document'
    return `${path}: ${issue.message}`
  })
}

function parseCreateInput(rawDocument: string): CliTemplateCreateInput {
  const parsed = CliTemplateCreateInputSchema.safeParse(parseJsonDocument(rawDocument))
  if (!parsed.success) {
    throw new CliCommandError(
      `Template document is invalid: ${formatValidationIssues(parsed.error).join('; ')}`,
      EXIT_INVALID_INPUT,
      'INVALID_INPUT'
    )
  }
  return parsed.data
}

function parseUpdateInput(rawDocument: string): CliTemplateUpdateInput {
  const parsed = CliTemplateUpdateInputSchema.safeParse(parseJsonDocument(rawDocument))
  if (!parsed.success) {
    throw new CliCommandError(
      `Template update is invalid: ${formatValidationIssues(parsed.error).join('; ')}`,
      EXIT_INVALID_INPUT,
      'INVALID_INPUT'
    )
  }
  return parsed.data
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  fieldName: string,
  minimum: number,
  maximum: number
): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliCommandError(
      `${fieldName} must be an integer from ${minimum} through ${maximum}.`,
      EXIT_INVALID_INPUT,
      'INVALID_INPUT'
    )
  }
  return parsed
}

function getCapabilities(version: string): object {
  return {
    application: 'LlamaDeck',
    version,
    protocol: CLI_PROTOCOL_VERSION,
    output: {
      standard: 'One JSON value on stdout.',
      followLogs: 'Newline-delimited JSON log event objects on stdout.',
      errors: 'Human-readable text on stderr with a non-zero exit code.'
    },
    exitCodes: {
      success: 0,
      failure: EXIT_FAILURE,
      invalidInput: EXIT_INVALID_INPUT,
      notFound: EXIT_NOT_FOUND,
      ambiguous: EXIT_AMBIGUOUS,
      conflict: EXIT_CONFLICT,
      usage: 64
    },
    commands: [
      { name: 'capabilities', usage: 'llamadeck capabilities', mutating: false },
      { name: 'status', usage: 'llamadeck status', mutating: false },
      { name: 'template.list', usage: 'llamadeck template list', mutating: false },
      { name: 'template.get', usage: 'llamadeck template get <id-or-name>', mutating: false },
      { name: 'template.create', usage: 'llamadeck template create <--file path|--json json>', mutating: true },
      { name: 'template.update', usage: 'llamadeck template update <id-or-name> <--file path|--json json>', mutating: true },
      { name: 'template.delete', usage: 'llamadeck template delete <id-or-name> --yes', mutating: true },
      { name: 'template.validate', usage: 'llamadeck template validate <id-or-name>|--file path|--json json', mutating: false },
      { name: 'template.start', usage: 'llamadeck template start <id-or-name>', mutating: true },
      { name: 'template.stop', usage: 'llamadeck template stop <id-or-name>', mutating: true },
      { name: 'template.logs', usage: 'llamadeck template logs <id-or-name> [--tail count] [--follow]', mutating: false, streaming: true },
      { name: 'template.waitReady', usage: 'llamadeck template wait <id-or-name> --ready [--timeout seconds]', mutating: false },
      { name: 'backend.list', usage: 'llamadeck backend list', mutating: false },
      { name: 'backend.use', usage: 'llamadeck backend use <name-or-display-name>', mutating: true },
      { name: 'litellm.status', usage: 'llamadeck litellm status', mutating: false },
      { name: 'litellm.start', usage: 'llamadeck litellm start', mutating: true },
      { name: 'litellm.stop', usage: 'llamadeck litellm stop', mutating: true },
      { name: 'litellm.restart', usage: 'llamadeck litellm restart', mutating: true },
      { name: 'litellm.install', usage: 'llamadeck litellm install', mutating: true },
      { name: 'litellm.update', usage: 'llamadeck litellm update', mutating: true },
      { name: 'litellm.test', usage: 'llamadeck litellm test', mutating: false },
      { name: 'litellm.models', usage: 'llamadeck litellm models', mutating: false },
      { name: 'litellm.logs', usage: 'llamadeck litellm logs [--tail count] [--follow]', mutating: false, streaming: true },
      { name: 'litellm.configGet', usage: 'llamadeck litellm config get', mutating: false, redacted: true },
      { name: 'litellm.configValidate', usage: 'llamadeck litellm config validate --file <path>', mutating: false },
      { name: 'litellm.configSet', usage: 'llamadeck litellm config set --file <path>', mutating: true },
      { name: 'app.show', usage: 'llamadeck app show', mutating: false },
      { name: 'version', usage: 'llamadeck --version', mutating: false }
    ],
    templateDocument: {
      required: ['name'],
      optional: ['id', 'description', 'backendVersion', 'modelPath', 'serverPort', 'args', 'launchMode', 'pricing'],
      updateable: ['name', 'description', 'backendVersion', 'modelPath', 'serverPort', 'args', 'launchMode', 'pricing'],
      clearWithNull: ['description', 'backendVersion', 'modelPath', 'pricing']
    }
  }
}

export function createCliCommandHandler(dependencies: CliCommandDependencies): (request: CliRequest) => Promise<CliResponse> {
  return async (request) => {
    try {
      if (request.command === 'capabilities') {
        return { ok: true, result: getCapabilities(dependencies.getVersion()) }
      }

      if (request.command === 'version') {
        return { ok: true, result: { version: dependencies.getVersion() } }
      }

      if (request.command === 'app.show') {
        dependencies.showApp()
        return { ok: true, result: { shown: true } }
      }

      if (request.command === 'backend.list') {
        const activeBackendName = dependencies.getActiveBackendName()
        return {
          ok: true,
          result: {
            active: activeBackendName,
            backends: dependencies.listBackends().map((backend) => ({
              ...backend,
              active: backend.name === activeBackendName
            }))
          }
        }
      }

      if (request.command === 'backend.use') {
        const resolvedBackend = resolveBackend(dependencies.listBackends(), request.args[0] ?? '')
        if ('ok' in resolvedBackend) return resolvedBackend
        await dependencies.useBackend(resolvedBackend)
        return {
          ok: true,
          result: {
            name: resolvedBackend.name,
            displayName: resolvedBackend.displayName,
            active: true
          }
        }
      }

      if (request.command === 'litellm.status') {
        return { ok: true, result: await dependencies.getLiteLlmStatus() }
      }

      if (request.command === 'litellm.start') {
        return { ok: true, result: await dependencies.startLiteLlm() }
      }

      if (request.command === 'litellm.stop') {
        return { ok: true, result: await dependencies.stopLiteLlm() }
      }

      if (request.command === 'litellm.restart') {
        const status = await dependencies.getLiteLlmStatus()
        if (status.running) {
          await dependencies.stopLiteLlm()
        }
        return { ok: true, result: await dependencies.startLiteLlm() }
      }

      if (request.command === 'litellm.install' || request.command === 'litellm.update') {
        return {
          ok: true,
          result: await dependencies.installLiteLlm(request.command === 'litellm.update')
        }
      }

      if (request.command === 'litellm.test') {
        return { ok: true, result: await dependencies.testLiteLlm() }
      }

      if (request.command === 'litellm.models') {
        return { ok: true, result: await dependencies.listLiteLlmModels() }
      }

      if (request.command === 'litellm.logs') {
        const afterSequence = parseBoundedInteger(request.args[0], 0, 'Log cursor', 0, Number.MAX_SAFE_INTEGER)
        const limit = parseBoundedInteger(request.args[1], DEFAULT_LOG_LIMIT, 'Log limit', 1, MAX_LOG_LIMIT)
        return { ok: true, result: dependencies.getLiteLlmLogs(afterSequence, limit) }
      }

      if (request.command === 'litellm.configGet') {
        return { ok: true, result: dependencies.getLiteLlmConfig() }
      }

      if (request.command === 'litellm.configValidate' || request.command === 'litellm.configSet') {
        const configText = request.args[0] ?? ''
        const validation = dependencies.validateLiteLlmConfig(configText)
        if (!validation.valid) {
          return {
            ok: true,
            result: {
              ...validation,
              ...(request.command === 'litellm.configSet' ? { saved: false } : {})
            }
          }
        }
        if (request.command === 'litellm.configValidate') {
          return { ok: true, result: validation }
        }
        return {
          ok: true,
          result: {
            ...validation,
            saved: true,
            ...await dependencies.setLiteLlmConfig(configText)
          }
        }
      }

      const templates = dependencies.listTemplates()

      if (request.command === 'template.list') {
        return { ok: true, result: templates }
      }

      if (request.command === 'status') {
        return {
          ok: true,
          result: {
            version: dependencies.getVersion(),
            templateCount: templates.length,
            running: dependencies.listRunningSessions()
          }
        }
      }

      if (request.command === 'template.create') {
        return { ok: true, result: await dependencies.createTemplate(parseCreateInput(request.args[0] ?? '')) }
      }

      if (request.command === 'template.validate' && request.args[0] === 'document') {
        let input: CliTemplateCreateInput
        try {
          input = parseCreateInput(request.args[1] ?? '')
        } catch (error) {
          return {
            ok: true,
            result: {
              valid: false,
              errors: [error instanceof Error ? error.message : String(error)],
              warnings: []
            } satisfies CliTemplateValidationResult
          }
        }
        return { ok: true, result: await dependencies.validateTemplate(input) }
      }

      const resolved = resolveTemplate(templates, request.args[0] ?? '')
      if (isCliResponse(resolved)) return resolved

      if (request.command === 'template.get') {
        return { ok: true, result: resolved }
      }

      if (request.command === 'template.start') {
        return { ok: true, result: await dependencies.startTemplate(resolved) }
      }

      if (request.command === 'template.stop') {
        await dependencies.stopTemplate(resolved)
        return {
          ok: true,
          result: {
            id: resolved.id,
            name: resolved.name,
            stopped: true
          }
        }
      }

      if (request.command === 'template.update') {
        return {
          ok: true,
          result: await dependencies.updateTemplate(resolved, parseUpdateInput(request.args[1] ?? ''))
        }
      }

      if (request.command === 'template.delete') {
        if (request.args[1] !== 'yes') {
          return errorResponse(
            'Template deletion requires explicit confirmation.',
            EXIT_INVALID_INPUT,
            'CONFIRMATION_REQUIRED'
          )
        }
        await dependencies.deleteTemplate(resolved)
        return {
          ok: true,
          result: {
            id: resolved.id,
            name: resolved.name,
            deleted: true
          }
        }
      }

      if (request.command === 'template.validate') {
        return { ok: true, result: await dependencies.validateTemplate(resolved) }
      }

      if (request.command === 'template.logs') {
        const afterSequence = parseBoundedInteger(request.args[1], 0, 'Log cursor', 0, Number.MAX_SAFE_INTEGER)
        const limit = parseBoundedInteger(request.args[2], DEFAULT_LOG_LIMIT, 'Log limit', 1, MAX_LOG_LIMIT)
        return { ok: true, result: dependencies.getTemplateLogs(resolved, afterSequence, limit) }
      }

      const timeoutMs = parseBoundedInteger(
        request.args[1],
        DEFAULT_READY_TIMEOUT_MS,
        'Readiness timeout',
        1,
        MAX_READY_TIMEOUT_MS
      )
      return { ok: true, result: await dependencies.waitForTemplateReady(resolved, timeoutMs) }
    } catch (error) {
      if (error instanceof CliCommandError) {
        return errorResponse(error.message, error.exitCode, error.code)
      }
      return errorResponse(error instanceof Error ? error.message : String(error))
    }
  }
}
