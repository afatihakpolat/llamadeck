export interface ModelFile {
  name: string
  path: string
}

export type BackendBuildFlavor = 'cuda' | 'cpu'
export type BackendBuildMode = 'single' | 'parallel'

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
export interface UsageCostSettings {
  currency: string
  inputCostPerMillion: number
  cacheCostPerMillion: number
  outputCostPerMillion: number
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
