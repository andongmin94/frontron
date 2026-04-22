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

const HELP_LINES = [
  '[Frontron] `frontron init` seeds a conservative Electron layer into an existing web frontend project.',
  '[Frontron] Start new apps with `npm create frontron@latest`.',
  '[Frontron] The retrofit flow stays app-owned and avoids replacing the existing frontend structure.',
] as const

function printHelp(output: CliOutput) {
  output.info('Usage: frontron init [options]')
  output.info('')

  for (const line of HELP_LINES) {
    output.info(line)
  }

  output.info('')
  output.info('Options:')
  output.info(
    '  --adapter <generic-static|next-export|next-standalone|nuxt-node-server|remix-node-server|sveltekit-static|sveltekit-node|generic-node-server>',
  )
  output.info('                                                   Override runtime adapter auto-detection.')
  output.info('  --preset <minimal|starter-like>         Choose the Electron retrofit preset.')
  output.info('  --server-root <path>                    Source runtime root for node-server adapters.')
  output.info('  --server-entry <path>                   Server entry inside that runtime root.')
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
      case '--adapter':
        if (!nextValue) throw new Error('--adapter requires a value.')
        options.adapter = nextValue
        index += 1
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
      case '--server-root':
        if (!nextValue) throw new Error('--server-root requires a value.')
        options.serverRoot = nextValue
        index += 1
        break
      case '--server-entry':
        if (!nextValue) throw new Error('--server-entry requires a value.')
        options.serverEntry = nextValue
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

  if (command === 'init') {
    if (parsed.positional[1] === '--help' || parsed.positional[1] === '-h') {
      printHelp(output)
      return 0
    }

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

  output.error(`[Frontron] Unknown command "${command}". Only "init" is supported.`)
  return 1
}
