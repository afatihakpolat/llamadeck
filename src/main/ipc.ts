import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import {
  existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync,
  unlinkSync, createWriteStream, statSync, rmdirSync, renameSync
} from 'fs'
import { join, extname, basename, dirname, resolve, sep, relative } from 'path'
import { spawn, ChildProcess, execFileSync } from 'child_process'
import https from 'https'
import http from 'http'
import { app } from 'electron'
import extract from 'extract-zip'
import type {
  LiteLlmInstallStatus,
  LiteLlmLogLevel,
  LiteLlmManagerSettings,
  LiteLlmManagerSettingsInput,
  LiteLlmManagerSnapshot,
  LiteLlmModelEntry,
  Template
} from '../shared/types'

type ConfigurablePathKind = 'models' | 'backend'

interface AppPaths {
  models: string
  templates: string
  backend: string
}

interface ModelEntry {
  name: string
  path: string
  size: number
  folder: string
}

interface BackendEntry {
  name: string
  displayName: string
  path: string
  hasCommands: boolean
  exe: string | null
}

interface BackendUpdateResult {
  snapshot: { paths: AppPaths; models: ModelEntry[]; backends: BackendEntry[] }
  templates: Template[]
  activeBackendName: string
}

interface SourceUpdateJob {
  process: ChildProcess
  cancelled: boolean
}

interface LiteLlmStoredSettings {
  baseUrl: string
  apiKey: string
}

interface LiteLlmManagerStoredSettings extends LiteLlmManagerSettings {}

interface PythonRuntimeCommand {
  command: string
  argsPrefix: string[]
  displayCommand: string
  pythonVersion: string
}

const SOURCE_UPDATE_SCRIPT_PATH = join(app.getPath('userData'), 'update-llama-source.ps1')
const SOURCE_UPDATE_SCRIPT = String.raw`
param(
  [string]$RepoDir,
  [string]$TargetRef,
  [string]$CudaArch = "native",
  [string]$BuildType = "Release"
)

$ErrorActionPreference = "Stop"

function Write-Phase([string]$Phase, [int]$Percent, [string]$Message) {
  Write-Output "HEXLLAMA_PROGRESS|$Phase|$Percent|$Message"
}

function Import-VsDevShell {
  $vsInstallerRoot = [System.Environment]::GetFolderPath('ProgramFilesX86')
  $vswhere = Join-Path $vsInstallerRoot "Microsoft Visual Studio\Installer\vswhere.exe"

  if (-not (Test-Path $vswhere)) {
    throw "Could not find vswhere.exe. Install Visual Studio Build Tools 2022 with the C++ workload."
  }

  $vsInstallPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath

  if (-not $vsInstallPath) {
    throw "Could not find Visual Studio C++ Build Tools. Install 'Desktop development with C++'."
  }

  $vcvars = Join-Path $vsInstallPath "VC\Auxiliary\Build\vcvars64.bat"
  if (-not (Test-Path $vcvars)) {
    throw "Could not find vcvars64.bat at: $vcvars"
  }

  $vcvarsCommand = '"' + $vcvars + '" >nul && set'

  cmd /d /s /c $vcvarsCommand | ForEach-Object {
    if ($_ -match "^(.*?)=(.*)$") {
      [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
  }
}

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
  Write-Phase "environment" 5 "Loading Visual Studio build environment"
  Import-VsDevShell
}

$clCommand = Get-Command cl.exe -ErrorAction SilentlyContinue
if (-not $clCommand) {
  throw "Could not load cl.exe into PATH after importing the Visual Studio build environment."
}

$clPath = $clCommand.Source
foreach ($compilerEnv in @("CC", "CXX", "CUDAHOSTCXX")) {
  Remove-Item "Env:$compilerEnv" -ErrorAction SilentlyContinue
}

foreach ($cmd in @("git", "cmake", "ninja", "nvcc")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $cmd"
  }
}

Push-Location $RepoDir
$buildSucceeded = $false
$targetBuildDir = $null
$serverExe = $null

try {
  Write-Phase "fetching" 12 "Fetching upstream git tags"
  git fetch origin --tags
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed." }

  if (-not $TargetRef -or $TargetRef -notmatch '^b\d+$') {
    throw "Could not determine the llama.cpp tag to build."
  }

  Write-Phase "resetting" 24 "Checking out $TargetRef"
  git checkout --force $TargetRef
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed." }

  $buildTag = $TargetRef
  if ($buildTag -notmatch '^b\d+$') {
    throw "Could not derive a llama.cpp build tag from git."
  }

  $targetBuildDir = Join-Path $RepoDir $buildTag
  $serverExe = Join-Path $targetBuildDir "bin\llama-server.exe"

  if (Test-Path $serverExe) {
    Write-Phase "finalizing" 95 "Latest build already exists"
    Write-Output "HEXLLAMA_RESULT|$buildTag|$targetBuildDir"
    exit 0
  }

  if (Test-Path $targetBuildDir) {
    Remove-Item -Recurse -Force $targetBuildDir
  }

  Write-Phase "configuring" 42 "Configuring $buildTag"
  $cmakeArgs = @(
    "-S", ".",
    "-B", $targetBuildDir,
    "-G", "Ninja",
    "-DGGML_CUDA=ON",
    "-DCMAKE_BUILD_TYPE=$BuildType",
    "-DCMAKE_C_COMPILER=$clPath",
    "-DCMAKE_CXX_COMPILER=$clPath",
    "-DCMAKE_CUDA_HOST_COMPILER=$clPath"
  )

  if ($CudaArch -and $CudaArch.Trim()) {
    $cmakeArgs += "-DCMAKE_CUDA_ARCHITECTURES=$CudaArch"
  }

  & cmake @cmakeArgs
  if ($LASTEXITCODE -ne 0) { throw "CMake configure failed." }

  Write-Phase "building" 72 "Building $buildTag"
  & cmake --build $targetBuildDir --config $BuildType -j
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }

  if (-not (Test-Path $serverExe)) {
    throw "Build completed but llama-server.exe was not found at $serverExe"
  }

  $buildSucceeded = $true
  Write-Phase "finalizing" 95 "Verifying $buildTag"
  Write-Output "HEXLLAMA_RESULT|$buildTag|$targetBuildDir"
}
catch {
  if (-not $buildSucceeded -and $targetBuildDir -and (Test-Path $targetBuildDir)) {
    Remove-Item -Recurse -Force $targetBuildDir -ErrorAction SilentlyContinue
  }

  throw
}
finally {
  Pop-Location
}
`

const APP_ROOT = app.isPackaged ? join(app.getPath('userData')) : join(process.cwd())

const DEFAULT_PATHS: AppPaths = {
  models: join(APP_ROOT, 'models'),
  templates: join(APP_ROOT, 'templates'),
  backend: join(APP_ROOT, 'backend')
}

const PATHS_CONFIG_FILE = join(app.getPath('userData'), 'folder-paths.json')
const LITELLM_SETTINGS_FILE = join(app.getPath('userData'), 'litellm-settings.json')
const LITELLM_MANAGER_FILE = join(app.getPath('userData'), 'litellm-manager.json')
const DEFAULT_LITELLM_CONFIG_PATH = join(app.getPath('userData'), 'litellm-config.yaml')
const DEFAULT_LITELLM_CONFIG = `model_list:
  - model_name: example-model
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY
`
const DEFAULT_LITELLM_MANAGER_SETTINGS: LiteLlmManagerStoredSettings = {
  host: '127.0.0.1',
  port: 4000,
  configPath: DEFAULT_LITELLM_CONFIG_PATH,
  logLevel: 'info'
}

function ensureDirectory(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function loadPathOverrides(): Partial<Record<ConfigurablePathKind, string>> {
  try {
    if (!existsSync(PATHS_CONFIG_FILE)) return {}
    const parsed = JSON.parse(readFileSync(PATHS_CONFIG_FILE, 'utf-8')) as Record<string, unknown>
    const overrides: Partial<Record<ConfigurablePathKind, string>> = {}

    if (typeof parsed.models === 'string' && parsed.models.trim()) {
      overrides.models = resolve(parsed.models)
    }
    if (typeof parsed.backend === 'string' && parsed.backend.trim()) {
      overrides.backend = resolve(parsed.backend)
    }

    return overrides
  } catch {
    return {}
  }
}

function buildPaths(overrides: Partial<Record<ConfigurablePathKind, string>>): AppPaths {
  return {
    templates: DEFAULT_PATHS.templates,
    models: overrides.models ? resolve(overrides.models) : DEFAULT_PATHS.models,
    backend: overrides.backend ? resolve(overrides.backend) : DEFAULT_PATHS.backend
  }
}

function persistPathOverrides(paths: AppPaths): void {
  ensureDirectory(dirname(PATHS_CONFIG_FILE))
  writeFileSync(PATHS_CONFIG_FILE, JSON.stringify({ models: paths.models, backend: paths.backend }, null, 2))
}

function normalizeLiteLlmBaseUrl(value: string): string {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    throw new Error('LiteLLM base URL is required')
  }

  return trimmedValue.replace(/\/+$/, '')
}

