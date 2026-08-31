import type { BackendVersion, CommandsSchema, ModelStartedEvent, Template } from '../../../shared/types'
import type { ModelFileInfo } from '../store/useStore'
import { getErrorMessage } from './notifications'

export type StartupStage =
  | 'Secure app bridge'
  | 'Storage folders'
  | 'Backends'
  | 'Models'
  | 'Active backend'
  | 'Templates'
  | 'Running sessions'
  | 'Backend commands'

export interface InitialAppSnapshot {
  paths: { models: string; templates: string; backend: string }
  backends: BackendVersion[]
  models: ModelFileInfo[]
  activeBackend: BackendVersion | null
  commandsSchema: CommandsSchema | null
  templates: Template[]
  runningModels: ModelStartedEvent[]
}

export interface StartupFailure {
  stage: StartupStage
  message: string
  details: string
}

export type InitialAppApi = Pick<
  Window['api'],
  | 'getPaths'
  | 'listBackends'
  | 'listModels'
  | 'getActiveBackendName'
  | 'listTemplates'
  | 'listRunningModels'
  | 'getCommands'
>

export class AppInitializationError extends Error {
  constructor(
    readonly stage: StartupStage,
    readonly originalError: unknown
  ) {
    super(`${stage}: ${getErrorMessage(originalError)}`)
    this.name = 'AppInitializationError'
  }
}

async function loadStage<T>(stage: StartupStage, operation: Promise<T>): Promise<T> {
  try {
    return await operation
  } catch (error) {
    throw new AppInitializationError(stage, error)
  }
}

export async function loadInitialAppSnapshot(
  api: InitialAppApi | undefined,
  storedActiveBackendName: string | null
): Promise<InitialAppSnapshot> {
  if (!api) {
    throw new AppInitializationError(
      'Secure app bridge',
      new Error('The desktop bridge did not load. Reload the interface to reconnect it.')
    )
  }

  const [paths, backends, models, persistedActiveBackendName, templates, runningModels] = await Promise.all([
    loadStage('Storage folders', api.getPaths()),
    loadStage('Backends', api.listBackends()),
    loadStage('Models', api.listModels()),
    loadStage('Active backend', api.getActiveBackendName()),
    loadStage('Templates', api.listTemplates()),
    loadStage('Running sessions', api.listRunningModels())
  ])

  const preferredBackendName = persistedActiveBackendName ?? storedActiveBackendName
  const activeBackend = (
    preferredBackendName
      ? backends.find((backend) => backend.name === preferredBackendName)
      : undefined
  ) ?? backends[0] ?? null
  const commandsSchema = await loadStage(
    'Backend commands',
    api.getCommands(activeBackend?.name ?? '')
  )

  return {
    paths,
    backends,
    models,
    activeBackend,
    commandsSchema,
    templates,
    runningModels
  }
}

export function describeStartupFailure(error: unknown): StartupFailure {
  if (error instanceof AppInitializationError) {
    return {
      stage: error.stage,
      message: getErrorMessage(error.originalError, 'This part of the workspace did not respond.'),
      details: error.stack || error.message
    }
  }

  return {
    stage: 'Secure app bridge',
    message: getErrorMessage(error, 'LlamaDeck could not initialize its local workspace.'),
    details: error instanceof Error ? error.stack || error.message : getErrorMessage(error)
  }
}
