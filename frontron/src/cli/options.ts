import type { InitOptions } from '../init/shared'

export const CLI_COMMANDS = ['init', 'doctor', 'clean', 'update'] as const

export type CliCommand = (typeof CLI_COMMANDS)[number]

export type ParsedCliOptions = {
  command: CliCommand | null
  help: boolean
  options: InitOptions
}

type InitValueOption = Exclude<keyof InitOptions, 'yes' | 'force' | 'dryRun'>

const INIT_VALUE_OPTIONS = new Map<string, InitValueOption>([
  ['--adapter', 'adapter'],
  ['--desktop-dir', 'desktopDir'],
  ['--app-script', 'appScript'],
  ['--build-script', 'buildScript'],
  ['--web-dev', 'webDevScript'],
  ['--web-build', 'webBuildScript'],
  ['--out-dir', 'outDir'],
  ['--server-root', 'serverRoot'],
  ['--server-entry', 'serverEntry'],
  ['--product-name', 'productName'],
  ['--app-id', 'appId'],
])

function splitOptionArgument(argument: string) {
  const equalsIndex = argument.startsWith('--') ? argument.indexOf('=') : -1

  if (equalsIndex === -1) return { name: argument, inlineValue: null }

  return {
    name: argument.slice(0, equalsIndex),
    inlineValue: argument.slice(equalsIndex + 1),
  }
}

function rejectInlineValue(name: string, inlineValue: string | null) {
  if (inlineValue !== null) throw new Error(`${name} does not accept a value.`)
}

function readOptionValue(name: string, inlineValue: string | null, argv: string[], index: number) {
  if (inlineValue !== null) {
    if (!inlineValue) throw new Error(`${name} requires a value.`)
    return { value: inlineValue, nextIndex: index }
  }

  const nextValue = argv[index + 1]

  if (!nextValue || nextValue.startsWith('-')) {
    throw new Error(`${name} requires a value.`)
  }

  return { value: nextValue, nextIndex: index + 1 }
}

function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value)
}

function createDefaultOptions(): InitOptions {
  return { yes: false, force: false }
}

function throwUnknownCommand(command: string): never {
  throw new Error(
    `Unknown command "${command}". Supported commands: ${CLI_COMMANDS.map((value) => `"${value}"`).join(', ')}.`,
  )
}

function throwUnknownOption(command: CliCommand, option: string): never {
  throw new Error(`Unknown option "${option}" for "frontron ${command}".`)
}

function throwUnexpectedPositional(command: CliCommand, argument: string): never {
  throw new Error(
    `Unexpected positional argument "${argument}" for "frontron ${command}". This command accepts no positional arguments.`,
  )
}

function throwInitForceMigrationError(): never {
  throw new Error(
    '--force is not available for "frontron init". Use "frontron update --yes" to refresh an existing initialization, or "frontron update --yes --force" to overwrite locally edited manifest-owned files.',
  )
}

export function parseCliOptions(argv: string[]): ParsedCliOptions {
  const options = createDefaultOptions()
  const rawCommand = argv[0]

  if (!rawCommand) return { command: null, help: true, options }

  if (rawCommand === '--help' || rawCommand === '-h') {
    if (argv.length > 1) {
      throw new Error(`Unexpected positional argument "${argv[1]}" for "frontron ${rawCommand}".`)
    }

    return { command: null, help: true, options }
  }

  if (!isCliCommand(rawCommand)) throwUnknownCommand(rawCommand)

  let help = false
  const commandArguments = argv.slice(1)

  for (let index = 0; index < commandArguments.length; index += 1) {
    const rawArgument = commandArguments[index]

    if (!rawArgument.startsWith('-')) throwUnexpectedPositional(rawCommand, rawArgument)

    const { name: argument, inlineValue } = splitOptionArgument(rawArgument)

    if (argument === '--help' || argument === '-h') {
      rejectInlineValue(argument, inlineValue)
      help = true
      continue
    }

    if (rawCommand === 'init' && argument === '--force') throwInitForceMigrationError()

    if (argument === '--yes' || argument === '-y') {
      if (rawCommand === 'doctor') throwUnknownOption(rawCommand, rawArgument)
      rejectInlineValue(argument, inlineValue)
      options.yes = true
      continue
    }

    if (argument === '--force') {
      if (rawCommand !== 'clean' && rawCommand !== 'update') {
        throwUnknownOption(rawCommand, rawArgument)
      }

      rejectInlineValue(argument, inlineValue)
      options.force = true
      continue
    }

    if (argument === '--dry-run') {
      if (rawCommand === 'doctor') throwUnknownOption(rawCommand, rawArgument)
      rejectInlineValue(argument, inlineValue)
      options.dryRun = true
      continue
    }

    const valueOption = INIT_VALUE_OPTIONS.get(argument)

    if (!valueOption || rawCommand !== 'init') {
      throwUnknownOption(rawCommand, rawArgument)
    }

    const next = readOptionValue(argument, inlineValue, commandArguments, index)
    options[valueOption] = next.value
    index = next.nextIndex
  }

  return { command: rawCommand, help, options }
}
