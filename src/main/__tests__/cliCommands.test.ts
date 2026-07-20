import { describe, expect, it, vi } from 'vitest'
import type { BackendVersion, Template } from '../../shared/types'
import {
  createCliCommandHandler,
  type CliCommandDependencies,
  type CliLiteLlmStatus
} from '../cliCommands'
import type { CliRequest } from '../cliProtocol'

const templates: Template[] = [
  {
    id: 'alpha-id',
    name: 'Alpha',
    modelPath: 'C:\\models\\alpha.gguf',
    serverPort: 8080,
    args: {},
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z'
  },
  {
    id: 'beta-id',
    name: 'Beta',
    modelPath: 'C:\\models\\beta.gguf',
    serverPort: 8081,
    args: {},
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z'
  }
]

const backends: BackendVersion[] = [
  {
    name: 'b1234',
    displayName: 'b1234 · CUDA',
    flavor: 'cuda',
    buildMode: 'parallel',
    path: 'C:\\backends\\b1234',
    hasCommands: true,
    exe: 'bin\\llama-server.exe'
  }
]

const liteLlmStatus: CliLiteLlmStatus = {
  running: false,
  pid: null,
  endpoint: 'http://127.0.0.1:4000',
  settings: {
    host: '127.0.0.1',
    port: 4000,
    configPath: 'C:\\data\\litellm-config.yaml',
    logLevel: 'info',
    apiKeyConfigured: true
  },
  install: {
    pythonCommand: 'py -3',
    pythonVersion: '3.12.0',
    installed: true,
    currentVersion: '1.75.0',
    latestVersion: '1.75.0',
    hasUpdate: false
  },
  config: {
    path: 'C:\\data\\litellm-config.yaml',
    valid: true,
    diagnostics: []
  },
  recentLogCount: 1
}

function request(command: CliRequest['command'], args: string[] = []): CliRequest {
  return { protocol: 1, token: 'test-token', command, args }
}

function createDependencies(): CliCommandDependencies {
  return {
    getVersion: () => '1.2.5',
    listTemplates: () => templates,
    listRunningSessions: () => [],
    listBackends: () => backends,
    getActiveBackendName: () => 'b1234',
    showApp: vi.fn(),
    createTemplate: vi.fn(async (input) => ({
      id: input.id ?? 'created-id',
      name: input.name,
      modelPath: input.modelPath,
      serverPort: input.serverPort,
      args: input.args,
      launchMode: input.launchMode,
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z'
    })),
    updateTemplate: vi.fn(async (template, input) => ({
      ...template,
      ...input,
      description: input.description ?? template.description,
      backendVersion: input.backendVersion ?? template.backendVersion,
      modelPath: input.modelPath ?? template.modelPath,
      pricing: input.pricing ?? template.pricing
    })),
    deleteTemplate: vi.fn(async () => undefined),
    validateTemplate: vi.fn(async (template) => ({
      valid: Boolean(template.modelPath),
      ...('id' in template && template.id ? { templateId: template.id } : {}),
      errors: template.modelPath ? [] : ['Model file is required.'],
      warnings: []
    })),
    getTemplateLogs: vi.fn((template, afterSequence) => ({
      id: template.id,
      name: template.name,
      events: afterSequence === 0
        ? [{ sequence: 1, id: template.id, stream: 'system', text: 'started\n', timestamp: '2026-07-20T00:00:00.000Z' }]
        : [],
      nextCursor: 1,
      hasMore: false,
      running: true
    })),
    waitForTemplateReady: vi.fn(async (template) => ({
      id: template.id,
      name: template.name,
      ready: true,
      url: `http://127.0.0.1:${template.serverPort}`,
      waitedMs: 25,
      statusCode: 200
    })),
    startTemplate: vi.fn(async (template: Template) => ({
      id: template.id,
      name: template.name,
      pid: 123,
      port: template.serverPort,
      backend: 'b1234'
    })),
    stopTemplate: vi.fn(async () => undefined),
    useBackend: vi.fn(async () => undefined),
    getLiteLlmStatus: vi.fn(async () => liteLlmStatus),
    startLiteLlm: vi.fn(async () => ({ ...liteLlmStatus, running: true, pid: 456 })),
    stopLiteLlm: vi.fn(async () => liteLlmStatus),
    installLiteLlm: vi.fn(async () => ({ status: liteLlmStatus, output: 'installed' })),
    testLiteLlm: vi.fn(async () => ({
      connected: true,
      modelCount: 2,
      endpoint: liteLlmStatus.endpoint
    })),
    listLiteLlmModels: vi.fn(async () => [
      { id: 'local/alpha', label: 'local/alpha' },
      { id: 'local/beta', label: 'local/beta' }
    ]),
    getLiteLlmLogs: vi.fn((afterSequence) => ({
      events: afterSequence === 0
        ? [{ sequence: 1, timestamp: '2026-07-20T00:00:00.000Z', text: 'proxy ready' }]
        : [],
      nextCursor: 1,
      hasMore: false,
      running: true
    })),
    getLiteLlmConfig: vi.fn(() => ({
      path: 'C:\\data\\litellm-config.yaml',
      text: 'general_settings:\\n  master_key: <redacted>\\n',
      redacted: true,
      valid: true,
      diagnostics: []
    })),
    validateLiteLlmConfig: vi.fn((configText) => ({
      valid: !configText.includes('invalid'),
      diagnostics: configText.includes('invalid')
        ? [{
            severity: 'error',
            message: 'Invalid YAML',
            line: 1,
            column: 1,
            from: 0,
            to: 1
          }]
        : []
    })),
    setLiteLlmConfig: vi.fn(async () => ({
      status: liteLlmStatus,
      restartRequired: false
    }))
  }
}

