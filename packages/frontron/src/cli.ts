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
type CliCommand = CommandName | 'init'

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
type InferenceSource =
  | 'config'
  | 'package-script'
  | 'vite-default'
  | 'react-scripts-default'
  | 'framework-default'

interface ConfiguredCommand {
  mode: 'dev' | 'build'
  target: string
  command: string
  commandSource: InferenceSource
  targetSource: InferenceSource
}

const defaultOutput: CliOutput = {
  info(message) {
    console.log(message)
  },
  error(message) {
    console.error(message)
  },
}

const require = createRequire(import.meta.url)
const VITE_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.cts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
]

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
  output.info('Usage: frontron <init|dev|build> [--cwd <path>] [--config <path>] [--check]')
  output.info('')
  output.info('Commands:')
  output.info('  init    Add a basic frontron.config.ts and app:dev/app:build scripts to the current project.')
  output.info('  dev     Run the configured web dev command and launch the framework-owned Electron runtime.')
  output.info('  build   Run the configured web build command and package the framework-owned Electron runtime.')
}

function ensureCommand(command: string | null): CliCommand {
  if (command === 'dev' || command === 'build' || command === 'init') {
    return command
  }

  throw new Error(
    `[Frontron] Unknown command "${command ?? ''}". Expected "init", "dev", or "build".`,
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

function readProjectPackageJson(rootDir: string) {
  const packageJsonPath = join(rootDir, 'package.json')

  if (!existsSync(packageJsonPath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string
      version?: string
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
  } catch {
    return null
  }
}

function writeProjectPackageJson(
  rootDir: string,
  packageJson: Record<string, unknown>,
) {
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
}

function resolveDefaultAppIconPath() {
  const candidate = resolvePackageFile('../assets/default-icon.ico')
  return existsSync(candidate) ? candidate : undefined
}

function stripPackageScope(packageName: string | undefined) {
  if (!packageName) {
    return undefined
  }

  const slashIndex = packageName.lastIndexOf('/')
  return slashIndex >= 0 ? packageName.slice(slashIndex + 1) : packageName
}

function createSuggestedAppName(packageName: string | undefined) {
  const baseName = stripPackageScope(packageName)

  if (!baseName) {
    return 'My App'
  }

  const words = baseName
    .split(/[^a-zA-Z\d]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))

  return words.length > 0 ? words.join(' ') : 'My App'
}

function createSuggestedAppId(packageName: string | undefined) {
  const baseName = sanitizePackageName(stripPackageScope(packageName) ?? 'my-app')
    .replace(/\./g, '-')

  return `com.example.${baseName || 'my-app'}`
}

function createInitConfigSource(packageName: string | undefined) {
  const appName = createSuggestedAppName(packageName)
  const appId = createSuggestedAppId(packageName)

  return [
    "import { defineConfig } from 'frontron'",
    '',
    'export default defineConfig({',
    '  app: {',
    `    name: '${appName.replace(/'/g, "\\'")}',`,
    `    id: '${appId.replace(/'/g, "\\'")}',`,
    '  },',
    '})',
    '',
  ].join('\n')
}

function detectPackageManager(rootDir: string) {
  const userAgent = process.env.npm_config_user_agent ?? ''

  if (userAgent.startsWith('pnpm/')) {
    return 'pnpm'
  }

  if (userAgent.startsWith('yarn/')) {
    return 'yarn'
  }

  if (userAgent.startsWith('bun/')) {
    return 'bun'
  }

  if (existsSync(join(rootDir, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }

  if (existsSync(join(rootDir, 'yarn.lock'))) {
    return 'yarn'
  }

  if (existsSync(join(rootDir, 'bun.lock')) || existsSync(join(rootDir, 'bun.lockb'))) {
    return 'bun'
  }

  return 'npm'
}

function createRunScriptCommand(rootDir: string, scriptName: string) {
  const packageManager = detectPackageManager(rootDir)

  if (packageManager === 'yarn') {
    return `yarn ${scriptName}`
  }

  if (packageManager === 'pnpm') {
    return `pnpm run ${scriptName}`
  }

  if (packageManager === 'bun') {
    return `bun run ${scriptName}`
  }

  return `npm run ${scriptName}`
}

function isRecursiveFrontronScript(commandText: string, commandName: CommandName) {
  const normalized = commandText.toLowerCase()

  return (
    normalized.includes(`frontron ${commandName}`) ||
    normalized.includes(`run app:${commandName}`) ||
    normalized.includes(` app:${commandName}`)
  )
}

function readScriptCandidates(rootDir: string, commandName: CommandName) {
  const packageJson = readProjectPackageJson(rootDir)
  const scripts = packageJson?.scripts ?? {}

  if (commandName === 'dev') {
    return [
      ['web:dev', scripts['web:dev']],
      ['dev', scripts.dev],
    ] as const
  }

  return [
    ['web:build', scripts['web:build']],
    ['build', scripts.build],
  ] as const
}

function inferScriptCommand(rootDir: string, commandName: CommandName) {
  for (const [scriptName, scriptBody] of readScriptCandidates(rootDir, commandName)) {
    if (!scriptBody || isRecursiveFrontronScript(scriptBody, commandName)) {
      continue
    }

    return {
      command: createRunScriptCommand(rootDir, scriptName),
      scriptName,
      scriptBody,
    }
  }

  return null
}

function parseNumericFlag(commandText: string, flagNames: string[]) {
  for (const flagName of flagNames) {
    const equalsMatch = commandText.match(new RegExp(`${flagName}=([0-9]+)`))

    if (equalsMatch?.[1]) {
      return Number(equalsMatch[1])
    }

    const spacedMatch = commandText.match(new RegExp(`${flagName}\\s+([0-9]+)`))

    if (spacedMatch?.[1]) {
      return Number(spacedMatch[1])
    }
  }

  return undefined
}

function parseStringFlag(commandText: string, flagNames: string[]) {
  for (const flagName of flagNames) {
    const equalsMatch = commandText.match(new RegExp(`${flagName}=([^\\s'"]+)`))

    if (equalsMatch?.[1]) {
      return equalsMatch[1]
    }

    const quotedMatch = commandText.match(new RegExp(`${flagName}\\s+['"]([^'"]+)['"]`))

    if (quotedMatch?.[1]) {
      return quotedMatch[1]
    }

    const spacedMatch = commandText.match(new RegExp(`${flagName}\\s+([^\\s'"]+)`))

    if (spacedMatch?.[1]) {
      return spacedMatch[1]
    }
  }

  return undefined
}

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function parseEnvAssignment(commandText: string, envNames: string[]) {
  for (const envName of envNames) {
    const directMatch = commandText.match(new RegExp(`(?:^|\\s|&&|;)${envName}=([^\\s;&]+)`, 'i'))

    if (directMatch?.[1]) {
      return stripWrappingQuotes(directMatch[1])
    }

    const setMatch = commandText.match(
      new RegExp(`(?:^|\\s|&&|;)set\\s+${envName}=([^\\s;&]+)`, 'i'),
    )

    if (setMatch?.[1]) {
      return stripWrappingQuotes(setMatch[1])
    }

    const powershellMatch = commandText.match(
      new RegExp(`\\$env:${envName}\\s*=\\s*['"]?([^'";\\s]+)`, 'i'),
    )

    if (powershellMatch?.[1]) {
      return stripWrappingQuotes(powershellMatch[1])
    }
  }

  return undefined
}

function readViteConfigSource(rootDir: string) {
  for (const candidate of VITE_CONFIG_FILES) {
    const configPath = join(rootDir, candidate)

    if (existsSync(configPath)) {
      return readFileSync(configPath, 'utf8')
    }
  }

  return null
}

function inferVitePort(rootDir: string, commandText?: string) {
  const commandPort = inferCommandPort(commandText)

  if (commandPort) {
    return commandPort
  }

  const viteConfigSource = readViteConfigSource(rootDir)
  const viteConfigPort = viteConfigSource?.match(/server\s*:\s*{[\s\S]*?\bport\s*:\s*(\d+)/)?.[1]

  if (viteConfigPort) {
    return Number(viteConfigPort)
  }

  return 5173
}

function inferViteOutDir(rootDir: string, commandText?: string) {
  const commandOutDir = commandText
    ? parseStringFlag(commandText, ['--outDir'])
    : undefined

  if (commandOutDir) {
    return commandOutDir
  }

  const viteConfigSource = readViteConfigSource(rootDir)
  const viteOutDir = viteConfigSource?.match(/build\s*:\s*{[\s\S]*?\boutDir\s*:\s*['"]([^'"]+)['"]/)?.[1]

  return viteOutDir ?? 'dist'
}

function hasPackageDependency(rootDir: string, dependencyName: string) {
  const packageJson = readProjectPackageJson(rootDir)

  return Boolean(
    packageJson?.dependencies?.[dependencyName] ?? packageJson?.devDependencies?.[dependencyName],
  )
}

function looksLikeViteProject(rootDir: string, commandText?: string) {
  return Boolean(
    commandText?.includes('vite') ||
      readViteConfigSource(rootDir) ||
      hasPackageDependency(rootDir, 'vite'),
  )
}

function looksLikeReactScriptsProject(commandText?: string) {
  return Boolean(commandText?.includes('react-scripts'))
}

function looksLikeNextProject(rootDir: string, commandText?: string) {
  return Boolean(commandText?.includes('next dev') || hasPackageDependency(rootDir, 'next'))
}

function looksLikeNuxtProject(rootDir: string, commandText?: string) {
  return Boolean(
    commandText?.includes('nuxi dev') ||
      commandText?.includes('nuxt dev') ||
      hasPackageDependency(rootDir, 'nuxt'),
  )
}

function looksLikeAstroProject(rootDir: string, commandText?: string) {
  return Boolean(commandText?.includes('astro dev') || hasPackageDependency(rootDir, 'astro'))
}

function looksLikeAngularProject(rootDir: string, commandText?: string) {
  return Boolean(
    commandText?.includes('ng serve') || hasPackageDependency(rootDir, '@angular/cli'),
  )
}

function looksLikeVueCliProject(rootDir: string, commandText?: string) {
  return Boolean(
    commandText?.includes('vue-cli-service serve') ||
      hasPackageDependency(rootDir, '@vue/cli-service'),
  )
}

function normalizeDevHost(hostValue: string | undefined) {
  if (!hostValue || hostValue === '0.0.0.0' || hostValue === '::' || hostValue === '[::]') {
    return 'localhost'
  }

  return hostValue
}

function inferCommandPort(commandText?: string) {
  if (!commandText) {
    return undefined
  }

  const flagPort = parseNumericFlag(commandText, ['--port', '-p'])

  if (flagPort) {
    return flagPort
  }

  const envPort = Number.parseInt(parseEnvAssignment(commandText, ['PORT']) ?? '', 10)

  return Number.isFinite(envPort) ? envPort : undefined
}

function inferCommandHost(commandText?: string) {
  if (!commandText) {
    return undefined
  }

  return (
    parseStringFlag(commandText, ['--host', '--hostname', '-H']) ??
    parseEnvAssignment(commandText, ['HOST', 'HOSTNAME'])
  )
}

function inferDevUrl(rootDir: string, commandText?: string) {
  const commandPort = inferCommandPort(commandText)
  const commandHost = normalizeDevHost(inferCommandHost(commandText))

  if (commandPort) {
    return {
      url: `http://${commandHost}:${commandPort}`,
      source: 'package-script' as const,
    }
  }

  if (looksLikeViteProject(rootDir, commandText)) {
    return {
      url: `http://${commandHost}:${inferVitePort(rootDir, commandText)}`,
      source: 'vite-default' as const,
    }
  }

  if (looksLikeReactScriptsProject(commandText)) {
    return {
      url: `http://${commandHost}:3000`,
      source: 'react-scripts-default' as const,
    }
  }

  if (looksLikeNextProject(rootDir, commandText) || looksLikeNuxtProject(rootDir, commandText)) {
    return {
      url: `http://${commandHost}:3000`,
      source: 'framework-default' as const,
    }
  }

  if (looksLikeAstroProject(rootDir, commandText)) {
    return {
      url: `http://${commandHost}:4321`,
      source: 'framework-default' as const,
    }
  }

  if (looksLikeAngularProject(rootDir, commandText)) {
    return {
      url: `http://${commandHost}:4200`,
      source: 'framework-default' as const,
    }
  }

  if (looksLikeVueCliProject(rootDir, commandText)) {
    return {
      url: `http://${commandHost}:8080`,
      source: 'framework-default' as const,
    }
  }

  return null
}

function inferBuildOutDir(rootDir: string, commandText?: string) {
  if (looksLikeViteProject(rootDir, commandText)) {
    return {
      outDir: inferViteOutDir(rootDir, commandText),
      source: 'vite-default' as const,
    }
  }

  if (looksLikeReactScriptsProject(commandText)) {
    return {
      outDir: 'build',
      source: 'react-scripts-default' as const,
    }
  }

  return null
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

function initializeProject(rootDir: string, output: CliOutput) {
  const packageJson = readProjectPackageJson(rootDir)

  if (!packageJson) {
    throw new Error('[Frontron] "init" requires a project package.json in the working directory.')
  }

  const nextPackageJson = {
    ...packageJson,
    scripts: {
      ...(packageJson.scripts ?? {}),
    },
  } as typeof packageJson & {
    scripts: Record<string, string>
  }
  const addedScripts: string[] = []

  if (!nextPackageJson.scripts['app:dev']) {
    nextPackageJson.scripts['app:dev'] = 'frontron dev'
    addedScripts.push('app:dev')
  }

  if (!nextPackageJson.scripts['app:build']) {
    nextPackageJson.scripts['app:build'] = 'frontron build'
    addedScripts.push('app:build')
  }

  if (addedScripts.length > 0) {
    writeProjectPackageJson(rootDir, nextPackageJson as Record<string, unknown>)
    output.info(`[Frontron] Added package scripts: ${addedScripts.join(', ')}`)
  } else {
    output.info('[Frontron] Package scripts already include app:dev and app:build.')
  }

  const configPath = join(rootDir, 'frontron.config.ts')

  if (!existsSync(configPath)) {
    writeFileSync(configPath, createInitConfigSource(packageJson.name))
    output.info(`[Frontron] Created config: ${configPath}`)
  } else {
    output.info(`[Frontron] Config already exists: ${configPath}`)
  }

  output.info('[Frontron] Next step: run `npm run app:dev`.')
}

function createRuntimeManifest(
  loadedConfig: Awaited<ReturnType<typeof loadConfig>>,
  mode: RuntimeManifest['mode'],
  configuredCommand?: ConfiguredCommand,
) {
  const projectPackage = readPackageJsonVersion(loadedConfig.rootDir)
  const configFile = relative(loadedConfig.rootDir, loadedConfig.configPath).replace(/\\/g, '/')
  const appIcon = loadedConfig.config.app.icon ?? resolveDefaultAppIconPath()

  return {
    rootDir: loadedConfig.rootDir,
    configFile,
    mode,
    app: {
      name: loadedConfig.config.app.name,
      id: loadedConfig.config.app.id,
      version: projectPackage.version,
      icon: appIcon,
    },
    web: {
      devUrl:
        configuredCommand?.mode === 'dev'
          ? configuredCommand.target
          : loadedConfig.config.web?.dev?.url,
      outDir:
        configuredCommand?.mode === 'build'
          ? configuredCommand.target
          : loadedConfig.config.web?.build?.outDir,
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
  loadedConfig: LoadedConfig,
): ConfiguredCommand {
  const config = loadedConfig.config

  if (command === 'dev') {
    const devConfig = config.web?.dev
    const explicitCommand = devConfig?.command
    const explicitUrl = devConfig?.url
    const inferredCommand = explicitCommand
      ? null
      : inferScriptCommand(loadedConfig.rootDir, 'dev')
    const commandValue = explicitCommand ?? inferredCommand?.command
    const commandSource = explicitCommand ? 'config' : inferredCommand ? 'package-script' : null
    const inferredUrl = explicitUrl
      ? null
      : inferDevUrl(loadedConfig.rootDir, inferredCommand?.scriptBody ?? commandValue)
    const urlValue = explicitUrl ?? inferredUrl?.url
    const targetSource = explicitUrl ? 'config' : inferredUrl?.source ?? null

    if (!commandValue || !commandSource) {
      throw new Error(
        '[Frontron] "dev" requires "web.dev.command" or a runnable package script such as "web:dev" or "dev".',
      )
    }

    if (!urlValue || !targetSource) {
      throw new Error(
        '[Frontron] "dev" requires "web.dev.url" or an inferable frontend dev server such as a standard Vite setup.',
      )
    }

    return {
      mode: 'dev',
      target: urlValue,
      command: commandValue,
      commandSource,
      targetSource,
    }
  }

  const buildConfig = config.web?.build
  const explicitCommand = buildConfig?.command
  const explicitOutDir = buildConfig?.outDir
  const inferredCommand = explicitCommand
    ? null
    : inferScriptCommand(loadedConfig.rootDir, 'build')
  const commandValue = explicitCommand ?? inferredCommand?.command
  const commandSource = explicitCommand ? 'config' : inferredCommand ? 'package-script' : null
  const inferredOutDir = explicitOutDir
    ? null
    : inferBuildOutDir(loadedConfig.rootDir, inferredCommand?.scriptBody ?? commandValue)
  const outDirValue = explicitOutDir ??
    (inferredOutDir ? resolve(loadedConfig.rootDir, inferredOutDir.outDir) : undefined)
  const targetSource = explicitOutDir ? 'config' : inferredOutDir?.source ?? null

  if (!commandValue || !commandSource) {
    throw new Error(
      '[Frontron] "build" requires "web.build.command" or a runnable package script such as "web:build" or "build".',
    )
  }

  if (!outDirValue || !targetSource) {
    throw new Error(
      '[Frontron] "build" requires "web.build.outDir" or an inferable frontend build output such as a standard Vite setup.',
    )
  }

  return {
    mode: 'build',
    target: outDirValue,
    command: commandValue,
    commandSource,
    targetSource,
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

  const configuredCommand = getConfiguredCommand('dev', loadedConfig)
  const manifest = createRuntimeManifest(loadedConfig, 'development', configuredCommand)
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
  const configuredCommand = getConfiguredCommand('build', loadedConfig)
  const manifest = createRuntimeManifest(loadedConfig, 'production', configuredCommand)
  const stageDir = ensureDotFrontronDir(loadedConfig.rootDir, 'runtime', 'build')
  const packagedAppDir = join(stageDir, 'app')
  const webOutDir = configuredCommand.target
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

  const configuredCommand = getConfiguredCommand('build', loadedConfig)
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

    if (command === 'init') {
      if (parsed.check) {
        throw new Error('[Frontron] "--check" is not supported with "init".')
      }

      initializeProject(cwd, output)
      return 0
    }

    const loadedConfig = await loadConfig({
      cwd,
      configFile: parsed.configFile,
    })
    const generatedBridgeTypesPath = writeBridgeTypes(loadedConfig)
    const configuredCommand = getConfiguredCommand(command, loadedConfig)

    output.info(`[Frontron] Loaded config: ${loadedConfig.configPath}`)
    output.info(`[Frontron] Generated bridge types: ${generatedBridgeTypesPath}`)
    output.info(
      `[Frontron] App: ${loadedConfig.config.app.name} (${loadedConfig.config.app.id})`,
    )
    if (!loadedConfig.config.app.icon) {
      output.info('[Frontron] App icon: using the default Frontron icon.')
    }
    if (configuredCommand.commandSource !== 'config') {
      output.info(
        `[Frontron] Inferred web ${configuredCommand.mode} command: ${configuredCommand.command}`,
      )
    }
    if (configuredCommand.targetSource !== 'config') {
      output.info(
        `[Frontron] Inferred web ${configuredCommand.mode} target: ${configuredCommand.target}`,
      )
    }
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
