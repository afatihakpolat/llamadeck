import type { CardState, UsageTemplateRollup } from '../../../shared/types'
import { UNASSIGNED_GROUP_ID, type TemplateModelGroup } from './templateGrouping'

export type TemplateSortMode = 'most-used' | 'name' | 'default'

export const DEFAULT_TEMPLATE_SORT_MODE: TemplateSortMode = 'most-used'

export const TEMPLATE_SORT_OPTIONS: ReadonlyArray<{ value: TemplateSortMode; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'default', label: 'Default' },
  { value: 'most-used', label: 'Most used' }
]

export interface TemplateUsage {
  requestCount: number
  lastRequestAt?: string
}

type UsageRollup = Pick<UsageTemplateRollup, 'templateId' | 'requestCount' | 'lastRequestAt'>

const NO_USAGE: TemplateUsage = { requestCount: 0 }

export function buildTemplateUsageMap(rollups: readonly UsageRollup[]): Map<string, TemplateUsage> {
  const usage = new Map<string, TemplateUsage>()

  for (const rollup of rollups) {
    usage.set(rollup.templateId, {
      requestCount: Number.isFinite(rollup.requestCount) && rollup.requestCount > 0 ? rollup.requestCount : 0,
      lastRequestAt: rollup.lastRequestAt
    })
  }

  return usage
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

/** Standard sort comparator: negative when `left` should rank above `right` (busier = higher). */
function compareUsage(left: TemplateUsage, right: TemplateUsage): number {
  if (left.requestCount !== right.requestCount) return right.requestCount - left.requestCount
  const leftLast = left.lastRequestAt ?? ''
  const rightLast = right.lastRequestAt ?? ''
  // ISO timestamps compare chronologically as strings.
  if (leftLast !== rightLast) return rightLast.localeCompare(leftLast)
  return 0
}

export function sortCardsByMode(
  cards: CardState[],
  mode: TemplateSortMode,
  usage: Map<string, TemplateUsage>
): CardState[] {
  const sorted = [...cards]

  if (mode === 'name') {
    sorted.sort((left, right) => compareNames(left.template.name, right.template.name))
  } else if (mode === 'most-used') {
    sorted.sort((left, right) =>
      compareUsage(usage.get(left.template.id) ?? NO_USAGE, usage.get(right.template.id) ?? NO_USAGE) ||
      compareNames(left.template.name, right.template.name)
    )
  }
  // 'default' keeps the incoming (directory) order; the copy above keeps callers' state intact.

  return sorted
}

function getBestUsageInGroup(cards: CardState[], usage: Map<string, TemplateUsage>): TemplateUsage {
  let best: TemplateUsage | null = null

  for (const card of cards) {
    const candidate = usage.get(card.template.id) ?? NO_USAGE
    if (best === null || compareUsage(candidate, best) < 0) {
      best = candidate
    }
  }

  return best ?? NO_USAGE
}

export function sortTemplateGroupsByMode(
  groups: TemplateModelGroup[],
  mode: TemplateSortMode,
  usage: Map<string, TemplateUsage>
): TemplateModelGroup[] {
  if (mode !== 'most-used') {
    // groupTemplatesByModelFolder already orders groups alphabetically with the
    // unassigned group last, which is what 'name' and 'default' keep.
    return groups
  }

  const sorted = [...groups]
  sorted.sort((left, right) => {
    const leftUnassigned = left.id === UNASSIGNED_GROUP_ID
    const rightUnassigned = right.id === UNASSIGNED_GROUP_ID
    if (leftUnassigned || rightUnassigned) {
      return leftUnassigned ? 1 : -1
    }
    return compareUsage(getBestUsageInGroup(left.cards, usage), getBestUsageInGroup(right.cards, usage)) ||
      compareNames(left.label, right.label)
  })

  return sorted
}
