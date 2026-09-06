export interface ModelFile {
  name: string
  path: string
}

export type BackendAccelerator = 'cuda' | 'cpu' | 'vulkan'
export type BackendBuildFlavor =
  | 'cuda'
  | 'cpu'
  | 'vulkan'
  | 'cuda-rpc'
  | 'cpu-rpc'
  | 'vulkan-rpc'
export type BackendBuildMode = 'single' | 'parallel'
export type BackendBuildType = 'Release' | 'RelWithDebInfo' | 'Debug'
export type BackendCompiler = 'cl' | 'clang-cl'

export interface BackendBuildOptions {
  accelerator: BackendAccelerator
  enableRpc: boolean
  buildMode: BackendBuildMode
  buildType: BackendBuildType
  cudaArch: string
  faAllQuants: boolean
  serverOnly: boolean
  // C/C++ compiler for CMAKE_C/CXX_COMPILER (and CUDA host compiler).
  compiler: BackendCompiler
  // Additional -D cmake flags, one per entry, appended after generated flags.
  extraFlags: string[]
}

// Allowed shape of a single extra cmake flag: -DNAME or -DNAME=VALUE.
// The charset excludes spaces, quotes, and shell metacharacters so flags
// can travel as separate process args without injection risk. Commas are
// excluded because the IPC layer comma-joins the list for PowerShell.
export const EXTRA_CMAKE_FLAG_PATTERN = /^-D[A-Za-z0-9_]+(=[A-Za-z0-9_.;+:/\\-]*?)?$/
export const MAX_EXTRA_CMAKE_FLAGS = 32
export const MAX_EXTRA_CMAKE_FLAG_LENGTH = 256

// Splits free-form textarea input into lines, dropping blanks and
// `#` comments, and partitions entries into valid flags vs rejects.
export function parseExtraCmakeFlags(text: string): { flags: string[]; invalid: string[] } {
  const flags: string[] = []
  const invalid: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // Mirror the schema limits so rejects surface in the modal hint,
    // not as an IPC validation error after clicking Build.
    if (trimmed.length <= MAX_EXTRA_CMAKE_FLAG_LENGTH && EXTRA_CMAKE_FLAG_PATTERN.test(trimmed)) flags.push(trimmed)
    else invalid.push(trimmed)
  }
  // No truncation here: over-limit lists are rejected by schema validation
  // so the user sees an error instead of silently dropped flags.
  return { flags, invalid }
}

export function resolveBuildFlavor(accelerator: BackendAccelerator, enableRpc: boolean): BackendBuildFlavor {
  if (!enableRpc) return accelerator
  return `${accelerator}-rpc` as BackendBuildFlavor
}

// Placeholders used by the build-command preview for values that only
// resolve on the build machine (VS toolchain path, detected CUDA arch).
export const PREVIEW_CL_EXE = '<cl.exe>'
export const PREVIEW_RESOLVED_CUDA_ARCH = '<resolved-at-launch>'

export interface SourceBuildPreview {
  buildFolder: string
  configureCommand: string
  buildCommand: string
}

// Pure renderer-side mirror of the cmake invocations assembled by the
// PowerShell build script (src/main/ipc.ts SOURCE_UPDATE_SCRIPT).
// Takes the effective options as sent to update-backend-source
// (cudaArch trimmed, faAllQuants already gated on CUDA by the caller).
export function previewSourceBuildCommands(tagName: string, options: BackendBuildOptions): SourceBuildPreview {
  const flavor = resolveBuildFlavor(options.accelerator, options.enableRpc)
  const buildFolder = flavor === 'cuda' ? tagName : `${tagName}-${flavor}`
  const compilerDisplay = options.compiler === 'clang-cl' ? '<clang-cl>' : PREVIEW_CL_EXE

  const configureArgs = [
    'cmake', '-S', '.', '-B', buildFolder, '-G', 'Ninja',
    `-DCMAKE_BUILD_TYPE=${options.buildType}`,
    `-DCMAKE_C_COMPILER=${compilerDisplay}`,
    `-DCMAKE_CXX_COMPILER=${compilerDisplay}`
  ]

  if (options.buildMode === 'single') {
    configureArgs.push('-DGGML_SCHED_MAX_COPIES=1')
  }

  if (flavor.includes('cuda')) {
    configureArgs.push('-DGGML_CUDA=ON', `-DCMAKE_CUDA_HOST_COMPILER=${compilerDisplay}`)
    if (options.faAllQuants) {
      configureArgs.push('-DGGML_CUDA_FA_ALL_QUANTS=ON')
    }
    const arch = options.cudaArch.trim()
    configureArgs.push(`-DCMAKE_CUDA_ARCHITECTURES=${arch || PREVIEW_RESOLVED_CUDA_ARCH}`)
  } else {
    configureArgs.push('-DGGML_CUDA=OFF')
  }

  if (flavor.includes('vulkan')) {
    configureArgs.push('-DGGML_VULKAN=ON')
  }

  if (flavor.includes('rpc')) {
    configureArgs.push('-DGGML_RPC=ON')
  }

  configureArgs.push(...options.extraFlags)

  const buildArgs = ['cmake', '--build', buildFolder, '--config', options.buildType]
  if (options.serverOnly) {
    buildArgs.push('--target', 'llama-server')
  }
  buildArgs.push('-j')

  return {
    buildFolder,
    configureCommand: configureArgs.join(' '),
    buildCommand: buildArgs.join(' ')
  }
}

