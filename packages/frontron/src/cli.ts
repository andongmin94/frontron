import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'

import { loadConfig } from './config'
import { writeBridgeTypes } from './bridge-types'
import { runHook, type HookOutput } from './hooks'
import { getRustTask } from './rust'
import type { RuntimeManifest } from './runtime/manifest'

type CommandName = 'dev' | 'build'

interface ParsedCliArgs {
  command: string | null
  cwd?: string
  configFile?: string
  check: boolean
  help: boolean
}

interface CliOutput {
  info(message: string): void
  error(message: string): void
}

type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>

const defaultOutput: CliOutput = {
  info(message) {
    console.log(message)
  },
  error(message) {
    console.error(message)
  },
}

const require = createRequire(import.meta.url)

function parseArgs(argv: string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = {
    command: null,
    check: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === '--help' || value === '-h') {
      parsed.help = true
      continue
    }

    if (value === '--check') {
      parsed.check = true
      continue
    }

    if (value === '--cwd') {
      parsed.cwd = argv[index + 1]
      index += 1
      continue
    }

    if (value === '--config') {
      parsed.configFile = argv[index + 1]
      index += 1
      continue
    }

    if (!parsed.command) {
      parsed.command = value
      continue
    }

    throw new Error(`[Frontron] Unknown argument: ${value}`)
  }

  return parsed
}

function printHelp(output: CliOutput) {
  output.info('Usage: frontron <dev|build> [--cwd <path>] [--config <path>] [--check]')
  output.info('')
  output.info('Commands:')
  output.info('  dev     Run the configured web dev command and launch the framework-owned Electron runtime.')
  output.info('  build   Run the configured web build command and package the framework-owned Electron runtime.')
}

function ensureCommand(command: string | null): CommandName {
  if (command === 'dev' || command === 'build') {
    return command
  }

  throw new Error(
    `[Frontron] Unknown command "${command ?? ''}". Expected "dev" or "build".`,
  )
}

function resolvePackageFile(...pathSegments: string[]) {
  return resolve(dirname(fileURLToPath(import.meta.url)), ...pathSegments)
}

function resolveRuntimeEntry(entryName: 'main' | 'preload') {
  const candidates = [
    resolvePackageFile('runtime', `${entryName}.mjs`),
    resolvePackageFile('../dist/runtime', `${entryName}.mjs`),
    resolvePackageFile('runtime', `${entryName}.ts`),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`[Frontron] Runtime entry "${entryName}" is unavailable. Build the package first.`)
}

function resolveRuntimeSharedDir() {
  const candidates = [
    resolvePackageFile('shared'),
    resolvePackageFile('../dist/shared'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function readPackageJsonVersion(rootDir: string) {
  const packageJsonPath = join(rootDir, 'package.json')

  if (!existsSync(packageJsonPath)) {
    return {
      version: '0.0.0',
      name: 'frontron-app',
    }
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string
      version?: string
    }

    return {
      version: packageJson.version ?? '0.0.0',
      name: packageJson.name ?? 'frontron-app',
    }
  } catch {
    return {
      version: '0.0.0',
      name: 'frontron-app',
    }
  }
}

function resolveInstalledPackageVersion(packageName: string) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    version?: string
  }

  if (!packageJson.version) {
    throw new Error(`[Frontron] Could not resolve the installed version for ${packageName}.`)
  }

  return packageJson.version
}

function sanitizePackageName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z\d\-._~]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '') || 'frontron-app'
}

function createRuntimeManifest(
  loadedConfig: Awaited<ReturnType<typeof loadConfig>>,
  mode: RuntimeManifest['mode'],
) {
  const projectPackage = readPackageJsonVersion(loadedConfig.rootDir)
  const configFile = relative(loadedConfig.rootDir, loadedConfig.configPath).replace(/\\/g, '/')

  return {
    rootDir: loadedConfig.rootDir,
    configFile,
    mode,
    app: {
      name: loadedConfig.config.app.name,
      id: loadedConfig.config.app.id,
      version: projectPackage.version,
      icon: loadedConfig.config.app.icon,
    },
    web: {
      devUrl: loadedConfig.config.web?.dev?.url,
      outDir: loadedConfig.config.web?.build?.outDir,
    },
    windows: loadedConfig.config.windows ?? {
      main: {
        route: '/',
        width: 1280,
        height: 800,
      },
    },
  } satisfies RuntimeManifest
}

