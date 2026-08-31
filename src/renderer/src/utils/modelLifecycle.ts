import type { ModelExitEvent } from '../../../shared/types'

export function isCurrentModelExit(currentPid: number | undefined, event: ModelExitEvent): boolean {
  return event.pid === undefined || currentPid === undefined || event.pid === currentPid
}
