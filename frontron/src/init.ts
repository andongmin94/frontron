import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { applyInitChanges } from './init/apply'
import { describeInitAdapterSelection, resolveInitAdapter } from './init/adapters'
import { createInitFileSources, addManifestSource } from './init/file-sources'
import { previewPackageJsonPatch } from './init/package-json'
import { readExistingManifest, readManifest, splitFileConflicts } from './init/manifest'
import { mergePackageJsonClaims } from './init/ownership-claims'
import { createDryRunReport, createInitPlan, createScriptFallbackWarnings } from './init/plan'
import { previewPnpmWorkspaceYamlPatch } from './init/pnpm-workspace-yaml'
import { askText, chooseDesktopScriptName, createReadlinePrompter } from './init/prompts'
import { previewTsconfigJsonPatch } from './init/tsconfig-json'
import { mergeYarnRcClaims, previewYarnRcYamlPatch } from './init/yarnrc-yaml'
import { normalizeProjectRelativePath } from './project-paths'
import {
  type InitContext,
  type InitOptions,
  type PackageJson,
  createDefaultAppId,
  inferPackageManager,
  normalizePresetValue,
  normalizePathValue,
  normalizeValue,
  titleCase,
} from './init/shared'
import { writeInitSuccessReport } from './init/success-report'
import { inferOutDir, inferOutDirFromScript } from './init/detect'
import { getInitTemplateInfo } from './init/runtime/renderers'

export type { InitContext, InitOptions, InitPrompter } from './init/shared'

// ensureObject 함수는 기존 설정 값이 객체인지 확인하고 아니면 기본 객체를 사용한다.
function ensureObject<T extends object>(value: unknown, fallback: T) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : fallback
}

