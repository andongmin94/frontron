import { spawn } from 'node:child_process'

import type { FrontronHook, FrontronHookContext } from './types'

export interface HookOutput {
  info(message: string): void
  error(message: string): void
}

function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (signal) {
        resolvePromise(1)
        return
      }

      resolvePromise(code ?? 0)
    })
  })
}

export async function runHook(
  hookName: string,
  hook: FrontronHook | undefined,
  context: FrontronHookContext,
  output: HookOutput,
) {
  if (!hook) {
    return
  }

  output.info(`[Frontron] Running hook "${hookName}".`)

  if (typeof hook === 'function') {
    await hook(context)
    return
  }

  const child = spawn(hook, [], {
    cwd: context.rootDir,
    env: process.env,
    shell: true,
    stdio: 'inherit',
  })
  const exitCode = await waitForExit(child)

  if (exitCode !== 0) {
    throw new Error(`[Frontron] Hook "${hookName}" failed with exit code ${exitCode}.`)
  }
}