function normalizeLiteLlmHost(value: string): string {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    throw new Error('LiteLLM host is required')
  }

  if (!['127.0.0.1', 'localhost'].includes(trimmedValue)) {
    throw new Error('LiteLLM host must stay on loopback: use 127.0.0.1 or localhost.')
  }

  return '127.0.0.1'
}

function normalizeLiteLlmPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('LiteLLM port must be between 1 and 65535')
  }

  return value
}

function normalizeLiteLlmLogLevel(value: LiteLlmLogLevel): LiteLlmLogLevel {
  return ['info', 'debug', 'detailed_debug'].includes(value)
    ? value
    : 'info'
}

function buildManagedLiteLlmBaseUrl(settings: Pick<LiteLlmManagerStoredSettings, 'host' | 'port'>): string {
  return `http://${settings.host}:${settings.port}`
}

function getManagedLiteLlmBaseUrl(): string {
  return buildManagedLiteLlmBaseUrl({ host: '127.0.0.1', port: liteLlmManagerSettings.port })
}

function loadLiteLlmStoredSettings(): LiteLlmStoredSettings {
  try {
    if (!existsSync(LITELLM_SETTINGS_FILE)) {
      return { baseUrl: '', apiKey: '' }
    }

    const parsed = JSON.parse(readFileSync(LITELLM_SETTINGS_FILE, 'utf-8')) as Record<string, unknown>
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : ''
    }
  } catch {
    return { baseUrl: '', apiKey: '' }
  }
}

function loadLiteLlmManagerStoredSettings(): LiteLlmManagerStoredSettings {
  try {
    if (!existsSync(LITELLM_MANAGER_FILE)) {
      return { ...DEFAULT_LITELLM_MANAGER_SETTINGS }
    }

    const parsed = JSON.parse(readFileSync(LITELLM_MANAGER_FILE, 'utf-8')) as Record<string, unknown>
    const host = typeof parsed.host === 'string' && parsed.host.trim()
      ? normalizeLiteLlmHost(parsed.host)
      : DEFAULT_LITELLM_MANAGER_SETTINGS.host
    const port = typeof parsed.port === 'number'
      ? normalizeLiteLlmPort(parsed.port)
      : DEFAULT_LITELLM_MANAGER_SETTINGS.port
    const configPath = typeof parsed.configPath === 'string' && parsed.configPath.trim()
      ? resolve(parsed.configPath)
      : DEFAULT_LITELLM_MANAGER_SETTINGS.configPath
    const logLevel = typeof parsed.logLevel === 'string'
      ? normalizeLiteLlmLogLevel(parsed.logLevel as LiteLlmLogLevel)
      : DEFAULT_LITELLM_MANAGER_SETTINGS.logLevel

    return { host, port, configPath, logLevel }
  } catch {
    return { ...DEFAULT_LITELLM_MANAGER_SETTINGS }
  }
}

