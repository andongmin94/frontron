import { relative } from 'node:path'

import { runInit, type InitPrompter } from './init'
import { runDoctor } from './doctor'
import { runClean } from './clean'
import { runUpdate } from './update'
import type { CliOutput } from './cli-output'
import {
  printCleanHelp,
  printDoctorHelp,
  printHelp,
  printInitHelp,
  printUpdateHelp,
} from './cli/help'
import { parseCliOptions } from './cli/options'
import { recoverPendingTransaction } from './transaction-journal'
import { resolveWorkspaceProject } from './workspace-project'

export type { CliOutput } from './cli-output'

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

export async function runCli(
  argv = process.argv.slice(2),
  output: CliOutput = defaultOutput,
  context: CliContext = {},
) {
  const invocationCwd = context.cwd ?? process.cwd()
  let parsed: ReturnType<typeof parseCliOptions>

  try {
    parsed = parseCliOptions(argv)
  } catch (error) {
    output.error(`[Frontron] ${(error as Error).message}`)
    return 1
  }

  if (parsed.help) {
    switch (parsed.command) {
      case 'init':
        printInitHelp(output)
        break
      case 'doctor':
        printDoctorHelp(output)
        break
      case 'clean':
        printCleanHelp(output)
        break
      case 'update':
        printUpdateHelp(output)
        break
      default:
        printHelp(output)
    }

    return 0
  }

  const command = parsed.command

  if (!command) {
    printHelp(output)
    return 0
  }

  let cwd: string

  try {
    const resolution = resolveWorkspaceProject(invocationCwd, command, parsed.project)
    cwd = resolution.projectRoot

    if (resolution.projectRoot !== resolution.invocationRoot) {
      output.info(
        `[Frontron] Using workspace project: ${relative(
          resolution.invocationRoot,
          resolution.projectRoot,
        ).replace(/\\/g, '/')}`,
      )
    }
  } catch (error) {
    output.error(`[Frontron] ${(error as Error).message}`)
    return 1
  }

  if (command !== 'doctor') {
    try {
      const recovery = recoverPendingTransaction(cwd)

      if (recovery.recovered) {
        output.info(
          `[Frontron] Recovered an interrupted ${recovery.operation} transaction before running the command.`,
        )
      }
    } catch (error) {
      output.error(
        `[Frontron] Could not recover an interrupted transaction: ${(error as Error).message}`,
      )
      return 1
    }
  }

  try {
    switch (command) {
      case 'init':
        return await runInit(parsed.options, {
          cwd,
          output,
          stdin: context.stdin ?? process.stdin,
          stdout: context.stdout ?? process.stdout,
          prompter: context.prompter,
        })
      case 'doctor':
        return await runDoctor({ cwd, output })
      case 'clean':
        return await runClean(parsed.options, { cwd, output })
      case 'update':
        return await runUpdate(parsed.options, {
          cwd,
          output,
          stdin: context.stdin ?? process.stdin,
          stdout: context.stdout ?? process.stdout,
          prompter: context.prompter,
        })
    }
  } catch (error) {
    output.error(`[Frontron] ${(error as Error).message}`)
    return 1
  }
}
