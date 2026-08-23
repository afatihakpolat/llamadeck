import { describe, expect, it } from 'vitest'
import type { UsageSessionRollup, UsageTemplateRollup } from '../../../shared/types'
import {
  buildSessionModelGroups,
  buildSortedSessionModelGroups,
  buildSortedTemplateModelGroups,
  getModelFileName,
  getModelGroupKey,
  getModelGroupLabel,
  sortSessionRollupsBy,
  UNASSIGNED_MODEL_GROUP_KEY,
  UNASSIGNED_MODEL_GROUP_LABEL
} from '../utils/usageModelGrouping'

const QWEN_FOLDER = 'C:\\Models\\QWEN3.6-27B-GGUF'

function createSession(overrides: Partial<UsageSessionRollup> = {}): UsageSessionRollup {
  return {
    launchId: 'launch-1',
    templateId: 'template-1',
    templateName: 'Template 1',
    modelPath: `${QWEN_FOLDER}\\Qwen3.6-27B-Q4_K_M.gguf`,
    startedAt: '2026-08-01T00:00:00.000Z',
    windowStartedAt: '2026-08-01T00:00:00.000Z',
    windowEndedAt: '2026-08-01T01:00:00.000Z',
    lastRequestAt: '2026-08-01T01:00:00.000Z',
    status: 'stopped',
    requestCount: 1,
    successCount: 1,
    errorCount: 0,
    exactUsageCount: 1,
    promptTokens: 10,
    cacheTokens: 4,
    completionTokens: 5,
    totalTokens: 19,
    ...overrides
  }
}

function createTemplateRollup(overrides: Partial<UsageTemplateRollup> = {}): UsageTemplateRollup {
  return {
    templateId: 'template-1',
    templateName: 'Template 1',
    modelPath: `${QWEN_FOLDER}\\Qwen3.6-27B-Q4_K_M.gguf`,
    lastRequestAt: '2026-08-01T01:00:00.000Z',
    requestCount: 1,
    successCount: 1,
    errorCount: 0,
    exactUsageCount: 1,
    promptTokens: 10,
    cacheTokens: 4,
    completionTokens: 5,
    totalTokens: 19,
    ...overrides
  }
}

describe('model group identity helpers', () => {
  it('derives the group key from the model folder', () => {
    expect(getModelGroupKey('C:\\Models\\QWEN3.6-27B-GGUF\\model.gguf')).toBe('model:qwen3.6-27b-gguf')
    expect(getModelGroupKey('C:/Models/QWEN3.6-27B-GGUF/model.gguf')).toBe('model:qwen3.6-27b-gguf')
  })

  it('treats folder casing differences as the same model', () => {
    expect(getModelGroupKey('D:\\Models\\Qwen-4B\\a.gguf')).toBe(getModelGroupKey('D:\\Models\\QWEN-4B\\b.gguf'))
  })

  it('falls back to the unassigned group when no folder is present', () => {
    expect(getModelGroupKey()).toBe(UNASSIGNED_MODEL_GROUP_KEY)
    expect(getModelGroupKey('model.gguf')).toBe(UNASSIGNED_MODEL_GROUP_KEY)
    expect(getModelGroupLabel('model.gguf')).toBe(UNASSIGNED_MODEL_GROUP_LABEL)
  })

  it('labels the group with the folder name', () => {
    expect(getModelGroupLabel(`${QWEN_FOLDER}\\model.gguf`)).toBe('QWEN3.6-27B-GGUF')
  })
})

describe('getModelFileName', () => {
  it('returns the leaf file name for Windows and POSIX paths', () => {
    expect(getModelFileName('C:\\Models\\model.gguf')).toBe('model.gguf')
    expect(getModelFileName('/models/provider/quant.gguf')).toBe('quant.gguf')
  })

  it('returns null without a usable path', () => {
    expect(getModelFileName()).toBeNull()
    expect(getModelFileName('   ')).toBeNull()
  })
})

