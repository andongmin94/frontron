import { runInit, type InitPrompter, type InitOptions } from './init'
import { runDoctor } from './doctor'
import { runClean } from './clean'
import { runUpdate } from './update'

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
  output.info('Usage: frontron <init|doctor|clean|update> [options]')
  output.info('')

  for (const line of HELP_LINES) {
    output.info(line)
  }

  output.info('')
  output.info('Commands:')
  output.info('  init                                    Add a conservative Electron layer.')
  output.info('  doctor                                  Check an initialized Electron layer.')
  output.info('  clean                                   Remove manifest-owned files, scripts, and package metadata.')
  output.info('  update                                  Refresh manifest-owned files, scripts, and package metadata.')
  output.info('')
  output.info('Run "frontron <command> --help" for command-specific options.')
}

function printInitHelp(output: CliOutput) {
  output.info('Usage: frontron init [options]')
  output.info('')
  output.info('Add a conservative Electron layer to an existing web frontend project.')
  output.info('')
  output.info('Options:')
  output.info('  --dry-run                              Show the plan without writing changes.')
  output.info('  --yes, -y                              Apply without interactive prompts.')
  output.info('  --force                                Refresh manifest-owned files from a previous init.')
  output.info(
    '  --adapter <generic-static|next-export|next-standalone|nuxt-node-server|remix-node-server|sveltekit-static|sveltekit-node|generic-node-server>',
  )
  output.info('                                                   Override runtime adapter auto-detection.')
  output.info('  --preset <minimal|starter-like>         Choose the Electron retrofit preset.')
  output.info('  --desktop-dir <path>                    Electron source directory.')
  output.info('  --app-script <name>                     Desktop dev script name.')
  output.info('  --build-script <name>                   Desktop build script name.')
  output.info('  --package-script <name>                 Desktop package script name.')
  output.info('  --web-dev <name>                        Existing frontend dev script name.')
  output.info('  --web-build <name>                      Existing frontend build script name.')
  output.info('  --out-dir <path>                        Frontend build output directory.')
  output.info('  --server-root <path>                    Source runtime root for node-server adapters.')
  output.info('  --server-entry <path>                   Server entry inside that runtime root.')
  output.info('  --product-name <name>                   Electron product name.')
  output.info('  --app-id <id>                           Electron app id.')
}

function printDoctorHelp(output: CliOutput) {
  output.info('Usage: frontron doctor')
  output.info('')
  output.info('Check an initialized Electron retrofit layer and report missing or locally edited manifest-owned parts.')
}

function printCleanHelp(output: CliOutput) {
  output.info('Usage: frontron clean [options]')
  output.info('')
  output.info('Remove only files, scripts, and package metadata recorded in .frontron/manifest.json.')
  output.info('')
  output.info('Options:')
  output.info('  --dry-run                              Show the cleanup plan without writing changes.')
  output.info('  --yes, -y                              Apply the cleanup plan.')
  output.info('  --force                                Remove manifest-owned files or metadata even when local edits are detected.')
}

function printUpdateHelp(output: CliOutput) {
  output.info('Usage: frontron update [options]')
  output.info('')
  output.info('Refresh manifest-owned files, scripts, and package metadata using the init settings recorded in the manifest.')
  output.info('')
  output.info('Options:')
  output.info('  --dry-run                              Show the refresh plan without writing changes.')
  output.info('  --yes, -y                              Apply the refresh plan.')
  output.info('  --adapter <name>                       Override the manifest adapter for this refresh.')
  output.info('  --preset <minimal|starter-like>         Override the manifest preset for this refresh.')
  output.info('  --desktop-dir <path>                    Override the manifest Electron source directory.')
  output.info('  --app-script <name>                     Override the manifest desktop dev script name.')
  output.info('  --build-script <name>                   Override the manifest desktop build script name.')
  output.info('  --package-script <name>                 Override the manifest desktop package script name.')
  output.info('  --web-dev <name>                        Override the manifest frontend dev script name.')
  output.info('  --web-build <name>                      Override the manifest frontend build script name.')
  output.info('  --out-dir <path>                        Override the manifest frontend build output directory.')
  output.info('  --server-root <path>                    Override the manifest node-server runtime root.')
  output.info('  --server-entry <path>                   Override the manifest node-server entry.')
  output.info('  --product-name <name>                   Override the manifest Electron product name.')
  output.info('  --app-id <id>                           Override the manifest Electron app id.')
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
      case '--dry-run':
        options.dryRun = true
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
      case '--package-script':
        if (!nextValue) throw new Error('--package-script requires a value.')
        options.packageScript = nextValue
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
      printInitHelp(output)
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

  if (command === 'doctor') {
    if (parsed.positional[1] === '--help' || parsed.positional[1] === '-h') {
      printDoctorHelp(output)
      return 0
    }

    try {
      return await runDoctor({
        cwd: context.cwd ?? process.cwd(),
        output,
      })
    } catch (error) {
      output.error(`[Frontron] ${(error as Error).message}`)
      return 1
    }
  }

  if (command === 'clean') {
    if (parsed.positional[1] === '--help' || parsed.positional[1] === '-h') {
      printCleanHelp(output)
      return 0
    }

    try {
      return await runClean(parsed.options, {
        cwd: context.cwd ?? process.cwd(),
        output,
      })
    } catch (error) {
      output.error(`[Frontron] ${(error as Error).message}`)
      return 1
    }
  }

  if (command === 'update') {
    if (parsed.positional[1] === '--help' || parsed.positional[1] === '-h') {
      printUpdateHelp(output)
      return 0
    }

    try {
      return await runUpdate(parsed.options, {
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

  output.error(`[Frontron] Unknown command "${command}". Supported commands: "init", "doctor", "clean", "update".`)
  return 1
}
