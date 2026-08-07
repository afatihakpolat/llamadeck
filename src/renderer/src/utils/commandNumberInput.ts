import type { CommandParam } from '../../../shared/types'

function getDecimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0

  const normalized = value.toString().toLowerCase()
  if (normalized.includes('e-')) {
    const [, exponent = '0'] = normalized.split('e-')
    const mantissa = normalized.split('e-')[0]
    const mantissaDecimals = mantissa.includes('.') ? mantissa.split('.')[1].length : 0
    return Number(exponent) + mantissaDecimals
  }

  if (!normalized.includes('.')) return 0
  return normalized.split('.')[1].length
}

export function getDescriptionRange(cmd: CommandParam): { min?: number; max?: number } {
  const rangeMatch = cmd.description.match(/valid range\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i)
  if (!rangeMatch) return {}

  return {
    min: Number(rangeMatch[1]),
    max: Number(rangeMatch[2])
  }
}

function getNumberPrecision(cmd: CommandParam): number {
  const descriptionNumbers = cmd.description.match(/-?\d+\.\d+/g) ?? []
  const candidates = [cmd.default, cmd.min, cmd.max]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .concat(descriptionNumbers.map(Number).filter(Number.isFinite))

  return candidates.reduce((maxPrecision, value) => {
    return Math.max(maxPrecision, getDecimalPlaces(value))
  }, 0)
}

export function getNumberStep(cmd: CommandParam): number {
  if (typeof cmd.step === 'number' && Number.isFinite(cmd.step) && cmd.step > 0) {
    return cmd.step
  }

  const precision = getNumberPrecision(cmd)
  return precision > 0 ? 10 ** -precision : 1
}

function clampNumber(value: number, cmd: CommandParam): number {
  const descriptionRange = getDescriptionRange(cmd)
  const min = cmd.min ?? descriptionRange.min ?? -Infinity
  const max = cmd.max ?? descriptionRange.max ?? Infinity
  return Math.min(max, Math.max(min, value))
}

function snapNumberToStep(value: number, step: number, min?: number): number {
  const origin = min ?? 0
  const precision = getDecimalPlaces(step)
  const snappedValue = origin + Math.round((value - origin) / step) * step

  return Number(snappedValue.toFixed(precision))
}

export function adjustNumberValue(currentValue: unknown, delta: number, cmd: CommandParam): number {
  const step = getNumberStep(cmd)
  const descriptionRange = getDescriptionRange(cmd)
  const min = cmd.min ?? descriptionRange.min
  const baseValue = typeof currentValue === 'number'
    ? currentValue
    : typeof cmd.default === 'number'
      ? cmd.default
      : cmd.min ?? 0
  const snappedBaseValue = snapNumberToStep(baseValue, step, min)
  const nextValue = clampNumber(snappedBaseValue + delta * step, cmd)
  const precision = getDecimalPlaces(step)

  return Number(nextValue.toFixed(precision))
}
