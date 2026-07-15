export type DownloadTaskPhase = 'downloading' | 'paused' | 'done' | 'error' | 'cancelled'

export interface DownloadTaskLike {
  phase: DownloadTaskPhase
}

export interface SourceUpdateJobLike {
  cancelled: boolean
  process: { pid?: number }
}

export interface ActiveWorkSnapshot {
  sourceUpdateJob: SourceUpdateJobLike | null
  cancelBackendDl: (() => void) | null
  downloadTasks: Map<string, DownloadTaskLike>
}

export function hasActiveWork(snapshot: ActiveWorkSnapshot): boolean {
  return (
    snapshot.sourceUpdateJob !== null ||
    snapshot.cancelBackendDl !== null ||
    Array.from(snapshot.downloadTasks.values()).some(
      (task) => task.phase !== 'done' && task.phase !== 'error' && task.phase !== 'cancelled'
    )
  )
}