import type { Template, BackendVersion, BackendBuildFlavor, CommandsSchema, LiteLlmInstallStatus, LiteLlmManagerSettingsInput, LiteLlmManagerSnapshot, LiteLlmModelEntry, ReleaseInfo, AppWindowBehaviorSettings, ModelExitEvent, ModelOutputEvent, ModelStartedEvent, UsageCostSettings, UsageStatsQuery, UsageStatsSnapshot, UsageUpdatedEvent } from '../../shared/types'
interface ModelFileInfo {
  name: string
  path: string
  size: number
  folder: string
}
interface ModelDownloadInfo {
  id: string
  url: string
  filename: string
  destPath: string
  receivedBytes: number
  totalBytes: number
  phase: 'downloading' | 'paused' | 'done' | 'error' | 'cancelled'
  percent: number
  speed?: number
  repoId?: string
}
interface HfModelResult {
  id: string; author: string; name: string
  downloads: number; likes: number; tags: string[]; lastModified: string
}
interface HfFileResult { name: string; size: number; downloadUrl: string }
interface AppPaths {
  models: string
  templates: string
  backend: string
}
interface FilesystemSnapshot {
  paths: AppPaths
  models: ModelFileInfo[]
  backends: BackendVersion[]
}
interface BackendSourceUpdateResult {
  snapshot: FilesystemSnapshot
  templates: Template[]
  activeBackendName: string
}
interface LlamaCppApi {
  getLiteLlmManager: () => Promise<LiteLlmManagerSnapshot>
  saveLiteLlmManagerSettings: (settings: LiteLlmManagerSettingsInput) => Promise<{ success: true; snapshot: LiteLlmManagerSnapshot } | { success: false; error?: string }>
  saveLiteLlmConfig: (configText: string) => Promise<{ success: true; snapshot: LiteLlmManagerSnapshot } | { success: false; error?: string }>
  installLiteLlm: () => Promise<{ success: true; snapshot: LiteLlmManagerSnapshot; output: string } | { success: false; error?: string; output?: string; install?: LiteLlmInstallStatus }>
  updateLiteLlm: () => Promise<{ success: true; snapshot: LiteLlmManagerSnapshot; output: string } | { success: false; error?: string; output?: string; install?: LiteLlmInstallStatus }>
  startLiteLlmProxy: () => Promise<{ success: true; snapshot: LiteLlmManagerSnapshot } | { success: false; error?: string; snapshot?: LiteLlmManagerSnapshot }>
  stopLiteLlmProxy: () => Promise<{ success: true; snapshot: LiteLlmManagerSnapshot } | { success: false; error?: string; snapshot?: LiteLlmManagerSnapshot }>
  testLiteLlmConnection: () => Promise<{ success: true; modelCount: number } | { success: false; error?: string }>
  listLiteLlmModels: () => Promise<{ success: true; models: LiteLlmModelEntry[] } | { success: false; error?: string }>
  onLiteLlmManagerChanged: (cb: (data: { at: string }) => void) => () => void
  listModels: () => Promise<ModelFileInfo[]>
  deleteModel: (filePath: string) => Promise<{ success: boolean; error?: string }>
  renameModel: (oldPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
  startModelDownload: (opts: { url: string; filename: string; repoId?: string; modelFolder?: string }) => Promise<{ success: boolean; id?: string; error?: string }>
  pauseModelDownload: (id: string) => Promise<{ success: boolean; error?: string }>
  resumeModelDownload: (id: string) => Promise<{ success: boolean; error?: string }>
  cancelModelDownload: (id: string) => Promise<{ success: boolean; error?: string }>
  listModelDownloads: () => Promise<ModelDownloadInfo[]>
  onModelDownloadProgress: (cb: (data: ModelDownloadInfo) => void) => void
  removeModelDownloadListener: () => void
  listBackends: () => Promise<BackendVersion[]>
  getActiveBackendName: () => Promise<string | null>
  setActiveBackendName: (name: string) => Promise<{ success: boolean; name?: string; error?: string }>
  deleteBackend: (name: string) => Promise<{ success: boolean; error?: string }>
  getCommands: (backendName: string) => Promise<CommandsSchema | null>
  saveBackendCommands: (backendName: string, schema: object) => Promise<{ success: boolean; error?: string }>
  listTemplates: () => Promise<Template[]>
  listRunningModels: () => Promise<ModelStartedEvent[]>
  onTemplatesChanged: (cb: (data: { at: string }) => void) => () => void
  onActiveBackendChanged: (cb: (data: { name: string }) => void) => () => void
  getTemplate: (id: string) => Promise<Template | null>
  getUsageStats: (query?: Partial<UsageStatsQuery>) => Promise<UsageStatsSnapshot>
  getUsageCostSettings: () => Promise<UsageCostSettings>
  saveTemplate: (template: object) => Promise<{ success: boolean; id: string }>
  deleteTemplate: (id: string) => Promise<{ success: boolean }>
  importTemplate: () => Promise<Template | null>
  exportTemplate: (template: object) => Promise<{ success: boolean }>
  pickModelFile: () => Promise<{ name: string; path: string } | null>
  runModel: (opts: { id: string; backendPath: string; exe: string; args: string[]; openBrowser: boolean; port: number }) => Promise<{ success: boolean; pid?: number; error?: string }>
  stopModel: (id: string) => Promise<{ success: boolean; error?: string }>
  onModelStarted: (cb: (data: ModelStartedEvent) => void) => void
  removeModelStartedListener: () => void
  onModelOutput: (cb: (data: ModelOutputEvent) => void) => void
  removeModelOutputListener: () => void
  onModelExit: (cb: (data: ModelExitEvent) => void) => void
  removeModelExitListener: () => void
  onModelError: (cb: (data: { id: string; error: string }) => void) => void
  onUsageUpdated: (cb: (data: UsageUpdatedEvent) => void) => () => void
  removeUsageUpdatedListener: () => void
  checkUpdates: () => Promise<ReleaseInfo>
  getAppVersion: () => Promise<{ version?: string; error?: string }>
  updateBackendSource: (tagName?: string, flavor?: BackendBuildFlavor) => Promise<{ success: true; result: BackendSourceUpdateResult } | { success: false; error?: string; cancelled?: boolean }>
  downloadRelease: (opts: { url: string; version: string; assetName: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  cancelBackendDownload: () => Promise<{ success: boolean }>
  onDownloadProgress: (callback: (data: { percent: number; phase: string }) => void) => void
  removeDownloadListener: () => void
  hfSearch: (query: string) => Promise<HfModelResult[] | { error: string }>
  hfGetFiles: (repoId: string) => Promise<HfFileResult[] | { error: string }>
  hfDownloadModel: (opts: { repoId: string; filename: string; downloadUrl: string }) => Promise<{ success: boolean; error?: string }>
  hfOpenModelsDir: () => Promise<void>
  onHfDownloadProgress: (callback: (data: { percent: number; phase: string; filename: string; destPath: string; speed?: number }) => void) => void
  removeHfDownloadListener: () => void
  openFolder: (path: string) => Promise<void>
  getPaths: () => Promise<AppPaths>
  chooseAppFolder: (kind: 'models' | 'backend') => Promise<string | null>
  setAppFolder: (kind: 'models' | 'backend', path: string) => Promise<{ success: true; snapshot: FilesystemSnapshot } | { success: false; error?: string }>
  openExternal: (url: string) => Promise<void>
  openChatWindow: (port: number) => Promise<void>
  getAppWindowBehaviorSettings: () => Promise<AppWindowBehaviorSettings>
  saveAppWindowBehaviorSettings: (settings: Partial<AppWindowBehaviorSettings>) => Promise<{ success: true; settings: AppWindowBehaviorSettings } | { success: false; error?: string }>
  saveUsageCostSettings: (settings: Partial<UsageCostSettings>) => Promise<{ success: true; settings: UsageCostSettings } | { success: false; error?: string }>
}
declare global {
  interface Window { api: LlamaCppApi }
}