function persistLiteLlmStoredSettings(settings: LiteLlmStoredSettings): void {
  ensureDirectory(dirname(LITELLM_SETTINGS_FILE))
  writeFileSync(LITELLM_SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

function persistLiteLlmManagerStoredSettings(settings: LiteLlmManagerStoredSettings): void {
  ensureDirectory(dirname(LITELLM_MANAGER_FILE))
  writeFileSync(LITELLM_MANAGER_FILE, JSON.stringify(settings, null, 2))
}

function buildLiteLlmApiUrl(baseUrl: string, endpointPath: string): string {
  const normalizedBaseUrl = normalizeLiteLlmBaseUrl(baseUrl)
  return /\/v1$/i.test(normalizedBaseUrl)
    ? `${normalizedBaseUrl}${endpointPath}`
    : `${normalizedBaseUrl}/v1${endpointPath}`
}

function buildLiteLlmRequestHeaders(settings: LiteLlmStoredSettings, includeJsonContent = false): Record<string, string> {
  const headers: Record<string, string> = {}

  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`
  }

  if (includeJsonContent) {
    headers['Content-Type'] = 'application/json'
  }

  return headers
}

function ensureAppPaths(paths: AppPaths): AppPaths {
  ensureDirectory(paths.templates)
  ensureDirectory(paths.models)
  ensureDirectory(paths.backend)
  return paths
}

let appPaths = ensureAppPaths(buildPaths(loadPathOverrides()))
let liteLlmSettings = loadLiteLlmStoredSettings()
let liteLlmManagerSettings = loadLiteLlmManagerStoredSettings()
let liteLlmProxyProcess: ChildProcess | null = null
const liteLlmLogBuffer: string[] = []
let latestLiteLlmVersionCache: { version: string | null; checkedAt: number } | null = null

function syncLiteLlmSettingsToManagedProxy(): void {
  const managedBaseUrl = getManagedLiteLlmBaseUrl()
  if (liteLlmSettings.baseUrl !== managedBaseUrl || liteLlmSettings.apiKey) {
    liteLlmSettings = { ...liteLlmSettings, baseUrl: managedBaseUrl, apiKey: '' }
    persistLiteLlmStoredSettings(liteLlmSettings)
  }
}

syncLiteLlmSettingsToManagedProxy()

function getAppPaths(): AppPaths {
  return appPaths
}

function updateAppPath(kind: ConfigurablePathKind, nextPath: string): AppPaths {
  const trimmedPath = nextPath.trim()
  if (!trimmedPath) {
    throw new Error('Folder path is required')
  }

  const resolvedPath = resolve(trimmedPath)
  ensureDirectory(resolvedPath)
  appPaths = ensureAppPaths({ ...appPaths, [kind]: resolvedPath })
  persistPathOverrides(appPaths)
  return appPaths
}

function ensureLiteLlmConfigFile(): string {
  ensureDirectory(dirname(liteLlmManagerSettings.configPath))
  if (!existsSync(liteLlmManagerSettings.configPath)) {
    writeFileSync(liteLlmManagerSettings.configPath, DEFAULT_LITELLM_CONFIG, 'utf-8')
  }

  return liteLlmManagerSettings.configPath
}

function readLiteLlmConfigText(): string {
  const configPath = ensureLiteLlmConfigFile()
  return readFileSync(configPath, 'utf-8')
}

function saveLiteLlmConfigText(configText: string): void {
  ensureDirectory(dirname(liteLlmManagerSettings.configPath))
  writeFileSync(liteLlmManagerSettings.configPath, configText, 'utf-8')
}

function appendLiteLlmLog(chunk: string): void {
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)

  for (const line of lines) {
    liteLlmLogBuffer.push(line)
  }

  if (liteLlmLogBuffer.length > 200) {
    liteLlmLogBuffer.splice(0, liteLlmLogBuffer.length - 200)
  }
}

function isLiteLlmProxyRunning(): boolean {
  return Boolean(liteLlmProxyProcess && !liteLlmProxyProcess.killed)
}

function probeLiteLlmApi(baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = buildLiteLlmApiUrl(baseUrl, '/models')
    const requestImpl = url.startsWith('https') ? https.request : http.request
    const req = requestImpl(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'hexllama/1.0.0',
        Accept: 'application/json',
        ...buildLiteLlmRequestHeaders(liteLlmSettings)
      }
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk.toString()
      })
      res.on('end', () => {
        const statusCode = res.statusCode ?? 0
        if (![200, 401, 403].includes(statusCode)) {
          resolve(false)
          return
        }

        try {
          const parsed = data.trim() ? JSON.parse(data) : null
          const looksLikeLiteLlm = Boolean(
            parsed &&
            typeof parsed === 'object' &&
            (
              ('data' in parsed && Array.isArray((parsed as { data?: unknown }).data)) ||
              'error' in parsed
            )
          )
          resolve(looksLikeLiteLlm)
        } catch {
          resolve(false)
        }
      })
    })

    req.setTimeout(1000, () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve(false))
    req.end()
  })
}

function waitForLiteLlmServerReady(baseUrl: string, child: ChildProcess, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      child.off('exit', handleExit)
      if (error) reject(error)
      else resolve()
    }

    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(new Error(`LiteLLM proxy exited before becoming ready${code !== null ? ` (code ${code})` : ''}${signal ? ` (${signal})` : ''}.`))
    }

    const attempt = async () => {
      if (settled) return
      if (Date.now() > deadline) {
        finish(new Error('LiteLLM proxy did not become ready before timeout.'))
        return
      }

      const isReady = await probeLiteLlmApi(baseUrl)
      if (isReady) {
        finish()
        return
      }

      setTimeout(() => {
        void attempt()
      }, 250)
    }

    child.on('exit', handleExit)
    void attempt()
  })
}

function detectPythonRuntimeCommand(): PythonRuntimeCommand | null {
  const candidates: Array<{ command: string; argsPrefix: string[] }> = [
    { command: 'py', argsPrefix: ['-3'] },
    { command: 'python', argsPrefix: [] },
    { command: 'python3', argsPrefix: [] }
  ]

  for (const candidate of candidates) {
    try {
      const versionOutput = execFileSync(candidate.command, [...candidate.argsPrefix, '-c', 'import sys; print(sys.version.split()[0])'], {
        encoding: 'utf-8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()

      return {
        command: candidate.command,
        argsPrefix: candidate.argsPrefix,
        displayCommand: [candidate.command, ...candidate.argsPrefix].join(' '),
        pythonVersion: versionOutput
      }
    } catch {}
  }

  return null
}

function compareLiteLlmVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function parseLiteLlmVersionFromPipShow(output: string): string | null {
  const match = output.match(/^Version:\s*(.+)$/im)
  return match?.[1]?.trim() || null
}

async function fetchLatestLiteLlmVersion(): Promise<string | null> {
  const now = Date.now()
  if (latestLiteLlmVersionCache && now - latestLiteLlmVersionCache.checkedAt < 5 * 60 * 1000) {
    return latestLiteLlmVersionCache.version
  }

  try {
    const response = await fetchJson('https://pypi.org/pypi/litellm/json') as { info?: { version?: string } } | null
    const version = typeof response?.info?.version === 'string' ? response.info.version.trim() : null
    latestLiteLlmVersionCache = { version, checkedAt: now }
    return version
  } catch {
    latestLiteLlmVersionCache = { version: null, checkedAt: now }
    return null
  }
}

async function resolveLiteLlmInstallStatus(): Promise<LiteLlmInstallStatus> {
  const runtime = detectPythonRuntimeCommand()
  if (!runtime) {
    return {
      pythonCommand: null,
      pythonVersion: null,
      installed: false,
      currentVersion: null,
      latestVersion: null,
      hasUpdate: false,
      error: 'Python 3 was not found on this computer.'
    }
  }

  let currentVersion: string | null = null
  try {
    const showOutput = execFileSync(runtime.command, [...runtime.argsPrefix, '-m', 'pip', 'show', 'litellm'], {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    currentVersion = parseLiteLlmVersionFromPipShow(showOutput)
  } catch {}

  const latestVersion = currentVersion ? await fetchLatestLiteLlmVersion() : null

  return {
    pythonCommand: runtime.displayCommand,
    pythonVersion: runtime.pythonVersion,
    installed: Boolean(currentVersion),
    currentVersion,
    latestVersion,
    hasUpdate: Boolean(currentVersion && latestVersion && compareLiteLlmVersions(currentVersion, latestVersion) < 0),
    ...(currentVersion ? {} : { error: 'LiteLLM is not installed for the detected Python runtime.' })
  }
}

function buildLiteLlmManagerSettingsSnapshot(): LiteLlmManagerSettings {
  return { ...liteLlmManagerSettings }
}

async function buildLiteLlmManagerSnapshot(): Promise<LiteLlmManagerSnapshot> {
  return {
    settings: buildLiteLlmManagerSettingsSnapshot(),
    install: await resolveLiteLlmInstallStatus(),
    running: isLiteLlmProxyRunning(),
    pid: liteLlmProxyProcess?.pid ?? null,
    recentLogs: [...liteLlmLogBuffer],
    configText: readLiteLlmConfigText()
  }
}

function saveLiteLlmManagerSettings(input: LiteLlmManagerSettingsInput): LiteLlmManagerSettings {
  const nextHost = normalizeLiteLlmHost(input.host)
  const nextPort = normalizeLiteLlmPort(input.port)
  const nextLogLevel = normalizeLiteLlmLogLevel(input.logLevel)
  if (
    isLiteLlmProxyRunning() &&
    (
      nextHost !== liteLlmManagerSettings.host ||
      nextPort !== liteLlmManagerSettings.port ||
      nextLogLevel !== liteLlmManagerSettings.logLevel
    )
  ) {
    throw new Error('Stop the LiteLLM proxy before changing host, port, or log level.')
  }

  const previousManagedBaseUrl = buildManagedLiteLlmBaseUrl(liteLlmManagerSettings)
  const nextSettings: LiteLlmManagerStoredSettings = {
    ...liteLlmManagerSettings,
    host: nextHost,
    port: nextPort,
    logLevel: nextLogLevel
  }

  liteLlmManagerSettings = nextSettings
  persistLiteLlmManagerStoredSettings(liteLlmManagerSettings)
  ensureLiteLlmConfigFile()

  const nextManagedBaseUrl = buildManagedLiteLlmBaseUrl(liteLlmManagerSettings)
  if (liteLlmSettings.baseUrl === previousManagedBaseUrl || liteLlmSettings.baseUrl !== nextManagedBaseUrl) {
    syncLiteLlmSettingsToManagedProxy()
  }

  return buildLiteLlmManagerSettingsSnapshot()
}

function runCommandCapture(command: string, args: string[]): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1' }
    })

    let output = ''
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      appendLiteLlmLog(text)
    })
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      appendLiteLlmLog(text)
    })
    child.on('error', reject)
    child.on('exit', (exitCode) => resolve({ exitCode: exitCode ?? 1, output: output.trim() }))
  })
}

async function installOrUpdateLiteLlm(upgrade: boolean): Promise<{ success: true; snapshot: LiteLlmManagerSnapshot; output: string } | { success: false; error: string; output?: string; install: LiteLlmInstallStatus }> {
  const runtime = detectPythonRuntimeCommand()
  const install = await resolveLiteLlmInstallStatus()
  if (!runtime) {
    return { success: false, error: install.error || 'Python 3 was not found on this computer.', install }
  }

  const args = upgrade
    ? [...runtime.argsPrefix, '-m', 'pip', 'install', '--upgrade', 'litellm[proxy]']
    : [...runtime.argsPrefix, '-m', 'pip', 'install', 'litellm[proxy]']

  appendLiteLlmLog(`${runtime.displayCommand} ${args.join(' ')}`)
  const result = await runCommandCapture(runtime.command, args)
  if (result.exitCode !== 0) {
    return {
      success: false,
      error: upgrade ? 'LiteLLM update failed.' : 'LiteLLM installation failed.',
      output: result.output,
      install: await resolveLiteLlmInstallStatus()
    }
  }

  return {
    success: true,
    snapshot: await buildLiteLlmManagerSnapshot(),
    output: result.output
  }
}

async function startLiteLlmProxyProcess(): Promise<{ success: true; snapshot: LiteLlmManagerSnapshot } | { success: false; error: string; snapshot?: LiteLlmManagerSnapshot }> {
  if (isLiteLlmProxyRunning()) {
    return { success: false, error: 'LiteLLM proxy is already running.', snapshot: await buildLiteLlmManagerSnapshot() }
  }

  const install = await resolveLiteLlmInstallStatus()
  if (!install.installed) {
    return { success: false, error: install.error || 'LiteLLM is not installed.', snapshot: await buildLiteLlmManagerSnapshot() }
  }

  const runtime = detectPythonRuntimeCommand()
  if (!runtime) {
    return { success: false, error: 'Python 3 was not found on this computer.', snapshot: await buildLiteLlmManagerSnapshot() }
  }

  const configPath = ensureLiteLlmConfigFile()
  syncLiteLlmSettingsToManagedProxy()
  const args = [
    ...runtime.argsPrefix,
    '-m',
    'litellm',
    '--config',
    configPath,
    '--host',
    liteLlmManagerSettings.host,
    '--port',
    String(liteLlmManagerSettings.port)
  ]

  if (liteLlmManagerSettings.logLevel === 'debug') {
    args.push('--debug')
  }
  if (liteLlmManagerSettings.logLevel === 'detailed_debug') {
    args.push('--detailed_debug')
  }

  appendLiteLlmLog(`Starting LiteLLM proxy with ${runtime.displayCommand} ${args.join(' ')}`)
  const child = spawn(runtime.command, args, {
    cwd: dirname(configPath),
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1' }
  })

  child.stdout?.on('data', (chunk) => appendLiteLlmLog(chunk.toString()))
  child.stderr?.on('data', (chunk) => appendLiteLlmLog(chunk.toString()))
  child.on('error', (error) => {
    appendLiteLlmLog(`LiteLLM proxy failed to start: ${String(error)}`)
    liteLlmProxyProcess = null
  })
  child.on('exit', (code, signal) => {
    appendLiteLlmLog(`LiteLLM proxy exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}`)
    if (liteLlmProxyProcess?.pid === child.pid) {
      liteLlmProxyProcess = null
    }
  })

  liteLlmProxyProcess = child
  try {
    await waitForLiteLlmServerReady(getManagedLiteLlmBaseUrl(), child)
  } catch (error) {
    appendLiteLlmLog(String(error))
    if (child.pid && !child.killed) {
      await killProcessTree(child.pid)
    }
    if (liteLlmProxyProcess?.pid === child.pid) {
      liteLlmProxyProcess = null
    }
    return { success: false, error: String(error), snapshot: await buildLiteLlmManagerSnapshot() }
  }

  return { success: true, snapshot: await buildLiteLlmManagerSnapshot() }
}

async function stopLiteLlmProxyProcess(): Promise<{ success: true; snapshot: LiteLlmManagerSnapshot } | { success: false; error: string; snapshot?: LiteLlmManagerSnapshot }> {
  if (!liteLlmProxyProcess?.pid) {
    return { success: false, error: 'LiteLLM proxy is not running.', snapshot: await buildLiteLlmManagerSnapshot() }
  }

  const pid = liteLlmProxyProcess.pid
  await killProcessTree(pid)
  appendLiteLlmLog(`Stopped LiteLLM proxy process ${pid}`)
  liteLlmProxyProcess = null
  return { success: true, snapshot: await buildLiteLlmManagerSnapshot() }
}

function isSafePath(base: string, target: string): boolean {
  const resolvedBase = resolve(base)
  const resolvedTarget = resolve(target)

  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${sep}`)
}

