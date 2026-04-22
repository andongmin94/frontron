import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import readline from 'node:readline/promises'

import { resolveInitAdapter } from './init/adapters'
import { patchPackageJson } from './init/package-json'
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

async function askConfirm(
  prompter: InitPrompter | null,
  enabled: boolean,
  message: string,
  defaultValue: boolean,
) {
  if (!enabled || !prompter) {
    return defaultValue
  }

  return prompter.confirm(message, defaultValue)
}

async function chooseDesktopScriptName(
  prompter: InitPrompter | null,
  promptEnabled: boolean,
  packageJson: PackageJson,
  message: string,
  defaultValue: string,
  takenNames: Set<string>,
  conflictFallback: string,
) {
  let candidate = normalizeValue(
    await askText(prompter, promptEnabled, message, defaultValue),
    defaultValue,
  )

  while (packageJson.scripts?.[candidate] || takenNames.has(candidate)) {
    if (!promptEnabled || !prompter) {
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

function createSummary(config: Parameters<typeof patchPackageJson>[0]) {
  const lines = [
    `- preset: ${config.preset}`,
    `- adapter: ${config.adapter}`,
    `- runtime strategy: ${config.runtimeStrategy}`,
    `- frontend dev script: ${config.webDevScript}`,
    `- frontend build script: ${config.webBuildScript}`,
    `- Electron directory: ${config.desktopDir}`,
    `- desktop dev script: ${config.appScript}`,
    `- desktop build script: ${config.buildScript}`,
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
  const promptEnabled = !options.yes
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
      options.appScript ?? 'app',
      takenDesktopScriptNames,
      'desktop:app',
    )
    takenDesktopScriptNames.add(appScript)
    const buildScript = await chooseDesktopScriptName(
      prompter,
      promptEnabled,
      packageJson,
      '데스크톱 빌드 스크립트 이름',
      options.buildScript ?? 'app:build',
      takenDesktopScriptNames,
      'desktop:build',
    )
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

    if (
      typeof existingExtraMetadataMain !== 'undefined' &&
      typeof existingExtraMetadataMain !== 'string'
    ) {
      throw new Error(
        'Existing build.extraMetadata.main must be a string to preserve existing packaging rules.',
      )
    }

    let allowExtraMetadataMainOverride =
      typeof existingExtraMetadataMain === 'undefined' ||
      existingExtraMetadataMain === 'dist-electron/main.js' ||
      options.force

    if (!allowExtraMetadataMainOverride && existingExtraMetadataMain) {
      allowExtraMetadataMainOverride = await askConfirm(
        prompter,
        promptEnabled,
        `기존 build.extraMetadata.main (${existingExtraMetadataMain}) 값을 dist-electron/main.js로 바꿀까요?`,
        false,
      )

      if (!allowExtraMetadataMainOverride) {
        throw new Error('Init aborted because build.extraMetadata.main already exists.')
      }
    }

    const config = {
      cwd: context.cwd,
      packageJson,
      packageManager: inferPackageManager(context.cwd),
      adapter: adapter.id,
      runtimeStrategy: adapter.runtimeStrategy,
      desktopDir,
      appScript,
      buildScript,
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

    const conflicts = [...filesToWrite.keys()].filter((filePath) => existsSync(filePath))

    if (conflicts.length > 0 && !options.force) {
      const overwrite = await askConfirm(
        prompter,
        promptEnabled,
        `기존 파일을 덮어쓸까요? ${conflicts
          .map((filePath) => normalizePathValue(relative(context.cwd, filePath), filePath))
          .join(', ')}`,
        false,
      )

      if (!overwrite) {
        throw new Error('Init aborted because one or more target files already exist.')
      }
    }

    patchPackageJson(config)

    for (const [filePath, source] of filesToWrite) {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, source, 'utf8')
    }

    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

    context.output.info(`[Frontron] Added the ${preset} Electron retrofit layer.`)
    context.output.info(createSummary(config))
    context.output.info('')
    context.output.info(`Run "${appScript}" to start the desktop app after installing dependencies.`)
    context.output.info(`Run "${buildScript}" to create a packaged build.`)

    return 0
  } finally {
    await prompter?.close()
  }
}
