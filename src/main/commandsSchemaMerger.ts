import type { Command, Overlay, MergedSchemaType } from './schemas'

const CATEGORY_ORDER = [
  'Model', 'Performance', 'GPU', 'KV Cache', 'Sampling',
  'RoPE / YaRN', 'Server', 'Logging', 'Speculative Decoding', 'Other'
]

interface UserOverride {
  version: string
  categories: { name: string; icon: string; commands: any[] }[]
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

function findUserOverride(cmd: Command, userOverride: UserOverride | null): any | null {
  if (!userOverride) return null
  const allUserArgs = new Map<string, any>()
  for (const cat of userOverride.categories) {
    for (const c of cat.commands) allUserArgs.set(c.arg, c)
  }
  if (allUserArgs.has(cmd.arg)) return allUserArgs.get(cmd.arg)
  for (const alias of cmd.aliasLongs || []) {
    if (allUserArgs.has(alias)) return allUserArgs.get(alias)
  }
  for (const neg of cmd.negationLongs || []) {
    if (allUserArgs.has(neg)) return allUserArgs.get(neg)
  }
  return null
}

export function mergeCommandsSchema(
  structural: Command[],
  overlay: Overlay,
  userOverride: UserOverride | null
): MergedSchemaType {
  const byCategory = new Map<string, { name: string; icon: string; commands: any[] }>()

  for (const cmd of structural) {
    const curated = findOverlayEntry(cmd, overlay)
    const userOverride_ = findUserOverride(cmd, userOverride)

    const sectionMapEntry = overlay.sectionMap[cmd.section || '']
    const fallbackName = sectionMapEntry?.name || 'Other'
    const fallbackIcon = sectionMapEntry?.icon || 'Settings'

    const categoryName = userOverride_?.category || curated?.category || fallbackName
    const categoryIcon = userOverride_?.icon || curated?.icon || fallbackIcon

    if (!byCategory.has(categoryName)) {
      byCategory.set(categoryName, { name: categoryName, icon: categoryIcon, commands: [] })
    }

    const merged: any = {
      arg: cmd.arg,
      description: cmd.description,
      type: cmd.type
    }
    if (cmd.short) merged.short = cmd.short
    if (cmd.default !== undefined) merged.default = cmd.default
    if (cmd.env) merged.env = cmd.env
    if (cmd.options) merged.options = cmd.options
    if (cmd.deprecated) {
      merged.deprecated = true
      if (cmd.deprecationNote) merged.deprecationNote = cmd.deprecationNote
    }
    merged.label = userOverride_?.label || curated?.label || deriveLabel(cmd.arg)
    if (userOverride_?.placeholder !== undefined) merged.placeholder = userOverride_.placeholder
    else if (curated?.placeholder) merged.placeholder = curated.placeholder
    if (userOverride_?.min !== undefined) merged.min = userOverride_.min
    else if (curated?.min !== undefined) merged.min = curated.min
    if (userOverride_?.max !== undefined) merged.max = userOverride_.max
    else if (curated?.max !== undefined) merged.max = curated.max

    // User override wins for any field it sets, including structural fields
    // like default, description, options, etc.
    if (userOverride_) {
      if (userOverride_.default !== undefined) merged.default = userOverride_.default
      if (userOverride_.description !== undefined) merged.description = userOverride_.description
      if (userOverride_.type !== undefined) merged.type = userOverride_.type
      if (userOverride_.short !== undefined) merged.short = userOverride_.short
      if (userOverride_.env !== undefined) merged.env = userOverride_.env
      if (userOverride_.options !== undefined) merged.options = userOverride_.options
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
