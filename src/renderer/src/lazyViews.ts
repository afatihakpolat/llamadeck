import { lazy } from 'react'
import type { ComponentType } from 'react'
import type { AppView } from '../../shared/types'

type ViewModule = Promise<{ default: ComponentType }>

const viewLoaders: Record<AppView, () => ViewModule> = {
  cards: () => import('./components/CardsView'),
  settings: () => import('./components/SettingsView'),
  hub: () => import('./components/HuggingFaceView'),
  models: () => import('./components/ModelsView'),
  litellm: () => import('./components/LiteLlmView'),
  'agent-skills': () => import('./components/AgentSkillsView'),
  'live-output': () => import('./components/LiveOutputView'),
  'usage-stats': () => import('./components/UsageStatsView')
}

export const CardsView = lazy(viewLoaders.cards)
export const SettingsView = lazy(viewLoaders.settings)
export const HuggingFaceView = lazy(viewLoaders.hub)
export const ModelsView = lazy(viewLoaders.models)
export const LiteLlmView = lazy(viewLoaders.litellm)
export const AgentSkillsView = lazy(viewLoaders['agent-skills'])
export const LiveOutputView = lazy(viewLoaders['live-output'])
export const UsageStatsView = lazy(viewLoaders['usage-stats'])
export const ChatWindow = lazy(() => import('./components/ChatWindow'))

export function preloadAppView(view: AppView): void {
  void viewLoaders[view]().catch(() => {
    // The error boundary will provide recovery if the user opens a chunk that failed to preload.
  })
}
