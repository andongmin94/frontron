import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import readline from 'node:readline/promises'

import { applyInitChanges } from './init/apply'
import { describeInitAdapterSelection, resolveInitAdapter } from './init/adapters'
import { createDesktopScriptCommands, previewPackageJsonPatch } from './init/package-json'
import {
  MANIFEST_PATH,
  createManifest,
  type PackageJsonOwnershipClaim,
  readExistingManifest,
  readManifest,
  renderManifestSource,
  splitFileConflicts,
} from './init/manifest'
import {
  createDryRunReport,
  createInitPlan,
  createScriptFallbackWarnings,
} from './init/plan'
import {
  type InitContext,
  type InitOptions,
  type InitPrompter,
  type PackageJson,
  createDefaultAppId,
  inferPackageManager,
  normalizePresetValue,
  normalizePathValue,
  normalizeValue,
  titleCase,
  usesStarterBridge,
} from './init/shared'
import {
  inferOutDir,
  inferOutDirFromScript,
} from './init/detect'
import {
  renderElectronTypesSource,
  renderIpcSource,
  renderMainSource,
  renderPreloadSource,
  renderServeSource,
  renderTsconfigSource,
  renderWindowSource,
} from './init/runtime/renderers'

export type { InitContext, InitOptions, InitPrompter } from './init/shared'

function createReadlinePrompter(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): InitPrompter {
  const rl = readline.createInterface({ input: stdin, output: stdout })

  return {
    async text(message, defaultValue) {
      const answer = await rl.question(`${message} [${defaultValue}]: `)
      return answer.trim() || defaultValue
    },
    async confirm(message, defaultValue) {
      const answer = (await rl.question(`${message} [${defaultValue ? 'Y/n' : 'y/N'}]: `))
        .trim()
        .toLowerCase()

      if (!answer) {
        return defaultValue
      }

      return answer === 'y' || answer === 'yes'
    },
    close() {
      rl.close()
    },
  }
}

async function askText(
  prompter: InitPrompter | null,
  enabled: boolean,
  message: string,
  defaultValue: string,
) {
  if (!enabled || !prompter) {
    return defaultValue
  }

  return prompter.text(message, defaultValue)
}

async function chooseDesktopScriptName(
  prompter: InitPrompter | null,
  promptEnabled: boolean,
  packageJson: PackageJson,
  message: string,
  defaultValue: string,
  takenNames: Set<string>,
  conflictFallback: string,
  explicitValue: boolean,
  allowedExistingNames = new Set<string>(),
) {
  let candidate = normalizeValue(
    await askText(prompter, promptEnabled, message, defaultValue),
    defaultValue,
  )

  while (
    (packageJson.scripts?.[candidate] && !allowedExistingNames.has(candidate)) ||
    takenNames.has(candidate)
  ) {
    if (!promptEnabled || !prompter) {
      if (!explicitValue) {
        for (const fallback of [
          conflictFallback,
          `${defaultValue}:electron`,
          `${conflictFallback}:2`,
        ]) {
          if (!packageJson.scripts?.[fallback] && !takenNames.has(fallback)) {
            return fallback
          }
        }
      }

      throw new Error(`Script name "${candidate}" already exists. Choose a different desktop script name.`)
    }

    candidate = normalizeValue(
      await askText(
        prompter,
        true,
        `${message} (이미 사용 중입니다. 다른 이름을 입력하세요)`,
        conflictFallback,
      ),
      conflictFallback,
    )
  }

  return candidate
}

function ensureObject<T extends object>(value: unknown, fallback: T) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : fallback
}

function createSummary(config: Parameters<typeof previewPackageJsonPatch>[0]) {
  const lines = [
    `- preset: ${config.preset}`,
    `- adapter: ${config.adapter}`,
    `- adapter confidence: ${config.adapterConfidence}`,
    ...config.adapterReasons.map((reason) => `- adapter reason: ${reason}`),
    `- runtime strategy: ${config.runtimeStrategy}`,
    `- frontend dev script: ${config.webDevScript}`,
    `- frontend build script: ${config.webBuildScript}`,
    `- Electron directory: ${config.desktopDir}`,
    `- desktop dev script: ${config.appScript}`,
    `- desktop build script: ${config.buildScript}`,
    `- desktop package script: ${config.packageScript}`,
    `- frontend output: ${config.outDir}`,
    `- package manager: ${config.packageManager}`,
    usesStarterBridge(config.preset) ? '- preload bridge: window.electron' : '- preload bridge: disabled',
  ]

  if (config.runtimeStrategy === 'node-server') {
    lines.push(`- server runtime root: ${config.nodeServerSourceRoot ?? '(unset)'}`)
    lines.push(`- server entry: ${config.nodeServerEntry ?? '(unset)'}`)
  }

  return lines.join('\n')
}