describe('buildSessionModelGroups', () => {
  it('merges templates with different quantizations into one model group', () => {
    const q4 = createSession({
      launchId: 'launch-q4',
      templateId: 'qwen-q4',
      templateName: 'Qwen 27B Q4',
      modelPath: `${QWEN_FOLDER}\\Qwen3.6-27B-Q4_K_M.gguf`,
      totalTokens: 100,
      promptTokens: 60,
      completionTokens: 40,
      requestCount: 3
    })
    const q8 = createSession({
      launchId: 'launch-q8',
      templateId: 'qwen-q8',
      templateName: 'Qwen 27B Q8',
      modelPath: `${QWEN_FOLDER}\\Qwen3.6-27B-Q8_0.gguf`,
      windowStartedAt: '2026-08-02T00:00:00.000Z',
      windowLastRequestAt: '2026-08-02T03:00:00.000Z',
      lastRequestAt: '2026-08-02T03:00:00.000Z',
      windowEndedAt: '2026-08-02T04:00:00.000Z',
      totalTokens: 50,
      promptTokens: 20,
      completionTokens: 30,
      requestCount: 2
    })
    const gemma = createSession({
      launchId: 'launch-gemma',
      templateId: 'gemma',
      templateName: 'Gemma 26B',
      modelPath: 'C:\\Models\\GEMMA-4-26B\\model.gguf',
      totalTokens: 5,
      requestCount: 1
    })

    const groups = buildSessionModelGroups([q4, q8, gemma])

    expect(groups.map((group) => group.label)).toEqual(['QWEN3.6-27B-GGUF', 'GEMMA-4-26B'])

    const qwenGroup = groups[0]
    expect(qwenGroup.templateCount).toBe(2)
    expect(qwenGroup.sessionCount).toBe(2)
    expect(qwenGroup.requestCount).toBe(5)
    expect(qwenGroup.promptTokens).toBe(80)
    expect(qwenGroup.completionTokens).toBe(70)
    expect(qwenGroup.totalTokens).toBe(150)
    // 1 hour (q4 window) + 4 hours (q8 window)
    expect(qwenGroup.durationMs).toBe(5 * 60 * 60 * 1000)
    expect(qwenGroup.lastActivityAt).toBe('2026-08-02T03:00:00.000Z')
    expect(qwenGroup.templates.map((template) => template.templateId)).toEqual(['qwen-q4', 'qwen-q8'])
  })

  it('keeps all sessions of one template together inside their model group', () => {
    const first = createSession({
      launchId: 'launch-1',
      templateId: 'qwen-q4',
      templateName: 'Qwen 27B Q4',
      modelPath: `${QWEN_FOLDER}\\Q4.gguf`
    })
    const second = createSession({
      launchId: 'launch-2',
      templateId: 'qwen-q4',
      templateName: 'Qwen 27B Q4',
      modelPath: `${QWEN_FOLDER}\\Q8.gguf`,
      totalTokens: 30
    })

    const [group] = buildSessionModelGroups([first, second])

    expect(group.key).toBe('model:qwen3.6-27b-gguf')
    const [template] = group.templates
    expect(template.templateId).toBe('qwen-q4')
    // The first non-null model-file snapshot wins for the template row label.
    expect(template.modelFileName).toBe('Q4.gguf')
    expect(template.sessionCount).toBe(2)
    expect(template.totalTokens).toBe(49)
    expect(template.sessions.map((session) => session.launchId)).toEqual(['launch-1', 'launch-2'])
  })

  it('splits sessions across model groups when the model folder differs', () => {
    const orphan = createSession({ launchId: 'launch-1', modelPath: undefined })
    const foldered = createSession({ launchId: 'launch-2' })

    const groups = buildSessionModelGroups([orphan, foldered])

    expect(groups.map((group) => group.key)).toEqual([UNASSIGNED_MODEL_GROUP_KEY, 'model:qwen3.6-27b-gguf'])
    expect(groups[0].templates[0].modelFileName).toBeNull()
  })
})

