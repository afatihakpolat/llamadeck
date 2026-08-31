import React, { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from './store/useStore'
import type { ThemeMode } from './store/useStore'
import { readStoredActiveBackendName } from './store/useStore'
import Titlebar from './components/Titlebar'
import Sidebar from './components/Sidebar'
import CreateModal from './components/CreateModal'
import UpdateBanner from './components/UpdateBanner'
import StartupStatusScreen from './components/StartupStatusScreen'
import ViewLoading from './components/ViewLoading'
import {
  AgentSkillsView,
  CardsView,
  ChatWindow,
  HuggingFaceView,
  LiteLlmView,
  LiveOutputView,
  ModelsView,
  SettingsView,
  UsageStatsView
} from './lazyViews'
import { buildDefaultTemplate } from './utils/defaultTemplate'
import {
  LLAMADECK_STORAGE_KEYS,
  readLlamaDeckStorage
} from './utils/storageMigration'
import { isCurrentModelExit } from './utils/modelLifecycle'
import {
  describeStartupFailure,
  loadInitialAppSnapshot,
  type StartupFailure
} from './utils/appInitialization'
import type { ModelOutputEvent, Template } from '../../shared/types'

const MODEL_OUTPUT_FLUSH_INTERVAL_MS = 50

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
  const [initialization, setInitialization] = React.useState<{
    status: 'loading' | 'ready' | 'error'
    failure: StartupFailure | null
  }>({ status: 'loading', failure: null })
  const initializationRun = React.useRef(0)

  const {
    view, showCreateModal, activeBackend,
    setBackends, setModels, setActiveBackend, setCommandsSchema,
    setCards, setPaths, setReleaseInfo, setCheckingUpdate,
    setHfDownload, removeHfDownload,
    upsertModelDownload, removeModelDownload,
    setAppUpdateState, setAppUpdatePreferences
  } = useStore(useShallow((state) => ({
    view: state.view,
    showCreateModal: state.showCreateModal,
    activeBackend: state.activeBackend,
    setBackends: state.setBackends,
    setModels: state.setModels,
    setActiveBackend: state.setActiveBackend,
    setCommandsSchema: state.setCommandsSchema,
    setCards: state.setCards,
    setPaths: state.setPaths,
    setReleaseInfo: state.setReleaseInfo,
    setCheckingUpdate: state.setCheckingUpdate,
    setHfDownload: state.setHfDownload,
    removeHfDownload: state.removeHfDownload,
    upsertModelDownload: state.upsertModelDownload,
    removeModelDownload: state.removeModelDownload,
    setAppUpdateState: state.setAppUpdateState,
    setAppUpdatePreferences: state.setAppUpdatePreferences
  })))

  const desktopApi = window.api as Window['api'] | undefined

  const checkUpdates = React.useCallback(async () => {
    if (!desktopApi) return
    setCheckingUpdate(true)
    try {
      const info = await desktopApi.checkUpdates()
      setReleaseInfo(info)
    } catch (error) {
      console.warn('Failed to check llama.cpp releases:', error)
    } finally {
      setCheckingUpdate(false)
    }
  }, [desktopApi, setCheckingUpdate, setReleaseInfo])

  const initializeApp = React.useCallback(async () => {
    const runId = ++initializationRun.current
    setInitialization({ status: 'loading', failure: null })

    try {
      const snapshot = await loadInitialAppSnapshot(desktopApi, readStoredActiveBackendName())
      if (runId !== initializationRun.current) return

      setPaths(snapshot.paths)
      setBackends(snapshot.backends)
      setModels(snapshot.models)
      setActiveBackend(snapshot.activeBackend)
      setCommandsSchema(snapshot.commandsSchema)

      const runningById = new Map(
        snapshot.runningModels.map((runningModel) => [runningModel.id, runningModel])
      )
      setCards(snapshot.templates.map((template: Template) => ({
        template,
        status: runningById.has(template.id) ? 'running' : 'idle',
        pid: runningById.get(template.id)?.pid,
        expanded: false
      })))
      setInitialization({ status: 'ready', failure: null })
      void checkUpdates()
    } catch (error) {
      if (runId !== initializationRun.current) return
      console.error('Initialization failed:', error)
      setInitialization({ status: 'error', failure: describeStartupFailure(error) })
    }
  }, [
    checkUpdates,
    desktopApi,
    setActiveBackend,
    setBackends,
    setCards,
    setCommandsSchema,
    setModels,
    setPaths
  ])

  useEffect(() => {
    void initializeApp()
  }, [initializeApp])

  useEffect(() => {
    if (!desktopApi) return

    desktopApi.onModelError((data) => {
      useStore.getState().setCardStatus(data.id, 'error')
      useStore.getState().pushNotification({
        tone: 'danger',
        title: 'Model execution failed',
        message: data.error
      })
    })

    return () => desktopApi.removeModelErrorListener()
  }, [desktopApi])

  useEffect(() => {
    if (!activeBackend || !desktopApi) return
    void desktopApi.setActiveBackendName(activeBackend.name).then((result) => {
      if (!result.success) {
        console.warn('Failed to persist the active backend:', result.error)
      }
    })
  }, [activeBackend, desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    desktopApi.onModelStarted((data) => {
      useStore.getState().setCardStatus(data.id, 'running', data.pid)
    })

    return () => desktopApi.removeModelStartedListener()
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    return desktopApi.onTemplatesChanged(async () => {
      const [templates, runningModels] = await Promise.all([
        desktopApi.listTemplates(),
        desktopApi.listRunningModels()
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
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    return desktopApi.onActiveBackendChanged(async ({ name }) => {
      const backends = await desktopApi.listBackends()
      const backend = backends.find((candidate) => candidate.name === name) ?? null
      const state = useStore.getState()
      state.setBackends(backends)
      state.setActiveBackend(backend)
      state.setCommandsSchema(backend ? await desktopApi.getCommands(backend.name) : null)
    })
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    let pendingEvents: ModelOutputEvent[] = []
    let flushTimer: number | null = null

    const flushPendingEvents = () => {
      flushTimer = null
      if (pendingEvents.length === 0) return

      const events = pendingEvents
      pendingEvents = []
      useStore.getState().appendModelOutputBatch(events)
    }

    desktopApi.onModelOutput((data) => {
      pendingEvents.push(data)
      if (flushTimer === null) {
        flushTimer = window.setTimeout(flushPendingEvents, MODEL_OUTPUT_FLUSH_INTERVAL_MS)
      }
    })

    return () => {
      desktopApi.removeModelOutputListener()
      if (flushTimer !== null) window.clearTimeout(flushTimer)
      flushPendingEvents()
    }
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    desktopApi.onModelExit((data) => {
      const state = useStore.getState()
      const currentCard = state.cards.find((card) => card.template.id === data.id)
      if (!isCurrentModelExit(currentCard?.pid, data)) return

      state.setCardStatus(data.id, data.code && data.code !== 0 ? 'error' : 'idle')
    })

    return () => desktopApi.removeModelExitListener()
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    desktopApi.onHfDownloadProgress(async (data) => {

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

        const models = await desktopApi.listModels()
        useStore.getState().setModels(models)

        setHfDownload({ repoId: '', filename: data.filename, percent: 100, phase: 'creating_template' })
        const { cards, activeBackend: backend, addCard: add } = useStore.getState()
        const template = buildDefaultTemplate(
          data.filename,
          data.destPath,
          cards.map(c => c.template),
          backend?.name || ''
        )
        const res = await desktopApi.saveTemplate(template)
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
    return () => desktopApi.removeHfDownloadListener()
  }, [desktopApi, removeHfDownload, setHfDownload, upsertModelDownload])

  useEffect(() => {
    if (!desktopApi) return
    desktopApi.onModelDownloadProgress(async (data) => {
      
      if (data.repoId) return
      upsertModelDownload(data)
      if (data.phase === 'done') {
        const models = await desktopApi.listModels()
        useStore.getState().setModels(models)
        
        const { cards, activeBackend: backend, addCard: add } = useStore.getState()
        const template = buildDefaultTemplate(
          data.filename,
          data.destPath,
          cards.map(c => c.template),
          backend?.name || ''
        )
        const res = await desktopApi.saveTemplate(template)
        if (res.success) add({ ...template, id: res.id })
        setTimeout(() => removeModelDownload(data.id), 4000)
      }
    })
    
    desktopApi.listModelDownloads().then(list => {
      list.forEach((download) => upsertModelDownload(download))
    })
    return () => desktopApi.removeModelDownloadListener()
  }, [desktopApi, removeModelDownload, upsertModelDownload])

  useEffect(() => {
    if (!activeBackend || !desktopApi) return
    desktopApi.getCommands(activeBackend.name).then((cmds) => {
      setCommandsSchema(cmds)
    })
  }, [activeBackend, desktopApi, setCommandsSchema])

  useEffect(() => {
    if (!desktopApi) return
    desktopApi.onDownloadProgress((data) => {
      useStore.getState().setDownloadProgress(data)
    })
    return () => desktopApi.removeDownloadListener()
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    void desktopApi.updateGetState().then((state) => {
      setAppUpdateState(state as any)
    })
    void desktopApi.updateGetPreferences().then((prefs) => {
      setAppUpdatePreferences(prefs as any)
    })
    const unsubscribe = desktopApi.onUpdateStateChanged((state) => {
      setAppUpdateState(state as any)
    })
    return unsubscribe
  }, [desktopApi, setAppUpdateState, setAppUpdatePreferences])

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

  if (initialization.status !== 'ready') {
    return (
      <StartupStatusScreen
        failure={initialization.failure}
        onRetry={() => void initializeApp()}
      />
    )
  }

  return (
    <div className="app">
      <Titlebar onCheckUpdates={checkUpdates} />
      <UpdateBanner />
      <div className="main-layout">
        <Sidebar />
        <main className="content">
          <React.Suspense fallback={<ViewLoading />}>
            {renderView()}
          </React.Suspense>
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
    return (
      <React.Suspense fallback={<StartupStatusScreen />}>
        <ChatWindow url={chatUrl} />
      </React.Suspense>
    )
  }

  return <MainApp />
}
