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
import { hasPendingTransaction, recoverPendingTransaction } from './transaction-journal'
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

// Recovery is a write, never a hidden side effect of an inspection or prompt.
// Stop after recovery so that a fresh command plans against the restored files.
function handlePendingTransaction(cwd: string, allowRecovery: boolean, output: CliOutput) {
  if (!hasPendingTransaction(cwd)) return false
  if (!allowRecovery) {
    throw new Error(
      'A pending transaction exists. No files were changed. Back up user edits and ' +
      'rerun a write command with --yes (without --dry-run) to attempt recovery. ' +
      'Conflicting files and the journal will be preserved.',
    )
  }
  const recovery = recoverPendingTransaction(cwd)
  if (recovery.recovered) {
    output.info(
      `[Frontron] Recovered an interrupted ${recovery.operation} transaction. ` +
      'The requested command was not applied. Inspect the restored project and run it again.',
    )
  }
  return true
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

  const allowRecovery = command !== 'doctor' && parsed.options.yes && !parsed.options.dryRun
  let cwd: string
  try {
    // A partially written package.json can prevent workspace resolution. Only
    // inspect the invocation root here when no other project was selected.
    if (!parsed.project && handlePendingTransaction(invocationCwd, allowRecovery, output)) {
      return 1
    }
    const resolution = resolveWorkspaceProject(invocationCwd, command, parsed.project)
    cwd = resolution.projectRoot
    if (cwd !== invocationCwd) {
      output.info(
        `[Frontron] Using workspace project: ${relative(resolution.invocationRoot, cwd).replace(/\\/g, '/')}`,
      )
    }
    if ((parsed.project || cwd !== invocationCwd) && handlePendingTransaction(cwd, allowRecovery, output)) {
      return 1
    }
  } catch (error) {
    output.error(`[Frontron] ${(error as Error).message}`)
    return 1
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
