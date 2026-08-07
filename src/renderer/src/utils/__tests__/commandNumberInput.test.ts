import { describe, expect, it } from 'vitest'
import type { CommandParam } from '../../../../shared/types'
import { adjustNumberValue, getNumberStep } from '../commandNumberInput'

const repeatPenalty: CommandParam = {
  arg: '--repeat-penalty',
  label: 'Repeat Penalty',
  description: 'penalize repeat sequence of tokens',
  type: 'number',
  default: 1,
  min: 0,
  max: 2,
  step: 0.01
}

describe('command number input', () => {
  it('uses the explicit fractional step even when all other values are integers', () => {
    expect(getNumberStep(repeatPenalty)).toBe(0.01)
  })

  it('increments a repeat penalty by its fractional step', () => {
    expect(adjustNumberValue(1.1, 1, repeatPenalty)).toBe(1.11)
    expect(adjustNumberValue(1.1, -1, repeatPenalty)).toBe(1.09)
  })
})
