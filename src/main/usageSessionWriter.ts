import { mkdir, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import type { UsagePersistedSession } from './usageSessions'

export interface UsageSessionWriteContext {
  launchId: string
  templateId: string
}

export type UsageSessionSnapshotWriter = (targetPath: string, contents: string) => Promise<void>

export interface UsageSessionWriterOptions {
  onError?: (error: unknown, context: UsageSessionWriteContext) => void
  writeSnapshot?: UsageSessionSnapshotWriter
}

interface PendingUsageSessionSnapshot extends UsageSessionWriteContext {
  contents: string
}

async function writeSnapshotAtomically(targetPath: string, contents: string): Promise<void> {
  const temporaryPath = `${targetPath}.tmp`
  await writeFile(temporaryPath, contents, 'utf-8')
  await rename(temporaryPath, targetPath)
}

export class UsageSessionWriter {
  private readonly pendingSnapshots = new Map<string, PendingUsageSessionSnapshot>()
  private readonly onError: UsageSessionWriterOptions['onError']
  private readonly writeSnapshot: UsageSessionSnapshotWriter
  private activeDrain: Promise<void> | null = null

  constructor(
    private readonly sessionsDir: string,
    options: UsageSessionWriterOptions = {}
  ) {
    this.onError = options.onError
    this.writeSnapshot = options.writeSnapshot ?? writeSnapshotAtomically
  }

  enqueue(session: UsagePersistedSession): void {
    this.pendingSnapshots.set(session.launchId, {
      launchId: session.launchId,
      templateId: session.templateId,
      contents: JSON.stringify(session, null, 2)
    })
    this.scheduleDrain()
  }

  async flush(): Promise<void> {
    while (this.activeDrain || this.pendingSnapshots.size > 0) {
      this.scheduleDrain()
      const activeDrain = this.activeDrain
      if (activeDrain) await activeDrain
      await Promise.resolve()
    }
  }

  private scheduleDrain(): void {
    if (this.activeDrain) return

    const drain = Promise.resolve().then(() => this.drainPending())
    this.activeDrain = drain
    void drain.finally(() => {
      if (this.activeDrain === drain) {
        this.activeDrain = null
      }
      if (this.pendingSnapshots.size > 0) {
        this.scheduleDrain()
      }
    })
  }

  private async drainPending(): Promise<void> {
    while (this.pendingSnapshots.size > 0) {
      const snapshots = Array.from(this.pendingSnapshots.values())
      this.pendingSnapshots.clear()

      try {
        await mkdir(this.sessionsDir, { recursive: true })
      } catch (error) {
        for (const snapshot of snapshots) this.reportError(error, snapshot)
        continue
      }

      await Promise.all(snapshots.map(async (snapshot) => {
        try {
          await this.writeSnapshot(join(this.sessionsDir, `${snapshot.launchId}.json`), snapshot.contents)
        } catch (error) {
          this.reportError(error, snapshot)
        }
      }))
    }
  }

  private reportError(error: unknown, context: UsageSessionWriteContext): void {
    try {
      this.onError?.(error, {
        launchId: context.launchId,
        templateId: context.templateId
      })
    } catch (callbackError) {
      console.error('[usage-session] error callback failed:', callbackError)
    }
  }
}
