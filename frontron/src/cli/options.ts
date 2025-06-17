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
  ['--package-script', 'packageScript'],
  ['--web-dev', 'webDevScript'],
  ['--web-build', 'webBuildScript'],
  ['--out-dir', 'outDir'],
  ['--server-root', 'serverRoot'],
  ['--server-entry', 'serverEntry'],
  ['--product-name', 'productName'],
  ['--app-id', 'appId'],
  ['--preset', 'preset'],
])

// splitOptionArgument 함수는 --option=value 형태를 옵션 이름과 값으로 나눈다.
function splitOptionArgument(argument: string) {
  const equalsIndex = argument.startsWith('--') ? argument.indexOf('=') : -1

  if (equalsIndex === -1) {
    return { name: argument, inlineValue: null }
  }

  return {
    name: argument.slice(0, equalsIndex),
    inlineValue: argument.slice(equalsIndex + 1),
  }
}

// rejectInlineValue 함수는 값을 받지 않는 플래그에 =value가 붙었는지 검사한다.
function rejectInlineValue(name: string, inlineValue: string | null) {
  if (inlineValue !== null) {
    throw new Error(`${name} does not accept a value.`)
  }
}

// readOptionValue 함수는 --option=value 또는 --option value 형식의 값을 읽는다.
function readOptionValue(name: string, inlineValue: string | null, argv: string[], index: number) {
  if (inlineValue !== null) {
    if (!inlineValue) {
      throw new Error(`${name} requires a value.`)
    }

    return {
      value: inlineValue,
      nextIndex: index,
    }
  }

  const nextValue = argv[index + 1]

  if (!nextValue || nextValue.startsWith('-')) {
    throw new Error(`${name} requires a value.`)
  }

  return {
    value: nextValue,
    nextIndex: index + 1,
  }
}

// isCliCommand 함수는 첫 번째 인자가 지원하는 명령인지 확인한다.
function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value)
}

// createDefaultOptions 함수는 모든 명령이 공유하는 안전한 기본 옵션을 만든다.
function createDefaultOptions(): InitOptions {
  return {
    yes: false,
    force: false,
  }
}

// throwUnknownCommand 함수는 지원하지 않는 명령과 사용 가능한 명령을 함께 안내한다.
function throwUnknownCommand(command: string): never {
  throw new Error(
    `Unknown command "${command}". Supported commands: ${CLI_COMMANDS.map((value) => `"${value}"`).join(', ')}.`,
  )
}

// throwUnknownOption 함수는 현재 명령에서 허용하지 않는 옵션을 명확히 거부한다.
function throwUnknownOption(command: CliCommand, option: string): never {
  throw new Error(`Unknown option "${option}" for "frontron ${command}".`)
}

// throwUnexpectedPositional 함수는 명령 뒤에 잘못 붙은 위치 인자를 거부한다.
function throwUnexpectedPositional(command: CliCommand, argument: string): never {
  throw new Error(
    `Unexpected positional argument "${argument}" for "frontron ${command}". This command accepts no positional arguments.`,
  )
}

// throwInitForceMigrationError 함수는 제거된 init --force 대신 update 사용법을 안내한다.
function throwInitForceMigrationError(): never {
  throw new Error(
    '--force is not available for "frontron init". Use "frontron update --yes" to refresh an existing initialization, or "frontron update --yes --force" to overwrite locally edited manifest-owned files.',
  )
}

// parseCliOptions 함수는 명령을 먼저 고른 뒤 그 명령이 허용하는 옵션만 해석한다.
export function parseCliOptions(argv: string[]): ParsedCliOptions {
  const options = createDefaultOptions()
  const rawCommand = argv[0]

  if (!rawCommand) {
    return { command: null, help: true, options }
  }

  if (rawCommand === '--help' || rawCommand === '-h') {
    if (argv.length > 1) {
      throw new Error(`Unexpected positional argument "${argv[1]}" for "frontron ${rawCommand}".`)
    }

    return { command: null, help: true, options }
  }

  if (!isCliCommand(rawCommand)) {
    throwUnknownCommand(rawCommand)
  }

  let help = false
  const commandArguments = argv.slice(1)

  for (let index = 0; index < commandArguments.length; index += 1) {
    const rawArgument = commandArguments[index]

    if (!rawArgument.startsWith('-')) {
      throwUnexpectedPositional(rawCommand, rawArgument)
    }

    const { name: argument, inlineValue } = splitOptionArgument(rawArgument)

    if (argument === '--help' || argument === '-h') {
      rejectInlineValue(argument, inlineValue)
      help = true
      continue
    }

    if (rawCommand === 'init' && argument === '--force') {
      throwInitForceMigrationError()
    }

    if (argument === '--yes' || argument === '-y') {
      if (rawCommand === 'doctor') {
        throwUnknownOption(rawCommand, rawArgument)
      }

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
      if (rawCommand === 'doctor') {
        throwUnknownOption(rawCommand, rawArgument)
      }

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