export interface BackendVersion {
  name: string
  displayName: string
  flavor: BackendBuildFlavor
  buildMode: BackendBuildMode | null
  path: string
  hasCommands: boolean
  exe: string | null
}
export interface CommandParam {
  arg: string
  short?: string | null
  label: string
  description: string
  type: 'boolean' | 'number' | 'string' | 'select' | 'text'
  default?: string | number | boolean | null
  options?: string[]
  min?: number
  max?: number
  step?: number
  placeholder?: string
  env?: string
  deprecated?: boolean
}
export interface CommandCategory {
  name: string
  icon: string
  commands: CommandParam[]
}
export interface CommandsSchema {
  version: string
  categories: CommandCategory[]
}
export type AppView = 'cards' | 'settings' | 'hub' | 'models' | 'litellm' | 'agent-skills' | 'live-output' | 'usage-stats'
export type ModelOutputStream = 'stdout' | 'stderr' | 'system'
export interface ModelOutputEvent {
  id: string
  stream: ModelOutputStream
  text: string
  timestamp: string
}
export interface ModelExitEvent {
  id: string
  code: number | null
  signal: string | null
  pid?: number
}
export interface ModelStartedEvent {
  id: string
  pid?: number
}
export type UsageSessionStatus = 'running' | 'stopped' | 'error'
export interface UsageTimingSnapshot {
  cacheN?: number
  promptN?: number
  promptMs?: number
  promptPerSecond?: number
  predictedN?: number
  predictedMs?: number
  predictedPerSecond?: number
}
export interface UsageRequestRecord {
  id: string
  launchId: string
  templateId: string
  templateNameSnapshot: string
  modelPathSnapshot?: string
  method: string
  path: string
  statusCode: number | null
  startedAt: string
  finishedAt: string
  durationMs: number
  stream: boolean
  countedExactly: boolean
  promptTokens: number
  cacheTokens: number
  completionTokens: number
  totalTokens: number
  timings?: UsageTimingSnapshot
  error?: string
}
export interface UsageLiveSession {
  launchId: string
  templateId: string
  templateName: string
  modelPath?: string
  backendVersion?: string
  publicPort: number
  upstreamPort: number
  startedAt: string
  stoppedAt?: string
  status: UsageSessionStatus
  requestCount: number
  successCount: number
  errorCount: number
  exactUsageCount: number
  promptTokens: number
  cacheTokens: number
  completionTokens: number
  totalTokens: number
  activeRequests: number
  lastRequestAt?: string
  lastEndpoint?: string
  lastError?: string
}
export interface UsageSummaryRollup {
  requestCount: number
  successCount: number
  errorCount: number
  exactUsageCount: number
  promptTokens: number
  cacheTokens: number
  completionTokens: number
  totalTokens: number
}
export interface UsageTemplateRollup extends UsageSummaryRollup {
  templateId: string
  templateName: string
  modelPath?: string
  lastRequestAt?: string
}
export interface UsageDailyRollup extends UsageSummaryRollup {
  day: string
}
export interface UsageSessionRollup extends UsageSummaryRollup {
  launchId: string
  templateId: string
  templateName: string
  modelPath?: string
  backendVersion?: string
  publicPort?: number
  upstreamPort?: number
  startedAt: string
  stoppedAt?: string
  lastRequestAt?: string
  windowStartedAt?: string
  windowEndedAt?: string
  windowLastRequestAt?: string
  lastEndpoint?: string
  lastError?: string
  status: UsageSessionStatus
}
export interface UsageStatsQuery {
  fromTimestamp: number
  toTimestamp: number
  templateId?: string | null
  limit?: number
}
export interface UsageStatsSnapshot {
  query: UsageStatsQuery
  summary: UsageSummaryRollup
  liveSessions: UsageLiveSession[]
  recentRequests: UsageRequestRecord[]
  templateRollups: UsageTemplateRollup[]
  dailyRollups: UsageDailyRollup[]
  sessionRollups: UsageSessionRollup[]
}
export interface UsageUpdatedEvent {
  at: string
}
// One model-level pricing override, keyed by the model folder name (the leaf
// folder holding the model's GGUF files — the same identity the Templates
// screen and Usage Stats model grouping use). Matching is case-insensitive.
export interface ModelPricing {
  model: string
  inputCostPerMillion: number
  cacheCostPerMillion: number
  outputCostPerMillion: number
}
export interface UsageCostSettings {
  currency: string
  inputCostPerMillion: number
  cacheCostPerMillion: number
  outputCostPerMillion: number
  modelPricing: ModelPricing[]
}
export interface AppWindowBehaviorSettings {
  minimizeToTray: boolean
}
export interface TemplatePricing {
  inputCostPerMillion: number
  cacheCostPerMillion: number
  outputCostPerMillion: number
}
export interface Template {
  id: string
  name: string
  description?: string
  backendVersion?: string
  modelPath?: string
  serverPort: number
  args: Record<string, string | number | boolean | null>
  launchMode?: 'chat' | 'api'
  createdAt: string
  updatedAt: string
  _file?: string
  pricing?: TemplatePricing
}

