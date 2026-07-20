import { describe, expect, it } from 'vitest'
import {
  LLAMADECK_STORAGE_KEYS,
  readLlamaDeckStorage,
  removeLlamaDeckStorage,
  writeLlamaDeckStorage
} from '../utils/storageMigration'

function createStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))

  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
}

describe('storageMigration', () => {
  it('moves a legacy value to the LlamaDeck key on first read', () => {
    const storage = createStorage({ hexllama_theme: 'dark' })

    expect(readLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.theme, storage)).toBe('dark')
    expect(storage.getItem(LLAMADECK_STORAGE_KEYS.theme)).toBe('dark')
    expect(storage.getItem('hexllama_theme')).toBeNull()
  })

  it('prefers the LlamaDeck value and removes the legacy duplicate', () => {
    const storage = createStorage({
      llamadeck_active_backend: 'b10064',
      hexllama_active_backend: 'b9979'
    })

    expect(readLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.activeBackend, storage)).toBe('b10064')
    expect(storage.getItem('hexllama_active_backend')).toBeNull()
  })

  it('cleans legacy keys when writing or removing values', () => {
    const storage = createStorage({ hexllama_update_notify: 'manual' })

    writeLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.updateNotification, 'banner', storage)
    expect(storage.getItem(LLAMADECK_STORAGE_KEYS.updateNotification)).toBe('banner')
    expect(storage.getItem('hexllama_update_notify')).toBeNull()

    removeLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.updateNotification, storage)
    expect(storage.getItem(LLAMADECK_STORAGE_KEYS.updateNotification)).toBeNull()
  })
})
