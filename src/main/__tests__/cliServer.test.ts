import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { connect } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { startCliServer, type CliServerHandle } from '../cliServer'
import type { CliEndpointDescriptor, CliRequest, CliResponse } from '../cliProtocol'

const tempDirs: string[] = []
const servers: CliServerHandle[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function sendRequest(pipeId: string, request: object): Promise<CliResponse> {
  return new Promise((resolveResponse, rejectResponse) => {
    const socket = connect(`\\\\.\\pipe\\${pipeId}`)
    let responseText = ''
    socket.setEncoding('utf-8')
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk: string) => {
      responseText += chunk
    })
    socket.on('end', () => resolveResponse(JSON.parse(responseText) as CliResponse))
    socket.on('error', rejectResponse)
  })
}

function runPowerShellCli(
  endpointFile: string | null,
  args: string[],
  additionalEnv: NodeJS.ProcessEnv = {}
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolveProcess, rejectProcess) => {
    const scriptPath = join(process.cwd(), 'resources', 'cli', 'llamadeck.ps1')
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      {
        windowsHide: true,
        env: {
          ...process.env,
          ...additionalEnv,
          LLAMADECK_CLI_ENDPOINT: endpointFile ?? ''
        }
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', rejectProcess)
    child.on('exit', (exitCode) => resolveProcess({ stdout, stderr, exitCode }))
  })
}