function listModelsFromDirectory(modelsDir: string): ModelEntry[] {
  if (!existsSync(modelsDir)) return []

  const exts = ['.gguf', '.bin', '.ggml']
  const results: ModelEntry[] = []
  const scan = (dir: string) => {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) scan(join(dir, entry.name))
        else if (exts.includes(extname(entry.name).toLowerCase()) && !entry.name.endsWith('.tmp') && !entry.name.toLowerCase().includes('mmproj')) {
          const filePath = join(dir, entry.name)
          const relativeFolder = relative(modelsDir, dir).replace(/\\/g, '/')
          results.push({
            name: entry.name,
            path: filePath,
            size: statSync(filePath).size,
            folder: relativeFolder || 'Root'
          })
        }
      }
    } catch {}
  }

  scan(modelsDir)
  return results
}

function findBackendExecutable(dir: string, depth = 0): string | null {
  if (depth > 3) return null

  try {
    const files = readdirSync(dir, { withFileTypes: true })
    const names = process.platform === 'win32'
      ? ['llama-server.exe', 'llama-server', 'main.exe', 'main', 'server.exe', 'server']
      : ['llama-server', 'main', 'server']

    for (const file of files) {
      if (!file.isDirectory() && names.includes(file.name.toLowerCase())) return file.name
    }

    for (const file of files) {
      if (file.isDirectory()) {
        const nested = findBackendExecutable(join(dir, file.name), depth + 1)
        if (nested) return join(file.name, nested)
      }
    }
  } catch {}

  return null
}

function getBackendDisplayName(basePath: string, fallbackName: string): string {
  const versionFile = join(basePath, 'llama-version.cmake')

  try {
    if (!existsSync(versionFile)) return fallbackName

    const content = readFileSync(versionFile, 'utf-8')
    const match = content.match(/set\(PACKAGE_VERSION\s+"\d+\.\d+\.(\d+)"\)/)
    if (!match) return fallbackName

    return `b${match[1]}`
  } catch {
    return fallbackName
  }
}

function parseBuildNumber(value: string): number {
  const match = value.match(/(\d{3,6})/)
  return match ? parseInt(match[1], 10) : 0
}

function getLatestGitTag(): { tagName: string; url: string } {
  const output = execFileSync(
    'git',
    ['ls-remote', '--tags', '--refs', 'https://github.com/ggerganov/llama.cpp.git', 'refs/tags/b*'],
    { encoding: 'utf-8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  )

  const tags = output
    .split(/\r?\n/)
    .map((line) => line.match(/refs\/tags\/(b\d+)/)?.[1])
    .filter((tag): tag is string => Boolean(tag))

  if (tags.length === 0) {
    throw new Error('No llama.cpp git tags found')
  }

  const latestTag = tags.reduce((best, current) => (
    parseBuildNumber(current) > parseBuildNumber(best) ? current : best
  ))

  return {
    tagName: latestTag,
    url: `https://github.com/ggerganov/llama.cpp/tree/${latestTag}`
  }
}

function ensureSourceUpdateScript(): string {
  writeFileSync(SOURCE_UPDATE_SCRIPT_PATH, SOURCE_UPDATE_SCRIPT, 'utf-8')
  return SOURCE_UPDATE_SCRIPT_PATH
}

function parseCudaComputeCapability(value: string): string | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return null

  const major = match[1]
  const minor = match[2] ?? '0'
  return `${major}${minor}`
}

function detectLocalCudaArch(): string | null {
  try {
    const output = execFileSync(
      'nvidia-smi',
      ['--query-gpu=compute_cap', '--format=csv,noheader'],
      { encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )

    const arches = Array.from(new Set(
      output
        .split(/\r?\n/)
        .map(parseCudaComputeCapability)
        .filter((value): value is string => Boolean(value))
    ))

    return arches.length > 0 ? arches.join(';') : null
  } catch {
    return null
  }
}

function getConfiguredCudaArch(repoDir: string): string {
  const envArch = process.env['HEXLLAMA_CUDA_ARCH']?.trim()
  if (envArch) return envArch

  const detectedArch = detectLocalCudaArch()
  if (detectedArch) return detectedArch

  const cachePaths = listBackendsFromDirectory(repoDir)
    .map((backend) => join(backend.path, 'CMakeCache.txt'))
    .filter((cachePath) => existsSync(cachePath))

  for (const cachePath of cachePaths) {
    try {
      const content = readFileSync(cachePath, 'utf-8')
      const match = content.match(/CMAKE_CUDA_ARCHITECTURES:STRING=([^\r\n]+)/)
      if (match?.[1]?.trim()) return match[1].trim()
    } catch {}
  }

  return 'native'
}

function removeFailedSourceBuild(repoDir: string, buildTagName: string): void {
  const buildDir = join(repoDir, buildTagName)
  if (!existsSync(buildDir)) return

  try {
    rmdirSync(buildDir, { recursive: true })
  } catch {}
}

function assertGitRepo(repoDir: string): void {
  execFileSync('git', ['-C', repoDir, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf-8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function listTemplatesFromDirectory(templatesDir: string): Template[] {
  if (!existsSync(templatesDir)) return []

  return readdirSync(templatesDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => {
      try {
        const parsed = JSON.parse(readFileSync(join(templatesDir, fileName), 'utf-8')) as Record<string, unknown>
        return normalizeTemplateRecord(parsed, { fileName, idFallback: basename(fileName, '.json') })
      } catch {
        return null
      }
    })
    .filter((template): template is Template => Boolean(template))
}

function getTemplateById(templateId: string): Template | null {
  return listTemplatesFromDirectory(getAppPaths().templates).find((template) => template.id === templateId) ?? null
}

function normalizeTemplateRecord(
  template: Record<string, unknown>,
  options: { fileName?: string; idFallback?: string } = {}
): Template {
  const id = typeof template.id === 'string' && template.id.trim()
    ? template.id.trim()
    : (options.idFallback || Date.now().toString())
  const name = typeof template.name === 'string' && template.name.trim()
    ? template.name.trim()
    : 'Untitled Template'
  const description = typeof template.description === 'string' && template.description.trim()
    ? template.description
    : undefined
  const backendVersion = typeof template.backendVersion === 'string' && template.backendVersion.trim()
    ? template.backendVersion.trim()
    : undefined
  const modelPath = typeof template.modelPath === 'string' && template.modelPath.trim()
    ? template.modelPath.trim()
    : undefined
  const args = template.args && typeof template.args === 'object' && !Array.isArray(template.args)
    ? template.args as Template['args']
    : {}
  const createdAt = typeof template.createdAt === 'string' && template.createdAt.trim()
    ? template.createdAt
    : new Date().toISOString()
  const updatedAt = typeof template.updatedAt === 'string' && template.updatedAt.trim()
    ? template.updatedAt
    : createdAt

  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(backendVersion ? { backendVersion } : {}),
    ...(modelPath ? { modelPath } : {}),
    serverPort: typeof template.serverPort === 'number' && Number.isInteger(template.serverPort)
      ? template.serverPort
      : 8080,
    args,
    launchMode: template.launchMode === 'api' ? 'api' : 'chat',
    createdAt,
    updatedAt,
    ...(options.fileName ? { _file: options.fileName } : {})
  }
}

function saveTemplateToDirectory(templatesDir: string, template: Template): void {
  const { _file, ...persisted } = normalizeTemplateRecord(template as unknown as Record<string, unknown>) as Template & { _file?: string }
  writeFileSync(join(templatesDir, `${template.id}.json`), JSON.stringify(persisted, null, 2))
}

function migrateTemplatesToBackend(backendName: string): Template[] {
  const templatesDir = getAppPaths().templates
  const templates = listTemplatesFromDirectory(templatesDir)
  const now = new Date().toISOString()

  for (const template of templates) {
    if (!template.backendVersion) continue

    saveTemplateToDirectory(templatesDir, {
      ...template,
      backendVersion: backendName,
      updatedAt: now
    })
  }

  return listTemplatesFromDirectory(templatesDir)
}

function buildBackendUpdateResult(activeBackendName: string): BackendUpdateResult {
  return {
    snapshot: buildFilesystemSnapshot(),
    templates: migrateTemplatesToBackend(activeBackendName),
    activeBackendName
  }
}

async function killProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    killer.on('exit', () => resolve())
    killer.on('error', () => resolve())
  })
}

function resolveAppIconPath(): string | undefined {
  const candidates = [
    join(process.cwd(), 'assets', 'icon.png'),
    join(__dirname, '../../assets/icon.png'),
    join(app.getAppPath(), 'assets', 'icon.png')
  ]

  return candidates.find(existsSync)
}

function listBackendsFromDirectory(backendDir: string): BackendEntry[] {
  if (!existsSync(backendDir)) return []

  const backends = readdirSync(backendDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const basePath = join(backendDir, entry.name)
      const commandsPath = join(basePath, 'commands.json')
      const exe = findBackendExecutable(basePath)

      return {
        name: entry.name,
        displayName: getBackendDisplayName(basePath, entry.name),
        path: basePath,
        hasCommands: existsSync(commandsPath),
        exe
      }
    })
    .filter((backend) => backend.exe !== null)

  backends.sort((left, right) => {
    return parseBuildNumber(right.displayName) - parseBuildNumber(left.displayName)
  })

  return backends
}

