import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UsageCostSettings } from '../../shared/types'

// appSettings.ts resolves USER_DATA_ROOT from Electron at import time. The
// mock below captures `testRoot` (created in module scope, before the dynamic
// import of appSettings triggers the mock factory) so the settings file lives
// in a temp dir, never the real userData or the repo.
const testRoot = mkdtempSync(join(tmpdir(), 'hexllama-appsettings-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => testRoot,
    isPackaged: false,
    setPath: () => undefined
  }
}))

// Imported dynamically (not statically) so the import — and with it the
// mock factory — runs after `testRoot` above has been initialized.
let getUsageCostSettings: typeof import('../appSettings')['getUsageCostSettings']
let saveUsageCostSettings: typeof import('../appSettings')['saveUsageCostSettings']

beforeAll(async () => {
  const module = await import('../appSettings')
  getUsageCostSettings = module.getUsageCostSettings
  saveUsageCostSettings = module.saveUsageCostSettings
})

const SETTINGS_FILE = join(testRoot, 'usage-cost-settings.json')
const DEFAULTS: UsageCostSettings = {
  currency: 'USD',
  inputCostPerMillion: 0,
  cacheCostPerMillion: 0,
  outputCostPerMillion: 0,
  modelPricing: []
}

// Each test resets the settings file up front (resetSettingsFile) because the
// module under test is imported dynamically and the file state must be
// deterministic per test.
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe('getUsageCostSettings', () => {
  it('returns defaults (including an empty model list) when the file is missing', () => {
    resetSettingsFile()
    expect(getUsageCostSettings()).toEqual(DEFAULTS)
  })

  it('returns defaults when the file is malformed', () => {
    resetSettingsFile()
    writeFileSync(SETTINGS_FILE, '{not json', 'utf-8')
    expect(getUsageCostSettings()).toEqual(DEFAULTS)
  })

  it('normalizes stored model pricing: trims names, drops invalid entries, dedupes case-insensitively', () => {
    resetSettingsFile()
    writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({
        currency: 'eur',
        inputCostPerMillion: 1,
        cacheCostPerMillion: 2,
        outputCostPerMillion: 3,
        modelPricing: [
          { model: '  Qwen3.5  ', inputCostPerMillion: 1, cacheCostPerMillion: 0.1, outputCostPerMillion: 2 },
          { model: 'qwen3.5', inputCostPerMillion: 9, cacheCostPerMillion: 9, outputCostPerMillion: 9 },
          { model: 42, inputCostPerMillion: 1, cacheCostPerMillion: 1, outputCostPerMillion: 1 },
          { model: `${'x'.repeat(201)}`, inputCostPerMillion: 1, cacheCostPerMillion: 1, outputCostPerMillion: 1 },
          { model: 'Mixtral', inputCostPerMillion: -5, cacheCostPerMillion: 'oops', outputCostPerMillion: 4 },
          null
        ]
      }),
      'utf-8'
    )

    const settings = getUsageCostSettings()
    expect(settings.currency).toBe('EUR')
    expect(settings.modelPricing).toEqual([
      { model: 'Qwen3.5', inputCostPerMillion: 1, cacheCostPerMillion: 0.1, outputCostPerMillion: 2 },
      { model: 'Mixtral', inputCostPerMillion: 0, cacheCostPerMillion: 0, outputCostPerMillion: 4 }
    ])
  })

  it('treats a missing modelPricing key as an empty list', () => {
    resetSettingsFile()
    writeFileSync(SETTINGS_FILE, JSON.stringify({ currency: 'USD', inputCostPerMillion: 1, cacheCostPerMillion: 1, outputCostPerMillion: 1 }), 'utf-8')
    expect(getUsageCostSettings().modelPricing).toEqual([])
  })
})

describe('saveUsageCostSettings', () => {
  it('replaces the model list when provided, keeping app-wide rates', () => {
    resetSettingsFile()
    saveUsageCostSettings({
      modelPricing: [
        { model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 },
        { model: 'Mixtral', inputCostPerMillion: 1, cacheCostPerMillion: 0.1, outputCostPerMillion: 2 }
      ]
    })
    const saved = getUsageCostSettings()
    expect(saved.inputCostPerMillion).toBe(0)
    expect(saved.modelPricing).toHaveLength(2)
    expect(saved.modelPricing[0].model).toBe('Qwen3.5-9B')
  })

  it('preserves the stored model list when saving app-wide settings without the key', () => {
    resetSettingsFile()
    saveUsageCostSettings({ modelPricing: [{ model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 4 }] })
    saveUsageCostSettings({ currency: 'EUR', inputCostPerMillion: 7, cacheCostPerMillion: 0, outputCostPerMillion: 9 })
    const saved = getUsageCostSettings()
    expect(saved.currency).toBe('EUR')
    expect(saved.inputCostPerMillion).toBe(7)
    expect(saved.modelPricing).toHaveLength(1)
    expect(saved.modelPricing[0].model).toBe('Qwen3.5-9B')
  })

  it('round-trips through the file and normalizes on re-read', () => {
    resetSettingsFile()
    saveUsageCostSettings({ modelPricing: [{ model: '  Qwen3.5-9B ', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: -1 }] })
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')) as { modelPricing: unknown[] }
    expect(raw.modelPricing).toHaveLength(1)
    const reloaded = getUsageCostSettings()
    expect(reloaded.modelPricing).toEqual([{ model: 'Qwen3.5-9B', inputCostPerMillion: 3, cacheCostPerMillion: 0.3, outputCostPerMillion: 0 }])
  })
})

function resetSettingsFile() {
  if (existsSync(SETTINGS_FILE)) {
    rmSync(SETTINGS_FILE)
  }
}