export type LiteLlmLogLevel = 'info' | 'debug' | 'detailed_debug'

export interface LiteLlmManagerSettings {
  host: string
  port: number
  configPath: string
  logLevel: LiteLlmLogLevel
  apiKey: string
}

export interface LiteLlmManagerSettingsInput {
  host: string
  port: number
  logLevel: LiteLlmLogLevel
  apiKey: string
}

export interface LiteLlmInstallStatus {
  pythonCommand: string | null
  pythonVersion: string | null
  installed: boolean
  currentVersion: string | null
  latestVersion: string | null
  hasUpdate: boolean
  error?: string
}

export interface LiteLlmManagerSnapshot {
  settings: LiteLlmManagerSettings
  install: LiteLlmInstallStatus
  running: boolean
  pid: number | null
  recentLogs: string[]
  configText: string
}

export interface LiteLlmModelEntry {
  id: string
  label: string
}

export type AgentHarnessId = 'codex' | 'claude-code' | 'gemini-cli' | 'opencode'
export type AgentSkillSourceKind = 'bundled' | 'imported'
export type AgentSkillInstallState = 'not-installed' | 'managed' | 'update-available' | 'unmanaged' | 'shared'

export interface AgentSkillSource {
  id: string
  name: string
  description: string
  kind: AgentSkillSourceKind
  contentHash: string
  fileCount: number
}

export interface InstalledAgentSkill {
  name: string
  description: string
  path: string
  managed: boolean
  sourceId: string | null
}

export interface AgentHarnessSnapshot {
  id: AgentHarnessId
  name: string
  command: string
  detected: boolean
  skillsDirectory: string
  installedSkills: InstalledAgentSkill[]
  sourceStates: Record<string, AgentSkillInstallState>
}

export interface AgentSkillsSnapshot {
  sources: AgentSkillSource[]
  harnesses: AgentHarnessSnapshot[]
  libraryDirectory: string
}

export interface ReleaseInfo {
  tagName: string
  name: string
  url: string
  publishedAt: string
  isNewer?: boolean
  assets: { name: string; downloadUrl: string; size: number }[]
  error?: string
}
export type RunningStatus = 'idle' | 'running' | 'error'
export interface CardState {
  template: Template
  status: RunningStatus
  pid?: number
  expanded: boolean
}