function ensureDotFrontronDir(rootDir: string, ...pathSegments: string[]) {
  const targetDir = join(rootDir, '.frontron', ...pathSegments)
  mkdirSync(targetDir, { recursive: true })
  return targetDir
}

function ensureConfigFileStaysInsideRoot(rootDir: string, configPath: string) {
  const relativePath = relative(rootDir, configPath).replace(/\\/g, '/')

  if (!relativePath || relativePath.startsWith('..')) {
    throw new Error(
      '[Frontron] Runtime staging requires the config file to stay inside the project root.',
    )
  }

  return relativePath
}

function stageFrameworkConfigSupport(
  loadedConfig: Awaited<ReturnType<typeof loadConfig>>,
  packagedAppDir: string,
) {
  const configFile = ensureConfigFileStaysInsideRoot(
    loadedConfig.rootDir,
    loadedConfig.configPath,
  )
  const stagedConfigPath = join(packagedAppDir, configFile)
  const appLayerDir = join(loadedConfig.rootDir, 'frontron')
  const shimDir = join(packagedAppDir, 'node_modules', 'frontron')

  mkdirSync(dirname(stagedConfigPath), { recursive: true })
  cpSync(loadedConfig.configPath, stagedConfigPath)

  if (existsSync(appLayerDir)) {
    cpSync(appLayerDir, join(packagedAppDir, 'frontron'), {
      recursive: true,
    })
  }

  mkdirSync(shimDir, { recursive: true })
  writeFileSync(
    join(shimDir, 'package.json'),
    JSON.stringify(
      {
        name: 'frontron',
        type: 'module',
        exports: './index.js',
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(shimDir, 'index.js'),
    [
      'export const defineConfig = (config) => config',
      'export default { defineConfig }',
      '',
    ].join('\n'),
  )

  return configFile
}

function readRelativeModuleImports(source: string) {
  const imports = new Set<string>()
  const patterns = [
    /from\s+['"](\.\/[^'"]+\.mjs)['"]/g,
    /import\(['"](\.\/[^'"]+\.mjs)['"]\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const importPath = match[1]

      if (importPath && !importPath.startsWith('./shared/')) {
        imports.add(importPath)
      }
    }
  }

  return [...imports]
}

function stageCompiledRuntimeModule(
  sourcePath: string,
  targetPath: string,
  sharedDir: string | null,
  stagedTargets = new Set<string>(),
) {
  if (stagedTargets.has(targetPath)) {
    return
  }

  stagedTargets.add(targetPath)

  const source = readFileSync(sourcePath, 'utf8').replaceAll('../shared/', './shared/')
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, source)

  if (sharedDir) {
    cpSync(sharedDir, join(dirname(targetPath), 'shared'), {
      recursive: true,
    })
  }

  for (const importPath of readRelativeModuleImports(source)) {
    const importedSourcePath = resolve(dirname(sourcePath), importPath)
    const importedTargetPath = resolve(dirname(targetPath), importPath)
    stageCompiledRuntimeModule(importedSourcePath, importedTargetPath, sharedDir, stagedTargets)
  }
}

function stageRuntimeEntryFile(
  entryPath: string,
  targetPath: string,
  sharedDir: string | null,
) {
  if (!entryPath.endsWith('.mjs')) {
    cpSync(entryPath, targetPath)
    return
  }

  stageCompiledRuntimeModule(entryPath, targetPath, sharedDir)
}

function writeRuntimeManifest(rootDir: string, manifest: RuntimeManifest, targetDir: string) {
  mkdirSync(targetDir, { recursive: true })
  const manifestPath = join(targetDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  return manifestPath
}

function resolveElectronBinary() {
  const electronBinary = require('electron')

  if (typeof electronBinary !== 'string' || electronBinary.length === 0) {
    throw new Error('[Frontron] Could not resolve the Electron binary from the frontron package.')
  }

  return electronBinary
}

function resolvePackageBin(packageName: string, binName: string) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }

  const relativeBinPath =
    typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binName]

  if (!relativeBinPath) {
    throw new Error(`[Frontron] Could not resolve the "${binName}" binary from ${packageName}.`)
  }

  return resolve(dirname(packageJsonPath), relativeBinPath)
}

