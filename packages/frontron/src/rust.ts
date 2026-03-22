import type { ResolvedFrontronRustConfig } from './types'

export interface RustTask {
  command: string
  args: string[]
  cwd: string
  displayCommand: string
}

export function getRustTask(
  commandName: 'dev' | 'build',
  rust: ResolvedFrontronRustConfig | undefined,
): RustTask | null {
  if (!rust?.enabled) {
    return null
  }

  if (commandName === 'dev') {
    return {
      command: 'cargo',
      args: ['build'],
      cwd: rust.path,
      displayCommand: 'cargo build',
    }
  }

  return {
    command: 'cargo',
    args: ['build', '--release'],
    cwd: rust.path,
    displayCommand: 'cargo build --release',
  }
}
