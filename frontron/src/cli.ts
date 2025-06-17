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

export type { CliOutput } from './cli-output'

export interface CliContext {
  cwd?: string
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  prompter?: InitPrompter
}

const defaultOutput: CliOutput = {
  // info 메서드는 일반 안내 메시지를 표준 출력으로 보낸다.
  info(message: string) {
    console.log(message)
  },
  // error 메서드는 오류 메시지를 표준 에러로 보낸다.
  error(message: string) {
    console.error(message)
  },
}

// runCli 함수는 CLI 인자를 해석해 init, doctor, clean, update 명령으로 라우팅한다.
export async function runCli(
  argv = process.argv.slice(2),
  output: CliOutput = defaultOutput,
  context: CliContext = {},
) {
  const cwd = context.cwd ?? process.cwd()
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
