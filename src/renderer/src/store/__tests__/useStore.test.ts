import { beforeEach, describe, expect, it } from 'vitest'
import type { ModelOutputEvent, Template } from '../../../../shared/types'
import { useStore } from '../useStore'

const template: Template = {
  id: 'template-a',
  name: 'Template A',
  serverPort: 8080,
  args: {},
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z'
}

function outputEvent(index: number, id = template.id): ModelOutputEvent {
  return {
    id,
    stream: 'stdout',
    text: `line-${index}`,
    timestamp: new Date(index).toISOString()
  }
}

describe('renderer store runtime updates', () => {
  beforeEach(() => {
    useStore.setState({
      cards: [],
      modelOutput: {},
      selectedModelOutputId: null
    })
  })

  it('clears a stale pid whenever a template is no longer running', () => {
    useStore.getState().setCards([{
      template,
      status: 'running',
      pid: 1234,
      expanded: false
    }])

    useStore.getState().setCardStatus(template.id, 'idle')

    expect(useStore.getState().cards[0]).toMatchObject({
      status: 'idle',
      pid: undefined
    })
  })

  it('batches output by template and keeps only the newest 400 events', () => {
    const events = Array.from({ length: 425 }, (_, index) => outputEvent(index))
    events.push(outputEvent(1, 'template-b'))

    useStore.getState().appendModelOutputBatch(events)

    const state = useStore.getState()
    expect(state.modelOutput[template.id]).toHaveLength(400)
    expect(state.modelOutput[template.id]?.[0]?.text).toBe('line-25')
    expect(state.modelOutput['template-b']).toHaveLength(1)
    expect(state.selectedModelOutputId).toBe(template.id)
  })

  it('does not publish a store update for an empty output batch', () => {
    const previousState = useStore.getState()

    useStore.getState().appendModelOutputBatch([])

    expect(useStore.getState()).toBe(previousState)
  })
})