function mergePackageJsonClaims(
  existingClaims: PackageJsonOwnershipClaim[] = [],
  nextClaims: PackageJsonOwnershipClaim[] = [],
) {
  const claims = new Map<string, PackageJsonOwnershipClaim>()

  for (const claim of [...existingClaims, ...nextClaims]) {
    claims.set(`${claim.action ?? 'set'}:${claim.path}:${JSON.stringify(claim.value)}`, claim)
  }

  return [...claims.values()]
}

export async function runInit(options: InitOptions, context: InitContext) {
  if (options.preset) {
    normalizePresetValue(options.preset)
  }

  const packageJsonPath = join(context.cwd, 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error('package.json was not found in the current directory.')
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
  const adapter = resolveInitAdapter(context.cwd, packageJson, options.adapter)
  const promptEnabled = !options.yes && !options.dryRun
  const existingManifest = options.force ? readExistingManifest(context.cwd) : null
  let existingManifestDetails: ReturnType<typeof readManifest> = null

  if (options.force) {
    try {
      existingManifestDetails = readManifest(context.cwd)
    } catch {
      existingManifestDetails = null
    }
  }
  const allowedExistingScriptNames = existingManifest?.scripts ?? new Set<string>()
  const prompter =
    promptEnabled
      ? context.prompter ?? createReadlinePrompter(context.stdin ?? process.stdin, context.stdout ?? process.stdout)
      : null

  try {
    const adapterDefaults = adapter.inferDefaults(context.cwd, packageJson)
    const inferredWebDevScript = options.webDevScript ?? adapterDefaults.webDevScript
    const inferredWebBuildScript = options.webBuildScript ?? adapterDefaults.webBuildScript
    const webDevScript = normalizeValue(
      await askText(prompter, promptEnabled, '웹 개발 스크립트 이름', inferredWebDevScript),
      inferredWebDevScript,
    )
    const webBuildScript = normalizeValue(
      await askText(prompter, promptEnabled, '웹 빌드 스크립트 이름', inferredWebBuildScript),
      inferredWebBuildScript,
    )

    if (!packageJson.scripts?.[webDevScript]) {
      throw new Error(`Selected web dev script "${webDevScript}" was not found in package.json.`)
    }

    if (!packageJson.scripts?.[webBuildScript]) {
      throw new Error(`Selected web build script "${webBuildScript}" was not found in package.json.`)
    }

    const desktopDir = normalizePathValue(
      await askText(prompter, promptEnabled, 'Electron 소스 디렉토리', options.desktopDir ?? 'electron'),
      options.desktopDir ?? 'electron',
    )
    const takenDesktopScriptNames = new Set<string>()
    const appScript = await chooseDesktopScriptName(
      prompter,
      promptEnabled,
      packageJson,
      '데스크톱 개발 스크립트 이름',
      options.appScript ?? 'frontron:dev',
      takenDesktopScriptNames,
      'frontron:dev:electron',
      Boolean(options.appScript),
      allowedExistingScriptNames,
    )
    takenDesktopScriptNames.add(appScript)
    const buildScript = await chooseDesktopScriptName(
      prompter,
      promptEnabled,
      packageJson,
      '데스크톱 빌드 스크립트 이름',
      options.buildScript ?? 'frontron:build',
      takenDesktopScriptNames,
      'frontron:build:electron',
      Boolean(options.buildScript),
      allowedExistingScriptNames,
    )
    takenDesktopScriptNames.add(buildScript)
    const packageScript = await chooseDesktopScriptName(
      prompter,
      promptEnabled,
      packageJson,
      '데스크톱 패키징 스크립트 이름',
      options.packageScript ?? 'frontron:package',
      takenDesktopScriptNames,
      'frontron:package:electron',
      Boolean(options.packageScript),
      allowedExistingScriptNames,
    )
    takenDesktopScriptNames.add(packageScript)
    const scriptFallbackWarnings = createScriptFallbackWarnings(packageJson, options, {
      appScript,
      buildScript,
      packageScript,
    })
    const preset = normalizePresetValue(
      await askText(
        prompter,
        promptEnabled,
        'Preset (minimal|starter-like)',
        options.preset ?? 'minimal',
      ),
      'minimal',
    )
    const webBuildCommand = adapter.resolveBuildCommand(packageJson, webBuildScript)
    const inferredOutDir =
      options.outDir ??
      adapterDefaults.outDir ??
      inferOutDirFromScript(packageJson, webBuildScript) ??
      inferOutDir(context.cwd)

    if (!inferredOutDir && options.yes) {
      throw new Error(
        `Unable to infer the frontend build output for "${webBuildScript}". Pass --out-dir or run without --yes.`,
      )
    }

    const outDir = normalizePathValue(
      await askText(
        prompter,
        promptEnabled,
        '프론트엔드 빌드 출력 디렉토리',
        inferredOutDir ?? 'dist',
      ),
      inferredOutDir ?? 'dist',
    )
    const inferredServerRoot =
      adapter.runtimeStrategy === 'node-server'
        ? options.serverRoot ?? adapterDefaults.nodeServerSourceRoot ?? ''
        : ''
    const inferredServerEntry =
      adapter.runtimeStrategy === 'node-server'
        ? options.serverEntry ?? adapterDefaults.nodeServerEntry ?? ''
        : ''

    if (adapter.runtimeStrategy === 'node-server' && options.yes) {
      if (!inferredServerRoot) {
        throw new Error(
          `Unable to infer the node server runtime root for adapter "${adapter.id}". Pass --server-root or run without --yes.`,
        )
      }

      if (!inferredServerEntry) {
        throw new Error(
          `Unable to infer the node server entry for adapter "${adapter.id}". Pass --server-entry or run without --yes.`,
        )
      }
    }

    const nodeServerSourceRoot =
      adapter.runtimeStrategy === 'node-server'
        ? normalizePathValue(
            await askText(
              prompter,
              promptEnabled,
              'Node 서버 런타임 루트',
              inferredServerRoot || '.output',
            ),
            inferredServerRoot || '.output',
          )
        : null
    const nodeServerEntry =
      adapter.runtimeStrategy === 'node-server'
        ? normalizePathValue(
            await askText(
              prompter,
              promptEnabled,
              'Node 서버 엔트리',
              inferredServerEntry || 'server/index.mjs',
            ),
            inferredServerEntry || 'server/index.mjs',
          )
        : null

    const packageName = packageJson.name ?? 'desktop-app'
    const productName = normalizeValue(
      await askText(
        prompter,
        promptEnabled,
        'Product name',
        options.productName ?? titleCase(packageName),
      ),
      options.productName ?? titleCase(packageName),
    )
    const appId = normalizeValue(
      await askText(
        prompter,
        promptEnabled,
        'App ID',
        options.appId ?? createDefaultAppId(packageName),
      ),
      options.appId ?? createDefaultAppId(packageName),
    )
    const existingBuild = ensureObject<NonNullable<PackageJson['build']>>(packageJson.build, {})
    const existingExtraMetadata = ensureObject<Record<string, unknown>>(existingBuild.extraMetadata, {})
    const existingExtraMetadataMain = existingExtraMetadata.main

    const allowExtraMetadataMainOverride =
      typeof existingExtraMetadataMain === 'undefined' ||
      existingExtraMetadataMain === 'dist-electron/main.js' ||
      options.force

    const adapterSelection = describeInitAdapterSelection(
      adapter,
      options.adapter,
      context.cwd,
      packageJson,
    )
    const config = {
      cwd: context.cwd,
      packageJson,
      packageManager: inferPackageManager(context.cwd),
      adapter: adapter.id,
      adapterConfidence: adapterSelection.confidence,
      adapterReasons: adapterSelection.reasons,
      runtimeStrategy: adapter.runtimeStrategy,
      desktopDir,
      appScript,
      buildScript,
      packageScript,
      webDevScript,
      webBuildScript,
      webBuildCommand,
      outDir,
      nodeServerSourceRoot,
      nodeServerEntry,
      nodeServerCopyTargets: adapterDefaults.nodeServerCopyTargets ?? [],
      productName,
      appId,
      preset,
      allowExtraMetadataMainOverride,
    }

    const filesToWrite = new Map<string, string>([
      [join(context.cwd, desktopDir, 'main.ts'), renderMainSource(preset)],
      [join(context.cwd, desktopDir, 'window.ts'), renderWindowSource(preset)],
      [join(context.cwd, desktopDir, 'serve.ts'), renderServeSource(config)],
      [join(context.cwd, 'tsconfig.electron.json'), renderTsconfigSource(desktopDir)],
    ])

    if (usesStarterBridge(preset)) {
      filesToWrite.set(join(context.cwd, desktopDir, 'preload.ts'), renderPreloadSource())
      filesToWrite.set(join(context.cwd, desktopDir, 'ipc.ts'), renderIpcSource())
      filesToWrite.set(join(context.cwd, 'src', 'types', 'electron.d.ts'), renderElectronTypesSource())
    }

    const packageJsonPatchPlan = previewPackageJsonPatch(config)
    const packageJsonClaims = mergePackageJsonClaims(
      existingManifestDetails?.packageJsonClaims,
      packageJsonPatchPlan.ownershipClaims,
    )
    filesToWrite.set(
      join(context.cwd, MANIFEST_PATH),
      renderManifestSource(
        createManifest(
          config,
          filesToWrite,
          [join(context.cwd, MANIFEST_PATH)],
          createDesktopScriptCommands(config),
          packageJsonClaims,
        ),
      ),
    )

    const conflicts = [...filesToWrite.keys()].filter((filePath) => existsSync(filePath))
    const conflictPlan = splitFileConflicts(context.cwd, conflicts, options.force, existingManifest)
    const packageJsonBlockers = [
      ...packageJsonPatchPlan.blockers,
      typeof existingExtraMetadataMain !== 'undefined' &&
      typeof existingExtraMetadataMain !== 'string'
        ? 'Existing build.extraMetadata.main must be a string to preserve existing packaging rules.'
        : null,
      !allowExtraMetadataMainOverride &&
      typeof existingExtraMetadataMain === 'string'
        ? `Existing build.extraMetadata.main will not be overwritten: ${existingExtraMetadataMain}`
        : null,
    ].filter((blocker): blocker is string => typeof blocker === 'string')
    const plan = createInitPlan({
      config,
      filesToWrite,
      packageJsonPlan: packageJsonPatchPlan,
      warnings: [
        ...scriptFallbackWarnings,
        ...adapterSelection.warnings,
        ...packageJsonPatchPlan.warnings,
      ],
      blockers: packageJsonBlockers,
      blockedFiles: conflictPlan.blocked,
      overwriteFiles: conflictPlan.safeToOverwrite,
    })

    if (options.dryRun) {
      context.output.info(createDryRunReport(plan))

      return 0
    }

    if (conflictPlan.blocked.length > 0) {
      throw new Error(
        `Init aborted because one or more target files already exist: ${conflictPlan.blocked
          .map((filePath) => normalizePathValue(relative(context.cwd, filePath), filePath))
          .join(', ')}`,
      )
    }

    if (plan.blockers.length > 0) {
      throw new Error(`Init aborted because package.json cannot be patched: ${plan.blockers.join('; ')}`)
    }

    applyInitChanges(packageJsonPath, packageJsonPatchPlan.packageJson, plan)

    context.output.info(`[Frontron] Added the ${preset} Electron retrofit layer.`)
    context.output.info(createSummary(config))
    if (scriptFallbackWarnings.length > 0) {
      context.output.info('')
      context.output.info('Warnings:')

      for (const warning of scriptFallbackWarnings) {
        context.output.info(`- ${warning}`)
      }
    }
    context.output.info('')
    context.output.info(`Run "${appScript}" to start the desktop app after installing dependencies.`)
    context.output.info(`Run "${buildScript}" to prepare the desktop build.`)
    context.output.info(`Run "${packageScript}" to create a packaged build.`)

    return 0
  } finally {
    await prompter?.close()
  }
}
