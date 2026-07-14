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
  packageScript: string
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

// 알 수 없는 JSON 값을 설정 객체로 읽고, 객체가 아니면 안전한 기본값을 사용한다.
function readObjectOrFallback<T extends object>(value: unknown, fallback: T) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : fallback
}

// 개발·빌드 스크립트를 질문 또는 어댑터 기본값에서 정하고 실제 존재 여부를 확인한다.
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

// Electron 소스 디렉터리를 프로젝트 내부의 정규화된 상대 경로로 결정한다.
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

// 세 Electron 명령의 이름을 순서대로 정하고 서로 겹치지 않게 예약한다.
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
    'Desktop build script name',
    context.options.buildScript ?? 'frontron:build',
    takenNames,
    'frontron:build:electron',
    Boolean(context.options.buildScript),
    context.allowedExistingScriptNames,
  )
  takenNames.add(buildScript)
  const packageScript = await chooseDesktopScriptName(
    context.prompter,
    context.promptEnabled,
    context.packageJson,
    'Desktop package script name',
    context.options.packageScript ?? 'frontron:package',
    takenNames,
    'frontron:package:electron',
    Boolean(context.options.packageScript),
    context.allowedExistingScriptNames,
  )

  return {
    appScript,
    buildScript,
    packageScript,
    warnings: createScriptFallbackWarnings(context.packageJson, context.options, {
      appScript,
      buildScript,
      packageScript,
    }),
  }
}

// 명시 옵션, 어댑터 기본값, 빌드 명령, 프레임워크 추론 순으로 출력 디렉터리를 정한다.
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

// 자동 실행에서는 Node 서버의 원본 루트와 entry를 추론하지 못하면 즉시 중단한다.
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

// Remix는 고정 staging entry를 쓰고, 다른 Node 서버는 사용자에게 entry를 물을 수 있다.
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

// 빌드 출력과 서버 원본이 서로 포함되면 런타임 복사 중 원본이 지워질 수 있어 차단한다.
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

// Node 서버 어댑터에만 서버 원본 루트와 staging entry를 해석한다.
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

// 패키지 이름을 바탕으로 표시 이름과 appId를 정하고 사용자 입력을 정규화한다.
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

// 기존 electron-builder main 값을 보존할 수 있는지 판단하고 계획 차단 사유를 만든다.
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

// 입력·어댑터·질문 결과를 렌더러와 패치기가 사용할 단일 InitConfig로 묶는다.
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
      packageScript: desktopScripts.packageScript,
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
