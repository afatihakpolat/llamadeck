import { describe, expect, it } from 'vitest'
import type { CardState, Template, UsageTemplateRollup } from '../../../shared/types'
import { groupTemplatesByModelFolder } from '../utils/templateGrouping'
import {
  DEFAULT_TEMPLATE_SORT_MODE,
  TEMPLATE_SORT_OPTIONS,
  buildTemplateUsageMap,
  sortCardsByMode,
  sortTemplateGroupsByMode,
  type TemplateSortMode,
  type TemplateUsage
} from '../utils/templateSorting'

function createCard(id: string, name: string, modelPath?: string): CardState {
  const template: Template = {
    id,
    name,
    modelPath,
    serverPort: 8080,
    args: {},
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z'
  }

  return {
    template,
    status: 'idle',
    expanded: false
  }
}

function createUsage(usage: Record<string, TemplateUsage>): Map<string, TemplateUsage> {
  return new Map(Object.entries(usage))
}

function createRollup(templateId: string, requestCount: number, lastRequestAt?: string): UsageTemplateRollup {
  return {
    templateId,
    templateName: `Template ${templateId}`,
    lastRequestAt,
    requestCount,
    successCount: 0,
    errorCount: 0,
    exactUsageCount: 0,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  }
}

function cardIds(cards: CardState[]): string[] {
  return cards.map((card) => card.template.id)
}

describe('sort mode options', () => {
  it('offers name, default, and most-used with most-used as the default', () => {
    expect(DEFAULT_TEMPLATE_SORT_MODE).toBe('most-used')
    expect(TEMPLATE_SORT_OPTIONS.map((option) => option.value)).toEqual([
      'name',
      'default',
      'most-used'
    ])
    expect(TEMPLATE_SORT_OPTIONS.every((option) => option.label.length > 0)).toBe(true)
  })
})

describe('buildTemplateUsageMap', () => {
  it('maps each template rollup by id with request count and recency', () => {
    const rollups: UsageTemplateRollup[] = [
      createRollup('a', 5, '2026-08-01T10:00:00.000Z'),
      createRollup('b', 0)
    ]

    expect(buildTemplateUsageMap(rollups)).toEqual(
      new Map([
        ['a', { requestCount: 5, lastRequestAt: '2026-08-01T10:00:00.000Z' }],
        ['b', { requestCount: 0 }]
      ])
    )
  })

  it('clamps negative or non-finite request counts to zero', () => {
    const usage = buildTemplateUsageMap([
      createRollup('neg', -3),
      createRollup('nan', Number.NaN)
    ])

    expect(usage.get('neg')).toEqual({ requestCount: 0 })
    expect(usage.get('nan')).toEqual({ requestCount: 0 })
  })
})

describe('sortCardsByMode', () => {
  it('name mode sorts alphabetically without regard to case', () => {
    const cards = [
      createCard('zeta', 'zeta'),
      createCard('Alpha', 'Alpha'),
      createCard('beta', 'beta')
    ]

    expect(cardIds(sortCardsByMode(cards, 'name', new Map()))).toEqual(['Alpha', 'beta', 'zeta'])
  })

  it('default mode keeps the incoming order and does not mutate the input', () => {
    const cards = [
      createCard('two', 'two'),
      createCard('one', 'one')
    ]

    const sorted = sortCardsByMode(cards, 'default', new Map())

    expect(sorted).not.toBe(cards)
    expect(cardIds(sorted)).toEqual(['two', 'one'])
    expect(cardIds(cards)).toEqual(['two', 'one'])
  })

  it('most-used mode ranks by request count, then recency, then name', () => {
    const cards = [
      createCard('idle-b', 'Idle B'),
      createCard('hot-older', 'Hot Older'),
      createCard('unused-a', 'Unused A'),
      createCard('hot-newer', 'Hot Newer'),
      createCard('cold', 'Cold')
    ]
    const usage = createUsage({
      'hot-older': { requestCount: 10, lastRequestAt: '2026-08-01T00:00:00.000Z' },
      'hot-newer': { requestCount: 10, lastRequestAt: '2026-08-02T00:00:00.000Z' },
      cold: { requestCount: 2 }
    })

    expect(cardIds(sortCardsByMode(cards, 'most-used', usage))).toEqual([
      'hot-newer',
      'hot-older',
      'cold',
      'idle-b',
      'unused-a'
    ])
  })

  it('most-used mode treats unknown templates as unused and last', () => {
    const cards = [
      createCard('unknown', 'Unknown'),
      createCard('used', 'Used')
    ]
    const usage = createUsage({
      used: { requestCount: 1 }
    })

    expect(cardIds(sortCardsByMode(cards, 'most-used', usage))).toEqual(['used', 'unknown'])
  })
})

describe('sortTemplateGroupsByMode', () => {
  it('most-used mode orders groups by their busiest card', () => {
    const groups = groupTemplatesByModelFolder([
      createCard('gemma-a', 'Gemma A', 'C:\\Models\\GEMMA\\a.gguf'),
      createCard('gemma-b', 'Gemma B', 'C:\\Models\\GEMMA\\b.gguf'),
      createCard('qwen-a', 'Qwen A', 'C:\\Models\\QWEN\\a.gguf'),
      createCard('llama-a', 'Llama A', 'C:\\Models\\LLAMA\\a.gguf')
    ])
    const usage = createUsage({
      'gemma-a': { requestCount: 3 },
      'gemma-b': { requestCount: 50, lastRequestAt: '2026-08-01T00:00:00.000Z' },
      'llama-a': { requestCount: 50, lastRequestAt: '2026-08-05T00:00:00.000Z' }
    })

    expect(
      sortTemplateGroupsByMode(groups, 'most-used', usage).map((group) => group.label)
    ).toEqual(['LLAMA', 'GEMMA', 'QWEN'])
  })

  it('most-used mode keeps the unassigned group last', () => {
    const groups = groupTemplatesByModelFolder([
      createCard('unassigned', 'No Model', undefined),
      createCard('qwen-a', 'Qwen A', 'C:\\Models\\QWEN\\a.gguf')
    ])
    const usage = createUsage({
      unassigned: { requestCount: 100 }
    })

    expect(
      sortTemplateGroupsByMode(groups, 'most-used', usage).map((group) => group.label)
    ).toEqual(['QWEN', 'No model selected'])
  })

  it('most-used mode breaks all-unused groups by label', () => {
    const groups = groupTemplatesByModelFolder([
      createCard('z-a', 'Z A', 'C:\\Models\\ZED\\a.gguf'),
      createCard('a-a', 'A A', 'C:\\Models\\ALPHA\\a.gguf')
    ])

    expect(
      sortTemplateGroupsByMode(groups, 'most-used', new Map()).map((group) => group.label)
    ).toEqual(['ALPHA', 'ZED'])
  })

  it.each(['name', 'default'] satisfies TemplateSortMode[])(
    '%s mode preserves the group order produced by the grouper',
    (mode) => {
      const groups = groupTemplatesByModelFolder([
        createCard('z-a', 'Z A', 'C:\\Models\\ZED\\a.gguf'),
        createCard('a-a', 'A A', 'C:\\Models\\ALPHA\\a.gguf'),
        createCard('unassigned', 'No Model', undefined)
      ])
      const usage = createUsage({
        'z-a': { requestCount: 100 }
      })

      expect(
        sortTemplateGroupsByMode(groups, mode, usage).map((group) => group.label)
      ).toEqual(['ALPHA', 'ZED', 'No model selected'])
    }
  )
})
