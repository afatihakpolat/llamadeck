import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import { createAppNotification, getErrorMessage } from '../utils/notifications'

describe('application notifications', () => {
  beforeEach(() => {
    useStore.setState({ notifications: [] })
  })

  it('assigns a useful default timeout by tone', () => {
    expect(createAppNotification({ tone: 'info', title: 'Ready' }, 100).timeoutMs).toBe(6_000)
    expect(createAppNotification({ tone: 'danger', title: 'Failed' }, 100).timeoutMs).toBe(10_000)
    expect(createAppNotification({ tone: 'warning', title: 'Wait', timeoutMs: 0 }, 100).timeoutMs).toBe(0)
  })

  it('deduplicates repeated messages and caps the visible stack', () => {
    const store = useStore.getState()
    store.pushNotification({ tone: 'danger', title: 'Repeated', message: 'Same failure' })
    store.pushNotification({ tone: 'danger', title: 'Repeated', message: 'Same failure' })

    for (let index = 0; index < 6; index += 1) {
      store.pushNotification({ tone: 'info', title: `Notice ${index}` })
    }

    const notifications = useStore.getState().notifications
    expect(notifications).toHaveLength(5)
    expect(notifications.some((notification) => notification.title === 'Repeated')).toBe(false)
    expect(notifications.map((notification) => notification.title)).toEqual([
      'Notice 1',
      'Notice 2',
      'Notice 3',
      'Notice 4',
      'Notice 5'
    ])
  })

  it('dismisses one notification without clearing the others', () => {
    const firstId = useStore.getState().pushNotification({ tone: 'info', title: 'First' })
    useStore.getState().pushNotification({ tone: 'success', title: 'Second' })

    useStore.getState().dismissNotification(firstId)

    expect(useStore.getState().notifications.map((notification) => notification.title)).toEqual(['Second'])
  })

  it('normalizes thrown values into readable messages', () => {
    expect(getErrorMessage(new Error('disk unavailable'))).toBe('disk unavailable')
    expect(getErrorMessage('  stopped  ')).toBe('stopped')
    expect(getErrorMessage(undefined)).toBe('Unknown error')
  })
})
