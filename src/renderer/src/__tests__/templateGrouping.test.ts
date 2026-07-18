import { describe, expect, it } from 'vitest'
import type { CardState, Template } from '../../../shared/types'
import {
  getTemplateModelFolder,
  groupTemplatesByModelFolder
} from '../utils/templateGrouping'

function createCard(id: string, modelPath?: string): CardState {
  const template: Template = {
    id,
    name: `Template ${id}`,
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

describe('getTemplateModelFolder', () => {
  it('uses the model subfolder instead of the provider folder on Windows', () => {
    expect(getTemplateModelFolder(
      'C:\\Models\\UNSLOTH\\QWEN3.6-27B-GGUF\\Qwen3.6-27B-Q4_K_M.gguf'
    )).toBe('QWEN3.6-27B-GGUF')
  })

  it('supports slash-separated model paths', () => {
    expect(getTemplateModelFolder(
      '/models/unsloth/gemma-4-26b-a4b-it-gguf/model.gguf'
    )).toBe('gemma-4-26b-a4b-it-gguf')
  })

  it('returns null when a template has no usable model folder', () => {
    expect(getTemplateModelFolder()).toBeNull()
    expect(getTemplateModelFolder('model.gguf')).toBeNull()
  })
})

describe('groupTemplatesByModelFolder', () => {
  it('groups templates by leaf model folder and sorts groups by model name', () => {
    const groups = groupTemplatesByModelFolder([
      createCard('qwen-a', 'C:\\Models\\UNSLOTH\\QWEN3.6-27B-GGUF\\a.gguf'),
      createCard('gemma', 'C:\\Models\\UNSLOTH\\GEMMA-4-26B-A4B-IT-GGUF\\model.gguf'),
      createCard('qwen-b', 'D:\\Archive\\QWEN3.6-27B-GGUF\\b.gguf')
    ])

    expect(groups.map((group) => group.label)).toEqual([
      'GEMMA-4-26B-A4B-IT-GGUF',
      'QWEN3.6-27B-GGUF'
    ])
    expect(groups[1].cards.map((card) => card.template.id)).toEqual(['qwen-a', 'qwen-b'])
  })

  it('keeps templates without a model in a final fallback group', () => {
    const groups = groupTemplatesByModelFolder([
      createCard('unassigned'),
      createCard('qwen', 'C:\\Models\\QWEN3.5-4B-GGUF\\model.gguf')
    ])

    expect(groups.map((group) => group.label)).toEqual([
      'QWEN3.5-4B-GGUF',
      'No model selected'
    ])
  })
})
