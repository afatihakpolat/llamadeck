import { describe, expect, it, vi } from 'vitest'
import type { BackendVersion, Template } from '../../shared/types'
import { createCliCommandHandler, type CliCommandDependencies } from '../cliCommands'
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
    useBackend: vi.fn(async () => undefined)
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
