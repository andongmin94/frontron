import type { CliOutput } from '../cli-output'

const HELP_LINES = [
  '[Frontron] `frontron init` seeds a conservative Electron layer into an existing web frontend project.',
  '[Frontron] Start new apps with `npm create frontron@latest`.',
  '[Frontron] The retrofit flow stays app-owned and avoids replacing the existing frontend structure.',
] as const

// printHelp 함수는 Frontron CLI 전체 도움말을 출력한다.
export function printHelp(output: CliOutput) {
  output.info('Usage: frontron <init|doctor|clean|update> [options]')
  output.info('')

  for (const line of HELP_LINES) {
    output.info(line)
  }

  output.info('')
  output.info('Commands:')
  output.info('  init                                    Add a conservative Electron layer.')
  output.info('  doctor                                  Check an initialized Electron layer.')
  output.info(
    '  clean                                   Remove manifest-owned files, scripts, and package metadata.',
  )
  output.info(
    '  update                                  Refresh manifest-owned files, scripts, and package metadata.',
  )
  output.info('')
  output.info('Run "frontron <command> --help" for command-specific options.')
}

// printInitHelp 함수는 init 명령 도움말을 출력한다.
export function printInitHelp(output: CliOutput) {
  output.info('Usage: frontron init [options]')
  output.info('')
  output.info('Add a conservative Electron layer to an existing web frontend project.')
  output.info('')
  output.info('Options:')
  output.info(
    '  --dry-run                              Show the plan without applying it; pending recovery runs first.',
  )
  output.info(
    '  --yes, -y                              Use detected/default values without prompts; fails if required paths cannot be inferred.',
  )
  output.info(
    '  --adapter <generic-static|next-export|next-standalone|nuxt-node-server|remix-node-server|sveltekit-static|sveltekit-node|generic-node-server>',
  )
  output.info(
    '                                                   Override runtime adapter auto-detection.',
  )
  output.info('  --desktop-dir <path>                    Electron source directory.')
  output.info('  --app-script <name>                     Desktop dev script name.')
  output.info('  --build-script <name>                   Desktop build script name.')
  output.info('  --package-script <name>                 Desktop package script name.')
  output.info('  --web-dev <name>                        Existing frontend dev script name.')
  output.info('  --web-build <name>                      Existing frontend build script name.')
  output.info('  --out-dir <path>                        Frontend build output directory.')
  output.info(
    '  --server-root <path>                    Source runtime root for node-server adapters.',
  )
  output.info('  --server-entry <path>                   Server entry inside that runtime root.')
  output.info('  --product-name <name>                   Electron product name.')
  output.info('  --app-id <id>                           Electron app id.')
}

// printDoctorHelp 함수는 doctor 명령 도움말을 출력한다.
export function printDoctorHelp(output: CliOutput) {
  output.info('Usage: frontron doctor')
  output.info('')
  output.info(
    'Check an initialized Electron retrofit layer and report missing or locally edited manifest-owned parts.',
  )
}

// printCleanHelp 함수는 clean 명령 도움말을 출력한다.
export function printCleanHelp(output: CliOutput) {
  output.info('Usage: frontron clean [options]')
  output.info('')
  output.info(
    'Remove only files, scripts, and package metadata recorded in .frontron/manifest.json.',
  )
  output.info('')
  output.info('Options:')
  output.info(
    '  --dry-run                              Show the cleanup plan without applying it; pending recovery runs first.',
  )
  output.info('  --yes, -y                              Apply the cleanup plan.')
  output.info(
    '  --force                                Remove manifest-owned files or metadata even when local edits are detected.',
  )
}

// printUpdateHelp 함수는 update 명령 도움말을 출력한다.
export function printUpdateHelp(output: CliOutput) {
  output.info('Usage: frontron update [options]')
  output.info('')
  output.info(
    'Refresh manifest-owned files, scripts, and package metadata using the init settings recorded in the manifest.',
  )
  output.info('')
  output.info('Options:')
  output.info(
    '  --dry-run                              Show the refresh plan without applying it; pending recovery runs first.',
  )
  output.info('  --yes, -y                              Apply the refresh plan.')
  output.info(
    '  --force                                Overwrite locally edited manifest-owned files and scripts.',
  )
}