describe('buildSortedSessionModelGroups', () => {
  function makeSessions() {
    return [
      createSession({
        launchId: 'launch-small',
        templateId: 'small',
        templateName: 'Small',
        modelPath: 'C:\\Models\\SMALL\\m.gguf',
        totalTokens: 10,
        requestCount: 4
      }),
      createSession({
        launchId: 'launch-large',
        templateId: 'large',
        templateName: 'Large',
        modelPath: 'C:\\Models\\LARGE\\m.gguf',
        lastRequestAt: '2026-08-05T00:00:00.000Z',
        windowLastRequestAt: '2026-08-05T00:00:00.000Z',
        totalTokens: 100,
        requestCount: 1
      })
    ]
  }

  it('sorts model groups by tokens by default and keeps unassigned last', () => {
    const sessions = makeSessions()
    sessions.push(createSession({
      launchId: 'launch-orphan',
      templateId: 'orphan',
      templateName: 'Orphan',
      modelPath: undefined,
      totalTokens: 9999,
      requestCount: 99
    }))

    const groups = buildSortedSessionModelGroups(sessions, 'tokens')

    expect(groups.map((group) => group.key)).toEqual([
      'model:large',
      'model:small',
      UNASSIGNED_MODEL_GROUP_KEY
    ])
  })

  it('sorts model groups by activity', () => {
    const groups = buildSortedSessionModelGroups(makeSessions(), 'activity')
    expect(groups.map((group) => group.key)).toEqual(['model:large', 'model:small'])
  })

  it('sorts model groups by cost using summed per-template pricing', () => {
    const sessions = makeSessions()
    sessions.push(createSession({
      launchId: 'launch-expensive',
      templateId: 'expensive-a',
      templateName: 'Expensive A',
      modelPath: 'C:\\Models\\EXPENSIVE\\a.gguf',
      totalTokens: 1,
      requestCount: 1
    }))
    sessions.push(createSession({
      launchId: 'launch-expensive-2',
      templateId: 'expensive-b',
      templateName: 'Expensive B',
      modelPath: 'C:\\Models\\EXPENSIVE\\b.gguf',
      totalTokens: 1,
      requestCount: 1
    }))

    const templateCosts: Record<string, number> = { 'expensive-a': 50, 'expensive-b': 10 }
    const costOfTemplate = (template: { templateId: string }): number =>
      templateCosts[template.templateId] ?? 1

    const groups = buildSortedSessionModelGroups(sessions, 'cost', {
      costOfTemplate,
      costOfSession: (session) => templateCosts[session.templateId] ?? 1
    })

    // Both expensive templates land in one model group (60 total), ahead of the
    // two single-cost groups; the cost tie between them breaks on request count.
    expect(groups.map((group) => group.key)).toEqual(['model:expensive', 'model:small', 'model:large'])
    expect(groups[0].templateCount).toBe(2)
    // Nested template rows follow the same cost axis in cost mode.
    expect(groups[0].templates.map((template) => template.templateId)).toEqual(['expensive-a', 'expensive-b'])
  })

  it('sorts templates within a model and sessions within a template by the chosen key', () => {
    const sessions = [
      createSession({
        launchId: 'launch-q8',
        templateId: 'qwen-q8',
        templateName: 'Qwen Q8',
        modelPath: `${QWEN_FOLDER}\\Q8.gguf`,
        totalTokens: 50,
        requestCount: 2
      }),
      createSession({
        launchId: 'launch-q4-old',
        templateId: 'qwen-q4',
        templateName: 'Qwen Q4',
        modelPath: `${QWEN_FOLDER}\\Q4.gguf`,
        lastRequestAt: '2026-07-01T00:00:00.000Z',
        windowLastRequestAt: '2026-07-01T00:00:00.000Z',
        totalTokens: 10,
        requestCount: 9
      }),
      createSession({
        launchId: 'launch-q4-new',
        templateId: 'qwen-q4',
        templateName: 'Qwen Q4',
        modelPath: `${QWEN_FOLDER}\\Q4.gguf`,
        totalTokens: 30,
        requestCount: 1
      })
    ]

    const groups = buildSortedSessionModelGroups(sessions, 'tokens')
    const [group] = groups

    expect(group.templates.map((template) => template.templateId)).toEqual(['qwen-q8', 'qwen-q4'])
    expect(group.templates[1].sessions.map((session) => session.launchId)).toEqual([
      'launch-q4-new',
      'launch-q4-old'
    ])
  })

  it('keeps session order stable for the activity key (most recent first)', () => {
    const groups = buildSortedSessionModelGroups(makeSessions(), 'activity')
    expect(groups[0].key).toBe('model:large')
    expect(groups[0].templates[0].sessions[0].launchId).toBe('launch-large')
  })
})

