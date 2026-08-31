import type { BrowserWindow } from 'electron'
import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { dirname, isAbsolute } from 'path'

export const PACKAGED_SMOKE_TEST_ENV = 'LLAMADECK_SMOKE_TEST'
export const PACKAGED_SMOKE_RESULT_ENV = 'LLAMADECK_SMOKE_RESULT'
export const PACKAGED_SMOKE_USER_DATA_ENV = 'LLAMADECK_SMOKE_USER_DATA'

interface RendererSmokeSnapshot {
  loadedViews: string[]
  apiMethods: string[]
  rootText: string
}

export interface PackagedSmokeResult {
  ok: boolean
  version: string
  loadedViews: string[]
  apiMethods: string[]
  rootText: string
  error?: string
}

const RENDERER_SMOKE_PROBE = String.raw`
(async () => {
  const waitFor = async (predicate, label, timeoutMs = 15000) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const rootText = document.getElementById('root')?.textContent?.trim() || ''
    throw new Error('Timed out waiting for ' + label + '. Root: ' + rootText.slice(0, 600))
  }

  const pageTitle = () => document.querySelector('.page-title')?.textContent?.trim() || ''
  await waitFor(() => pageTitle() === 'My Templates', 'the Templates page')

  const requiredApiMethods = [
    'getPaths',
    'listTemplates',
    'listRunningModels',
    'runModel',
    'stopModel',
    'getLiteLlmManager',
    'startLiteLlmProxy',
    'startModelDownload',
    'updateGetState'
  ]
  const missingApiMethods = requiredApiMethods.filter((name) => typeof window.api?.[name] !== 'function')
  if (missingApiMethods.length > 0) {
    throw new Error('Missing preload API methods: ' + missingApiMethods.join(', '))
  }

  const viewChecks = [
    ['Models', 'Models'],
    ['Model Hub', 'Model Hub'],
    ['Settings', 'Settings'],
    ['LiteLLM', 'LiteLLM'],
    ['Agent Skills', 'Agent Skills'],
    ['Live View', 'Live Output'],
    ['Usage Stats', 'Usage Stats'],
    ['My Templates', 'My Templates']
  ]
  const loadedViews = ['My Templates']

  for (const [navigationLabel, expectedTitle] of viewChecks) {
    const button = Array.from(document.querySelectorAll('button.nav-item')).find(
      (candidate) => candidate.textContent?.trim().startsWith(navigationLabel)
    )
    if (!button) throw new Error('Navigation button not found: ' + navigationLabel)
    button.click()
    await waitFor(() => pageTitle() === expectedTitle, expectedTitle + ' page')
    loadedViews.push(expectedTitle)
  }

  return {
    loadedViews,
    apiMethods: requiredApiMethods,
    rootText: document.getElementById('root')?.textContent?.trim().slice(0, 600) || ''
  }
})()
`

export function isPackagedSmokeTest(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[PACKAGED_SMOKE_TEST_ENV] === '1'
}

export function getPackagedSmokeResultPath(
  environment: NodeJS.ProcessEnv = process.env
): string | null {
  const candidate = environment[PACKAGED_SMOKE_RESULT_ENV]?.trim()
  if (!candidate) return null
  if (!isAbsolute(candidate)) {
    throw new Error(`${PACKAGED_SMOKE_RESULT_ENV} must be an absolute path.`)
  }
  return candidate
}

export function writePackagedSmokeResult(
  resultPath: string,
  result: PackagedSmokeResult
): void {
  mkdirSync(dirname(resultPath), { recursive: true })
  const temporaryPath = `${resultPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, resultPath)
}

export async function runPackagedSmokeProbe(
  targetWindow: BrowserWindow,
  version: string
): Promise<PackagedSmokeResult> {
  const snapshot = await targetWindow.webContents.executeJavaScript(
    RENDERER_SMOKE_PROBE,
    true
  ) as RendererSmokeSnapshot

  return {
    ok: true,
    version,
    loadedViews: snapshot.loadedViews,
    apiMethods: snapshot.apiMethods,
    rootText: snapshot.rootText
  }
}
