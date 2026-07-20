import React, { useEffect } from 'react'
import { useStore } from './store/useStore'
import type { ThemeMode } from './store/useStore'
import { readStoredActiveBackendName } from './store/useStore'
import Titlebar from './components/Titlebar'
import Sidebar from './components/Sidebar'
import CardsView from './components/CardsView'
import SettingsView from './components/SettingsView'
import HuggingFaceView from './components/HuggingFaceView'
import ModelsView from './components/ModelsView'
import LiteLlmView from './components/LiteLlmView'
import AgentSkillsView from './components/AgentSkillsView'
import LiveOutputView from './components/LiveOutputView'
import UsageStatsView from './components/UsageStatsView'
import CreateModal from './components/CreateModal'
import UpdateBanner from './components/UpdateBanner'
import ChatWindow from './components/ChatWindow'
import { buildDefaultTemplate } from './utils/defaultTemplate'
import {
  LLAMADECK_STORAGE_KEYS,
  readLlamaDeckStorage
} from './utils/storageMigration'
import type { Template } from '../../shared/types'

function resolveThemeMode(themeMode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (themeMode === 'system') {
    return prefersDark ? 'dark' : 'light'
  }

  return themeMode
}

function readStoredThemeMode(): ThemeMode {
  const storedValue = readLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.theme)
  return storedValue === 'light' || storedValue === 'dark' || storedValue === 'system'
    ? storedValue
    : 'system'
}