describe.runIf(process.platform === 'win32')('startCliServer', () => {
  it('authenticates and dispatches a request', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-'))
    tempDirs.push(userDataDir)
    const server = await startCliServer({
      userDataDir,
      handleRequest: async (request) => ({ ok: true, result: { command: request.command } })
    })
    servers.push(server)
    const descriptor = JSON.parse(readFileSync(server.endpointFile, 'utf-8')) as CliEndpointDescriptor

    await expect(sendRequest(descriptor.pipeId, {
      protocol: 1,
      token: descriptor.token,
      command: 'status',
      args: []
    })).resolves.toEqual({ ok: true, result: { command: 'status' } })
  })

  it('rejects an invalid token without dispatching', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-'))
    tempDirs.push(userDataDir)
    const server = await startCliServer({
      userDataDir,
      handleRequest: async () => ({ ok: true, result: null })
    })
    servers.push(server)
    const descriptor = JSON.parse(readFileSync(server.endpointFile, 'utf-8')) as CliEndpointDescriptor

    await expect(sendRequest(descriptor.pipeId, {
      protocol: 1,
      token: 'wrong-token',
      command: 'status',
      args: []
    })).resolves.toEqual({ ok: false, error: 'CLI authentication failed.', exitCode: 1 })
  })

  it('serves JSON to the packaged PowerShell client', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-'))
    tempDirs.push(userDataDir)
    const server = await startCliServer({
      userDataDir,
      handleRequest: async () => ({
        ok: true,
        result: { version: '1.2.5', templateCount: 2, running: [] }
      })
    })
    servers.push(server)

    const result = await runPowerShellCli(server.endpointFile, ['status'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({ version: '1.2.5', templateCount: 2, running: [] })
  })

  it('discovers the live endpoint only from the LlamaDeck profile', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-discovery-'))
    tempDirs.push(workDir)
    const appDataDir = join(workDir, 'appdata')
    const userDataDir = join(appDataDir, 'llamadeck')
    const server = await startCliServer({
      userDataDir,
      handleRequest: async () => ({
        ok: true,
        result: { version: '1.5.1', templateCount: 1, running: [] }
      })
    })
    servers.push(server)

    const result = await runPowerShellCli(null, ['status'], {
      APPDATA: appDataDir
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      version: '1.5.1',
      templateCount: 1,
      running: []
    })
  })

  it('ignores a stale descriptor whose process is no longer running', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-stale-'))
    tempDirs.push(workDir)
    const appDataDir = join(workDir, 'appdata')
    const userDataDir = join(appDataDir, 'llamadeck')
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(join(userDataDir, 'cli-endpoint.json'), JSON.stringify({
      protocol: 1,
      pipeId: 'llamadeck-cli-stale',
      token: 'stale-token',
      pid: 2_147_483_647
    }), 'utf-8')

    const result = await runPowerShellCli(null, ['status'], {
      APPDATA: appDataDir
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('LlamaDeck is not running.')
    expect(result.stderr).not.toContain('Timed out waiting')
  })

  it('passes a template file to an agent-focused command', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-'))
    tempDirs.push(userDataDir)
    const templateFile = join(userDataDir, 'template.json')
    writeFileSync(templateFile, JSON.stringify({ name: 'Agent Template', serverPort: 9000 }), 'utf-8')
    const server = await startCliServer({
      userDataDir,
      handleRequest: async (request) => ({
        ok: true,
        result: {
          command: request.command,
          document: JSON.parse(request.args[0]) as unknown
        }
      })
    })
    servers.push(server)

    const result = await runPowerShellCli(server.endpointFile, ['template', 'create', '--file', templateFile])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'template.create',
      document: { name: 'Agent Template', serverPort: 9000 }
    })
  })

  it('returns validation JSON with exit code 2 when a document is invalid', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-'))
    tempDirs.push(userDataDir)
    const server = await startCliServer({
      userDataDir,
      handleRequest: async () => ({
        ok: true,
        result: {
          valid: false,
          errors: ['modelPath is required'],
          warnings: []
        }
      })
    })
    servers.push(server)

    const result = await runPowerShellCli(server.endpointFile, [
      'template',
      'validate',
      '--json',
      '{"name":"Incomplete"}'
    ])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      valid: false,
      errors: ['modelPath is required'],
      warnings: []
    })
  })

  it('passes a LiteLLM YAML file to config set', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-'))
    tempDirs.push(userDataDir)
    const configFile = join(userDataDir, 'litellm.yaml')
    const configText = 'model_list:\n  - model_name: local-model\n'
    writeFileSync(configFile, configText, 'utf-8')
    let receivedRequest: CliRequest | null = null
    const server = await startCliServer({
      userDataDir,
      handleRequest: async (request) => {
        receivedRequest = request
        return {
          ok: true,
          result: { valid: true, diagnostics: [], saved: true }
        }
      }
    })
    servers.push(server)

    const result = await runPowerShellCli(server.endpointFile, [
      'litellm',
      'config',
      'set',
      '--file',
      configFile
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(receivedRequest).toMatchObject({
      command: 'litellm.configSet',
      args: [configText]
    })
    expect(JSON.parse(result.stdout)).toEqual({
      valid: true,
      diagnostics: [],
      saved: true
    })
  })

  it('uses exit code 2 for invalid LiteLLM config validation', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-'))
    tempDirs.push(userDataDir)
    const configFile = join(userDataDir, 'invalid-litellm.yaml')
    writeFileSync(configFile, 'model_list: [', 'utf-8')
    const server = await startCliServer({
      userDataDir,
      handleRequest: async () => ({
        ok: true,
        result: {
          valid: false,
          diagnostics: [{ severity: 'error', message: 'Invalid YAML', line: 1, column: 13 }]
        }
      })
    })
    servers.push(server)

    const result = await runPowerShellCli(server.endpointFile, [
      'litellm',
      'config',
      'validate',
      '--file',
      configFile
    ])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: false,
      diagnostics: [{ message: 'Invalid YAML' }]
    })
  })

  it('streams LiteLLM logs as newline-delimited JSON', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'llamadeck-cli-'))
    tempDirs.push(userDataDir)
    const server = await startCliServer({
      userDataDir,
      handleRequest: async () => ({
        ok: true,
        result: {
          events: [{
            sequence: 4,
            timestamp: '2026-07-20T00:00:00.000Z',
            text: 'proxy stopped'
          }],
          nextCursor: 4,
          hasMore: false,
          running: false
        }
      })
    })
    servers.push(server)

    const result = await runPowerShellCli(server.endpointFile, [
      'litellm',
      'logs',
      '--follow'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      sequence: 4,
      timestamp: '2026-07-20T00:00:00.000Z',
      text: 'proxy stopped'
    })
  })
})
