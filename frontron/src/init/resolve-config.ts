import { resolve } from 'node:path'

import { isInsideDirectory, normalizeProjectRelativePath } from '../project-paths'
import { resolveInitAdapterSelection, type InitAdapterSelection } from './adapters'
import { inferOutDir, inferOutDirFromScript } from './detect'
import { createScriptFallbackWarnings } from './plan'
import { askText, chooseDesktopScriptName } from './prompts'
import type { CreateFrontronTemplateSnapshot } from './runtime/create-frontron-template'
import {
  type AdapterDefaults,
  type InitAdapter,
  type InitConfig,
  type InitOptions,
  type InitPrompter,
  type PackageJson,
  createDefaultAppId,
  inferPackageManager,
  normalizeValue,
  titleCase,
} from './shared'

type ConfigResolutionContext = {
  cwd: string
  packageJson: PackageJson
  options: InitOptions
  prompter: InitPrompter | null
  promptEnabled: boolean
  allowedExistingScriptNames: Set<string>
}

type WebScriptSelection = {
  webDevScript: string
  webBuildScript: string
  webBuildCommand: string
}

type DesktopScriptSelection = {
  appScript: string
  buildScript: string
  warnings: string[]
}

type NodeServerPaths = {
  nodeServerSourceRoot: string | null
  nodeServerSourceEntry: string | null
  nodeServerEntry: string | null
}

export type ResolvedInitConfig = {
  config: InitConfig
  successWarnings: string[]
  packageMetadataBlockers: string[]
}

export type ResolveInitConfigInput = ConfigResolutionContext & {
  template: CreateFrontronTemplateSnapshot
}

function readObjectOrFallback<T extends object>(value: unknown, fallback: T) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : fallback
}

async function resolveWebScripts(
  context: ConfigResolutionContext,
  adapter: InitAdapter,
  defaults: AdapterDefaults,
): Promise<WebScriptSelection> {
  const inferredWebDevScript = context.options.webDevScript ?? defaults.webDevScript
  const inferredWebBuildScript = context.options.webBuildScript ?? defaults.webBuildScript
  const webDevScript = normalizeValue(
    await askText(
      context.prompter,
      context.promptEnabled,
      'Web dev script name',
      inferredWebDevScript,
    ),
    inferredWebDevScript,
  )
  const webBuildScript = normalizeValue(
    await askText(
      context.prompter,
      context.promptEnabled,
      'Web build script name',
      inferredWebBuildScript,
    ),
    inferredWebBuildScript,
  )

  if (!context.packageJson.scripts?.[webDevScript]) {
    throw new Error(`Selected web dev script "${webDevScript}" was not found in package.json.`)
  }

  if (!context.packageJson.scripts?.[webBuildScript]) {
    throw new Error(`Selected web build script "${webBuildScript}" was not found in package.json.`)
  }

  return {
    webDevScript,
    webBuildScript,
    webBuildCommand: adapter.resolveBuildCommand(context.packageJson, webBuildScript),
  }
}

async function resolveDesktopDirectory(context: ConfigResolutionContext) {
  const defaultValue = context.options.desktopDir ?? 'electron'

  return normalizeProjectRelativePath(
    context.cwd,
    await askText(
      context.prompter,
      context.promptEnabled,
      'Electron source directory',
      defaultValue,
    ),
    defaultValue,
    'Electron source directory',
  )
}

async function resolveDesktopScripts(
  context: ConfigResolutionContext,
): Promise<DesktopScriptSelection> {
  const takenNames = new Set<string>()
  const appScript = await chooseDesktopScriptName(
    context.prompter,
    context.promptEnabled,
    context.packageJson,
    'Desktop dev script name',
    context.options.appScript ?? 'frontron:dev',
    takenNames,
    'frontron:dev:electron',
    Boolean(context.options.appScript),
    context.allowedExistingScriptNames,
  )
  takenNames.add(appScript)
  const buildScript = await chooseDesktopScriptName(
    context.prompter,
    context.promptEnabled,
    context.packageJson,
    'Desktop build and package script name',
    context.options.buildScript ?? 'frontron:build',
    takenNames,
    'frontron:build:electron',
    Boolean(context.options.buildScript),
    context.allowedExistingScriptNames,
  )

  return {
    appScript,
    buildScript,
    warnings: createScriptFallbackWarnings(context.packageJson, context.options, {
      appScript,
      buildScript,
    }),
  }
}