function applyTheme(themeMode: ThemeMode): void {
  const resolvedTheme = resolveThemeMode(themeMode, window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = resolvedTheme
  document.documentElement.style.colorScheme = resolvedTheme
}

function MainApp() {
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  const {
    view, showCreateModal, activeBackend,
    setBackends, setModels, setActiveBackend, setCommandsSchema,
    setCards, setPaths, setReleaseInfo, setCheckingUpdate,
    setHfDownload, removeHfDownload, addCard, appendModelOutput,
    upsertModelDownload, removeModelDownload,
    setAppUpdateState, setAppUpdatePreferences
  } = useStore()

  useEffect(() => {
    async function init() {
      try {
        const [paths, backendsData, modelsData, persistedActiveBackendName] = await Promise.all([
          window.api.getPaths(),
          window.api.listBackends(),
          window.api.listModels(),
          window.api.getActiveBackendName()
        ])
        setPaths(paths)
        setBackends(backendsData)
        setModels(modelsData)
        if (backendsData.length > 0) {
          const storedActiveBackendName = persistedActiveBackendName ?? readStoredActiveBackendName()
          const nextActiveBackend = (storedActiveBackendName
            ? backendsData.find((backend) => backend.name === storedActiveBackendName)
            : undefined) ?? backendsData[0]

          setActiveBackend(nextActiveBackend)
          const cmds = await window.api.getCommands(nextActiveBackend.name)
          setCommandsSchema(cmds)
        } else {
          const cmds = await window.api.getCommands('')
          setCommandsSchema(cmds)
        }
        const [templates, runningModels] = await Promise.all([
          window.api.listTemplates(),
          window.api.listRunningModels()
        ])
        const runningById = new Map(runningModels.map((runningModel) => [runningModel.id, runningModel]))
        setCards(
          (templates as Template[]).map((t) => ({
            template: t,
            status: runningById.has(t.id) ? 'running' : 'idle',
            pid: runningById.get(t.id)?.pid,
            expanded: false
          }))
        )
      } catch (e) {
        console.error('Init error:', e)
      }
      checkUpdates()
    }
    init()
    window.api.onModelError((data) => {
      useStore.getState().setCardStatus(data.id, 'error')
      alert(`Model execution error:\n\n${data.error}`)
    })
  }, [])

  useEffect(() => {
    if (!activeBackend) return
    void window.api.setActiveBackendName(activeBackend.name).then((result) => {
      if (!result.success) {
        console.warn('Failed to persist the active backend:', result.error)
      }
    })
  }, [activeBackend])

  useEffect(() => {
    window.api.onModelStarted((data) => {
      useStore.getState().setCardStatus(data.id, 'running', data.pid)
    })

    return () => window.api.removeModelStartedListener()
  }, [])

  useEffect(() => {
    return window.api.onTemplatesChanged(async () => {
      const [templates, runningModels] = await Promise.all([
        window.api.listTemplates(),
        window.api.listRunningModels()
      ])
      const state = useStore.getState()
      const existingCards = new Map(state.cards.map((card) => [card.template.id, card]))
      const runningById = new Map(runningModels.map((runningModel) => [runningModel.id, runningModel]))

      state.setCards(templates.map((template) => {
        const existing = existingCards.get(template.id)
        const running = runningById.get(template.id)
        return {
          template,
          status: running ? 'running' : existing?.status === 'error' ? 'error' : 'idle',
          ...(running?.pid === undefined ? {} : { pid: running.pid }),
          expanded: existing?.expanded ?? false
        }
      }))
    })
  }, [])

  useEffect(() => {
    return window.api.onActiveBackendChanged(async ({ name }) => {
      const backends = await window.api.listBackends()
      const backend = backends.find((candidate) => candidate.name === name) ?? null
      const state = useStore.getState()
      state.setBackends(backends)
      state.setActiveBackend(backend)
      state.setCommandsSchema(backend ? await window.api.getCommands(backend.name) : null)
    })
  }, [])

  useEffect(() => {
    window.api.onModelOutput((data) => {
      appendModelOutput(data)
    })

    return () => window.api.removeModelOutputListener()
  }, [appendModelOutput])

  useEffect(() => {
    window.api.onModelExit((data) => {
      useStore.getState().setCardStatus(data.id, data.code && data.code !== 0 ? 'error' : 'idle')
    })

    return () => window.api.removeModelExitListener()
  }, [])

  useEffect(() => {
    window.api.onHfDownloadProgress(async (data) => {

      upsertModelDownload({
        id: (data as any).id || data.filename,
        url: '',
        filename: data.filename,
        destPath: data.destPath,
        receivedBytes: (data as any).receivedBytes ?? 0,
        totalBytes: (data as any).totalBytes ?? 0,
        speed: (data as any).speed ?? 0,
        percent: data.percent,
        phase: data.phase as any,
        repoId: (data as any).repoId
      })

      if (data.phase === 'done') {
        
        setHfDownload({ repoId: '', filename: data.filename, percent: 100, phase: 'saving' })

        const models = await window.api.listModels()
        useStore.getState().setModels(models)

        setHfDownload({ repoId: '', filename: data.filename, percent: 100, phase: 'creating_template' })
        const { cards, activeBackend: backend, addCard: add } = useStore.getState()
        const template = buildDefaultTemplate(
          data.filename,
          data.destPath,
          cards.map(c => c.template),
          backend?.name || ''
        )
        const res = await window.api.saveTemplate(template)
        if (res.success) add({ ...template, id: res.id })

        setHfDownload({ repoId: '', filename: data.filename, percent: 100, phase: 'done' })
        setTimeout(() => removeHfDownload(data.filename), 2500)
      } else {
        
        setHfDownload({
          repoId: '',
          filename: data.filename,
          percent: data.percent,
          phase: data.phase as any,
          speed: (data as any).speed
        })
      }
    })
    return () => window.api.removeHfDownloadListener()
  }, [])

  useEffect(() => {
    window.api.onModelDownloadProgress(async (data: any) => {
      
      if (data.repoId) return
      upsertModelDownload(data)
      if (data.phase === 'done') {
        const models = await window.api.listModels()
        useStore.getState().setModels(models)
        
        const { cards, activeBackend: backend, addCard: add } = useStore.getState()
        const template = buildDefaultTemplate(
          data.filename,
          data.destPath,
          cards.map(c => c.template),
          backend?.name || ''
        )
        const res = await window.api.saveTemplate(template)
        if (res.success) add({ ...template, id: res.id })
        setTimeout(() => removeModelDownload(data.id), 4000)
      }
    })
    
    window.api.listModelDownloads().then(list => {
      list.forEach((dl: any) => upsertModelDownload(dl))
    })
    return () => window.api.removeModelDownloadListener()
  }, [])

  useEffect(() => {
    if (!activeBackend) return
    window.api.getCommands(activeBackend.name).then((cmds) => {
      setCommandsSchema(cmds)
    })
  }, [activeBackend, setCommandsSchema])

  useEffect(() => {
    window.api.onDownloadProgress((data) => {
      useStore.getState().setDownloadProgress(data)
    })
    return () => window.api.removeDownloadListener()
  }, [])

  useEffect(() => {
    void window.api.updateGetState().then((state) => {
      setAppUpdateState(state as any)
    })
    void window.api.updateGetPreferences().then((prefs) => {
      setAppUpdatePreferences(prefs as any)
    })
    const unsubscribe = window.api.onUpdateStateChanged((state) => {
      setAppUpdateState(state as any)
    })
    return unsubscribe
  }, [setAppUpdateState, setAppUpdatePreferences])

  async function checkUpdates() {
    setCheckingUpdate(true)
    try {
      const info = await window.api.checkUpdates()
      setReleaseInfo(info)
    } finally {
      setCheckingUpdate(false)
    }
  }

  function renderView() {
    if (view === 'hub') return <HuggingFaceView />
    if (view === 'settings') return <SettingsView />
    if (view === 'litellm') return <LiteLlmView />
    if (view === 'agent-skills') return <AgentSkillsView />
    if (view === 'models') return <ModelsView />
    if (view === 'live-output') return <LiveOutputView />
    if (view === 'usage-stats') return <UsageStatsView />
    return <CardsView />
  }

  if (loading) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text)'
      }}>
        <img src="./icon.png" alt="LlamaDeck Icon" className="brand-logo-img" style={{ width: 128, height: 128, marginBottom: 24, imageRendering: 'crisp-edges' }} draggable={false} />
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12, color: 'var(--text-secondary)' }}>LlamaDeck</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '0.5px' }}>All AI-Glory to the Llama.cpp</h2>
      </div>
    )
  }

  return (
    <div className="app">
      <Titlebar onCheckUpdates={checkUpdates} />
      <UpdateBanner />
      <div className="main-layout">
        <Sidebar />
        <main className="content">
          {renderView()}
        </main>
      </div>
      {showCreateModal && <CreateModal />}
    </div>
  )
}

export default function App() {
  const searchParams = new URLSearchParams(window.location.search)
  const chatUrl = searchParams.get('chat_url')
  const themeMode = useStore((state) => state.themeMode)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const syncTheme = (nextThemeMode: ThemeMode) => {
      applyTheme(nextThemeMode)
    }

    const handleSystemThemeChange = () => {
      if (themeMode === 'system') {
        syncTheme(themeMode)
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LLAMADECK_STORAGE_KEYS.theme) {
        const nextThemeMode = readStoredThemeMode()
        useStore.setState({ themeMode: nextThemeMode })
        syncTheme(nextThemeMode)
      }
    }

    syncTheme(themeMode)
    window.addEventListener('storage', handleStorage)

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange)
      return () => {
        mediaQuery.removeEventListener('change', handleSystemThemeChange)
        window.removeEventListener('storage', handleStorage)
      }
    }

    mediaQuery.addListener(handleSystemThemeChange)
    return () => {
      mediaQuery.removeListener(handleSystemThemeChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [themeMode])

  if (chatUrl) {
    return <ChatWindow url={chatUrl} />
  }

  return <MainApp />
}
