import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsagePersistedSession } from '../usageSessions'
import { UsageSessionWriter } from '../usageSessionWriter'

function createSession(requestCount: number): UsagePersistedSession {
  return {
    launchId: 'launch-1',
    templateId: 'template-1',
    templateName: 'Template 1',
    startedAt: '2026-08-30T12:00:00.000Z',
    status: 'running',
    requestCount,
    successCount: requestCount,
    errorCount: 0,
    exactUsageCount: requestCount,
    promptTokens: requestCount * 10,
    cacheTokens: 0,
    completionTokens: requestCount * 2,
    totalTokens: requestCount * 12,
    dailyRollups: []
  }
}

describe('UsageSessionWriter', () => {
  let sessionsDir = ''

  beforeEach(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), 'llamadeck-usage-writer-'))
  })

  afterEach(() => {
    rmSync(sessionsDir, { force: true, recursive: true })
  })

  it('writes the latest session snapshot atomically', async () => {
    const writer = new UsageSessionWriter(sessionsDir)

    writer.enqueue(createSession(4))
    await writer.flush()
    writer.enqueue(createSession(5))
    await writer.flush()

    const parsed = JSON.parse(readFileSync(join(sessionsDir, 'launch-1.json'), 'utf-8'))
    expect(parsed.requestCount).toBe(5)
    expect(readdirSync(sessionsDir)).toEqual(['launch-1.json'])
  })

  it('coalesces queued updates while preserving the newest snapshot', async () => {
    let releaseFirstWrite: (() => void) | undefined
    let resolveFirstWriteStarted: (() => void) | undefined
    const firstWriteStarted = new Promise<void>((resolve) => {
      resolveFirstWriteStarted = resolve
    })
    const firstWriteReleased = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const writtenRequestCounts: number[] = []
    const writeSnapshot = vi.fn(async (_targetPath: string, contents: string) => {
      writtenRequestCounts.push(JSON.parse(contents).requestCount)
      if (writtenRequestCounts.length === 1) {
        resolveFirstWriteStarted?.()
        await firstWriteReleased
      }
    })
    const writer = new UsageSessionWriter(sessionsDir, { writeSnapshot })

    writer.enqueue(createSession(1))
    await firstWriteStarted
    writer.enqueue(createSession(2))
    writer.enqueue(createSession(3))
    releaseFirstWrite?.()
    await writer.flush()

    expect(writtenRequestCounts).toEqual([1, 3])
    expect(writeSnapshot).toHaveBeenCalledTimes(2)
  })

  it('reports a failed write and continues with later snapshots', async () => {
    const onError = vi.fn()
    const writeSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValue(undefined)
    const writer = new UsageSessionWriter(sessionsDir, { onError, writeSnapshot })

    writer.enqueue(createSession(1))
    await writer.flush()
    writer.enqueue(createSession(2))
    await writer.flush()

    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      launchId: 'launch-1',
      templateId: 'template-1'
    }))
    expect(writeSnapshot).toHaveBeenCalledTimes(2)
  })
})
