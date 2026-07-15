import { create } from 'zustand'
import type { AppView, Template, BackendVersion, CommandsSchema, ReleaseInfo, RunningStatus, ModelOutputEvent } from '../../../shared/types'
import type { UpdatePreferences, UpdateState } from '../../../shared/update'

export type ThemeMode = 'system' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'hexllama_theme'
const ACTIVE_BACKEND_STORAGE_KEY = 'hexllama_active_backend'

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'

  const storedValue = window.localStorage.getItem(THEME_STORAGE_KEY)
  return storedValue === 'light' || storedValue === 'dark' || storedValue === 'system'
    ? storedValue
    : 'system'
}

export function readStoredActiveBackendName(): string | null {
  if (typeof window === 'undefined') return null

  const storedValue = window.localStorage.getItem(ACTIVE_BACKEND_STORAGE_KEY)
  return storedValue?.trim() || null
}

interface CardState {
  template: Template
  status: RunningStatus
  pid?: number
  expanded: boolean
}
export interface ModelFileInfo {
  name: string; path: string; size: number; folder: string
}
export interface ModelDownloadInfo {
  id: string; url: string; filename: string; destPath: string
  receivedBytes: number; totalBytes: number
  phase: 'downloading' | 'paused' | 'done' | 'error' | 'cancelled'
  percent: number; repoId?: string; speed?: number
}
interface AppStore {
  cards: CardState[]
  backends: BackendVersion[]
  models: ModelFileInfo[]
  activeBackend: BackendVersion | null
  commandsSchema: CommandsSchema | null
  releaseInfo: ReleaseInfo | null
  paths: { models: string; templates: string; backend: string } | null
  view: AppView
  themeMode: ThemeMode
  showCreateModal: boolean
  editingTemplate: Template | null
  updateDismissed: boolean
  checkingUpdate: boolean
  downloadProgress: { percent: number; phase: string } | null
  appUpdateState: UpdateState | null
  appUpdatePreferences: UpdatePreferences | null
  templateSearch: string
  modelDownloads: Record<string, ModelDownloadInfo>
  modelOutput: Record<string, ModelOutputEvent[]>
  selectedModelOutputId: string | null
  hfDownloads: { repoId: string; filename: string; percent: number; phase: 'downloading' | 'paused' | 'saving' | 'creating_template' | 'done' | 'error' | 'starting'; speed?: number }[]
  hubQuery: string
  hubResults: any[]
  hubSelectedModelId: string | null
  setView: (v: AppView) => void
  setThemeMode: (themeMode: ThemeMode) => void
  setShowCreateModal: (show: boolean, template?: Template | null) => void
  setActiveBackend: (b: BackendVersion | null) => void
  setCommandsSchema: (s: CommandsSchema | null) => void
  setBackends: (b: BackendVersion[]) => void
  setModels: (m: ModelFileInfo[]) => void
  setCards: (c: CardState[]) => void
  setReleaseInfo: (r: ReleaseInfo | null) => void
  setPaths: (p: { models: string; templates: string; backend: string }) => void
  setUpdateDismissed: (v: boolean) => void
  setCheckingUpdate: (v: boolean) => void
  setDownloadProgress: (data: { percent: number; phase: string } | null) => void
  setAppUpdateState: (state: UpdateState | null) => void
  setAppUpdatePreferences: (prefs: UpdatePreferences | null) => void
  setTemplateSearch: (q: string) => void
  upsertModelDownload: (d: ModelDownloadInfo) => void
  removeModelDownload: (id: string) => void
  appendModelOutput: (event: ModelOutputEvent) => void
  clearModelOutput: (id: string) => void
  setSelectedModelOutputId: (id: string | null) => void
  focusModelOutput: (id: string) => void
  setHfDownload: (d: { repoId: string; filename: string; percent: number; phase: 'downloading' | 'paused' | 'saving' | 'creating_template' | 'done' | 'error' | 'starting'; speed?: number }) => void
  removeHfDownload: (filename: string) => void
  setHubQuery: (q: string) => void
  setHubResults: (r: any[]) => void
  setHubSelectedModelId: (id: string | null) => void
  addCard: (template: Template) => void
  updateCard: (id: string, template: Partial<Template>) => void
  removeCard: (id: string) => void
  setCardStatus: (id: string, status: RunningStatus, pid?: number) => void
  toggleCardExpanded: (id: string) => void
  collapseAllCards: () => void
}
export const useStore = create<AppStore>((set) => ({
  cards: [], backends: [], models: [], activeBackend: null,
  commandsSchema: null, releaseInfo: null, paths: null,
  view: 'cards', themeMode: getInitialThemeMode(), showCreateModal: false, editingTemplate: null,
  updateDismissed: false, checkingUpdate: false, downloadProgress: null,
  appUpdateState: null, appUpdatePreferences: null,
  templateSearch: '', modelDownloads: {}, modelOutput: {}, selectedModelOutputId: null, hfDownloads: [],
  hubQuery: '', hubResults: [], hubSelectedModelId: null,
  setView: (v) => set({ view: v }),
  setThemeMode: (themeMode) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)
    }

    set({ themeMode })
  },
  setShowCreateModal: (show, template = null) => set({ showCreateModal: show, editingTemplate: template }),
  setActiveBackend: (b) => {
    if (typeof window !== 'undefined') {
      if (b?.name) {
        window.localStorage.setItem(ACTIVE_BACKEND_STORAGE_KEY, b.name)
      } else {
        window.localStorage.removeItem(ACTIVE_BACKEND_STORAGE_KEY)
      }
    }

    set({ activeBackend: b })
  },
  setCommandsSchema: (s) => set({ commandsSchema: s }),
  setBackends: (b) => set({ backends: b }),
  setModels: (m) => set({ models: m }),
  setCards: (c) => set({ cards: c }),
  setReleaseInfo: (r) => set({ releaseInfo: r }),
  setPaths: (p) => set({ paths: p }),
  setUpdateDismissed: (v) => set({ updateDismissed: v }),
  setCheckingUpdate: (v) => set({ checkingUpdate: v }),
  setDownloadProgress: (data) => set({ downloadProgress: data }),
  setAppUpdateState: (state) => set({ appUpdateState: state }),
  setAppUpdatePreferences: (prefs) => set({ appUpdatePreferences: prefs }),
  setTemplateSearch: (q) => set({ templateSearch: q }),
  upsertModelDownload: (d) => set((s) => ({ modelDownloads: { ...s.modelDownloads, [d.id]: d } })),
  removeModelDownload: (id) => set((s) => {
    const next = { ...s.modelDownloads }; delete next[id]; return { modelDownloads: next }
  }),
  appendModelOutput: (event) => set((s) => {
    const nextEntries = [...(s.modelOutput[event.id] || []), event]

    return {
      modelOutput: {
        ...s.modelOutput,
        [event.id]: nextEntries.slice(-400)
      },
      selectedModelOutputId: s.selectedModelOutputId || event.id
    }
  }),
  clearModelOutput: (id) => set((s) => {
    const nextOutput = { ...s.modelOutput }
    delete nextOutput[id]

    return {
      modelOutput: nextOutput,
      selectedModelOutputId: s.selectedModelOutputId === id ? null : s.selectedModelOutputId
    }
  }),
  setSelectedModelOutputId: (id) => set({ selectedModelOutputId: id }),
  focusModelOutput: (id) => set({ selectedModelOutputId: id }),
  setHfDownload: (d) => set((s) => {
    const arr = s.hfDownloads.filter(x => x.filename !== d.filename)
    return { hfDownloads: [...arr, d] }
  }),
  removeHfDownload: (filename) => set((s) => ({ hfDownloads: s.hfDownloads.filter(x => x.filename !== filename) })),
  setHubQuery: (q) => set({ hubQuery: q }),
  setHubResults: (r) => set({ hubResults: r }),
  setHubSelectedModelId: (id) => set({ hubSelectedModelId: id }),
  addCard: (template) => set((s) => ({ cards: [...s.cards, { template, status: 'idle', expanded: false }] })),
  updateCard: (id, partial) => set((s) => ({
    cards: s.cards.map(c => c.template.id === id ? { ...c, template: { ...c.template, ...partial, updatedAt: new Date().toISOString() } } : c)
  })),
  removeCard: (id) => set((s) => {
    const nextOutput = { ...s.modelOutput }
    delete nextOutput[id]

    return {
      cards: s.cards.filter(c => c.template.id !== id),
      modelOutput: nextOutput,
      selectedModelOutputId: s.selectedModelOutputId === id ? null : s.selectedModelOutputId
    }
  }),
  setCardStatus: (id, status, pid) => set((s) => ({
    cards: s.cards.map(c => c.template.id === id ? { ...c, status, pid: pid ?? c.pid } : c)
  })),
  toggleCardExpanded: (id) => set((s) => ({
    cards: s.cards.map(c => c.template.id === id ? { ...c, expanded: !c.expanded } : c)
  })),
  collapseAllCards: () => set((s) => ({ cards: s.cards.map(c => ({ ...c, expanded: false })) }))
}))