async function resolveFrontendOutDir(
  context: ConfigResolutionContext,
  defaults: AdapterDefaults,
  webBuildScript: string,
) {
  const inferredOutDir =
    context.options.outDir ??
    defaults.outDir ??
    inferOutDirFromScript(context.packageJson, webBuildScript) ??
    inferOutDir(context.cwd)

  if (!inferredOutDir && context.options.yes) {
    throw new Error(
      `Unable to infer the frontend build output for "${webBuildScript}". Pass --out-dir or run without --yes.`,
    )
  }

  const defaultValue = inferredOutDir ?? 'dist'

  return normalizeProjectRelativePath(
    context.cwd,
    await askText(
      context.prompter,
      context.promptEnabled,
      'Frontend build output directory',
      defaultValue,
    ),
    defaultValue,
    'Frontend build output directory',
  )
}

function assertNodeServerDefaults(
  context: ConfigResolutionContext,
  selection: InitAdapterSelection,
  sourceRoot: string,
  entry: string,
) {
  if (!context.options.yes) return

  if (!sourceRoot) {
    throw new Error(
      `Unable to infer the node server runtime root for adapter "${selection.adapter.id}". Pass --server-root or run without --yes.`,
    )
  }

  if (!entry) {
    throw new Error(
      `Unable to infer the node server entry for adapter "${selection.adapter.id}". Pass --server-entry or run without --yes.`,
    )
  }
}

async function resolveNodeServerEntry(
  context: ConfigResolutionContext,
  selection: InitAdapterSelection,
  inferredEntry: string,
) {
  const inputValue =
    selection.adapter.id === 'remix-node-server'
      ? inferredEntry || 'server.cjs'
      : await askText(
          context.prompter,
          context.promptEnabled,
          'Node server entry',
          inferredEntry || 'server/index.mjs',
        )

  return normalizeProjectRelativePath(
    context.cwd,
    inputValue,
    inferredEntry || 'server/index.mjs',
    'Node server entry',
  )
}

function assertRuntimePathsDoNotOverlap(cwd: string, outDir: string, sourceRoot: string) {
  const absoluteOutDir = resolve(cwd, outDir)
  const absoluteSourceRoot = resolve(cwd, sourceRoot)

  if (
    isInsideDirectory(absoluteOutDir, absoluteSourceRoot) ||
    isInsideDirectory(absoluteSourceRoot, absoluteOutDir)
  ) {
    throw new Error(
      `Frontend build output directory and node server runtime root must be separate, non-overlapping directories: outDir="${outDir}", serverRoot="${sourceRoot}".`,
    )
  }
}

async function resolveNodeServerPaths(
  context: ConfigResolutionContext,
  selection: InitAdapterSelection,
  defaults: AdapterDefaults,
  outDir: string,
): Promise<NodeServerPaths> {
  if (selection.adapter.runtimeStrategy !== 'node-server') {
    return {
      nodeServerSourceRoot: null,
      nodeServerSourceEntry: null,
      nodeServerEntry: null,
    }
  }

  const usesRemixRuntime = selection.adapter.id === 'remix-node-server'
  const inferredSourceRoot = context.options.serverRoot ?? defaults.nodeServerSourceRoot ?? ''
  const inferredEntry = usesRemixRuntime
    ? (defaults.nodeServerEntry ?? 'server.cjs')
    : (context.options.serverEntry ?? defaults.nodeServerEntry ?? '')
  assertNodeServerDefaults(context, selection, inferredSourceRoot, inferredEntry)

  const nodeServerSourceRoot = normalizeProjectRelativePath(
    context.cwd,
    await askText(
      context.prompter,
      context.promptEnabled,
      'Node server runtime root',
      inferredSourceRoot || '.output',
    ),
    inferredSourceRoot || '.output',
    'Node server runtime root',
  )
  const nodeServerEntry = await resolveNodeServerEntry(context, selection, inferredEntry)
  const nodeServerSourceEntry =
    usesRemixRuntime && context.options.serverEntry
      ? normalizeProjectRelativePath(
          context.cwd,
          context.options.serverEntry,
          context.options.serverEntry,
          'Node server source entry',
        )
      : null
  assertRuntimePathsDoNotOverlap(context.cwd, outDir, nodeServerSourceRoot)

  return { nodeServerSourceRoot, nodeServerSourceEntry, nodeServerEntry }
}

