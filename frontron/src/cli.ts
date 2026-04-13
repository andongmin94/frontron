import { runInit, type InitPrompter, type InitOptions } from './init'

export interface CliOutput {
  info(message: string): void
  error(message: string): void
}

export interface CliContext {
  cwd?: string
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  prompter?: InitPrompter
}

const defaultOutput: CliOutput = {
  info(message: string) {
    console.log(message)
  },
  error(message: string) {
    console.error(message)
  },
}

const PLACEHOLDER_LINES = [
  '[Frontron] `frontron` is now an experimental init shell.',
  '[Frontron] The existing-project retrofit flow is still starter-derived and conservative.',
  '[Frontron] Start new apps with `npm create frontron@latest`.',
  '[Frontron] `frontron init` can now seed the first minimal Electron source into compatible web frontend projects.',
] as const

function printHelp(output: CliOutput) {
  output.info('Usage: frontron <init|check|dev|build> [--help]')
  output.info('')

  for (const line of PLACEHOLDER_LINES) {
    output.info(line)
  }

  output.info('')
  output.info('Active command: init')
  output.info('Placeholder commands: check, dev, build')
}

function printCommandNotice(command: string, output: CliOutput) {
  output.error(`[Frontron] "${command}" is not active in the current init-shell package.`)

  for (const line of PLACEHOLDER_LINES) {
    output.error(line)
  }
}

function parseCliOptions(argv: string[]) {
  const options: InitOptions = {
    yes: false,
    force: false,
  }
  const positional: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (!argument.startsWith('-')) {
      positional.push(argument)
      continue
    }

    const nextValue = argv[index + 1]

    switch (argument) {
      case '--help':
      case '-h':
        positional.push(argument)
        break
      case '--yes':
      case '-y':
        options.yes = true
        break
      case '--force':
        options.force = true
        break
      case '--desktop-dir':
        if (!nextValue) throw new Error('--desktop-dir requires a value.')
        options.desktopDir = nextValue
        index += 1
        break
      case '--app-script':
        if (!nextValue) throw new Error('--app-script requires a value.')
        options.appScript = nextValue
        index += 1
        break
      case '--build-script':
        if (!nextValue) throw new Error('--build-script requires a value.')
        options.buildScript = nextValue
        index += 1
        break
      case '--web-dev':
        if (!nextValue) throw new Error('--web-dev requires a value.')
        options.webDevScript = nextValue
        index += 1
        break
      case '--web-build':
        if (!nextValue) throw new Error('--web-build requires a value.')
        options.webBuildScript = nextValue
        index += 1
        break
      case '--out-dir':
        if (!nextValue) throw new Error('--out-dir requires a value.')
        options.outDir = nextValue
        index += 1
        break
      case '--product-name':
        if (!nextValue) throw new Error('--product-name requires a value.')
        options.productName = nextValue
        index += 1
        break
      case '--app-id':
        if (!nextValue) throw new Error('--app-id requires a value.')
        options.appId = nextValue
        index += 1
        break
      case '--preset':
        if (!nextValue) throw new Error('--preset requires a value.')
        options.preset = nextValue
        index += 1
        break
      default:
        throw new Error(`Unknown option "${argument}".`)
    }
  }

  return { options, positional }
}

export async function runCli(
  argv = process.argv.slice(2),
  output: CliOutput = defaultOutput,
  context: CliContext = {},
) {
  let parsed: ReturnType<typeof parseCliOptions>

  try {
    parsed = parseCliOptions(argv)
  } catch (error) {
    output.error(`[Frontron] ${(error as Error).message}`)
    return 1
  }

  const command = parsed.positional[0]

  if (!command || command === '--help' || command === '-h') {
    printHelp(output)
    return 0
  }

  if (command === 'doctor') {
    printCommandNotice('check', output)
    return 1
  }

  if (command === 'init') {
    try {
      return await runInit(parsed.options, {
        cwd: context.cwd ?? process.cwd(),
        output,
        stdin: context.stdin ?? process.stdin,
        stdout: context.stdout ?? process.stdout,
        prompter: context.prompter,
      })
    } catch (error) {
      output.error(`[Frontron] ${(error as Error).message}`)
      return 1
    }
  }

  if (command === 'check' || command === 'dev' || command === 'build') {
    printCommandNotice(command, output)
    return 1
  }

  output.error(
    `[Frontron] Unknown command "${command}". Expected "init", "check", "dev", or "build".`,
  )
  return 1
}
