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

function printCommandHelp(
  command: ReturnType<typeof parseCliOptions>['command'],
  output: CliOutput,
) {
  switch (command) {
    case 'init':
      printInitHelp(output)
      return
    case 'doctor':
      printDoctorHelp(output)
      return
    case 'clean':
      printCleanHelp(output)
      return
    case 'update':
      printUpdateHelp(output)
      return
    default:
      printHelp(output)
  }
}

// 프로젝트 선택과 중단 트랜잭션 복구 판단을 CLI 진입점에서 분리한다.
function resolveCommandProject(
  invocationCwd: string,
  command: NonNullable<ReturnType<typeof parseCliOptions>['command']>,
  project: string | undefined,
  allowRecovery: boolean,
  output: CliOutput,
) {
  // package.json이 반쯤 쓰인 상태에서도 루트 저널은 먼저 확인할 수 있어야 한다.
  if (
    command !== 'doctor' &&
    !project &&
    handlePendingTransaction(invocationCwd, allowRecovery, output)
  ) {
    return null
  }

  const resolution = resolveWorkspaceProject(invocationCwd, command, project)
  const cwd = resolution.projectRoot
  if (cwd !== invocationCwd) {
    output.info(
      `[Frontron] Using workspace project: ${relative(resolution.invocationRoot, cwd).replace(/\\/g, '/')}`,
    )
  }

  if (
    command !== 'doctor' &&
    (project || cwd !== invocationCwd) &&
    handlePendingTransaction(cwd, allowRecovery, output)
  ) {
    return null
  }

  return cwd
}

async function runParsedCommand(
  command: NonNullable<ReturnType<typeof parseCliOptions>['command']>,
  parsed: ReturnType<typeof parseCliOptions>,
  cwd: string,
  output: CliOutput,
  context: CliContext,
) {
  const io = {
    cwd,
    output,
    stdin: context.stdin ?? process.stdin,
    stdout: context.stdout ?? process.stdout,
    prompter: context.prompter,
  }

  switch (command) {
    case 'init':
      return await runInit(parsed.options, io)
    case 'doctor':
      return await runDoctor({ cwd, output })
    case 'clean':
      return await runClean(parsed.options, { cwd, output })
    case 'update':
      return await runUpdate(parsed.options, io)
  }
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
    printCommandHelp(parsed.command, output)
    return 0
  }

  const command = parsed.command
  if (!command) {
    printHelp(output)
    return 0
  }

  try {
    const allowRecovery = command !== 'doctor' && parsed.options.yes && !parsed.options.dryRun
    const cwd = resolveCommandProject(invocationCwd, command, parsed.project, allowRecovery, output)
    if (!cwd) return 1
    return await runParsedCommand(command, parsed, cwd, output, context)
  } catch (error) {
    output.error(`[Frontron] ${(error as Error).message}`)
    return 1
  }
}