async function resolveProductIdentity(context: ConfigResolutionContext) {
  const packageName = context.packageJson.name ?? 'desktop-app'
  const defaultProductName = context.options.productName ?? titleCase(packageName)
  const defaultAppId = context.options.appId ?? createDefaultAppId(packageName)
  const productName = normalizeValue(
    await askText(context.prompter, context.promptEnabled, 'Product name', defaultProductName),
    defaultProductName,
  )
  const appId = normalizeValue(
    await askText(context.prompter, context.promptEnabled, 'App ID', defaultAppId),
    defaultAppId,
  )

  return { productName, appId }
}

function inspectPackageMetadata(packageJson: PackageJson, force: boolean) {
  const existingBuild = readObjectOrFallback<NonNullable<PackageJson['build']>>(
    packageJson.build,
    {},
  )
  const extraMetadata = readObjectOrFallback<Record<string, unknown>>(
    existingBuild.extraMetadata,
    {},
  )
  const currentMain = extraMetadata.main
  const allowExtraMetadataMainOverride =
    typeof currentMain === 'undefined' || currentMain === 'dist-electron/main.js' || force
  const blockers: string[] = []

  if (typeof currentMain !== 'undefined' && typeof currentMain !== 'string') {
    blockers.push(
      'Existing build.extraMetadata.main must be a string to preserve existing packaging rules.',
    )
  }

  if (!allowExtraMetadataMainOverride && typeof currentMain === 'string') {
    blockers.push(`Existing build.extraMetadata.main will not be overwritten: ${currentMain}`)
  }

  return { allowExtraMetadataMainOverride, blockers }
}

export async function resolveInitConfig(
  input: ResolveInitConfigInput,
): Promise<ResolvedInitConfig> {
  const selection = resolveInitAdapterSelection(input.cwd, input.packageJson, input.options.adapter)

  const defaults = selection.adapter.inferDefaults(input.cwd, input.packageJson)
  const webScripts = await resolveWebScripts(input, selection.adapter, defaults)
  const desktopDir = await resolveDesktopDirectory(input)
  const desktopScripts = await resolveDesktopScripts(input)
  const outDir = await resolveFrontendOutDir(input, defaults, webScripts.webBuildScript)
  const nodeServer = await resolveNodeServerPaths(input, selection, defaults, outDir)
  const product = await resolveProductIdentity(input)
  const metadata = inspectPackageMetadata(input.packageJson, input.options.force)

  return {
    config: {
      cwd: input.cwd,
      packageJson: input.packageJson,
      packageManager: inferPackageManager(input.cwd, input.packageJson),
      adapter: selection.adapter.id,
      adapterConfidence: selection.confidence,
      adapterReasons: selection.reasons,
      runtimeStrategy: selection.adapter.runtimeStrategy,
      desktopDir,
      appScript: desktopScripts.appScript,
      buildScript: desktopScripts.buildScript,
      webDevScript: webScripts.webDevScript,
      webBuildScript: webScripts.webBuildScript,
      webBuildCommand: webScripts.webBuildCommand,
      outDir,
      nodeServerSourceRoot: nodeServer.nodeServerSourceRoot,
      nodeServerSourceEntry: nodeServer.nodeServerSourceEntry,
      nodeServerEntry: nodeServer.nodeServerEntry,
      nodeServerCopyTargets: defaults.nodeServerCopyTargets ?? [],
      productName: product.productName,
      appId: product.appId,
      templateInfo: input.template.info,
      templateDependencies: input.template.dependencies,
      allowExtraMetadataMainOverride: metadata.allowExtraMetadataMainOverride,
    },
    successWarnings: [...desktopScripts.warnings, ...selection.warnings],
    packageMetadataBlockers: metadata.blockers,
  }
}