// runInit 함수는 기존 웹 프로젝트에 Electron 레이어를 추가하는 init 흐름을 실행한다.
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
  const prompter = promptEnabled
    ? (context.prompter ??
      createReadlinePrompter(context.stdin ?? process.stdin, context.stdout ?? process.stdout))
    : null

  try {
    const adapterDefaults = adapter.inferDefaults(context.cwd, packageJson)
    const inferredWebDevScript = options.webDevScript ?? adapterDefaults.webDevScript
    const inferredWebBuildScript = options.webBuildScript ?? adapterDefaults.webBuildScript
    const webDevScript = normalizeValue(
      await askText(prompter, promptEnabled, 'Web dev script name', inferredWebDevScript),
      inferredWebDevScript,
    )
    const webBuildScript = normalizeValue(
      await askText(prompter, promptEnabled, 'Web build script name', inferredWebBuildScript),
      inferredWebBuildScript,
    )

    if (!packageJson.scripts?.[webDevScript]) {
      throw new Error(`Selected web dev script "${webDevScript}" was not found in package.json.`)
    }

    if (!packageJson.scripts?.[webBuildScript]) {
      throw new Error(
        `Selected web build script "${webBuildScript}" was not found in package.json.`,
      )
    }

    const desktopDir = normalizeProjectRelativePath(
      context.cwd,
      await askText(
        prompter,
        promptEnabled,
        'Electron source directory',
        options.desktopDir ?? 'electron',
      ),
      options.desktopDir ?? 'electron',
      'Electron source directory',
    )
    const takenDesktopScriptNames = new Set<string>()
    const appScript = await chooseDesktopScriptName(
      prompter,
      promptEnabled,
      packageJson,
      'Desktop dev script name',
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
      'Desktop build script name',
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
      'Desktop package script name',
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

    const outDir = normalizeProjectRelativePath(
      context.cwd,
      await askText(
        prompter,
        promptEnabled,
        'Frontend build output directory',
        inferredOutDir ?? 'dist',
      ),
      inferredOutDir ?? 'dist',
      'Frontend build output directory',
    )
    const inferredServerRoot =
      adapter.runtimeStrategy === 'node-server'
        ? (options.serverRoot ?? adapterDefaults.nodeServerSourceRoot ?? '')
        : ''
    const inferredServerEntry =
      adapter.runtimeStrategy === 'node-server'
        ? (options.serverEntry ?? adapterDefaults.nodeServerEntry ?? '')
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
        ? normalizeProjectRelativePath(
            context.cwd,
            await askText(
              prompter,
              promptEnabled,
              'Node server runtime root',
              inferredServerRoot || '.output',
            ),
            inferredServerRoot || '.output',
            'Node server runtime root',
          )
        : null
    const nodeServerEntry =
      adapter.runtimeStrategy === 'node-server'
        ? normalizeProjectRelativePath(
            context.cwd,
            await askText(
              prompter,
              promptEnabled,
              'Node server entry',
              inferredServerEntry || 'server/index.mjs',
            ),
            inferredServerEntry || 'server/index.mjs',
            'Node server entry',
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
    const existingExtraMetadata = ensureObject<Record<string, unknown>>(
      existingBuild.extraMetadata,
      {},
    )
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
      packageManager: inferPackageManager(context.cwd, packageJson),
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
      templateInfo: getInitTemplateInfo(preset),
      allowExtraMetadataMainOverride,
    }

    const filesToWrite = createInitFileSources(config)
    const packageJsonPatchPlan = previewPackageJsonPatch(config)
    const tsconfigJsonPatchPlan = previewTsconfigJsonPatch(context.cwd, desktopDir)
    const pnpmWorkspacePatchPlan = previewPnpmWorkspaceYamlPatch(context.cwd, config.packageManager)
    const yarnRcPatchPlan = previewYarnRcYamlPatch(context.cwd, config.packageManager)
    const packageJsonClaims = mergePackageJsonClaims(
      existingManifestDetails?.packageJsonClaims,
      packageJsonPatchPlan.ownershipClaims,
    )
    const tsconfigJsonClaims = mergePackageJsonClaims(
      existingManifestDetails?.tsconfigJsonClaims,
      tsconfigJsonPatchPlan?.ownershipClaims,
    )
    const pnpmWorkspaceClaims = mergePackageJsonClaims(
      existingManifestDetails?.pnpmWorkspaceClaims,
      pnpmWorkspacePatchPlan?.ownershipClaims,
    )
    const yarnRcClaims = mergeYarnRcClaims(
      existingManifestDetails?.yarnRcClaims,
      yarnRcPatchPlan?.ownershipClaims,
    )
    addManifestSource(
      config,
      filesToWrite,
      packageJsonClaims,
      tsconfigJsonClaims,
      pnpmWorkspaceClaims,
      yarnRcClaims,
    )

    const conflicts = [...filesToWrite.keys()].filter((filePath) => existsSync(filePath))
    const conflictPlan = splitFileConflicts(context.cwd, conflicts, options.force, existingManifest)
    const packageJsonBlockers = [
      ...packageJsonPatchPlan.blockers,
      typeof existingExtraMetadataMain !== 'undefined' &&
      typeof existingExtraMetadataMain !== 'string'
        ? 'Existing build.extraMetadata.main must be a string to preserve existing packaging rules.'
        : null,
      ...(tsconfigJsonPatchPlan?.blockers ?? []),
      ...(pnpmWorkspacePatchPlan?.blockers ?? []),
      ...(yarnRcPatchPlan?.blockers ?? []),
      !allowExtraMetadataMainOverride && typeof existingExtraMetadataMain === 'string'
        ? `Existing build.extraMetadata.main will not be overwritten: ${existingExtraMetadataMain}`
        : null,
    ].filter((blocker): blocker is string => typeof blocker === 'string')
    const plan = createInitPlan({
      config,
      filesToWrite,
      packageJsonPlan: packageJsonPatchPlan,
      tsconfigJsonPlan: tsconfigJsonPatchPlan,
      pnpmWorkspacePlan: pnpmWorkspacePatchPlan,
      yarnRcPlan: yarnRcPatchPlan,
      warnings: [
        ...scriptFallbackWarnings,
        ...adapterSelection.warnings,
        ...packageJsonPatchPlan.warnings,
        ...(tsconfigJsonPatchPlan?.warnings ?? []),
        ...(pnpmWorkspacePatchPlan?.warnings ?? []),
        ...(yarnRcPatchPlan?.warnings ?? []),
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
      throw new Error(
        `Init aborted because package.json cannot be patched: ${plan.blockers.join('; ')}`,
      )
    }

    applyInitChanges(packageJsonPath, plan)

    writeInitSuccessReport(context.output, config, scriptFallbackWarnings)

    return 0
  } finally {
    await prompter?.close()
  }
}
