export const LLAMADECK_STORAGE_KEYS = {
  theme: 'llamadeck_theme',
  activeBackend: 'llamadeck_active_backend',
  updateNotification: 'llamadeck_update_notify',
  usageStatsQuery: 'llamadeck_usage_stats_query_v1'
} as const

type LlamaDeckStorageKey = typeof LLAMADECK_STORAGE_KEYS[keyof typeof LLAMADECK_STORAGE_KEYS]

const LEGACY_STORAGE_KEYS: Record<LlamaDeckStorageKey, string> = {
  [LLAMADECK_STORAGE_KEYS.theme]: 'hexllama_theme',
  [LLAMADECK_STORAGE_KEYS.activeBackend]: 'hexllama_active_backend',
  [LLAMADECK_STORAGE_KEYS.updateNotification]: 'hexllama_update_notify',
  [LLAMADECK_STORAGE_KEYS.usageStatsQuery]: 'hexllama_usage_stats_query_v1'
}

export function readLlamaDeckStorage(
  key: LlamaDeckStorageKey,
  storage: Storage = window.localStorage
): string | null {
  const legacyKey = LEGACY_STORAGE_KEYS[key]
  const currentValue = storage.getItem(key)

  if (currentValue !== null) {
    storage.removeItem(legacyKey)
    return currentValue
  }

  const legacyValue = storage.getItem(legacyKey)
  if (legacyValue !== null) {
    storage.setItem(key, legacyValue)
    storage.removeItem(legacyKey)
  }

  return legacyValue
}

export function writeLlamaDeckStorage(
  key: LlamaDeckStorageKey,
  value: string,
  storage: Storage = window.localStorage
): void {
  storage.setItem(key, value)
  storage.removeItem(LEGACY_STORAGE_KEYS[key])
}

export function removeLlamaDeckStorage(
  key: LlamaDeckStorageKey,
  storage: Storage = window.localStorage
): void {
  storage.removeItem(key)
  storage.removeItem(LEGACY_STORAGE_KEYS[key])
}
