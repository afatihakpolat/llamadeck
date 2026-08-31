import { describe, expect, it } from 'vitest'
import type { ModelExitEvent } from '../../../../shared/types'
import { isCurrentModelExit } from '../modelLifecycle'

function exitEvent(pid?: number): ModelExitEvent {
  return {
    id: 'template-a',
    code: 0,
    signal: null,
    ...(pid === undefined ? {} : { pid })
  }
}

describe('model lifecycle events', () => {
  it('rejects an exit from the previous process after a replacement starts', () => {
    expect(isCurrentModelExit(2002, exitEvent(1001))).toBe(false)
  })

  it('accepts the current process exit and legacy events without a pid', () => {
    expect(isCurrentModelExit(2002, exitEvent(2002))).toBe(true)
    expect(isCurrentModelExit(2002, exitEvent())).toBe(true)
  })
})