function stagePackageDependency(packageName: string, packagedAppDir: string) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const sourceDir = dirname(packageJsonPath)
  const targetDir = join(packagedAppDir, 'node_modules', ...packageName.split('/'))

  mkdirSync(dirname(targetDir), { recursive: true })
  cpSync(sourceDir, targetDir, {
    recursive: true,
  })
}

function spawnCommand(
  command: string,
  args: string[],
  options: {
    cwd: string
    env?: NodeJS.ProcessEnv
    shell?: boolean
  },
) {
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: options.shell ?? false,
    stdio: 'inherit',
  })
}

function waitForChildExit(child: ChildProcess) {
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

function terminateChild(child: ChildProcess | null) {
  if (!child || child.killed) {
    return
  }

  child.kill('SIGTERM')
}

async function runShellCommand(command: string, cwd: string) {
  const child = spawnCommand(command, [], {
    cwd,
    shell: true,
  })

  return await waitForChildExit(child)
}

function getConfiguredCommand(
  command: CommandName,
  config: LoadedConfig['config'],
) {
  if (command === 'dev') {
    const devConfig = config.web?.dev

    if (!devConfig?.command || !devConfig.url) {
      throw new Error('[Frontron] "dev" requires "web.dev.command" and "web.dev.url".')
    }

    return {
      mode: 'dev',
      target: devConfig.url,
      command: devConfig.command,
    }
  }

  const buildConfig = config.web?.build

  if (!buildConfig?.command || !buildConfig.outDir) {
    throw new Error('[Frontron] "build" requires "web.build.command" and "web.build.outDir".')
  }

  return {
    mode: 'build',
    target: buildConfig.outDir,
    command: buildConfig.command,
  }
}

async function runRustTask(
  commandName: CommandName,
  loadedConfig: LoadedConfig,
  output: CliOutput,
) {
  const rustTask = getRustTask(commandName, loadedConfig.config.rust)

  if (!rustTask) {
    return 0
  }

  output.info(`[Frontron] Running Rust slot command: ${rustTask.displayCommand}`)
  const child = spawnCommand(rustTask.command, rustTask.args, {
    cwd: rustTask.cwd,
  })

  return await waitForChildExit(child)
}

async function runDevRuntime(
  loadedConfig: LoadedConfig,
  output: CliOutput,
) {
  await runHook(
    'beforeDev',
    loadedConfig.config.hooks?.beforeDev,
    {
      rootDir: loadedConfig.rootDir,
      configPath: loadedConfig.configPath,
      command: 'dev',
    },
    output as HookOutput,
  )

  const rustExitCode = await runRustTask('dev', loadedConfig, output)

  if (rustExitCode !== 0) {
    return rustExitCode
  }

  const configuredCommand = getConfiguredCommand('dev', loadedConfig.config)
  const manifest = createRuntimeManifest(loadedConfig, 'development')
  const runtimeDir = ensureDotFrontronDir(loadedConfig.rootDir, 'runtime', 'dev')
  const manifestPath = writeRuntimeManifest(loadedConfig.rootDir, manifest, runtimeDir)
  const electronBinary = resolveElectronBinary()
  const runtimeMainPath = resolveRuntimeEntry('main')

  output.info(`[Frontron] Launching web dev command: ${configuredCommand.command}`)
  output.info(`[Frontron] Launching framework runtime: ${runtimeMainPath}`)

  const webChild = spawnCommand(configuredCommand.command, [], {
    cwd: loadedConfig.rootDir,
    shell: true,
  })

  const electronChild = spawnCommand(
    electronBinary,
    [runtimeMainPath],
    {
      cwd: loadedConfig.rootDir,
      env: {
        ...process.env,
        FRONTRON_MANIFEST_PATH: manifestPath,
      },
    },
  )

  const webExit = waitForChildExit(webChild)
  const electronExit = waitForChildExit(electronChild)
  const [firstExited, exitCode] = await Promise.race([
    webExit.then((resolvedExitCode) => ['web', resolvedExitCode] as const),
    electronExit.then((resolvedExitCode) => ['electron', resolvedExitCode] as const),
  ])

  if (firstExited === 'web') {
    terminateChild(electronChild)
    return exitCode
  }

  terminateChild(webChild)
  return exitCode
}

export function stageBuildApp(loadedConfig: Awaited<ReturnType<typeof loadConfig>>) {
  const manifest = createRuntimeManifest(loadedConfig, 'production')
  const stageDir = ensureDotFrontronDir(loadedConfig.rootDir, 'runtime', 'build')
  const packagedAppDir = join(stageDir, 'app')
  const webOutDir = loadedConfig.config.web?.build?.outDir
  const runtimeMainEntry = resolveRuntimeEntry('main')
  const runtimePreloadEntry = resolveRuntimeEntry('preload')
  const runtimeSharedDir = resolveRuntimeSharedDir()

  if (!webOutDir || !existsSync(webOutDir)) {
    throw new Error(`[Frontron] Built web output not found: ${webOutDir ?? '(missing path)'}`)
  }

  rmSync(packagedAppDir, { recursive: true, force: true })
  mkdirSync(packagedAppDir, { recursive: true })

  cpSync(webOutDir, join(packagedAppDir, 'web'), {
    recursive: true,
  })

  stageRuntimeEntryFile(runtimeMainEntry, join(packagedAppDir, 'main.mjs'), runtimeSharedDir)
  stageRuntimeEntryFile(
    runtimePreloadEntry,
    join(packagedAppDir, 'preload.mjs'),
    runtimeSharedDir,
  )

  let stagedIconName: string | undefined

  if (manifest.app.icon && existsSync(manifest.app.icon)) {
    stagedIconName = `icon${extname(manifest.app.icon)}`
    cpSync(manifest.app.icon, join(packagedAppDir, stagedIconName))
    manifest.app.icon = stagedIconName
  }

  manifest.rootDir = packagedAppDir
  manifest.configFile = stageFrameworkConfigSupport(loadedConfig, packagedAppDir)
  manifest.web.outDir = './web'
  writeRuntimeManifest(loadedConfig.rootDir, manifest, packagedAppDir)

  if (loadedConfig.config.rust?.enabled) {
    stagePackageDependency('koffi', packagedAppDir)
  }

  const projectPackage = readPackageJsonVersion(loadedConfig.rootDir)
  const frontronPackage = JSON.parse(
    readFileSync(resolvePackageFile('../package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>
  }
  const electronVersion =
    frontronPackage.dependencies?.electron && !frontronPackage.dependencies.electron.startsWith('^')
      ? frontronPackage.dependencies.electron
      : resolveInstalledPackageVersion('electron')

  writeFileSync(
    join(packagedAppDir, 'package.json'),
    JSON.stringify(
      {
        name: sanitizePackageName(projectPackage.name),
        version: projectPackage.version,
        type: 'module',
        main: 'main.mjs',
        description: loadedConfig.config.app.name,
        devDependencies: {
          electron: electronVersion,
        },
      },
      null,
      2,
    ),
  )

  const builderConfigPath = join(stageDir, 'builder.json')
  writeFileSync(
    builderConfigPath,
    JSON.stringify(
      {
        appId: loadedConfig.config.app.id,
        productName: loadedConfig.config.app.name,
        directories: {
          output: join(loadedConfig.rootDir, 'output'),
        },
        files: ['**/*'],
        icon: stagedIconName ? join(packagedAppDir, stagedIconName) : undefined,
        electronVersion,
        npmRebuild: false,
        nodeGypRebuild: false,
        publish: null,
      },
      null,
      2,
    ),
  )

  return {
    stageDir,
    packagedAppDir,
    builderConfigPath,
  }
}

async function runBuildRuntime(
  loadedConfig: LoadedConfig,
  output: CliOutput,
) {
  await runHook(
    'beforeBuild',
    loadedConfig.config.hooks?.beforeBuild,
    {
      rootDir: loadedConfig.rootDir,
      configPath: loadedConfig.configPath,
      command: 'build',
    },
    output as HookOutput,
  )

  const rustExitCode = await runRustTask('build', loadedConfig, output)

  if (rustExitCode !== 0) {
    return rustExitCode
  }

  const configuredCommand = getConfiguredCommand('build', loadedConfig.config)
  const webBuildExitCode = await runShellCommand(configuredCommand.command, loadedConfig.rootDir)

  if (webBuildExitCode !== 0) {
    return webBuildExitCode
  }

  const stagedBuild = stageBuildApp(loadedConfig)
  const electronBuilderCli = resolvePackageBin('electron-builder', 'electron-builder')

  output.info(`[Frontron] Staged packaged app: ${stagedBuild.packagedAppDir}`)
  output.info(`[Frontron] Packaging desktop app with framework-owned build config.`)

  const builderChild = spawnCommand(
    process.execPath,
    [
      electronBuilderCli,
      '--projectDir',
      stagedBuild.packagedAppDir,
      '--config',
      stagedBuild.builderConfigPath,
      '--publish',
      'never',
    ],
    {
      cwd: loadedConfig.rootDir,
    },
  )

  const builderExitCode = await waitForChildExit(builderChild)

  if (builderExitCode === 0) {
    await runHook(
      'afterPack',
      loadedConfig.config.hooks?.afterPack,
      {
        rootDir: loadedConfig.rootDir,
        configPath: loadedConfig.configPath,
        command: 'build',
        stageDir: stagedBuild.stageDir,
        packagedAppDir: stagedBuild.packagedAppDir,
        outputDir: join(loadedConfig.rootDir, 'output'),
      },
      output as HookOutput,
    )
  }

  return builderExitCode
}

export async function runCli(argv = process.argv.slice(2), output: CliOutput = defaultOutput) {
  try {
    const parsed = parseArgs(argv)

    if (parsed.help || !parsed.command) {
      printHelp(output)
      return 0
    }

    const command = ensureCommand(parsed.command)
    const cwd = resolve(parsed.cwd ?? process.cwd())
    const loadedConfig = await loadConfig({
      cwd,
      configFile: parsed.configFile,
    })
    const generatedBridgeTypesPath = writeBridgeTypes(loadedConfig)
    const configuredCommand = getConfiguredCommand(command, loadedConfig.config)

    output.info(`[Frontron] Loaded config: ${loadedConfig.configPath}`)
    output.info(`[Frontron] Generated bridge types: ${generatedBridgeTypesPath}`)
    output.info(
      `[Frontron] App: ${loadedConfig.config.app.name} (${loadedConfig.config.app.id})`,
    )
    output.info(`[Frontron] Web ${configuredCommand.mode} target: ${configuredCommand.target}`)

    if (loadedConfig.config.rust) {
      output.info(
        `[Frontron] Rust slot: ${loadedConfig.config.rust.path} (${loadedConfig.config.rust.enabled ? 'enabled' : 'disabled'})`,
      )
    }

    if (parsed.check) {
      output.info(`[Frontron] Configuration check passed for "${command}".`)
      return 0
    }

    if (command === 'dev') {
      return await runDevRuntime(loadedConfig, output)
    }

    return await runBuildRuntime(loadedConfig, output)
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const exitCode = await runCli()
  process.exitCode = exitCode
}