function buildFilesystemSnapshot(): { paths: AppPaths; models: ModelEntry[]; backends: BackendEntry[] } {
  const paths = getAppPaths()

  return {
    paths,
    models: listModelsFromDirectory(paths.models),
    backends: listBackendsFromDirectory(paths.backend)
  }
}
const runningProcesses = new Map<string, ChildProcess>()
interface DownloadTask {
  id: string
  url: string
  filename: string
  destPath: string
  receivedBytes: number
  totalBytes: number
  speed: number
  phase: 'downloading' | 'paused' | 'done' | 'error' | 'cancelled'
  repoId?: string
  cancelFn?: () => void
}
const downloadTasks = new Map<string, DownloadTask>()
const broadcastTimes = new Map<string, number>()
const BROADCAST_THROTTLE_MS = 200
let sourceUpdateJob: SourceUpdateJob | null = null
function canBroadcast(id: string): boolean {
  const now = Date.now()
  const last = broadcastTimes.get(id) || 0
  if (now - last >= BROADCAST_THROTTLE_MS) { broadcastTimes.set(id, now); return true }
  return false
}
function requestJson(url: string, options: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestImpl = url.startsWith('https') ? https.request : http.request
    const req = requestImpl(url, {
      method: options.method ?? 'GET',
      headers: {
        'User-Agent': 'hexllama/1.0.0',
        Accept: 'application/json',
        ...(options.headers ?? {})
      }
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return requestJson(res.headers.location, options).then(resolve).catch(reject)
      }

      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        const trimmedData = data.trim()
        const statusCode = res.statusCode ?? 500

        if (statusCode >= 400) {
          reject(new Error(trimmedData || `HTTP ${statusCode}`))
          return
        }

        if (!trimmedData) {
          resolve(null)
          return
        }

        try {
          resolve(JSON.parse(trimmedData))
        } catch (error) {
          reject(error)
        }
      })
    })

    req.on('error', reject)
    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

function fetchJson(url: string): Promise<unknown> {
  return requestJson(url)
}

