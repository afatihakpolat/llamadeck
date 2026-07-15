import { describe, expect, it } from 'vitest'
import {
  isCommaListSelectCommand,
  parseCommaListCommandValue,
  toggleCommaListCommandValue
} from '../utils/commandArgs'

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
