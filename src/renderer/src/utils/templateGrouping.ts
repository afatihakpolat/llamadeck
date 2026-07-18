import type { CardState } from '../../../shared/types'

const UNASSIGNED_GROUP_ID = 'unassigned'
const UNASSIGNED_GROUP_LABEL = 'No model selected'

export interface TemplateModelGroup {
  id: string
  label: string
  cards: CardState[]
}

export function getTemplateModelFolder(modelPath?: string): string | null {
  const normalizedPath = modelPath?.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedPath) return null

  const lastSeparator = normalizedPath.lastIndexOf('/')
  if (lastSeparator <= 0) return null

  const parentPath = normalizedPath.slice(0, lastSeparator).replace(/\/+$/, '')
  const folderName = parentPath.slice(parentPath.lastIndexOf('/') + 1).trim()

  if (!folderName || /^[a-z]:$/i.test(folderName)) return null
  return folderName
}

export function groupTemplatesByModelFolder(cards: CardState[]): TemplateModelGroup[] {
  const groups = new Map<string, TemplateModelGroup>()

  for (const card of cards) {
    const folderName = getTemplateModelFolder(card.template.modelPath)
    const id = folderName ? `model:${folderName.toLowerCase()}` : UNASSIGNED_GROUP_ID
    const existingGroup = groups.get(id)

    if (existingGroup) {
      existingGroup.cards.push(card)
      continue
    }

    groups.set(id, {
      id,
      label: folderName || UNASSIGNED_GROUP_LABEL,
      cards: [card]
    })
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (left.id === UNASSIGNED_GROUP_ID) return 1
    if (right.id === UNASSIGNED_GROUP_ID) return -1
    return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
  })
}