async function listLiteLlmModelsFromSettings(): Promise<LiteLlmModelEntry[]> {
  if (!isLiteLlmProxyRunning()) {
    throw new Error('LiteLLM proxy is not running.')
  }

  const response = await requestJson(buildLiteLlmApiUrl(getManagedLiteLlmBaseUrl(), '/models'), {
    headers: buildLiteLlmRequestHeaders(liteLlmSettings)
  }) as { data?: Array<{ id?: string }> } | null

  const models = Array.isArray(response?.data)
    ? response.data
        .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
        .filter((value): value is string => Boolean(value))
        .map((id) => ({ id, label: id }))
    : []

  return models.sort((left, right) => left.label.localeCompare(right.label))
}
function startDownload(
  url: string,
  destPath: string,
  startByte: number,
  onProgress: (received: number, total: number, speed: number) => void,
  onDone: () => void,
  onError: (err: Error) => void
): () => void {
  let destroyed = false
  let currentReq: ReturnType<typeof https.get> | null = null
  const flags = startByte > 0 ? 'a' : 'w'
  const file = createWriteStream(destPath, { flags })

  let speedBytes = 0
  let lastSpeedCheck = Date.now()
  let currentSpeed = 0

  const attempt = (currentUrl: string) => {
    const get = currentUrl.startsWith('https') ? https.get : http.get
    const headers: Record<string, string> = { 'User-Agent': 'hexllama/1.0' }
    if (startByte > 0) headers['Range'] = `bytes=${startByte}-`
    currentReq = get(currentUrl, { headers }, (res) => {
      if (destroyed) { res.destroy(); return }
      if (res.statusCode === 301 || res.statusCode === 302) {
        return attempt(res.headers.location!)
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        if (!destroyed) onError(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const contentLength = parseInt(res.headers['content-length'] || '0', 10)
      const totalBytes = contentLength + startByte
      let receivedBytes = startByte

      res.on('data', (chunk: Buffer) => {
        if (destroyed) return
        file.write(chunk)
        receivedBytes += chunk.length
        speedBytes += chunk.length

        const now = Date.now()
        const elapsed = (now - lastSpeedCheck) / 1000
        if (elapsed >= 0.5) {
          currentSpeed = speedBytes / elapsed
          speedBytes = 0
          lastSpeedCheck = now
        }
        onProgress(receivedBytes, totalBytes, currentSpeed)
      })

      res.on('end', () => {
        if (destroyed) return
        file.end(() => {
          if (!destroyed) onDone()
        })
      })

      res.on('error', (err) => {
        if (!destroyed) { file.destroy(); onError(err) }
      })
    }).on('error', (err) => {
      if (!destroyed) { file.destroy(); onError(err) }
    })
  }
  attempt(url)
  return () => {
    if (destroyed) return
    destroyed = true
    currentReq?.destroy()
    
    file.end()
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('get-litellm-manager', async () => {
    return buildLiteLlmManagerSnapshot()
  })
  ipcMain.handle('save-litellm-manager-settings', async (_e, input: LiteLlmManagerSettingsInput) => {
    try {
      saveLiteLlmManagerSettings(input)
      return { success: true, snapshot: await buildLiteLlmManagerSnapshot() }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
  ipcMain.handle('save-litellm-config', async (_e, configText: string) => {
    try {
      saveLiteLlmConfigText(configText)
      appendLiteLlmLog(`Saved LiteLLM config to ${liteLlmManagerSettings.configPath}`)
      return { success: true, snapshot: await buildLiteLlmManagerSnapshot() }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
  ipcMain.handle('install-litellm', async () => {
    return installOrUpdateLiteLlm(false)
  })
  ipcMain.handle('update-litellm', async () => {
    return installOrUpdateLiteLlm(true)
  })
  ipcMain.handle('start-litellm-proxy', async () => {
    return startLiteLlmProxyProcess()
  })
  ipcMain.handle('stop-litellm-proxy', async () => {
    return stopLiteLlmProxyProcess()
  })
  ipcMain.handle('test-litellm-connection', async () => {
    try {
      const models = await listLiteLlmModelsFromSettings()
      return { success: true, modelCount: models.length }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('list-litellm-models', async () => {
    try {
      return { success: true, models: await listLiteLlmModelsFromSettings() }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('list-models', () => {
    return listModelsFromDirectory(getAppPaths().models)
  })
  ipcMain.handle('delete-model', (_e, filePath: string) => {
    try {
      const modelsDir = getAppPaths().models
      if (!isSafePath(modelsDir, filePath)) return { success: false, error: 'Access denied' }
      unlinkSync(filePath)
      const dir = dirname(filePath)
      if (dir !== modelsDir) {
        try { if (readdirSync(dir).length === 0) rmdirSync(dir) } catch {}
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('rename-model', (_e, oldPath: string, newName: string) => {
    try {
      const modelsDir = getAppPaths().models
      if (!isSafePath(modelsDir, oldPath)) return { success: false, error: 'Access denied' }
      const dir = dirname(oldPath)
      const newPath = join(dir, newName + extname(oldPath))
      if (!isSafePath(modelsDir, newPath)) return { success: false, error: 'Access denied' }
      renameSync(oldPath, newPath)
      return { success: true, newPath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('start-model-download', (event, opts: {
    url: string
    filename: string
    repoId?: string
    modelFolder?: string
  }) => {
    const id = opts.filename
    if (downloadTasks.has(id)) {
      const t = downloadTasks.get(id)!
      if (t.phase === 'downloading') return { success: false, error: 'Already downloading' }
    }
    const modelsDir = getAppPaths().models
    const folder = opts.modelFolder || opts.repoId?.split('/').pop() || 'downloads'
    const destDir = join(modelsDir, folder)
    if (!isSafePath(modelsDir, destDir)) return { success: false, error: 'Access denied' }
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    const finalPath = join(destDir, opts.filename)
    const tmpPath = finalPath + '.tmp'
    const task: DownloadTask = {
      id, url: opts.url, filename: opts.filename,
      destPath: finalPath, receivedBytes: 0, totalBytes: 0, speed: 0,
      phase: 'downloading', repoId: opts.repoId
    }
    const broadcastProgress = (t: DownloadTask, force = false) => {
      if (!force && !canBroadcast(t.id)) return
      const payload = {
        id: t.id, filename: t.filename,
        percent: t.totalBytes > 0 ? Math.round((t.receivedBytes / t.totalBytes) * 100) : 0,
        receivedBytes: t.receivedBytes, totalBytes: t.totalBytes,
        speed: t.speed, phase: t.phase, destPath: t.destPath,
        repoId: t.repoId
      }
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('model-download-progress', payload)
      })
    }
    task.cancelFn = startDownload(
      opts.url, tmpPath, 0,
      (received, total, speed) => { task.receivedBytes = received; task.totalBytes = total; task.speed = speed; broadcastProgress(task) },
      () => {
        try { renameSync(tmpPath, finalPath) } catch {}
        task.phase = 'done'; task.speed = 0; broadcastProgress(task, true)
        setTimeout(() => { downloadTasks.delete(id); broadcastTimes.delete(id) }, 5000)
      },
      (err) => { task.phase = 'error'; task.speed = 0; broadcastProgress(task, true); console.error('Download error:', err) }
    )
    downloadTasks.set(id, task)
    broadcastProgress(task, true)
    return { success: true, id }
  })
  ipcMain.handle('pause-model-download', (_e, id: string) => {
    const task = downloadTasks.get(id)
    if (!task || task.phase !== 'downloading') return { success: false, error: 'Not downloading' }
    task.cancelFn?.()
    task.phase = 'paused'
    task.speed = 0
    
    broadcastTimes.delete(id)
    const payload = {
      id, filename: task.filename, phase: 'paused', speed: 0,
      percent: task.totalBytes > 0 ? Math.round((task.receivedBytes / task.totalBytes) * 100) : 0,
      receivedBytes: task.receivedBytes, totalBytes: task.totalBytes,
      destPath: task.destPath, repoId: task.repoId
    }
    BrowserWindow.getAllWindows().forEach(win => { 
      if (!win.isDestroyed()) {
        win.webContents.send('model-download-progress', payload)
        if (task.repoId) win.webContents.send('hf-download-progress', payload)
      }
    })
    return { success: true }
  })
  ipcMain.handle('resume-model-download', (_e, id: string) => {
    const task = downloadTasks.get(id)
    if (!task || task.phase !== 'paused') return { success: false, error: 'Not paused' }
    task.phase = 'downloading'
    const tmpPath = task.destPath + '.tmp'
    
    try { task.receivedBytes = statSync(tmpPath).size } catch {}
    const broadcastProgress = (t: DownloadTask, force = false) => {
      if (!force && !canBroadcast(t.id)) return
      const payload = {
        id: t.id, filename: t.filename, phase: t.phase, speed: t.speed,
        percent: t.totalBytes > 0 ? Math.round((t.receivedBytes / t.totalBytes) * 100) : 0,
        receivedBytes: t.receivedBytes, totalBytes: t.totalBytes, destPath: t.destPath,
        repoId: t.repoId
      }
      BrowserWindow.getAllWindows().forEach(win => { 
        if (!win.isDestroyed()) {
          win.webContents.send('model-download-progress', payload)
          if (t.repoId) win.webContents.send('hf-download-progress', payload)
        }
      })
    }
    const startByte = task.receivedBytes
    task.cancelFn = startDownload(
      task.url, tmpPath, startByte,
      (received, total, speed) => { task.receivedBytes = received; task.totalBytes = total; task.speed = speed; broadcastProgress(task) },
      () => {
        try { renameSync(tmpPath, task.destPath) } catch {}
        task.phase = 'done'; task.speed = 0; broadcastProgress(task, true)
        setTimeout(() => { downloadTasks.delete(id); broadcastTimes.delete(id) }, 5000)
      },
      (err) => { task.phase = 'error'; task.speed = 0; broadcastProgress(task, true); console.error('Resume error:', err) }
    )
    broadcastProgress(task, true)
    return { success: true }
  })
  ipcMain.handle('cancel-model-download', (event, id: string) => {
    const task = downloadTasks.get(id)
    if (!task) return { success: false, error: 'Not found' }
    task.cancelFn?.()
    task.phase = 'cancelled'
    
    try { unlinkSync(task.destPath + '.tmp') } catch {}
    try { unlinkSync(task.destPath) } catch {}
    const payload = { id, filename: task.filename, phase: 'cancelled', percent: 0, receivedBytes: 0, totalBytes: 0, speed: 0 }
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('model-download-progress', payload)
        if (task.repoId) win.webContents.send('hf-download-progress', payload)
      }
    })
    downloadTasks.delete(id)
    return { success: true }
  })
  ipcMain.handle('list-model-downloads', () => {
    return Array.from(downloadTasks.values()).map(t => ({
      id: t.id, url: t.url, filename: t.filename, destPath: t.destPath,
      receivedBytes: t.receivedBytes, totalBytes: t.totalBytes, phase: t.phase,
      percent: t.totalBytes > 0 ? Math.round((t.receivedBytes / t.totalBytes) * 100) : 0
    }))
  })
  ipcMain.handle('list-backends', () => {
    return listBackendsFromDirectory(getAppPaths().backend)
  })
  ipcMain.handle('delete-backend', (_e, backendName: string) => {
    try {
      const backendDir = getAppPaths().backend
      const backendPath = join(backendDir, backendName)
      if (!isSafePath(backendDir, backendPath)) return { success: false, error: 'Access denied' }
      const rm = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name)
          e.isDirectory() ? rm(p) : unlinkSync(p)
        }
        rmdirSync(dir)
      }
      rm(backendPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('get-commands', (_e, backendName: string) => {
    const backendDir = getAppPaths().backend
    const commandsPath = join(backendDir, backendName, 'commands.json')
    if (!isSafePath(backendDir, commandsPath)) return null
    if (existsSync(commandsPath)) return JSON.parse(readFileSync(commandsPath, 'utf-8'))
    const defaultPath = join(APP_ROOT, 'resources', 'commands.json')
    if (existsSync(defaultPath)) return JSON.parse(readFileSync(defaultPath, 'utf-8'))
    return null
  })
  ipcMain.handle('save-backend-commands', (_e, backendName: string, schema: unknown) => {
    try {
      const backendDir = getAppPaths().backend
      const backendPath = join(backendDir, backendName)
      if (!isSafePath(backendDir, backendPath)) return { success: false, error: 'Access denied' }
      if (!existsSync(backendPath)) mkdirSync(backendPath, { recursive: true })
      writeFileSync(join(backendPath, 'commands.json'), JSON.stringify(schema, null, 2))
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('list-templates', () => {
    const templatesDir = getAppPaths().templates
    return listTemplatesFromDirectory(templatesDir)
  })
  ipcMain.handle('get-template', (_e, templateId: string) => {
    return getTemplateById(templateId)
  })
  ipcMain.handle('save-template', (_e, template: Record<string, unknown>) => {
    const templatesDir = getAppPaths().templates
    const normalized = normalizeTemplateRecord(template)
    saveTemplateToDirectory(templatesDir, normalized)
    return { success: true, id: normalized.id }
  })
  ipcMain.handle('delete-template', (_e, id: string) => {
    const templatesDir = getAppPaths().templates
    const fp = join(templatesDir, `${id}.json`)
    if (!isSafePath(templatesDir, fp)) return { success: false, error: 'Access denied' }
    if (existsSync(fp)) unlinkSync(fp)
    return { success: true }
  })
  ipcMain.handle('import-template', async () => {
    const templatesDir = getAppPaths().templates
    const r = await dialog.showOpenDialog({ title: 'Import Template', filters: [{ name: 'JSON Template', extensions: ['json'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths.length) return null
    const data = JSON.parse(readFileSync(r.filePaths[0], 'utf-8')) as Record<string, unknown>
    const normalized = normalizeTemplateRecord(data, { idFallback: Date.now().toString() })
    saveTemplateToDirectory(templatesDir, normalized)
    return normalized
  })
  ipcMain.handle('export-template', async (_e, template: Record<string, unknown>) => {
    const r = await dialog.showSaveDialog({ title: 'Export Template', defaultPath: `${template.name ?? 'template'}.json`, filters: [{ name: 'JSON Template', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return { success: false }
    writeFileSync(r.filePath, JSON.stringify(template, null, 2)); return { success: true }
  })
  ipcMain.handle('pick-model-file', async () => {
    const r = await dialog.showOpenDialog({ title: 'Select Model File', filters: [{ name: 'GGUF / GGML Models', extensions: ['gguf', 'bin', 'ggml'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths.length) return null
    return { name: basename(r.filePaths[0]), path: r.filePaths[0] }
  })
  ipcMain.handle('run-model', (_e, opts: { id: string; backendPath: string; exe: string; args: string[]; openBrowser: boolean; port: number }) => {
    if (runningProcesses.has(opts.id)) return { success: false, error: 'Already running' }
    const backendDir = getAppPaths().backend
    const exePath = join(opts.backendPath, opts.exe)
    if (!isSafePath(backendDir, exePath)) return { success: false, error: 'Access denied' }
    if (!existsSync(exePath)) return { success: false, error: `Executable not found: ${exePath}` }
    try {
      const proc = spawn(exePath, opts.args, { detached: false, stdio: 'pipe', cwd: dirname(exePath), windowsHide: false })
      proc.stderr?.on('data', (d) => console.error('[llama-server]', d.toString()))
      proc.stdout?.on('data', (d) => console.log('[llama-server]', d.toString()))
      proc.on('error', (err: any) => {
        let msg = String(err)
        if (err.code === 'UNKNOWN' && opts.backendPath.toLowerCase().includes('arm64') && process.arch !== 'arm64') {
          msg = 'Architecture mismatch: You are trying to run an ARM64 backend on an x64 system. Please delete this backend in Settings and download the x64 version.'
        }
        console.error('[llama-server] spawn error:', msg)
        runningProcesses.delete(opts.id)
        _e.sender.send('model-error', { id: opts.id, error: msg })
      })
      runningProcesses.set(opts.id, proc)
      proc.on('exit', () => runningProcesses.delete(opts.id))
      if (opts.openBrowser) {
        setTimeout(() => {
          openChatWindow(opts.port)
        }, 2500)
      }
      return { success: true, pid: proc.pid }
    } catch (err: any) {
      if (err.code === 'UNKNOWN' && opts.backendPath.toLowerCase().includes('arm64') && process.arch !== 'arm64') {
        return { success: false, error: 'Architecture mismatch: You are trying to run an ARM64 backend on an x64 system. Please delete this backend in Settings and download the x64 version.' }
      }
      return { success: false, error: String(err) }
    }
  })
  
  function openChatWindow(port: number) {
    const chatUrl = `http://127.0.0.1:${port}`
    const icon = resolveAppIconPath()
    
    const chatWin = new BrowserWindow({
      width: 1024, height: 768, show: true, autoHideMenuBar: true,
      title: 'Hexllama - Llama-UI',
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#ffffff',
      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl) {
      chatWin.loadURL(`${rendererUrl}?chat_url=${encodeURIComponent(chatUrl)}`)
    } else {
      chatWin.loadFile(join(__dirname, '../renderer/index.html'), { query: { chat_url: chatUrl } })
    }
  }

  ipcMain.handle('open-chat-window', (_e, port: number) => {
    openChatWindow(port)
  })
  ipcMain.handle('stop-model', (_e, id: string) => {
    const proc = runningProcesses.get(id)
    if (!proc) return { success: false, error: 'Not running' }
    proc.kill(); runningProcesses.delete(id)
    return { success: true }
  })

  let cancelBackendDl: (() => void) | null = null

  function hasActiveTransfers(): boolean {
    return sourceUpdateJob !== null || cancelBackendDl !== null || Array.from(downloadTasks.values()).some((task) => !['done', 'error', 'cancelled'].includes(task.phase))
  }

  ipcMain.handle('check-updates', async () => {
    try {
      const latestTag = getLatestGitTag()
      const latestNum = parseBuildNumber(latestTag.tagName)
      const backendDir = getAppPaths().backend
      const installedBackends = existsSync(backendDir) ? listBackendsFromDirectory(backendDir) : []
      const isNewer = !installedBackends.some((backend) => {
        const backendNum = parseBuildNumber(backend.displayName)
        return backend.displayName === latestTag.tagName || backendNum >= latestNum
      })

      return {
        tagName: latestTag.tagName,
        name: latestTag.tagName,
        url: latestTag.url,
        publishedAt: '',
        isNewer,
        assets: []
      }
    } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('update-backend-source', async (event, requestedTagName?: string) => {
    if (runningProcesses.size > 0) {
      return { success: false, error: 'Stop running model processes before updating the backend.' }
    }

    if (hasActiveTransfers()) {
      return { success: false, error: 'Finish or cancel active downloads or updates before starting a source update.' }
    }

    const repoDir = getAppPaths().backend

    try {
      assertGitRepo(repoDir)
    } catch {
      return { success: false, error: 'The configured backend folder must be a llama.cpp git repository root to build from source.' }
    }

    const scriptPath = ensureSourceUpdateScript()
    const cudaArch = getConfiguredCudaArch(repoDir)
    const buildType = process.env['HEXLLAMA_BUILD_TYPE']?.trim() || 'Release'
    let targetTagName = requestedTagName?.trim()

    if (!targetTagName) {
      try {
        targetTagName = getLatestGitTag().tagName
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }

    if (!targetTagName || !/^b\d+$/.test(targetTagName)) {
      return { success: false, error: 'Could not determine a valid upstream llama.cpp build tag.' }
    }

    event.sender.send('download-progress', { percent: 3, phase: 'starting' })

    return await new Promise<{ success: true; result: BackendUpdateResult } | { success: false; error: string; cancelled?: boolean }>((resolve) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-RepoDir', repoDir, '-TargetRef', targetTagName, '-CudaArch', cudaArch, '-BuildType', buildType],
        { windowsHide: true }
      )

      const job: SourceUpdateJob = { process: child, cancelled: false }
      sourceUpdateJob = job
      let stdoutBuffer = ''
      let stderrBuffer = ''
      let buildName = ''

      const handleLine = (line: string) => {
        if (!line.trim()) return

        if (line.startsWith('HEXLLAMA_PROGRESS|')) {
          const [, phase, percent, message = ''] = line.split('|')
          event.sender.send('download-progress', { phase, percent: Number(percent), message })
          return
        }

        if (line.startsWith('HEXLLAMA_RESULT|')) {
          const [, reportedBuildName] = line.split('|')
          buildName = reportedBuildName
          return
        }

        console.log('[backend-source-update]', line)
      }

      child.stdout?.on('data', (data) => {
        stdoutBuffer += data.toString()
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() || ''
        lines.forEach(handleLine)
      })

      child.stderr?.on('data', (data) => {
        stderrBuffer += data.toString()
      })

      child.on('error', (error) => {
        if (sourceUpdateJob === job) {
          sourceUpdateJob = null
        }

        removeFailedSourceBuild(repoDir, targetTagName)
        event.sender.send('download-progress', null)
        resolve({ success: false, error: String(error) })
      })

      child.on('exit', (code) => {
        if (stdoutBuffer.trim()) handleLine(stdoutBuffer.trim())
        if (sourceUpdateJob === job) {
          sourceUpdateJob = null
        }

        if (job.cancelled) {
          removeFailedSourceBuild(repoDir, targetTagName)
          event.sender.send('download-progress', null)
          resolve({ success: false, error: 'cancelled', cancelled: true })
          return
        }

        if (code !== 0) {
          removeFailedSourceBuild(repoDir, targetTagName)
          event.sender.send('download-progress', null)
          resolve({ success: false, error: stderrBuffer.trim() || 'Source update failed.' })
          return
        }

        const backends = listBackendsFromDirectory(repoDir)
        const nextBackend = backends.find((backend) => backend.name === buildName || backend.displayName === buildName) || backends[0]
        if (!nextBackend) {
          event.sender.send('download-progress', null)
          resolve({ success: false, error: 'Build completed but no runnable backend was discovered.' })
          return
        }

        event.sender.send('download-progress', { percent: 100, phase: 'done' })
        resolve({ success: true, result: buildBackendUpdateResult(nextBackend.name) })
      })
    })
  })
  ipcMain.handle('download-release', async (event, opts: { url: string; version: string; assetName: string }) => {
    const zipPath = join(app.getPath('temp'), opts.assetName)
    const backendDir = getAppPaths().backend
    const extractPath = join(backendDir, opts.version)
    try {
      event.sender.send('download-progress', { percent: 0, phase: 'downloading' })
      await new Promise<void>((resolve, reject) => {
        cancelBackendDl = startDownload(opts.url, zipPath, 0,
          (r, t) => event.sender.send('download-progress', { percent: t > 0 ? Math.round(r / t * 100) : 0, phase: 'downloading' }),
          resolve, reject)
      })
      cancelBackendDl = null
      event.sender.send('download-progress', { percent: 100, phase: 'extracting' })
      if (!existsSync(extractPath)) mkdirSync(extractPath, { recursive: true })
      await extract(zipPath, { dir: extractPath })
      try { unlinkSync(zipPath) } catch {}
      return { success: true, path: extractPath }
    } catch (err) { 
      cancelBackendDl = null
      try { unlinkSync(zipPath) } catch {}
      return { success: false, error: String(err) } 
    }
  })
  ipcMain.handle('cancel-backend-download', () => {
    if (sourceUpdateJob?.process.pid) {
      sourceUpdateJob.cancelled = true
      void killProcessTree(sourceUpdateJob.process.pid)
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('download-progress', { percent: 0, phase: 'cancelled' })
        }
      })
      return { success: true }
    }

    if (cancelBackendDl) {
      cancelBackendDl()
      cancelBackendDl = null
    }
    return { success: true }
  })
  ipcMain.handle('open-folder', (_e, folderPath: string) => shell.openPath(folderPath))
  ipcMain.handle('get-paths', () => getAppPaths())
  ipcMain.handle('choose-app-folder', async (_e, kind: ConfigurablePathKind) => {
    if (kind !== 'models' && kind !== 'backend') return null

    const result = await dialog.showOpenDialog({
      title: kind === 'models' ? 'Select Models Folder' : 'Select Backend Folder',
      defaultPath: getAppPaths()[kind],
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || !result.filePaths.length) return null
    return resolve(result.filePaths[0])
  })
  ipcMain.handle('set-app-folder', (_e, kind: ConfigurablePathKind, nextPath: string) => {
    if (kind !== 'models' && kind !== 'backend') {
      return { success: false, error: 'Invalid folder kind' }
    }

    if (hasActiveTransfers()) {
      return { success: false, error: 'Finish or cancel active downloads before changing storage folders' }
    }

    try {
      updateAppPath(kind, nextPath)
      return { success: true, snapshot: buildFilesystemSnapshot() }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('open-external', (_e, url: string) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
  })
  ipcMain.handle('hf-search', async (_e, query: string) => {
    try {
      const data = await fetchJson(`https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&limit=24&sort=downloads&direction=-1`) as any[]
      return data.map(m => ({ id: m.id, author: m.author || m.id.split('/')[0] || '', name: m.id.split('/').pop() || m.id, downloads: m.downloads || 0, likes: m.likes || 0, tags: m.tags || [], lastModified: m.lastModified || '' }))
    } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('hf-get-files', async (_e, repoId: string) => {
    try {
      const data = await fetchJson(`https://huggingface.co/api/models/${repoId}/tree/main`) as any[]
      return data.filter((f: any) => f.type === 'file' && f.path.endsWith('.gguf')).map((f: any) => ({
        name: f.path,
        size: f.size || 0,
        downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${f.path}`
      }))
    } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('hf-download-model', (_event, opts: { repoId: string; filename: string; downloadUrl: string }) => {
    const id = opts.filename
    if (downloadTasks.has(id)) {
      const existing = downloadTasks.get(id)!
      if (existing.phase === 'downloading') return { success: false, error: 'Already downloading' }
    }
    const modelsDir = getAppPaths().models
    const folder = opts.repoId.split('/').pop() || 'downloads'
    const destDir = join(modelsDir, folder)
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    const finalPath = join(destDir, opts.filename)
    const tmpPath = finalPath + '.tmp'
    const task: DownloadTask = { id, url: opts.downloadUrl, filename: opts.filename, destPath: finalPath, receivedBytes: 0, totalBytes: 0, speed: 0, phase: 'downloading', repoId: opts.repoId }
    const broadcast = (force = false) => {
      if (!force && !canBroadcast(task.id)) return
      const percent = task.totalBytes > 0 ? Math.round(task.receivedBytes / task.totalBytes * 100) : 0

      const payload = {
        id: task.id, filename: task.filename, phase: task.phase,
        percent, speed: task.speed, destPath: task.destPath,
        receivedBytes: task.receivedBytes, totalBytes: task.totalBytes,
        repoId: task.repoId
      }
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('hf-download-progress', payload)
        }
      })
    }
    task.cancelFn = startDownload(
      opts.downloadUrl, tmpPath, 0,
      (r, t, speed) => { task.receivedBytes = r; task.totalBytes = t; task.speed = speed; broadcast() },
      () => {
        try { renameSync(tmpPath, finalPath) } catch {}
        task.phase = 'done'; task.speed = 0; broadcast(true)
        setTimeout(() => { downloadTasks.delete(id); broadcastTimes.delete(id) }, 10000)
      },
      (err) => { task.phase = 'error'; task.speed = 0; broadcast(true); console.error('HF download error:', err) }
    )
    downloadTasks.set(id, task)
    return { success: true }
  })
  ipcMain.handle('hf-open-models-dir', () => shell.openPath(getAppPaths().models))
  ipcMain.handle('onDownloadProgress', () => {})
  ipcMain.handle('removeDownloadListener', () => {})
}
