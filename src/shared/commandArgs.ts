import type { CommandParam, CommandsSchema, Template } from './types'

type CommandArgs = Template['args']

export function isDefaultTrueBooleanCommand(command: Pick<CommandParam, 'arg' | 'type' | 'default'>): boolean {
  return command.type === 'boolean' && command.default === true && command.arg.startsWith('--')
}

export function getBooleanCommandFlag(command: Pick<CommandParam, 'arg' | 'type' | 'default'>, value: unknown): string | null {
  if (command.type !== 'boolean') {
    return null
  }

  if (value === true) {
    return command.arg
  }

  if (value === false && isDefaultTrueBooleanCommand(command)) {
    return `--no-${command.arg.slice(2)}`
  }

  return null
}

export function isCommaListSelectCommand(command: Pick<CommandParam, 'arg' | 'type'>): boolean {
  return command.type === 'select' && command.arg === '--spec-type'
}

export function parseCommaListCommandValue(value: unknown): string[] {
  if (typeof value !== 'string') {
    return []
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function serializeCommaListCommandValue(values: readonly string[]): string {
  const seen = new Set<string>()
  const uniqueValues: string[] = []

  for (const value of values) {
    const trimmedValue = value.trim()
    if (!trimmedValue || seen.has(trimmedValue)) continue
    seen.add(trimmedValue)
    uniqueValues.push(trimmedValue)
  }

  return uniqueValues.join(',')
}

export function toggleCommaListCommandValue(
  currentValue: unknown,
  option: string,
  orderedOptions: readonly string[] = [],
  defaultValue?: CommandParam['default']
): string {
  const normalizedOption = option.trim()
  if (!normalizedOption) {
    return serializeCommaListCommandValue(parseCommaListCommandValue(currentValue))
  }

  const selectedValues = new Set(parseCommaListCommandValue(currentValue))

  if (selectedValues.has(normalizedOption)) {
    selectedValues.delete(normalizedOption)
  } else {
    if (typeof defaultValue === 'string') {
      if (normalizedOption === defaultValue) {
        selectedValues.clear()
      } else {
        selectedValues.delete(defaultValue)
      }
    }
    selectedValues.add(normalizedOption)
  }

  const orderedSelectedValues = orderedOptions.filter((orderedOption) => selectedValues.has(orderedOption))
  const remainingSelectedValues = Array.from(selectedValues).filter((selectedValue) => !orderedOptions.includes(selectedValue))

  return serializeCommaListCommandValue([...orderedSelectedValues, ...remainingSelectedValues])
}

function buildArgAliasMap(commandsSchema: CommandsSchema | null): Map<string, string> {
  const aliasMap = new Map<string, string>()

  if (!commandsSchema) return aliasMap

  for (const category of commandsSchema.categories) {
    for (const command of category.commands) {
      aliasMap.set(command.arg, command.arg)
      if (command.short) aliasMap.set(command.short, command.arg)
      if (isDefaultTrueBooleanCommand(command)) {
        aliasMap.set(`--no-${command.arg.slice(2)}`, command.arg)
      }
    }
  }

  return aliasMap
}

function buildCommandMap(commandsSchema: CommandsSchema | null): Map<string, CommandParam> {
  const commandMap = new Map<string, CommandParam>()

  if (!commandsSchema) return commandMap

  for (const category of commandsSchema.categories) {
    for (const command of category.commands) {
      commandMap.set(command.arg, command)
    }
  }

  return commandMap
}

export function normalizeCommandArgs(args: CommandArgs, commandsSchema: CommandsSchema | null): CommandArgs {
  const aliasMap = buildArgAliasMap(commandsSchema)
  const commandMap = buildCommandMap(commandsSchema)
  if (aliasMap.size === 0) return { ...args }

  const normalizedArgs: CommandArgs = {}

  for (const [key, value] of Object.entries(args)) {
    const canonicalKey = aliasMap.get(key) || key
    const existingValue = normalizedArgs[canonicalKey]
    const command = commandMap.get(canonicalKey)
    let normalizedValue = value

    if (key.startsWith('--no-') && aliasMap.has(key)) {
      if (value === true) {
        normalizedValue = false
      } else {
        continue
      }
    }

    if (command && isDefaultTrueBooleanCommand(command) && normalizedValue === true) {
      continue
    }

    if (existingValue === undefined || canonicalKey === key) {
      normalizedArgs[canonicalKey] = normalizedValue
    }
  }

  return normalizedArgs
}

export function buildTemplateLaunchArgs(
  template: Template,
  commandsSchema: CommandsSchema | null,
  modelPath: string
): string[] {
  const args: string[] = ['-m', modelPath]
  const normalizedArgs = normalizeCommandArgs(template.args || {}, commandsSchema)

  if (commandsSchema) {
    const knownArgs = new Set<string>()

    for (const category of commandsSchema.categories) {
      for (const command of category.commands) {
        knownArgs.add(command.arg)
        const value = normalizedArgs[command.arg]
        if (value === undefined || value === null || value === '') continue

        if (command.type === 'boolean') {
          const booleanFlag = getBooleanCommandFlag(command, value)
          if (booleanFlag) args.push(booleanFlag)
        } else {
          args.push(command.arg, String(value))
        }
      }
    }

    for (const [key, value] of Object.entries(normalizedArgs)) {
      if (knownArgs.has(key)) continue
      if (value === true) args.push(key)
      else if (value !== false && value !== null && value !== '') args.push(key, String(value))
    }
  } else {
    for (const [key, value] of Object.entries(normalizedArgs)) {
      if (value === true) args.push(key)
      else if (value !== false && value !== null && value !== '') args.push(key, String(value))
    }
  }

  if (!args.includes('--port') && template.serverPort) {
    args.push('--port', String(template.serverPort))
  }
  if ((template.launchMode || 'chat') === 'api' && !args.includes('--no-webui')) {
    args.push('--no-webui')
  }

  return args
}
