import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
const api = {
  getLiteLlmManager: () => ipcRenderer.invoke('get-litellm-manager'),
  saveLiteLlmManagerSettings: (settings: object) => ipcRenderer.invoke('save-litellm-manager-settings', settings),
  saveLiteLlmConfig: (configText: string) => ipcRenderer.invoke('save-litellm-config', configText),
  installLiteLlm: () => ipcRenderer.invoke('install-litellm'),
  updateLiteLlm: () => ipcRenderer.invoke('update-litellm'),
  startLiteLlmProxy: () => ipcRenderer.invoke('start-litellm-proxy'),
  stopLiteLlmProxy: () => ipcRenderer.invoke('stop-litellm-proxy'),
  testLiteLlmConnection: () => ipcRenderer.invoke('test-litellm-connection'),
  listLiteLlmModels: () => ipcRenderer.invoke('list-litellm-models'),
  listModels: () => ipcRenderer.invoke('list-models'),
  deleteModel: (filePath: string) => ipcRenderer.invoke('delete-model', filePath),
  renameModel: (oldPath: string, newName: string) => ipcRenderer.invoke('rename-model', oldPath, newName),
  startModelDownload: (opts: object) => ipcRenderer.invoke('start-model-download', opts),
  pauseModelDownload: (id: string) => ipcRenderer.invoke('pause-model-download', id),
  resumeModelDownload: (id: string) => ipcRenderer.invoke('resume-model-download', id),
  cancelModelDownload: (id: string) => ipcRenderer.invoke('cancel-model-download', id),
  listModelDownloads: () => ipcRenderer.invoke('list-model-downloads'),
  onModelDownloadProgress: (cb: (data: object) => void) => {
    ipcRenderer.removeAllListeners('model-download-progress')
    ipcRenderer.on('model-download-progress', (_e, data) => cb(data))
  },
  removeModelDownloadListener: () => ipcRenderer.removeAllListeners('model-download-progress'),
  listBackends: () => ipcRenderer.invoke('list-backends'),
  getActiveBackendName: () => ipcRenderer.invoke('get-active-backend-name'),
  setActiveBackendName: (name: string) => ipcRenderer.invoke('set-active-backend-name', name),
  deleteBackend: (name: string) => ipcRenderer.invoke('delete-backend', name),
  getCommands: (backendName: string) => ipcRenderer.invoke('get-commands', backendName),
  saveBackendCommands: (backendName: string, schema: object) => ipcRenderer.invoke('save-backend-commands', backendName, schema),
  listTemplates: () => ipcRenderer.invoke('list-templates'),
  listRunningModels: () => ipcRenderer.invoke('list-running-models'),
  onTemplatesChanged: (cb: (data: { at: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: { at: string }) => cb(data)
    ipcRenderer.on('templates-changed', listener)
    return () => ipcRenderer.removeListener('templates-changed', listener)
  },
  onActiveBackendChanged: (cb: (data: { name: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: { name: string }) => cb(data)
    ipcRenderer.on('active-backend-changed', listener)
    return () => ipcRenderer.removeListener('active-backend-changed', listener)
  },
  getTemplate: (id: string) => ipcRenderer.invoke('get-template', id),
  getUsageStats: (query?: object) => ipcRenderer.invoke('get-usage-stats', query),
  getUsageCostSettings: () => ipcRenderer.invoke('get-usage-cost-settings'),
  saveTemplate: (template: object) => ipcRenderer.invoke('save-template', template),
  deleteTemplate: (id: string) => ipcRenderer.invoke('delete-template', id),
  importTemplate: () => ipcRenderer.invoke('import-template'),
  exportTemplate: (template: object) => ipcRenderer.invoke('export-template', template),
  pickModelFile: () => ipcRenderer.invoke('pick-model-file'),
  runModel: (opts: object) => ipcRenderer.invoke('run-model', opts),
  stopModel: (id: string) => ipcRenderer.invoke('stop-model', id),
  onModelStarted: (cb: (data: { id: string; pid?: number }) => void) => {
    ipcRenderer.removeAllListeners('model-started')
    ipcRenderer.on('model-started', (_e, data) => cb(data))
  },
  removeModelStartedListener: () => ipcRenderer.removeAllListeners('model-started'),
  onModelOutput: (cb: (data: { id: string; stream: 'stdout' | 'stderr' | 'system'; text: string; timestamp: string }) => void) => {
    ipcRenderer.removeAllListeners('model-output')
    ipcRenderer.on('model-output', (_e, data) => cb(data))
  },
  removeModelOutputListener: () => ipcRenderer.removeAllListeners('model-output'),
  onModelExit: (cb: (data: { id: string; code: number | null; signal: string | null }) => void) => {
    ipcRenderer.removeAllListeners('model-exit')
    ipcRenderer.on('model-exit', (_e, data) => cb(data))
  },
  removeModelExitListener: () => ipcRenderer.removeAllListeners('model-exit'),
  onModelError: (cb: (data: { id: string; error: string }) => void) => {
    ipcRenderer.removeAllListeners('model-error')
    ipcRenderer.on('model-error', (_e, data) => cb(data))
  },
  onUsageUpdated: (cb: (data: { at: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: { at: string }) => cb(data)
    ipcRenderer.on('usage-updated', listener)

    return () => {
      ipcRenderer.removeListener('usage-updated', listener)
    }
  },
  removeUsageUpdatedListener: () => ipcRenderer.removeAllListeners('usage-updated'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  updateBackendSource: (tagName?: string, flavor?: 'cuda' | 'cpu') => ipcRenderer.invoke('update-backend-source', tagName, flavor),
  downloadRelease: (opts: object) => ipcRenderer.invoke('download-release', opts),
  cancelBackendDownload: () => ipcRenderer.invoke('cancel-backend-download'),
  onDownloadProgress: (callback: (data: { percent: number; phase: string }) => void) => {
    ipcRenderer.removeAllListeners('download-progress')
    ipcRenderer.on('download-progress', (_event, data) => callback(data))
  },
  removeDownloadListener: () => ipcRenderer.removeAllListeners('download-progress'),
  hfSearch: (query: string) => ipcRenderer.invoke('hf-search', query),
  hfGetFiles: (repoId: string) => ipcRenderer.invoke('hf-get-files', repoId),
  hfDownloadModel: (opts: object) => ipcRenderer.invoke('hf-download-model', opts),
  hfOpenModelsDir: () => ipcRenderer.invoke('hf-open-models-dir'),
  onHfDownloadProgress: (callback: (data: { percent: number; phase: string; filename: string; destPath: string }) => void) => {
    ipcRenderer.removeAllListeners('hf-download-progress')
    ipcRenderer.on('hf-download-progress', (_event, data) => callback(data))
  },
  removeHfDownloadListener: () => ipcRenderer.removeAllListeners('hf-download-progress'),
  openFolder: (path: string) => ipcRenderer.invoke('open-folder', path),
  getPaths: () => ipcRenderer.invoke('get-paths'),
  chooseAppFolder: (kind: 'models' | 'backend') => ipcRenderer.invoke('choose-app-folder', kind),
  setAppFolder: (kind: 'models' | 'backend', path: string) => ipcRenderer.invoke('set-app-folder', kind, path),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openChatWindow: (port: number) => ipcRenderer.invoke('open-chat-window', port),
  getAppWindowBehaviorSettings: () => ipcRenderer.invoke('get-app-window-behavior-settings'),
  saveAppWindowBehaviorSettings: (settings: object) => ipcRenderer.invoke('save-app-window-behavior-settings', settings),
  saveUsageCostSettings: (settings: object) => ipcRenderer.invoke('save-usage-cost-settings', settings),
  updateGetState: () => ipcRenderer.invoke('update:get-state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstallAndRestart: () => ipcRenderer.invoke('update:install-and-restart'),
  updateGetPreferences: () => ipcRenderer.invoke('update:get-preferences'),
  updateSetPreferences: (prefs: object) => ipcRenderer.invoke('update:set-preferences', prefs),
  onUpdateStateChanged: (cb: (data: object) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: object) => cb(data)
    ipcRenderer.on('update:state-changed', listener)
    return () => { ipcRenderer.removeListener('update:state-changed', listener) }
  }
}
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
