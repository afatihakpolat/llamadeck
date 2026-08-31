import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getPackagedSmokeResultPath,
  isPackagedSmokeTest,
  runPackagedSmokeProbe,
  writePackagedSmokeResult
} from '../packagedSmoke'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('packaged smoke helpers', () => {
  it('enables smoke mode only for the explicit environment value', () => {
    expect(isPackagedSmokeTest({ LLAMADECK_SMOKE_TEST: '1' })).toBe(true)
    expect(isPackagedSmokeTest({ LLAMADECK_SMOKE_TEST: 'true' })).toBe(false)
    expect(isPackagedSmokeTest({})).toBe(false)
  })

  it('requires an absolute result path', () => {
    expect(() => getPackagedSmokeResultPath({
      LLAMADECK_SMOKE_RESULT: 'relative-result.json'
    })).toThrow('must be an absolute path')
  })

  it('writes a complete result atomically', () => {
    const directory = mkdtempSync(join(tmpdir(), 'llamadeck-smoke-result-'))
    temporaryDirectories.push(directory)
    const resultPath = join(directory, 'result.json')

    writePackagedSmokeResult(resultPath, {
      ok: true,
      version: '1.6.6',
      loadedViews: ['My Templates'],
      apiMethods: ['getPaths'],
      rootText: 'My Templates'
    })

    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
      ok: true,
      version: '1.6.6'
    })
  })

  it('returns the renderer page and preload checks', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      loadedViews: ['My Templates', 'Models'],
      apiMethods: ['getPaths', 'runModel'],
      rootText: 'My Templates'
    })
    const targetWindow = {
      webContents: { executeJavaScript }
    } as unknown as BrowserWindow

    const result = await runPackagedSmokeProbe(targetWindow, '1.6.6')

    expect(result).toEqual({
      ok: true,
      version: '1.6.6',
      loadedViews: ['My Templates', 'Models'],
      apiMethods: ['getPaths', 'runModel'],
      rootText: 'My Templates'
    })
    expect(executeJavaScript).toHaveBeenCalledOnce()
  })
})
