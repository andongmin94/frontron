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
import type {
  FrontronPublishMode,
  ResolvedFrontronBuildLinuxConfig,
  ResolvedFrontronBuildMacConfig,
  ResolvedFrontronBuildFilePattern,
  ResolvedFrontronBuildNsisConfig,
  ResolvedFrontronBuildWindowsConfig,
} from './types'

type CommandName = 'dev' | 'build'
type CliCommand = CommandName | 'init'

interface ParsedCliArgs {
  command: string | null
  cwd?: string
  configFile?: string
  check: boolean
  help: boolean
  skipInstall: boolean
}

interface CliOutput {
  info(message: string): void
  error(message: string): void
}

type PackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun'

interface InitDependencyRequest {
  rootDir: string
  packageManager: PackageManagerName
  packageName: string
  versionRange: string
  command: string
}

interface CliRuntimeOptions {
  installDependency?(request: InitDependencyRequest): Promise<number> | number
}

interface ProjectPackageJson {
  name?: string
  version?: string
  description?: string
  author?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface ProjectPackageMetadata {
  name: string
  version: string
  description?: string
  author?: unknown
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
const VITEPRESS_CONFIG_FILES = [
  join('docs', '.vitepress', 'config.ts'),
  join('docs', '.vitepress', 'config.mts'),
  join('docs', '.vitepress', 'config.cts'),
  join('docs', '.vitepress', 'config.js'),
  join('docs', '.vitepress', 'config.mjs'),
  join('docs', '.vitepress', 'config.cjs'),
  join('.vitepress', 'config.ts'),
  join('.vitepress', 'config.mts'),
  join('.vitepress', 'config.cts'),
  join('.vitepress', 'config.js'),
  join('.vitepress', 'config.mjs'),
  join('.vitepress', 'config.cjs'),
]
const NEXT_CONFIG_FILES = [
  'next.config.ts',
  'next.config.mts',
  'next.config.cts',
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs',
]
const NUXT_CONFIG_FILES = [
  'nuxt.config.ts',
  'nuxt.config.mts',
  'nuxt.config.cts',
  'nuxt.config.js',
  'nuxt.config.mjs',
  'nuxt.config.cjs',
]
const ASTRO_CONFIG_FILES = [
  'astro.config.ts',
  'astro.config.mts',
  'astro.config.cts',
  'astro.config.js',
  'astro.config.mjs',
  'astro.config.cjs',
]
const VUE_CLI_CONFIG_FILES = [
  'vue.config.ts',
  'vue.config.mts',
  'vue.config.cts',
  'vue.config.js',
  'vue.config.mjs',
  'vue.config.cjs',
]
const ANGULAR_WORKSPACE_FILE = 'angular.json'
const COMMON_SCRIPT_PREFIXES = [
  'web',
  'docs',
  'site',
  'frontend',
  'client',
  'ui',
  'renderer',
] as const
const DEFAULT_BUILD_OUTPUT_DIR = 'output'
const DEFAULT_BUILD_PUBLISH_MODE: FrontronPublishMode = 'never'

function parseArgs(argv: string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = {
    command: null,
    check: false,
    help: false,
    skipInstall: false,
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

    if (value === '--skip-install') {
      parsed.skipInstall = true
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
  output.info(
    'Usage: frontron <init|dev|build> [--cwd <path>] [--config <path>] [--check] [--skip-install]',
  )
  output.info('')
  output.info('Commands:')
  output.info(
    '  init    Add a basic frontron.config.ts and app:dev/app:build scripts, and install frontron if it is missing.',
  )
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

function readProjectPackageMetadata(rootDir: string): ProjectPackageMetadata {
  const packageJsonPath = join(rootDir, 'package.json')

  if (!existsSync(packageJsonPath)) {
    return {
      version: '0.0.0',
      name: 'frontron-app',
    }
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as ProjectPackageJson

    return {
      version: packageJson.version ?? '0.0.0',
      name: packageJson.name ?? 'frontron-app',
      description: typeof packageJson.description === 'string' ? packageJson.description : undefined,
      author: packageJson.author,
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
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as ProjectPackageJson
  } catch {
    return null
  }
}

function readProjectScripts(rootDir: string) {
  return readProjectPackageJson(rootDir)?.scripts ?? {}
}

function readConfigSource(rootDir: string, candidateFiles: readonly string[]) {
  for (const candidate of candidateFiles) {
    const configPath = join(rootDir, candidate)

    if (existsSync(configPath)) {
      return readFileSync(configPath, 'utf8')
    }
  }

  return null
}

function writeProjectPackageJson(
  rootDir: string,
  packageJson: ProjectPackageJson,
) {
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
}

function resolveDefaultAppIconPath() {
  const candidate = resolvePackageFile('../assets/default-icon.ico')
  return existsSync(candidate) ? candidate : undefined
}

function resolveBuildOutputDir(loadedConfig: LoadedConfig) {
  return loadedConfig.config.build?.outputDir ?? join(loadedConfig.rootDir, DEFAULT_BUILD_OUTPUT_DIR)
}

function resolveBuildPublishMode(loadedConfig: LoadedConfig) {
  return loadedConfig.config.build?.publish ?? DEFAULT_BUILD_PUBLISH_MODE
}

function createBuilderFilePattern(pattern: ResolvedFrontronBuildFilePattern) {
  if (typeof pattern === 'string') {
    return pattern
  }

  const fileSet: Record<string, unknown> = {
    from: pattern.from,
  }

  if (pattern.to) {
    fileSet.to = pattern.to
  }

  if (pattern.filter?.length) {
    fileSet.filter = pattern.filter
  }

  return fileSet
}

function createBuilderFiles(
  patterns: readonly ResolvedFrontronBuildFilePattern[] | undefined,
) {
  const files: Array<string | Record<string, unknown>> = ['**/*']

  for (const pattern of patterns ?? []) {
    files.push(createBuilderFilePattern(pattern))
  }

  return files
}

function createBuilderExtraEntries(
  patterns: readonly ResolvedFrontronBuildFilePattern[] | undefined,
) {
  if (!patterns?.length) {
    return undefined
  }

  return patterns.map((pattern) => createBuilderFilePattern(pattern))
}

function createBuilderWindowsConfig(
  windows: ResolvedFrontronBuildWindowsConfig | undefined,
) {
  if (!windows) {
    return undefined
  }

  const builderWindows: Record<string, unknown> = {}

  if (windows.targets?.length) {
    builderWindows.target = windows.targets
  }

  if (windows.icon) {
    builderWindows.icon = windows.icon
  }

  if (windows.publisherName?.length) {
    builderWindows.publisherName = windows.publisherName
  }

  if (typeof windows.signAndEditExecutable !== 'undefined') {
    builderWindows.signAndEditExecutable = windows.signAndEditExecutable
  }

  if (windows.requestedExecutionLevel) {
    builderWindows.requestedExecutionLevel = windows.requestedExecutionLevel
  }

  if (windows.artifactName) {
    builderWindows.artifactName = windows.artifactName
  }

  return Object.keys(builderWindows).length > 0 ? builderWindows : undefined
}

function createBuilderNsisConfig(nsis: ResolvedFrontronBuildNsisConfig | undefined) {
  if (!nsis) {
    return undefined
  }

  const builderNsis: Record<string, unknown> = {}

  if (typeof nsis.oneClick !== 'undefined') {
    builderNsis.oneClick = nsis.oneClick
  }

  if (typeof nsis.perMachine !== 'undefined') {
    builderNsis.perMachine = nsis.perMachine
  }

  if (typeof nsis.allowToChangeInstallationDirectory !== 'undefined') {
    builderNsis.allowToChangeInstallationDirectory = nsis.allowToChangeInstallationDirectory
  }

  if (typeof nsis.deleteAppDataOnUninstall !== 'undefined') {
    builderNsis.deleteAppDataOnUninstall = nsis.deleteAppDataOnUninstall
  }

  if (nsis.installerIcon) {
    builderNsis.installerIcon = nsis.installerIcon
  }

  if (nsis.uninstallerIcon) {
    builderNsis.uninstallerIcon = nsis.uninstallerIcon
  }

  return Object.keys(builderNsis).length > 0 ? builderNsis : undefined
}

function createBuilderMacConfig(mac: ResolvedFrontronBuildMacConfig | undefined) {
  if (!mac) {
    return undefined
  }

  const builderMac: Record<string, unknown> = {}

  if (mac.targets?.length) {
    builderMac.target = mac.targets
  }

  if (mac.icon) {
    builderMac.icon = mac.icon
  }

  if (mac.category) {
    builderMac.category = mac.category
  }

  if (mac.artifactName) {
    builderMac.artifactName = mac.artifactName
  }

  return Object.keys(builderMac).length > 0 ? builderMac : undefined
}

function createBuilderLinuxConfig(linux: ResolvedFrontronBuildLinuxConfig | undefined) {
  if (!linux) {
    return undefined
  }

  const builderLinux: Record<string, unknown> = {}

  if (linux.targets?.length) {
    builderLinux.target = linux.targets
  }

  if (linux.icon) {
    builderLinux.icon = linux.icon
  }

  if (linux.category) {
    builderLinux.category = linux.category
  }

  if (linux.packageCategory) {
    builderLinux.packageCategory = linux.packageCategory
  }

  if (linux.artifactName) {
    builderLinux.artifactName = linux.artifactName
  }

  return Object.keys(builderLinux).length > 0 ? builderLinux : undefined
}

function resolveAppDescription(
  loadedConfig: LoadedConfig,
  projectPackage: ProjectPackageMetadata,
) {
  return loadedConfig.config.app.description ?? projectPackage.description ?? loadedConfig.config.app.name
}

function resolveAppAuthor(
  loadedConfig: LoadedConfig,
  projectPackage: ProjectPackageMetadata,
) {
  return loadedConfig.config.app.author ?? projectPackage.author
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

function detectPackageManager(rootDir: string): PackageManagerName {
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

function detectBootstrapPackageManager(rootDir: string): PackageManagerName {
  if (existsSync(join(rootDir, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }

  if (existsSync(join(rootDir, 'yarn.lock'))) {
    return 'yarn'
  }

  if (existsSync(join(rootDir, 'bun.lock')) || existsSync(join(rootDir, 'bun.lockb'))) {
    return 'bun'
  }

  return detectPackageManager(rootDir)
}

function readDependencyVersion(
  packageJson: ReturnType<typeof readProjectPackageJson>,
  dependencyName: string,
) {
  return packageJson?.dependencies?.[dependencyName] ?? packageJson?.devDependencies?.[dependencyName]
}

function readCurrentPackageVersionRange() {
  const packageJson = JSON.parse(readFileSync(resolvePackageFile('../package.json'), 'utf8')) as {
    version?: string
  }

  return `^${packageJson.version ?? '0.0.0'}`
}

function createPackageManagerAddCommand(
  packageManager: PackageManagerName,
  packageSpec: string,
) {
  if (packageManager === 'npm') {
    return `npm install ${packageSpec}`
  }

  if (packageManager === 'pnpm') {
    return `pnpm add ${packageSpec}`
  }

  if (packageManager === 'yarn') {
    return `yarn add ${packageSpec}`
  }

  return `bun add ${packageSpec}`
}

function createInitDependencyRequest(rootDir: string): InitDependencyRequest {
  const packageName = 'frontron'
  const packageManager = detectBootstrapPackageManager(rootDir)
  const versionRange = readCurrentPackageVersionRange()
  const command = createPackageManagerAddCommand(
    packageManager,
    `${packageName}@${versionRange}`,
  )

  return {
    rootDir,
    packageManager,
    packageName,
    versionRange,
    command,
  }
}

function createRunScriptCommand(rootDir: string, scriptName: string) {
  return createRunScriptCommandForPackageManager(detectPackageManager(rootDir), scriptName)
}

function createRunScriptCommandForPackageManager(
  packageManager: PackageManagerName,
  scriptName: string,
) {
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

function isNuxtStaticGenerateCommand(commandText: string | undefined) {
  if (!commandText) {
    return false
  }

  return (
    /\b(?:nuxi|nuxt)\s+generate\b/.test(commandText) ||
    (/\b(?:nuxi|nuxt)\s+build\b/.test(commandText) &&
      /\s--prerender(?:\s|$|=)/.test(commandText))
  )
}

function readScriptCandidates(
  rootDir: string,
  commandName: CommandName,
): Array<[string, string | undefined]> {
  const scripts = readProjectScripts(rootDir)
  const candidateScripts: Array<[string, string | undefined]> = []

  if (commandName === 'build' && looksLikeNuxtProject(rootDir)) {
    for (const prefix of COMMON_SCRIPT_PREFIXES) {
      const scriptName = `${prefix}:generate`
      const scriptBody = scripts[scriptName]
      candidateScripts.push([
        scriptName,
        isNuxtStaticGenerateCommand(scriptBody) ? scriptBody : undefined,
      ])
    }

    candidateScripts.push([
      'generate',
      isNuxtStaticGenerateCommand(scripts.generate) ? scripts.generate : undefined,
    ])
  }

  for (const prefix of COMMON_SCRIPT_PREFIXES) {
    const scriptName = `${prefix}:${commandName}`
    candidateScripts.push([scriptName, scripts[scriptName]])
  }

  if (commandName === 'dev') {
    candidateScripts.push(['dev', scripts.dev])
    return candidateScripts
  }

  candidateScripts.push(['build', scripts.build])
  return candidateScripts
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
  return readConfigSource(rootDir, VITE_CONFIG_FILES)
}

function readVitePressConfigSource(rootDir: string) {
  return readConfigSource(rootDir, VITEPRESS_CONFIG_FILES)
}

function readNextConfigSource(rootDir: string) {
  return readConfigSource(rootDir, NEXT_CONFIG_FILES)
}

function readNuxtConfigSource(rootDir: string) {
  return readConfigSource(rootDir, NUXT_CONFIG_FILES)
}

function readAstroConfigSource(rootDir: string) {
  return readConfigSource(rootDir, ASTRO_CONFIG_FILES)
}

function readVueCliConfigSource(rootDir: string) {
  return readConfigSource(rootDir, VUE_CLI_CONFIG_FILES)
}

function tokenizeCommand(commandText: string) {
  const matches = commandText.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return matches.map(stripWrappingQuotes)
}

function readFirstCommandPositionalArg(commandText: string, commandNames: string[]) {
  const tokens = tokenizeCommand(commandText)
  const commandIndex = tokens.findIndex((token) => commandNames.includes(token))

  if (commandIndex < 0) {
    return undefined
  }

  for (let index = commandIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (!token) {
      continue
    }

    if (token.startsWith('-')) {
      if (!token.includes('=')) {
        index += 1
      }
      continue
    }

    return token
  }

  return undefined
}

function commandIncludesToken(commandText: string | undefined, token: string) {
  if (!commandText) {
    return false
  }

  return tokenizeCommand(commandText).includes(token)
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

function looksLikeVitePressProject(rootDir: string, commandText?: string) {
  return Boolean(
    commandIncludesToken(commandText, 'vitepress') ||
      readVitePressConfigSource(rootDir) ||
      hasPackageDependency(rootDir, 'vitepress'),
  )
}

function inferVitePressContentDir(rootDir: string, commandText?: string) {
  const contentDir = commandText
    ? readFirstCommandPositionalArg(commandText, ['dev', 'build', 'preview'])
    : undefined

  if (contentDir) {
    return contentDir
  }

  if (existsSync(join(rootDir, '.vitepress'))) {
    return '.'
  }

  return 'docs'
}

function hasPackageDependency(rootDir: string, dependencyName: string) {
  const packageJson = readProjectPackageJson(rootDir)

  return Boolean(
    packageJson?.dependencies?.[dependencyName] ?? packageJson?.devDependencies?.[dependencyName],
  )
}

function readAngularWorkspace(rootDir: string) {
  const workspacePath = join(rootDir, ANGULAR_WORKSPACE_FILE)

  if (!existsSync(workspacePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(workspacePath, 'utf8')) as {
      defaultProject?: string
      projects?: Record<
        string,
        {
          architect?: {
            build?: {
              builder?: string
              options?: {
                outputPath?: string | { base?: string; browser?: string }
              }
            }
          }
          targets?: {
            build?: {
              builder?: string
              options?: {
                outputPath?: string | { base?: string; browser?: string }
              }
            }
          }
        }
      >
    }
  } catch {
    return null
  }
}

function looksLikeViteProject(rootDir: string, commandText?: string) {
  if (looksLikeVitePressProject(rootDir, commandText)) {
    return false
  }

  return Boolean(
    commandIncludesToken(commandText, 'vite') ||
      readViteConfigSource(rootDir) ||
      hasPackageDependency(rootDir, 'vite'),
  )
}

function looksLikeReactScriptsProject(commandText?: string) {
  return Boolean(commandText?.includes('react-scripts'))
}

function looksLikeNextProject(rootDir: string, commandText?: string) {
  return Boolean(
    commandText?.includes('next dev') ||
      readNextConfigSource(rootDir) ||
      hasPackageDependency(rootDir, 'next'),
  )
}

function looksLikeNuxtProject(rootDir: string, commandText?: string) {
  return Boolean(
    commandText?.includes('nuxi dev') ||
      commandText?.includes('nuxt dev') ||
      readNuxtConfigSource(rootDir) ||
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

function inferNextStaticOutDir(rootDir: string, commandText?: string) {
  const exportOutDir = commandText
    ? parseStringFlag(commandText, ['--outdir', '-o'])
    : undefined

  if (commandText?.includes('next export')) {
    return exportOutDir ?? 'out'
  }

  const nextConfigSource = readNextConfigSource(rootDir)

  if (nextConfigSource?.match(/\boutput\s*:\s*['"]export['"]/)) {
    return 'out'
  }

  return null
}

function inferNuxtStaticOutDir(commandText?: string) {
  if (isNuxtStaticGenerateCommand(commandText)) {
    return '.output/public'
  }

  return null
}

function inferAstroOutDir(rootDir: string, commandText?: string) {
  const commandOutDir = commandText
    ? parseStringFlag(commandText, ['--outDir'])
    : undefined

  if (commandOutDir) {
    return commandOutDir
  }

  const astroConfigSource = readAstroConfigSource(rootDir)
  const astroOutDir =
    astroConfigSource?.match(/\boutDir\s*:\s*['"]([^'"]+)['"]/)?.[1]

  return astroOutDir ?? 'dist'
}

function inferVueCliOutDir(rootDir: string) {
  const vueCliConfigSource = readVueCliConfigSource(rootDir)
  const vueCliOutDir =
    vueCliConfigSource?.match(/\boutputDir\s*:\s*['"]([^'"]+)['"]/)?.[1]

  return vueCliOutDir ?? 'dist'
}

function resolveAngularOutputPath(
  outputPath: string | { base?: string; browser?: string } | undefined,
) {
  if (!outputPath) {
    return null
  }

  if (typeof outputPath === 'string') {
    return outputPath
  }

  if (outputPath.base && outputPath.browser) {
    return join(outputPath.base, outputPath.browser)
  }

  return outputPath.base ?? outputPath.browser ?? null
}

function inferAngularOutDir(rootDir: string, commandText?: string) {
  const angularWorkspace = readAngularWorkspace(rootDir)

  if (!angularWorkspace?.projects) {
    return 'dist'
  }

  const requestedProject = commandText
    ? readFirstCommandPositionalArg(commandText, ['build'])
    : undefined
  const projectName =
    requestedProject ?? angularWorkspace.defaultProject ?? Object.keys(angularWorkspace.projects)[0]

  if (!projectName) {
    return 'dist'
  }

  const project = angularWorkspace.projects[projectName]
  const buildTarget = project?.architect?.build ?? project?.targets?.build
  const outputPath = buildTarget?.options?.outputPath
  const builder = buildTarget?.builder
  const resolvedOutputPath = resolveAngularOutputPath(outputPath)

  if (resolvedOutputPath) {
    if (builder?.endsWith(':application') && !resolvedOutputPath.replace(/\\/g, '/').endsWith('/browser')) {
      return join(resolvedOutputPath, 'browser')
    }

    return resolvedOutputPath
  }

  if (builder?.endsWith(':application')) {
    return join('dist', projectName, 'browser')
  }

  return join('dist', projectName)
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

  if (looksLikeVitePressProject(rootDir, commandText)) {
    return {
      url: `http://${commandHost}:5173`,
      source: 'framework-default' as const,
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
  if (looksLikeVitePressProject(rootDir, commandText)) {
    return {
      outDir: join(inferVitePressContentDir(rootDir, commandText), '.vitepress', 'dist'),
      source: 'framework-default' as const,
    }
  }

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

  if (looksLikeNextProject(rootDir, commandText)) {
    const nextOutDir = inferNextStaticOutDir(rootDir, commandText)

    if (nextOutDir) {
      return {
        outDir: nextOutDir,
        source: 'framework-default' as const,
      }
    }
  }

  if (looksLikeNuxtProject(rootDir, commandText)) {
    const nuxtOutDir = inferNuxtStaticOutDir(commandText)

    if (nuxtOutDir) {
      return {
        outDir: nuxtOutDir,
        source: 'framework-default' as const,
      }
    }
  }

  if (looksLikeAstroProject(rootDir, commandText)) {
    return {
      outDir: inferAstroOutDir(rootDir, commandText),
      source: 'framework-default' as const,
    }
  }

  if (looksLikeAngularProject(rootDir, commandText)) {
    return {
      outDir: inferAngularOutDir(rootDir, commandText),
      source: 'framework-default' as const,
    }
  }

  if (looksLikeVueCliProject(rootDir, commandText)) {
    return {
      outDir: inferVueCliOutDir(rootDir),
      source: 'framework-default' as const,
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

async function defaultInstallDependency(request: InitDependencyRequest) {
  return await runShellCommand(request.command, request.rootDir)
}

async function initializeProject(
  rootDir: string,
  output: CliOutput,
  runtimeOptions: CliRuntimeOptions,
  skipInstall: boolean,
) {
  const packageJson = readProjectPackageJson(rootDir)

  if (!packageJson) {
    throw new Error('[Frontron] "init" requires a project package.json in the working directory.')
  }

  const existingDependencyVersion = readDependencyVersion(packageJson, 'frontron')

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
    writeProjectPackageJson(rootDir, nextPackageJson)
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

  const appDevCommand = createRunScriptCommandForPackageManager(
    detectBootstrapPackageManager(rootDir),
    'app:dev',
  )

  if (existingDependencyVersion) {
    output.info(`[Frontron] Package already depends on frontron (${existingDependencyVersion}).`)
    output.info(`[Frontron] Next step: run \`${appDevCommand}\`.`)
    return
  }

  if (skipInstall) {
    const installHint = createPackageManagerAddCommand(
      detectBootstrapPackageManager(rootDir),
      'frontron',
    )
    output.info('[Frontron] Skipped automatic frontron install (--skip-install).')
    output.info(`[Frontron] Next step: run \`${installHint}\`, then \`${appDevCommand}\`.`)
    return
  }

  const installRequest = createInitDependencyRequest(rootDir)
  output.info(`[Frontron] Installing frontron: ${installRequest.command}`)

  const installExitCode = await (runtimeOptions.installDependency ?? defaultInstallDependency)(
    installRequest,
  )

  if (installExitCode !== 0) {
    throw new Error(
      '[Frontron] Failed to install frontron automatically. Re-run with "--skip-install" to scaffold without installing.',
    )
  }

  output.info(`[Frontron] Installed dependency: frontron@${installRequest.versionRange}`)
  output.info(`[Frontron] Next step: run \`${appDevCommand}\`.`)
}

function createRuntimeManifest(
  loadedConfig: Awaited<ReturnType<typeof loadConfig>>,
  mode: RuntimeManifest['mode'],
  configuredCommand?: ConfiguredCommand,
) {
  const projectPackage = readProjectPackageMetadata(loadedConfig.rootDir)
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

function stageDevRuntimeApp(runtimeDir: string) {
  const runtimeMainEntry = resolveRuntimeEntry('main')
  const runtimePreloadEntry = resolveRuntimeEntry('preload')
  const runtimeSharedDir = resolveRuntimeSharedDir()

  stageRuntimeEntryFile(runtimeMainEntry, join(runtimeDir, 'main.mjs'), runtimeSharedDir)
  stageRuntimeEntryFile(runtimePreloadEntry, join(runtimeDir, 'preload.mjs'), runtimeSharedDir)

  writeFileSync(
    join(runtimeDir, 'package.json'),
    JSON.stringify(
      {
        name: 'frontron-dev-runtime',
        private: true,
        type: 'module',
        main: 'main.mjs',
      },
      null,
      2,
    ),
  )

  return runtimeDir
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

function createElectronChildEnv(extraEnv: NodeJS.ProcessEnv = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
  }

  delete env.ELECTRON_RUN_AS_NODE

  return env
}

function spawnElectronRuntime(
  electronBinary: string,
  appDir: string,
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  const env = createElectronChildEnv(extraEnv)

  return spawnCommand(electronBinary, [appDir], {
    cwd,
    env,
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
      '[Frontron] "build" requires "web.build.outDir" or an inferable frontend build output such as a standard Vite build, a Next.js static export, or a Nuxt generate setup.',
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
  const runtimeDir = ensureDotFrontronDir(loadedConfig.rootDir, 'runtime', 'dev-app')
  const manifestPath = writeRuntimeManifest(loadedConfig.rootDir, manifest, runtimeDir)
  const electronBinary = resolveElectronBinary()
  const stagedRuntimeAppDir = stageDevRuntimeApp(runtimeDir)

  output.info(`[Frontron] Launching web dev command: ${configuredCommand.command}`)
  output.info(`[Frontron] Launching framework runtime: ${stagedRuntimeAppDir}`)

  const webChild = spawnCommand(configuredCommand.command, [], {
    cwd: loadedConfig.rootDir,
    shell: true,
  })

  const electronChild = spawnElectronRuntime(
    electronBinary,
    stagedRuntimeAppDir,
    loadedConfig.rootDir,
    {
      FRONTRON_MANIFEST_PATH: manifestPath,
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
  const buildConfig = loadedConfig.config.build
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

  const projectPackage = readProjectPackageMetadata(loadedConfig.rootDir)
  const appDescription = resolveAppDescription(loadedConfig, projectPackage)
  const appAuthor = resolveAppAuthor(loadedConfig, projectPackage)
  const outputDir = resolveBuildOutputDir(loadedConfig)
  const publishMode = resolveBuildPublishMode(loadedConfig)
  const frontronPackage = JSON.parse(
    readFileSync(resolvePackageFile('../package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>
  }
  const electronVersion =
    frontronPackage.dependencies?.electron && !frontronPackage.dependencies.electron.startsWith('^')
      ? frontronPackage.dependencies.electron
      : resolveInstalledPackageVersion('electron')

  const stagedPackageJson: Record<string, unknown> = {
    name: sanitizePackageName(projectPackage.name),
    version: projectPackage.version,
    type: 'module',
    main: 'main.mjs',
    description: appDescription,
    devDependencies: {
      electron: electronVersion,
    },
  }

  if (typeof appAuthor !== 'undefined') {
    stagedPackageJson.author = appAuthor
  }

  if (loadedConfig.config.app.copyright) {
    stagedPackageJson.copyright = loadedConfig.config.app.copyright
  }

  writeFileSync(
    join(packagedAppDir, 'package.json'),
    JSON.stringify(
      stagedPackageJson,
      null,
      2,
    ),
  )

  const builderConfigPath = join(stageDir, 'builder.json')
  const builderConfig: Record<string, unknown> = {
    appId: loadedConfig.config.app.id,
    productName: loadedConfig.config.app.name,
    directories: {
      output: outputDir,
    },
    files: createBuilderFiles(buildConfig?.files),
    asar: buildConfig?.asar,
    compression: buildConfig?.compression,
    extraResources: createBuilderExtraEntries(buildConfig?.extraResources),
    extraFiles: createBuilderExtraEntries(buildConfig?.extraFiles),
    icon: stagedIconName ? join(packagedAppDir, stagedIconName) : undefined,
    artifactName: buildConfig?.artifactName,
    electronVersion,
    npmRebuild: false,
    nodeGypRebuild: false,
    publish: null,
    copyright: loadedConfig.config.app.copyright,
  }

  const builderWindowsConfig = createBuilderWindowsConfig(buildConfig?.windows)

  if (builderWindowsConfig) {
    builderConfig.win = builderWindowsConfig
  }

  const builderNsisConfig = createBuilderNsisConfig(buildConfig?.nsis)

  if (builderNsisConfig) {
    builderConfig.nsis = builderNsisConfig
  }

  const builderMacConfig = createBuilderMacConfig(buildConfig?.mac)

  if (builderMacConfig) {
    builderConfig.mac = builderMacConfig
  }

  const builderLinuxConfig = createBuilderLinuxConfig(buildConfig?.linux)

  if (builderLinuxConfig) {
    builderConfig.linux = builderLinuxConfig
  }

  writeFileSync(
    builderConfigPath,
    JSON.stringify(
      builderConfig,
      null,
      2,
    ),
  )

  return {
    stageDir,
    packagedAppDir,
    builderConfigPath,
    outputDir,
    publishMode,
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
      stagedBuild.publishMode,
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
        outputDir: stagedBuild.outputDir,
      },
      output as HookOutput,
    )
  }

  return builderExitCode
}

export async function runCli(
  argv = process.argv.slice(2),
  output: CliOutput = defaultOutput,
  runtimeOptions: CliRuntimeOptions = {},
) {
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

      await initializeProject(cwd, output, runtimeOptions, parsed.skipInstall)
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

    if (command === 'build') {
      output.info(`[Frontron] Package output dir: ${resolveBuildOutputDir(loadedConfig)}`)

      if (loadedConfig.config.build?.artifactName) {
        output.info(`[Frontron] Package artifact pattern: ${loadedConfig.config.build.artifactName}`)
      }

      if (loadedConfig.config.build?.windows?.targets) {
        output.info(
          `[Frontron] Windows package targets: ${loadedConfig.config.build.windows.targets.join(', ')}`,
        )
      }

      if (typeof loadedConfig.config.build?.asar !== 'undefined') {
        output.info(`[Frontron] Package asar: ${loadedConfig.config.build.asar ? 'enabled' : 'disabled'}`)
      }

      if (loadedConfig.config.build?.compression) {
        output.info(`[Frontron] Package compression: ${loadedConfig.config.build.compression}`)
      }

      if (loadedConfig.config.build?.files) {
        output.info(
          `[Frontron] Package file patterns: ${loadedConfig.config.build.files.length}`,
        )
      }

      if (loadedConfig.config.build?.extraResources) {
        output.info(
          `[Frontron] Package extra resources: ${loadedConfig.config.build.extraResources.length}`,
        )
      }

      if (loadedConfig.config.build?.extraFiles) {
        output.info(
          `[Frontron] Package extra files: ${loadedConfig.config.build.extraFiles.length}`,
        )
      }

      if (loadedConfig.config.build?.windows?.artifactName) {
        output.info(
          `[Frontron] Windows artifact pattern: ${loadedConfig.config.build.windows.artifactName}`,
        )
      }

      if (loadedConfig.config.build?.windows?.requestedExecutionLevel) {
        output.info(
          `[Frontron] Windows execution level: ${loadedConfig.config.build.windows.requestedExecutionLevel}`,
        )
      }

      if (loadedConfig.config.build?.mac?.targets) {
        output.info(
          `[Frontron] macOS package targets: ${loadedConfig.config.build.mac.targets.join(', ')}`,
        )
      }

      if (loadedConfig.config.build?.mac?.artifactName) {
        output.info(
          `[Frontron] macOS artifact pattern: ${loadedConfig.config.build.mac.artifactName}`,
        )
      }

      if (loadedConfig.config.build?.mac?.category) {
        output.info(`[Frontron] macOS category: ${loadedConfig.config.build.mac.category}`)
      }

      if (loadedConfig.config.build?.linux?.targets) {
        output.info(
          `[Frontron] Linux package targets: ${loadedConfig.config.build.linux.targets.join(', ')}`,
        )
      }

      if (loadedConfig.config.build?.linux?.artifactName) {
        output.info(
          `[Frontron] Linux artifact pattern: ${loadedConfig.config.build.linux.artifactName}`,
        )
      }

      if (loadedConfig.config.build?.linux?.category) {
        output.info(`[Frontron] Linux category: ${loadedConfig.config.build.linux.category}`)
      }

      if (loadedConfig.config.build?.linux?.packageCategory) {
        output.info(
          `[Frontron] Linux package category: ${loadedConfig.config.build.linux.packageCategory}`,
        )
      }
    }

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