describe('buildSortedTemplateModelGroups', () => {
  it('groups template rollups by model folder and rolls totals up', () => {
    const rollups = [
      createTemplateRollup({
        templateId: 'qwen-q4',
        templateName: 'Qwen Q4',
        modelPath: `${QWEN_FOLDER}\\Q4.gguf`,
        lastRequestAt: '2026-08-01T00:00:00.000Z',
        totalTokens: 100,
        requestCount: 2
      }),
      createTemplateRollup({
        templateId: 'qwen-q8',
        templateName: 'Qwen Q8',
        modelPath: `${QWEN_FOLDER}\\Q8.gguf`,
        lastRequestAt: '2026-08-03T00:00:00.000Z',
        totalTokens: 50,
        requestCount: 1
      }),
      createTemplateRollup({
        templateId: 'gemma',
        templateName: 'Gemma',
        modelPath: 'C:\\Models\\GEMMA-4-26B\\model.gguf',
        totalTokens: 200,
        requestCount: 3
      })
    ]

    const groups = buildSortedTemplateModelGroups(rollups)

    expect(groups.map((group) => group.key)).toEqual(['model:gemma-4-26b', 'model:qwen3.6-27b-gguf'])
    const qwenGroup = groups[1]
    expect(qwenGroup.label).toBe('QWEN3.6-27B-GGUF')
    expect(qwenGroup.templateCount).toBe(2)
    expect(qwenGroup.totalTokens).toBe(150)
    expect(qwenGroup.requestCount).toBe(3)
    expect(qwenGroup.lastRequestAt).toBe('2026-08-03T00:00:00.000Z')
    // Inner rollups keep the most-tokens-first default order.
    expect(qwenGroup.templates.map((rollup) => rollup.templateId)).toEqual(['qwen-q4', 'qwen-q8'])
  })

  it('sorts groups by last activity for the activity key', () => {
    const rollups = [
      createTemplateRollup({
        templateId: 'old',
        templateName: 'Old',
        modelPath: 'C:\\Models\\OLD\\m.gguf',
        lastRequestAt: '2026-07-01T00:00:00.000Z',
        totalTokens: 500
      }),
      createTemplateRollup({
        templateId: 'new',
        templateName: 'New',
        modelPath: 'C:\\Models\\NEW\\m.gguf',
        lastRequestAt: '2026-08-01T00:00:00.000Z',
        totalTokens: 10
      })
    ]

    const groups = buildSortedTemplateModelGroups(rollups, 'activity')
    expect(groups.map((group) => group.key)).toEqual(['model:new', 'model:old'])
  })

  it('sorts groups by summed per-template cost for the cost key', () => {
    const rollups = [
      createTemplateRollup({
        templateId: 'cheap',
        templateName: 'Cheap',
        modelPath: 'C:\\Models\\CHEAP\\m.gguf',
        totalTokens: 1000
      }),
      createTemplateRollup({
        templateId: 'pricy-a',
        templateName: 'Pricy A',
        modelPath: 'C:\\Models\\PRICED\\a.gguf',
        totalTokens: 1
      }),
      createTemplateRollup({
        templateId: 'pricy-b',
        templateName: 'Pricy B',
        modelPath: 'C:\\Models\\PRICED\\b.gguf',
        totalTokens: 1
      })
    ]

    const costOfRollup = (rollup: Pick<UsageTemplateRollup, 'templateId'>): number =>
      rollup.templateId.startsWith('pricy') ? 10 : 0.5

    const groups = buildSortedTemplateModelGroups(rollups, 'cost', costOfRollup)
    expect(groups.map((group) => group.key)).toEqual(['model:priced', 'model:cheap'])
  })
})

describe('sortSessionRollupsBy', () => {
  it('orders sessions by requests or duration when asked', () => {
    const sessions = [
      createSession({ launchId: 'a', requestCount: 1, totalTokens: 500 }),
      createSession({ launchId: 'b', requestCount: 9, totalTokens: 10 }),
      createSession({
        launchId: 'c',
        requestCount: 2,
        totalTokens: 10,
        windowStartedAt: '2026-08-01T00:00:00.000Z',
        lastRequestAt: '2026-08-01T05:00:00.000Z',
        windowLastRequestAt: '2026-08-01T05:00:00.000Z',
        windowEndedAt: '2026-08-01T06:00:00.000Z'
      })
    ]

    expect(sortSessionRollupsBy(sessions, 'requests').map((session) => session.launchId)).toEqual(['b', 'c', 'a'])
    // a and b share the same 1-hour window, so the duration tie breaks on tokens.
    expect(sortSessionRollupsBy(sessions, 'duration').map((session) => session.launchId)).toEqual(['c', 'a', 'b'])
  })

  it('does not mutate the input array', () => {
    const sessions = [
      createSession({ launchId: 'a', totalTokens: 5 }),
      createSession({ launchId: 'b', totalTokens: 40 })
    ]
    const originalOrder = sessions.map((session) => session.launchId)

    sortSessionRollupsBy(sessions, 'tokens')

    expect(sessions.map((session) => session.launchId)).toEqual(originalOrder)
  })
})
