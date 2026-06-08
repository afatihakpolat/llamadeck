import type { Command, Overlay, MergedCommandType, MergedCategoryType, MergedSchemaType } from './schemas'

const CATEGORY_ORDER = [
  'Model', 'Performance', 'GPU', 'KV Cache', 'Sampling',
  'RoPE / YaRN', 'Server', 'Logging', 'Speculative Decoding', 'Other'
]

interface UserOverride {
  version: string
  categories: MergedCategoryType[]
}

function deriveLabel(arg: string): string {
  return arg.replace(/^--/, '').split('-').map(s => s ? s[0].toUpperCase() + s.slice(1) : s).join(' ')
}

function findOverlayEntry(cmd: Command, overlay: Overlay) {
  if (overlay.args[cmd.arg]) return overlay.args[cmd.arg]
  for (const alias of cmd.aliasLongs || []) {
    if (overlay.args[alias]) return overlay.args[alias]
  }
  for (const neg of cmd.negationLongs || []) {
    if (overlay.args[neg]) return overlay.args[neg]
  }
  return null
}

function buildUserArgsMap(userOverride: UserOverride | null): Map<string, MergedCommandType> {
  const map = new Map<string, MergedCommandType>()
  if (!userOverride) return map
  for (const cat of userOverride.categories) {
    for (const c of cat.commands) map.set(c.arg, c)
  }
  return map
}

function findUserOverride(
  cmd: Command,
  userArgs: Map<string, MergedCommandType>
): MergedCommandType | null {
  if (userArgs.has(cmd.arg)) return userArgs.get(cmd.arg)!
  for (const alias of cmd.aliasLongs || []) {
    if (userArgs.has(alias)) return userArgs.get(alias)!
  }
  for (const neg of cmd.negationLongs || []) {
    if (userArgs.has(neg)) return userArgs.get(neg)!
  }
  return null
}

export function mergeCommandsSchema(
  structural: Command[],
  overlay: Overlay,
  userOverride: UserOverride | null
): MergedSchemaType {
  const byCategory = new Map<string, MergedCategoryType>()
  const userArgs = buildUserArgsMap(userOverride)

  for (const command of structural) {
    const curated = findOverlayEntry(command, overlay)
    const userEntry = findUserOverride(command, userArgs)

    const sectionMapEntry = overlay.sectionMap[command.section || '']
    const fallbackName = sectionMapEntry?.name || 'Other'
    const fallbackIcon = sectionMapEntry?.icon || 'Settings'

    const categoryName = userEntry?.category || curated?.category || fallbackName
    const categoryIcon = curated?.icon || fallbackIcon

    if (!byCategory.has(categoryName)) {
      byCategory.set(categoryName, { name: categoryName, icon: categoryIcon, commands: [] })
    }

    const merged: MergedCommandType = {
      arg: command.arg,
      description: command.description,
      type: command.type,
      label: userEntry?.label || curated?.label || deriveLabel(command.arg)
    }
    if (command.short) merged.short = command.short
    if (command.default !== undefined) merged.default = command.default
    if (command.env) merged.env = command.env
    if (command.options) merged.options = command.options
    if (command.deprecated) {
      merged.deprecated = true
      if (command.deprecationNote) merged.deprecationNote = command.deprecationNote
    }
    if (userEntry?.placeholder !== undefined) merged.placeholder = userEntry.placeholder
    else if (curated?.placeholder) merged.placeholder = curated.placeholder
    if (userEntry?.min !== undefined) merged.min = userEntry.min
    else if (curated?.min !== undefined) merged.min = curated.min
    if (userEntry?.max !== undefined) merged.max = userEntry.max
    else if (curated?.max !== undefined) merged.max = curated.max

    // User override wins for any field it sets, including structural fields
    // like default, description, options, etc.
    if (userEntry) {
      if (userEntry.default !== undefined) merged.default = userEntry.default
      if (userEntry.description !== undefined) merged.description = userEntry.description
      if (userEntry.type !== undefined) merged.type = userEntry.type
      if (userEntry.short !== undefined) merged.short = userEntry.short
      if (userEntry.env !== undefined) merged.env = userEntry.env
      if (userEntry.options !== undefined) merged.options = userEntry.options
    }

    byCategory.get(categoryName)!.commands.push(merged)
  }

  const categories = [...byCategory.values()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.name)
    const bi = CATEGORY_ORDER.indexOf(b.name)
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return { version: 'merged', categories }
}