describe('createCliCommandHandler', () => {
  it('lists templates and reports status', async () => {
    const handler = createCliCommandHandler(createDependencies())

    await expect(handler(request('template.list'))).resolves.toEqual({ ok: true, result: templates })
    await expect(handler(request('status'))).resolves.toEqual({
      ok: true,
      result: {
        version: '1.2.5',
        templateCount: 2,
        running: []
      }
    })
  })

  it('gets a template by ID or case-insensitive name', async () => {
    const handler = createCliCommandHandler(createDependencies())

    await expect(handler(request('template.get', ['alpha-id']))).resolves.toEqual({ ok: true, result: templates[0] })
    await expect(handler(request('template.get', ['beta']))).resolves.toEqual({ ok: true, result: templates[1] })
  })

  it('starts and stops resolved templates', async () => {
    const dependencies = createDependencies()
    const handler = createCliCommandHandler(dependencies)

    await expect(handler(request('template.start', ['Alpha']))).resolves.toEqual({
      ok: true,
      result: { id: 'alpha-id', name: 'Alpha', pid: 123, port: 8080, backend: 'b1234' }
    })
    await expect(handler(request('template.stop', ['beta-id']))).resolves.toEqual({
      ok: true,
      result: { id: 'beta-id', name: 'Beta', stopped: true }
    })
    expect(dependencies.startTemplate).toHaveBeenCalledWith(templates[0])
    expect(dependencies.stopTemplate).toHaveBeenCalledWith(templates[1])
  })

  it('creates, updates, deletes, and validates templates with structured documents', async () => {
    const dependencies = createDependencies()
    const handler = createCliCommandHandler(dependencies)

    await expect(handler(request('template.create', [JSON.stringify({
      name: 'Created',
      modelPath: 'C:\\models\\created.gguf'
    })]))).resolves.toMatchObject({
      ok: true,
      result: { id: 'created-id', name: 'Created', serverPort: 8080, args: {}, launchMode: 'chat' }
    })
    await expect(handler(request('template.update', ['alpha-id', JSON.stringify({
      description: 'Updated by an agent',
      serverPort: 9000
    })]))).resolves.toMatchObject({
      ok: true,
      result: { id: 'alpha-id', description: 'Updated by an agent', serverPort: 9000 }
    })
    await expect(handler(request('template.delete', ['beta-id', 'yes']))).resolves.toEqual({
      ok: true,
      result: { id: 'beta-id', name: 'Beta', deleted: true }
    })
    await expect(handler(request('template.validate', ['document', JSON.stringify({ name: 'Missing model' })]))).resolves.toEqual({
      ok: true,
      result: { valid: false, errors: ['Model file is required.'], warnings: [] }
    })

    expect(dependencies.createTemplate).toHaveBeenCalledOnce()
    expect(dependencies.updateTemplate).toHaveBeenCalledWith(templates[0], {
      description: 'Updated by an agent',
      serverPort: 9000
    })
    expect(dependencies.deleteTemplate).toHaveBeenCalledWith(templates[1])
  })

  it('returns structured invalid-document validation without mutating', async () => {
    const dependencies = createDependencies()
    const handler = createCliCommandHandler(dependencies)

    const response = await handler(request('template.validate', ['document', '{"name":7}']))

    expect(response).toMatchObject({
      ok: true,
      result: {
        valid: false,
        warnings: []
      }
    })
    expect(dependencies.validateTemplate).not.toHaveBeenCalled()
  })

  it('lists and selects backends and exposes machine-readable capabilities', async () => {
    const dependencies = createDependencies()
    const handler = createCliCommandHandler(dependencies)

    await expect(handler(request('backend.list'))).resolves.toEqual({
      ok: true,
      result: {
        active: 'b1234',
        backends: [{ ...backends[0], active: true }]
      }
    })
    await expect(handler(request('backend.use', ['b1234 · cuda']))).resolves.toEqual({
      ok: true,
      result: { name: 'b1234', displayName: 'b1234 · CUDA', active: true }
    })
    await expect(handler(request('capabilities'))).resolves.toMatchObject({
      ok: true,
      result: {
        application: 'LlamaDeck',
        version: '1.2.5',
        protocol: 1
      }
    })
    expect(dependencies.useBackend).toHaveBeenCalledWith(backends[0])
  })

  it('reads buffered logs and waits for readiness', async () => {
    const handler = createCliCommandHandler(createDependencies())

    await expect(handler(request('template.logs', ['alpha-id', '0', '20']))).resolves.toMatchObject({
      ok: true,
      result: {
        id: 'alpha-id',
        nextCursor: 1,
        running: true,
        events: [{ sequence: 1, text: 'started\n' }]
      }
    })
    await expect(handler(request('template.waitReady', ['alpha-id', '5000']))).resolves.toEqual({
      ok: true,
      result: {
        id: 'alpha-id',
        name: 'Alpha',
        ready: true,
        url: 'http://127.0.0.1:8080',
        waitedMs: 25,
        statusCode: 200
      }
    })
  })

  it('controls LiteLLM and restarts a running proxy through shared operations', async () => {
    const dependencies = createDependencies()
    vi.mocked(dependencies.getLiteLlmStatus).mockResolvedValue({
      ...liteLlmStatus,
      running: true,
      pid: 456
    })
    const handler = createCliCommandHandler(dependencies)

    await expect(handler(request('litellm.status'))).resolves.toEqual({
      ok: true,
      result: { ...liteLlmStatus, running: true, pid: 456 }
    })
    await expect(handler(request('litellm.start'))).resolves.toMatchObject({
      ok: true,
      result: { running: true, pid: 456 }
    })
    await expect(handler(request('litellm.stop'))).resolves.toEqual({
      ok: true,
      result: liteLlmStatus
    })
    await expect(handler(request('litellm.restart'))).resolves.toMatchObject({
      ok: true,
      result: { running: true, pid: 456 }
    })

    expect(dependencies.stopLiteLlm).toHaveBeenCalledTimes(2)
    expect(dependencies.startLiteLlm).toHaveBeenCalledTimes(2)
  })

  it('installs, tests, lists models, and reads LiteLLM logs', async () => {
    const dependencies = createDependencies()
    const handler = createCliCommandHandler(dependencies)

    await expect(handler(request('litellm.install'))).resolves.toMatchObject({
      ok: true,
      result: { output: 'installed' }
    })
    await expect(handler(request('litellm.update'))).resolves.toMatchObject({
      ok: true,
      result: { output: 'installed' }
    })
    await expect(handler(request('litellm.test'))).resolves.toEqual({
      ok: true,
      result: { connected: true, modelCount: 2, endpoint: 'http://127.0.0.1:4000' }
    })
    await expect(handler(request('litellm.models'))).resolves.toMatchObject({
      ok: true,
      result: [{ id: 'local/alpha' }, { id: 'local/beta' }]
    })
    await expect(handler(request('litellm.logs', ['0', '20']))).resolves.toMatchObject({
      ok: true,
      result: {
        nextCursor: 1,
        events: [{ sequence: 1, text: 'proxy ready' }]
      }
    })

    expect(dependencies.installLiteLlm).toHaveBeenNthCalledWith(1, false)
    expect(dependencies.installLiteLlm).toHaveBeenNthCalledWith(2, true)
  })

  it('gets, validates, and safely sets LiteLLM config documents', async () => {
    const dependencies = createDependencies()
    const handler = createCliCommandHandler(dependencies)

    await expect(handler(request('litellm.configGet'))).resolves.toMatchObject({
      ok: true,
      result: { redacted: true, text: expect.stringContaining('<redacted>') }
    })
    await expect(handler(request('litellm.configValidate', ['invalid yaml']))).resolves.toMatchObject({
      ok: true,
      result: { valid: false, diagnostics: [{ message: 'Invalid YAML' }] }
    })
    await expect(handler(request('litellm.configSet', ['model_list: []']))).resolves.toMatchObject({
      ok: true,
      result: {
        valid: true,
        saved: true,
        restartRequired: false,
        status: liteLlmStatus
      }
    })
    expect(dependencies.setLiteLlmConfig).toHaveBeenCalledWith('model_list: []')
  })

  it('returns a distinct not-found error', async () => {
    const handler = createCliCommandHandler(createDependencies())

    await expect(handler(request('template.get', ['missing']))).resolves.toEqual({
      ok: false,
      error: 'Template not found: missing',
      exitCode: 3,
      code: 'NOT_FOUND'
    })
  })
})
