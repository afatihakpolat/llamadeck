import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(SCRIPT_DIR, '..')
const EXECUTABLE_PATH = join(PROJECT_DIR, 'dist', 'win-unpacked', 'LlamaDeck.exe')
const TIMEOUT_MS = 60_000
const MAX_LOG_CHARS = 32_000

function appendBounded(current, chunk) {
  return `${current}${chunk.toString()}`.slice(-MAX_LOG_CHARS)
}

async function run() {
  if (process.platform !== 'win32') {
    throw new Error('The packaged smoke test currently targets the Windows unpacked build.')
  }
  if (!existsSync(EXECUTABLE_PATH)) {
    throw new Error(`Packaged executable not found at ${EXECUTABLE_PATH}. Run npm run package first.`)
  }

  const smokeDirectory = await mkdtemp(join(tmpdir(), 'llamadeck-package-smoke-'))
  const resultPath = join(smokeDirectory, 'result.json')
  const userDataPath = join(smokeDirectory, 'user-data')
  let stdout = ''
  let stderr = ''

  try {
    const child = spawn(EXECUTABLE_PATH, [], {
      cwd: PROJECT_DIR,
      windowsHide: true,
      env: {
        ...process.env,
        LLAMADECK_SMOKE_TEST: '1',
        LLAMADECK_SMOKE_RESULT: resultPath,
        LLAMADECK_SMOKE_USER_DATA: userDataPath
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk) })

    const exitCode = await new Promise((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => {
        child.kill()
        rejectExit(new Error(`Packaged app did not finish its smoke probe within ${TIMEOUT_MS / 1000} seconds.`))
      }, TIMEOUT_MS)

      child.once('error', (error) => {
        clearTimeout(timeout)
        rejectExit(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        resolveExit(code)
      })
    })

    if (!existsSync(resultPath)) {
      throw new Error(`Packaged app exited with code ${exitCode} without a smoke result.`)
    }

    const result = JSON.parse(await readFile(resultPath, 'utf8'))
    if (exitCode !== 0 || result.ok !== true) {
      throw new Error(result.error || `Packaged app exited with code ${exitCode}.`)
    }

    const packageJson = JSON.parse(await readFile(join(PROJECT_DIR, 'package.json'), 'utf8'))
    if (result.version !== packageJson.version) {
      throw new Error(`Packaged version ${result.version} does not match package.json ${packageJson.version}.`)
    }

    process.stdout.write(
      `Packaged smoke passed for LlamaDeck ${result.version}: ${result.loadedViews.length} page checks, ${result.apiMethods.length} preload API checks.\n`
    )
  } catch (error) {
    if (stdout) process.stderr.write(`Packaged stdout:\n${stdout}\n`)
    if (stderr) process.stderr.write(`Packaged stderr:\n${stderr}\n`)
    throw error
  } finally {
    const resolvedSmokeDirectory = resolve(smokeDirectory)
    const resolvedTempDirectory = resolve(tmpdir())
    const smokeRelativeToTemp = relative(resolvedTempDirectory, resolvedSmokeDirectory)
    const isInsideTemp = smokeRelativeToTemp !== '' && !smokeRelativeToTemp.startsWith(`..${sep}`) && smokeRelativeToTemp !== '..'
    if (!isInsideTemp) {
      throw new Error(`Refusing to remove smoke directory outside the system temp folder: ${resolvedSmokeDirectory}`)
    }
    await rm(resolvedSmokeDirectory, { recursive: true, force: true })
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
