import { describe, expect, it } from 'vitest'
import {
  buildTemplateLaunchArgs,
  isCommaListSelectCommand,
  parseCommaListCommandValue,
  toggleCommaListCommandValue
} from '../../../shared/commandArgs'
import type { CommandsSchema, Template } from '../../../shared/types'

const SPEC_TYPE_OPTIONS = [
  'none',
  'draft-simple',
  'draft-eagle3',
  'draft-mtp',
  'ngram-simple',
  'ngram-map-k',
  'ngram-map-k4v',
  'ngram-mod',
  'ngram-cache'
]

describe('comma-list select command args', () => {
  it('only treats --spec-type as a comma-list select', () => {
    expect(isCommaListSelectCommand({ arg: '--spec-type', type: 'select' })).toBe(true)
    expect(isCommaListSelectCommand({ arg: '--pooling', type: 'select' })).toBe(false)
    expect(isCommaListSelectCommand({ arg: '--spec-type', type: 'string' })).toBe(false)
  })

  it('serializes selected values as one comma-separated argv value in option order', () => {
    const withNgramMod = toggleCommaListCommandValue('', 'ngram-mod', SPEC_TYPE_OPTIONS, 'none')
    const withDraftMtp = toggleCommaListCommandValue(withNgramMod, 'draft-mtp', SPEC_TYPE_OPTIONS, 'none')

    expect(withDraftMtp).toBe('draft-mtp,ngram-mod')
    expect(parseCommaListCommandValue(withDraftMtp)).toEqual(['draft-mtp', 'ngram-mod'])
  })

  it('keeps the default option exclusive when mixed with real modes', () => {
    expect(toggleCommaListCommandValue('draft-mtp,ngram-mod', 'none', SPEC_TYPE_OPTIONS, 'none')).toBe('none')
    expect(toggleCommaListCommandValue('none', 'draft-mtp', SPEC_TYPE_OPTIONS, 'none')).toBe('draft-mtp')
  })
})

describe('template launch args', () => {
  it('builds the same argv for GUI and CLI launches', () => {
    const template: Template = {
      id: 'template-id',
      name: 'Template',
      modelPath: 'C:\\models\\model.gguf',
      serverPort: 9090,
      launchMode: 'api',
      args: {
        '--flash-attn': true,
        '--jinja': false,
        '--ctx-size': 8192,
        '--custom-flag': 'custom'
      },
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z'
    }
    const schema: CommandsSchema = {
      version: 'test',
      categories: [{
        name: 'Model',
        icon: 'test',
        commands: [
          { arg: '--flash-attn', label: 'Flash attention', description: '', type: 'boolean' },
          { arg: '--jinja', label: 'Jinja', description: '', type: 'boolean', default: true },
          { arg: '--ctx-size', label: 'Context', description: '', type: 'number' }
        ]
      }]
    }

    expect(buildTemplateLaunchArgs(template, schema, template.modelPath!)).toEqual([
      '-m',
      'C:\\models\\model.gguf',
      '--flash-attn',
      '--no-jinja',
      '--ctx-size',
      '8192',
      '--custom-flag',
      'custom',
      '--port',
      '9090',
      '--no-webui'
    ])
  })
})
