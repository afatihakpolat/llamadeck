import type { CommandsSchema, Template } from '../../../shared/types'

type CommandArgs = Template['args']

function buildArgAliasMap(commandsSchema: CommandsSchema | null): Map<string, string> {
  const aliasMap = new Map<string, string>()

  if (!commandsSchema) return aliasMap

  for (const category of commandsSchema.categories) {
    for (const command of category.commands) {
      aliasMap.set(command.arg, command.arg)
      if (command.short) aliasMap.set(command.short, command.arg)
    }
  }

  return aliasMap
}

export function normalizeCommandArgs(args: CommandArgs, commandsSchema: CommandsSchema | null): CommandArgs {
  const aliasMap = buildArgAliasMap(commandsSchema)
  if (aliasMap.size === 0) return { ...args }

  const normalizedArgs: CommandArgs = {}

  for (const [key, value] of Object.entries(args)) {
    const canonicalKey = aliasMap.get(key) || key
    const existingValue = normalizedArgs[canonicalKey]

    if (existingValue === undefined || canonicalKey === key) {
      normalizedArgs[canonicalKey] = value
    }
  }

  return normalizedArgs
}
