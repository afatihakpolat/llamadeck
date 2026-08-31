import { describe, expect, it, vi } from 'vitest'
import type { BackendVersion } from '../../../shared/types'
import {
  AppInitializationError,
  describeStartupFailure,
  loadInitialAppSnapshot,
  type InitialAppApi
} from '../utils/appInitialization'

const backends: BackendVersion[] = [
  {
    name: 'b1000',
    displayName: 'Build 1000',
    flavor: 'cuda',
    buildMode: 'parallel',
    path: 'C:\\backends\\b1000',
    hasCommands: true,
    exe: 'C:\\backends\\b1000\\llama-server.exe'
  },
  {
    name: 'b2000-cpu',
    displayName: 'Build 2000 CPU',
    flavor: 'cpu',
    buildMode: null,
    path: 'C:\\backends\\b2000-cpu',
    hasCommands: true,
    exe: 'C:\\backends\\b2000-cpu\\llama-server.exe'
  }
]

function createApi(overrides: Partial<InitialAppApi> = {}): InitialAppApi {
  return {
    getPaths: vi.fn().mockResolvedValue({
      models: 'C:\\models',
      templates: 'C:\\templates',
      backend: 'C:\\backends'
    }),
    listBackends: vi.fn().mockResolvedValue(backends),
    listModels: vi.fn().mockResolvedValue([]),
    getActiveBackendName: vi.fn().mockResolvedValue(null),
    listTemplates: vi.fn().mockResolvedValue([]),
    listRunningModels: vi.fn().mockResolvedValue([]),
    getCommands: vi.fn().mockResolvedValue({ version: '1.0', categories: [] }),
    ...overrides
  }
}

describe('loadInitialAppSnapshot', () => {
  it('loads independent startup data and honors the persisted active backend', async () => {
    const api = createApi({
      getActiveBackendName: vi.fn().mockResolvedValue('b2000-cpu')
    })

    const snapshot = await loadInitialAppSnapshot(api, 'b1000')

    expect(snapshot.activeBackend?.name).toBe('b2000-cpu')
    expect(api.getCommands).toHaveBeenCalledWith('b2000-cpu')
    expect(api.getPaths).toHaveBeenCalledOnce()
    expect(api.listBackends).toHaveBeenCalledOnce()
    expect(api.listModels).toHaveBeenCalledOnce()
    expect(api.listTemplates).toHaveBeenCalledOnce()
    expect(api.listRunningModels).toHaveBeenCalledOnce()
  })

  it('falls back to the first installed backend when the saved one is stale', async () => {
    const api = createApi()

    const snapshot = await loadInitialAppSnapshot(api, 'missing-build')

    expect(snapshot.activeBackend?.name).toBe('b1000')
    expect(api.getCommands).toHaveBeenCalledWith('b1000')
  })

  it('labels the startup stage that failed', async () => {
    const api = createApi({
      listTemplates: vi.fn().mockRejectedValue(new Error('templates.json is locked'))
    })

    await expect(loadInitialAppSnapshot(api, null)).rejects.toMatchObject({
      name: 'AppInitializationError',
      stage: 'Templates'
    })

    const failure = describeStartupFailure(
      new AppInitializationError('Templates', new Error('templates.json is locked'))
    )
    expect(failure).toMatchObject({
      stage: 'Templates',
      message: 'templates.json is locked'
    })
    expect(failure.details).toContain('AppInitializationError')
  })

  it('reports a missing preload bridge as a recoverable startup failure', async () => {
    await expect(loadInitialAppSnapshot(undefined, null)).rejects.toMatchObject({
      stage: 'Secure app bridge'
    })
  })
})
