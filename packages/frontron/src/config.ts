import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type {
  FrontronBuildCompression,
  FrontronBuildFilePattern,
  FrontronBuildFileSet,
  FrontronConfig,
  FrontronLinuxBuildTarget,
  FrontronMacBuildTarget,
  FrontronPublishMode,
  FrontronRequestedExecutionLevel,
  FrontronRustBridgeConfig,
  FrontronRustValueType,
  FrontronTitleBarStyle,
  FrontronWindowsBuildTarget,
  LoadConfigOptions,
  LoadedFrontronConfig,
  ResolvedFrontronBuildFilePattern,
  ResolvedFrontronBuildConfig,
  ResolvedFrontronConfig,
  ResolvedFrontronRustConfig,
} from './types'

const OFFICIAL_CONFIG_FILE = 'frontron.config.ts'
const OFFICIAL_RUST_DIR = join('frontron', 'rust')
const SUPPORTED_FILE_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']
const SUPPORTED_RUST_VALUE_TYPES: FrontronRustValueType[] = [
  'void',
  'int',
  'double',
  'bool',
  'string',
]
const SUPPORTED_PUBLISH_MODES: FrontronPublishMode[] = [
  'never',
  'always',
  'onTag',
  'onTagOrDraft',
]
const SUPPORTED_WINDOWS_BUILD_TARGETS: FrontronWindowsBuildTarget[] = [
  'dir',
  'nsis',
  'portable',
]
const SUPPORTED_MAC_BUILD_TARGETS: FrontronMacBuildTarget[] = [
  'default',
  'dmg',
  'mas',
  'mas-dev',
  'pkg',
  '7z',
  'zip',
  'tar.xz',
  'tar.lz',
  'tar.gz',
  'tar.bz2',
  'dir',
]
const SUPPORTED_LINUX_BUILD_TARGETS: FrontronLinuxBuildTarget[] = [
  'AppImage',
  'flatpak',
  'snap',
  'deb',
  'rpm',
  'freebsd',
  'pacman',
  'p5p',
  'apk',
  '7z',
  'zip',
  'tar.xz',
  'tar.lz',
  'tar.gz',
  'tar.bz2',
  'dir',
]
const SUPPORTED_BUILD_COMPRESSIONS: FrontronBuildCompression[] = [
  'store',
  'normal',
  'maximum',
]
const SUPPORTED_REQUESTED_EXECUTION_LEVELS: FrontronRequestedExecutionLevel[] = [
  'asInvoker',
  'highestAvailable',
  'requireAdministrator',
]
const SUPPORTED_TITLE_BAR_STYLES: FrontronTitleBarStyle[] = [
  'default',
  'hidden',
  'hiddenInset',
  'customButtonsOnHover',
]

function isRelativeSpecifier(specifier: string) {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

function isFileUrl(value: string) {
  return value.startsWith('file:')
}

function isNodeModulesPath(filePath: string) {
  return filePath.includes(`${sep}node_modules${sep}`)
}

function inferModuleFormat(filePath: string): 'module' | 'commonjs' {
  const extension = extname(filePath)

  if (extension === '.ts' || extension === '.mts' || extension === '.mjs') {
    return 'module'
  }

  if (extension === '.cts' || extension === '.cjs') {
    return 'commonjs'
  }

  let currentDir = dirname(filePath)

  while (true) {
    const packageJsonPath = join(currentDir, 'package.json')

    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
          type?: string
        }

        return packageJson.type === 'module' ? 'module' : 'commonjs'
      } catch {
        return 'commonjs'
      }
    }

    const parentDir = dirname(currentDir)

    if (parentDir === currentDir) {
      return 'commonjs'
    }

    currentDir = parentDir
  }
}

function resolveProjectPath(rootDir: string, value: string | undefined) {
  if (!value) {
    return value
  }

  if (isAbsolute(value)) {
    return value
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
    return value
  }

  return resolve(rootDir, value)
}

function normalizeTray(rootDir: string, tray: FrontronConfig['tray']) {
  if (!tray) {
    return tray
  }

  return {
    ...tray,
    icon: resolveProjectPath(rootDir, tray.icon),
  }
}

function normalizeRust(
  rootDir: string,
  rust: FrontronConfig['rust'],
): ResolvedFrontronRustConfig | undefined {
  if (typeof rust === 'undefined') {
    return undefined
  }

  const enabled = typeof rust === 'boolean' ? rust : rust.enabled ?? true
  const path = resolve(rootDir, OFFICIAL_RUST_DIR)

  return {
    enabled,
    path,
    cargoTomlPath: join(path, 'Cargo.toml'),
    sourceDir: join(path, 'src'),
    libRsPath: join(path, 'src', 'lib.rs'),
    bridge: typeof rust === 'object' ? rust.bridge : undefined,
  }
}

function normalizeBuildFilePattern(
  rootDir: string,
  pattern: FrontronBuildFilePattern,
  resolveFromPath: boolean,
): ResolvedFrontronBuildFilePattern {
  if (typeof pattern === 'string') {
    return resolveFromPath ? resolveProjectPath(rootDir, pattern) ?? pattern : pattern
  }

  return {
    ...pattern,
    from: resolveProjectPath(rootDir, pattern.from) ?? pattern.from,
    filter:
      typeof pattern.filter === 'string'
        ? [pattern.filter]
        : pattern.filter
          ? [...pattern.filter]
          : undefined,
  }
}

function normalizeBuildFilePatterns(
  rootDir: string,
  patterns: readonly FrontronBuildFilePattern[] | undefined,
  resolveFromPath: boolean,
) {
  if (!patterns) {
    return undefined
  }

  return patterns.map((pattern) => normalizeBuildFilePattern(rootDir, pattern, resolveFromPath))
}

function normalizeBuild(
  rootDir: string,
  build: FrontronConfig['build'],
): ResolvedFrontronBuildConfig | undefined {
  if (!build) {
    return undefined
  }

  const windowsTargets = build.windows?.targets
  const macTargets = build.mac?.targets
  const linuxTargets = build.linux?.targets

  return {
    ...build,
    outputDir: resolveProjectPath(rootDir, build.outputDir),
    files: normalizeBuildFilePatterns(rootDir, build.files, false),
    extraResources: normalizeBuildFilePatterns(rootDir, build.extraResources, true),
    extraFiles: normalizeBuildFilePatterns(rootDir, build.extraFiles, true),
    windows: build.windows
      ? {
          ...build.windows,
          icon: resolveProjectPath(rootDir, build.windows.icon),
          publisherName:
            typeof build.windows.publisherName === 'string'
              ? [build.windows.publisherName]
              : build.windows.publisherName
                ? [...build.windows.publisherName]
                : undefined,
          targets:
            typeof windowsTargets === 'string'
              ? [windowsTargets]
              : windowsTargets
                ? [...windowsTargets]
                : undefined,
        }
      : undefined,
    nsis: build.nsis
      ? {
          ...build.nsis,
          installerIcon: resolveProjectPath(rootDir, build.nsis.installerIcon),
          uninstallerIcon: resolveProjectPath(rootDir, build.nsis.uninstallerIcon),
        }
      : undefined,
    mac: build.mac
      ? {
          ...build.mac,
          icon: resolveProjectPath(rootDir, build.mac.icon),
          targets:
            typeof macTargets === 'string'
              ? [macTargets]
              : macTargets
                ? [...macTargets]
                : undefined,
        }
      : undefined,
    linux: build.linux
      ? {
          ...build.linux,
          icon: resolveProjectPath(rootDir, build.linux.icon),
          targets:
            typeof linuxTargets === 'string'
              ? [linuxTargets]
              : linuxTargets
                ? [...linuxTargets]
                : undefined,
        }
      : undefined,
  }
}

function normalizeConfig(rootDir: string, config: FrontronConfig): ResolvedFrontronConfig {
  return {
    ...config,
    app: {
      ...config.app,
      icon: resolveProjectPath(rootDir, config.app.icon),
    },
    web: config.web
      ? {
          ...config.web,
          build: config.web.build
            ? {
                ...config.web.build,
                outDir: resolveProjectPath(rootDir, config.web.build.outDir) ?? '',
              }
            : undefined,
        }
      : undefined,
    build: normalizeBuild(rootDir, config.build),
    tray: normalizeTray(rootDir, config.tray),
    rust: normalizeRust(rootDir, config.rust),
  }
}

function validateMenuItems(menu: unknown, owner: string) {
  if (!Array.isArray(menu)) {
    throw new Error(`[Frontron] ${owner} must be an array of menu items.`)
  }

  for (const [index, item] of menu.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`[Frontron] ${owner}[${index}] must be an object.`)
    }

    const candidate = item as {
      submenu?: unknown
      onClick?: unknown
    }

    if (typeof candidate.onClick !== 'undefined' && typeof candidate.onClick !== 'function') {
      throw new Error(`[Frontron] ${owner}[${index}].onClick must be a function.`)
    }

    if (typeof candidate.submenu !== 'undefined') {
      validateMenuItems(candidate.submenu, `${owner}[${index}].submenu`)
    }
  }
}

function validateHooks(hooks: unknown) {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new Error('[Frontron] "hooks" must be an object.')
  }

  for (const [hookName, hookValue] of Object.entries(hooks)) {
    if (typeof hookValue !== 'string' && typeof hookValue !== 'function') {
      throw new Error(
        `[Frontron] Hook "${hookName}" must be a shell command string or function.`,
      )
    }
  }
}

function validateOptionalString(value: unknown, owner: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[Frontron] ${owner} must be a non-empty string.`)
  }
}

function validateOptionalBoolean(value: unknown, owner: string) {
  if (typeof value !== 'boolean') {
    throw new Error(`[Frontron] ${owner} must be a boolean.`)
  }
}

function validateOptionalPositiveNumber(value: unknown, owner: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`[Frontron] ${owner} must be a positive number.`)
  }
}

function validateStringArray(value: unknown, owner: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`[Frontron] ${owner} must be a non-empty array of strings.`)
  }

  for (const [index, item] of value.entries()) {
    validateOptionalString(item, `${owner}[${index}]`)
  }
}

function validateBuildFileSet(value: unknown, owner: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[Frontron] ${owner} must be a string or file set object.`)
  }

  const candidate = value as FrontronBuildFileSet
  validateOptionalString(candidate.from, `${owner}.from`)

  if (typeof candidate.to !== 'undefined') {
    validateOptionalString(candidate.to, `${owner}.to`)
  }

  if (typeof candidate.filter !== 'undefined') {
    if (typeof candidate.filter === 'string') {
      validateOptionalString(candidate.filter, `${owner}.filter`)
      return
    }

    validateStringArray(candidate.filter, `${owner}.filter`)
  }
}

function validateBuildFilePatterns(value: unknown, owner: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`[Frontron] ${owner} must be a non-empty array.`)
  }

  for (const [index, pattern] of value.entries()) {
    if (typeof pattern === 'string') {
      validateOptionalString(pattern, `${owner}[${index}]`)
      continue
    }

    validateBuildFileSet(pattern, `${owner}[${index}]`)
  }
}

function validateWindowDimensions(
  candidate: {
    width?: unknown
    height?: unknown
    minWidth?: unknown
    minHeight?: unknown
    maxWidth?: unknown
    maxHeight?: unknown
  },
  owner: string,
) {
  if (
    typeof candidate.minWidth === 'number' &&
    typeof candidate.maxWidth === 'number' &&
    candidate.minWidth > candidate.maxWidth
  ) {
    throw new Error(
      `[Frontron] "${owner}.minWidth" cannot be greater than "${owner}.maxWidth".`,
    )
  }

  if (
    typeof candidate.minHeight === 'number' &&
    typeof candidate.maxHeight === 'number' &&
    candidate.minHeight > candidate.maxHeight
  ) {
    throw new Error(
      `[Frontron] "${owner}.minHeight" cannot be greater than "${owner}.maxHeight".`,
    )
  }

  if (
    typeof candidate.width === 'number' &&
    typeof candidate.minWidth === 'number' &&
    candidate.width < candidate.minWidth
  ) {
    throw new Error(`[Frontron] "${owner}.width" cannot be smaller than "${owner}.minWidth".`)
  }

  if (
    typeof candidate.width === 'number' &&
    typeof candidate.maxWidth === 'number' &&
    candidate.width > candidate.maxWidth
  ) {
    throw new Error(`[Frontron] "${owner}.width" cannot be greater than "${owner}.maxWidth".`)
  }

  if (
    typeof candidate.height === 'number' &&
    typeof candidate.minHeight === 'number' &&
    candidate.height < candidate.minHeight
  ) {
    throw new Error(
      `[Frontron] "${owner}.height" cannot be smaller than "${owner}.minHeight".`,
    )
  }

  if (
    typeof candidate.height === 'number' &&
    typeof candidate.maxHeight === 'number' &&
    candidate.height > candidate.maxHeight
  ) {
    throw new Error(
      `[Frontron] "${owner}.height" cannot be greater than "${owner}.maxHeight".`,
    )
  }
}

function validateWindows(windows: unknown) {
  if (!windows || typeof windows !== 'object' || Array.isArray(windows)) {
    throw new Error('[Frontron] "windows" must be an object.')
  }

  for (const [windowName, windowConfig] of Object.entries(windows)) {
    if (!windowConfig || typeof windowConfig !== 'object' || Array.isArray(windowConfig)) {
      throw new Error(`[Frontron] "windows.${windowName}" must be an object.`)
    }

    const candidate = windowConfig as {
      route?: unknown
      width?: unknown
      height?: unknown
      minWidth?: unknown
      minHeight?: unknown
      maxWidth?: unknown
      maxHeight?: unknown
      frame?: unknown
      resizable?: unknown
      show?: unknown
      center?: unknown
      fullscreen?: unknown
      fullscreenable?: unknown
      maximizable?: unknown
      minimizable?: unknown
      closable?: unknown
      alwaysOnTop?: unknown
      backgroundColor?: unknown
      transparent?: unknown
      autoHideMenuBar?: unknown
      skipTaskbar?: unknown
      title?: unknown
      titleBarStyle?: unknown
    }
    const owner = `windows.${windowName}`

    validateOptionalString(candidate.route, `"${owner}.route"`)

    if (typeof candidate.width !== 'undefined') {
      validateOptionalPositiveNumber(candidate.width, `"${owner}.width"`)
    }

    if (typeof candidate.height !== 'undefined') {
      validateOptionalPositiveNumber(candidate.height, `"${owner}.height"`)
    }

    if (typeof candidate.minWidth !== 'undefined') {
      validateOptionalPositiveNumber(candidate.minWidth, `"${owner}.minWidth"`)
    }

    if (typeof candidate.minHeight !== 'undefined') {
      validateOptionalPositiveNumber(candidate.minHeight, `"${owner}.minHeight"`)
    }

    if (typeof candidate.maxWidth !== 'undefined') {
      validateOptionalPositiveNumber(candidate.maxWidth, `"${owner}.maxWidth"`)
    }

    if (typeof candidate.maxHeight !== 'undefined') {
      validateOptionalPositiveNumber(candidate.maxHeight, `"${owner}.maxHeight"`)
    }

    validateWindowDimensions(candidate, owner)

    if (typeof candidate.frame !== 'undefined') {
      validateOptionalBoolean(candidate.frame, `"${owner}.frame"`)
    }

    if (typeof candidate.resizable !== 'undefined') {
      validateOptionalBoolean(candidate.resizable, `"${owner}.resizable"`)
    }

    if (typeof candidate.show !== 'undefined') {
      validateOptionalBoolean(candidate.show, `"${owner}.show"`)
    }

    if (typeof candidate.center !== 'undefined') {
      validateOptionalBoolean(candidate.center, `"${owner}.center"`)
    }

    if (typeof candidate.fullscreen !== 'undefined') {
      validateOptionalBoolean(candidate.fullscreen, `"${owner}.fullscreen"`)
    }

    if (typeof candidate.fullscreenable !== 'undefined') {
      validateOptionalBoolean(candidate.fullscreenable, `"${owner}.fullscreenable"`)
    }

    if (typeof candidate.maximizable !== 'undefined') {
      validateOptionalBoolean(candidate.maximizable, `"${owner}.maximizable"`)
    }

    if (typeof candidate.minimizable !== 'undefined') {
      validateOptionalBoolean(candidate.minimizable, `"${owner}.minimizable"`)
    }

    if (typeof candidate.closable !== 'undefined') {
      validateOptionalBoolean(candidate.closable, `"${owner}.closable"`)
    }

    if (typeof candidate.alwaysOnTop !== 'undefined') {
      validateOptionalBoolean(candidate.alwaysOnTop, `"${owner}.alwaysOnTop"`)
    }

    if (typeof candidate.transparent !== 'undefined') {
      validateOptionalBoolean(candidate.transparent, `"${owner}.transparent"`)
    }

    if (typeof candidate.autoHideMenuBar !== 'undefined') {
      validateOptionalBoolean(candidate.autoHideMenuBar, `"${owner}.autoHideMenuBar"`)
    }

    if (typeof candidate.skipTaskbar !== 'undefined') {
      validateOptionalBoolean(candidate.skipTaskbar, `"${owner}.skipTaskbar"`)
    }

    if (typeof candidate.backgroundColor !== 'undefined') {
      validateOptionalString(candidate.backgroundColor, `"${owner}.backgroundColor"`)
    }

    if (typeof candidate.title !== 'undefined') {
      validateOptionalString(candidate.title, `"${owner}.title"`)
    }

    if (typeof candidate.titleBarStyle !== 'undefined') {
      if (
        typeof candidate.titleBarStyle !== 'string' ||
        !SUPPORTED_TITLE_BAR_STYLES.includes(candidate.titleBarStyle as FrontronTitleBarStyle)
      ) {
        throw new Error(
          `[Frontron] "${owner}.titleBarStyle" must be one of: ${SUPPORTED_TITLE_BAR_STYLES.join(', ')}.`,
        )
      }
    }
  }
}

function validateBuildTarget(
  target: unknown,
  owner: string,
  supportedTargets: readonly string[],
) {
  if (
    typeof target !== 'string' ||
    !supportedTargets.includes(target)
  ) {
    throw new Error(`[Frontron] ${owner} must be one of: ${supportedTargets.join(', ')}.`)
  }
}

function validateBuildTargetList(
  targets: unknown,
  owner: string,
  validateTarget: (target: unknown, targetOwner: string) => void,
) {
  if (typeof targets === 'string') {
    validateTarget(targets, owner)
    return
  }

  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(`[Frontron] ${owner} must be a string or non-empty array.`)
  }

  for (const [index, target] of targets.entries()) {
    validateTarget(target, `${owner}[${index}]`)
  }
}

function validateWindowsBuildTarget(target: unknown, owner: string) {
  validateBuildTarget(target, owner, SUPPORTED_WINDOWS_BUILD_TARGETS)
}

function validateMacBuildTarget(target: unknown, owner: string) {
  validateBuildTarget(target, owner, SUPPORTED_MAC_BUILD_TARGETS)
}

function validateLinuxBuildTarget(target: unknown, owner: string) {
  validateBuildTarget(target, owner, SUPPORTED_LINUX_BUILD_TARGETS)
}

function validateBuild(build: unknown) {
  if (!build || typeof build !== 'object' || Array.isArray(build)) {
    throw new Error('[Frontron] "build" must be an object.')
  }

  const candidate = build as {
    outputDir?: unknown
    artifactName?: unknown
    publish?: unknown
    asar?: unknown
    compression?: unknown
    files?: unknown
    extraResources?: unknown
    extraFiles?: unknown
    windows?: unknown
    nsis?: unknown
    mac?: unknown
    linux?: unknown
  }

  if (typeof candidate.outputDir !== 'undefined') {
    validateOptionalString(candidate.outputDir, '"build.outputDir"')
  }

  if (typeof candidate.artifactName !== 'undefined') {
    validateOptionalString(candidate.artifactName, '"build.artifactName"')
  }

  if (typeof candidate.publish !== 'undefined') {
    if (
      typeof candidate.publish !== 'string' ||
      !SUPPORTED_PUBLISH_MODES.includes(candidate.publish as FrontronPublishMode)
    ) {
      throw new Error(
        `[Frontron] "build.publish" must be one of: ${SUPPORTED_PUBLISH_MODES.join(', ')}.`,
      )
    }
  }

  if (typeof candidate.asar !== 'undefined') {
    validateOptionalBoolean(candidate.asar, '"build.asar"')
  }

  if (typeof candidate.compression !== 'undefined') {
    if (
      typeof candidate.compression !== 'string' ||
      !SUPPORTED_BUILD_COMPRESSIONS.includes(candidate.compression as FrontronBuildCompression)
    ) {
      throw new Error(
        `[Frontron] "build.compression" must be one of: ${SUPPORTED_BUILD_COMPRESSIONS.join(', ')}.`,
      )
    }
  }

  if (typeof candidate.files !== 'undefined') {
    validateBuildFilePatterns(candidate.files, '"build.files"')
  }

  if (typeof candidate.extraResources !== 'undefined') {
    validateBuildFilePatterns(candidate.extraResources, '"build.extraResources"')
  }

  if (typeof candidate.extraFiles !== 'undefined') {
    validateBuildFilePatterns(candidate.extraFiles, '"build.extraFiles"')
  }

  if (typeof candidate.nsis !== 'undefined') {
    if (!candidate.nsis || typeof candidate.nsis !== 'object' || Array.isArray(candidate.nsis)) {
      throw new Error('[Frontron] "build.nsis" must be an object.')
    }

    const nsis = candidate.nsis as {
      oneClick?: unknown
      perMachine?: unknown
      allowToChangeInstallationDirectory?: unknown
      deleteAppDataOnUninstall?: unknown
      installerIcon?: unknown
      uninstallerIcon?: unknown
    }

    if (typeof nsis.oneClick !== 'undefined') {
      validateOptionalBoolean(nsis.oneClick, '"build.nsis.oneClick"')
    }

    if (typeof nsis.perMachine !== 'undefined') {
      validateOptionalBoolean(nsis.perMachine, '"build.nsis.perMachine"')
    }

    if (typeof nsis.allowToChangeInstallationDirectory !== 'undefined') {
      validateOptionalBoolean(
        nsis.allowToChangeInstallationDirectory,
        '"build.nsis.allowToChangeInstallationDirectory"',
      )
    }

    if (typeof nsis.deleteAppDataOnUninstall !== 'undefined') {
      validateOptionalBoolean(
        nsis.deleteAppDataOnUninstall,
        '"build.nsis.deleteAppDataOnUninstall"',
      )
    }

    if (typeof nsis.installerIcon !== 'undefined') {
      validateOptionalString(nsis.installerIcon, '"build.nsis.installerIcon"')
    }

    if (typeof nsis.uninstallerIcon !== 'undefined') {
      validateOptionalString(nsis.uninstallerIcon, '"build.nsis.uninstallerIcon"')
    }
  }

  if (typeof candidate.windows !== 'undefined') {
    if (!candidate.windows || typeof candidate.windows !== 'object' || Array.isArray(candidate.windows)) {
      throw new Error('[Frontron] "build.windows" must be an object.')
    }

    const windows = candidate.windows as {
      targets?: unknown
      icon?: unknown
      publisherName?: unknown
      signAndEditExecutable?: unknown
      requestedExecutionLevel?: unknown
      artifactName?: unknown
    }

    if (typeof windows.targets !== 'undefined') {
      validateBuildTargetList(
        windows.targets,
        '"build.windows.targets"',
        validateWindowsBuildTarget,
      )
    }

    if (typeof windows.icon !== 'undefined') {
      validateOptionalString(windows.icon, '"build.windows.icon"')
    }

    if (typeof windows.publisherName !== 'undefined') {
      if (typeof windows.publisherName === 'string') {
        validateOptionalString(windows.publisherName, '"build.windows.publisherName"')
      } else {
        validateStringArray(windows.publisherName, '"build.windows.publisherName"')
      }
    }

    if (typeof windows.signAndEditExecutable !== 'undefined') {
      validateOptionalBoolean(
        windows.signAndEditExecutable,
        '"build.windows.signAndEditExecutable"',
      )
    }

    if (typeof windows.requestedExecutionLevel !== 'undefined') {
      if (
        typeof windows.requestedExecutionLevel !== 'string' ||
        !SUPPORTED_REQUESTED_EXECUTION_LEVELS.includes(
          windows.requestedExecutionLevel as FrontronRequestedExecutionLevel,
        )
      ) {
        throw new Error(
          `[Frontron] "build.windows.requestedExecutionLevel" must be one of: ${SUPPORTED_REQUESTED_EXECUTION_LEVELS.join(', ')}.`,
        )
      }
    }

    if (typeof windows.artifactName !== 'undefined') {
      validateOptionalString(windows.artifactName, '"build.windows.artifactName"')
    }
  }

  if (typeof candidate.mac !== 'undefined') {
    if (!candidate.mac || typeof candidate.mac !== 'object' || Array.isArray(candidate.mac)) {
      throw new Error('[Frontron] "build.mac" must be an object.')
    }

    const mac = candidate.mac as {
      targets?: unknown
      icon?: unknown
      category?: unknown
      artifactName?: unknown
    }

    if (typeof mac.targets !== 'undefined') {
      validateBuildTargetList(mac.targets, '"build.mac.targets"', validateMacBuildTarget)
    }

    if (typeof mac.icon !== 'undefined') {
      validateOptionalString(mac.icon, '"build.mac.icon"')
    }

    if (typeof mac.category !== 'undefined') {
      validateOptionalString(mac.category, '"build.mac.category"')
    }

    if (typeof mac.artifactName !== 'undefined') {
      validateOptionalString(mac.artifactName, '"build.mac.artifactName"')
    }
  }

  if (typeof candidate.linux !== 'undefined') {
    if (!candidate.linux || typeof candidate.linux !== 'object' || Array.isArray(candidate.linux)) {
      throw new Error('[Frontron] "build.linux" must be an object.')
    }

    const linux = candidate.linux as {
      targets?: unknown
      icon?: unknown
      category?: unknown
      packageCategory?: unknown
      artifactName?: unknown
    }

    if (typeof linux.targets !== 'undefined') {
      validateBuildTargetList(
        linux.targets,
        '"build.linux.targets"',
        validateLinuxBuildTarget,
      )
    }

    if (typeof linux.icon !== 'undefined') {
      validateOptionalString(linux.icon, '"build.linux.icon"')
    }

    if (typeof linux.category !== 'undefined') {
      validateOptionalString(linux.category, '"build.linux.category"')
    }

    if (typeof linux.packageCategory !== 'undefined') {
      validateOptionalString(linux.packageCategory, '"build.linux.packageCategory"')
    }

    if (typeof linux.artifactName !== 'undefined') {
      validateOptionalString(linux.artifactName, '"build.linux.artifactName"')
    }
  }
}

function validateRust(rust: unknown) {
  if (typeof rust === 'boolean') {
    return
  }

  if (!rust || typeof rust !== 'object' || Array.isArray(rust)) {
    throw new Error('[Frontron] "rust" must be a boolean or object.')
  }

  const candidate = rust as {
    enabled?: unknown
    bridge?: unknown
  }

  if (typeof candidate.enabled !== 'undefined' && typeof candidate.enabled !== 'boolean') {
    throw new Error('[Frontron] "rust.enabled" must be a boolean.')
  }

  if (typeof candidate.bridge !== 'undefined') {
    validateRustBridge(candidate.bridge)
  }
}

function validateRustValueType(value: unknown, owner: string) {
  if (
    typeof value !== 'string' ||
    !SUPPORTED_RUST_VALUE_TYPES.includes(value as FrontronRustValueType)
  ) {
    throw new Error(
      `[Frontron] ${owner} must be one of: ${SUPPORTED_RUST_VALUE_TYPES.join(', ')}.`,
    )
  }
}

function validateRustBridge(bridge: unknown) {
  if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge)) {
    throw new Error('[Frontron] "rust.bridge" must be an object of namespaces.')
  }

  for (const [namespace, methods] of Object.entries(bridge as FrontronRustBridgeConfig)) {
    if (!methods || typeof methods !== 'object' || Array.isArray(methods)) {
      throw new Error(
        `[Frontron] Rust bridge namespace "${namespace}" must be an object of bindings.`,
      )
    }

    for (const [methodName, binding] of Object.entries(methods)) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
        throw new Error(
          `[Frontron] Rust bridge binding "${namespace}.${methodName}" must be an object.`,
        )
      }

      const candidate = binding as {
        symbol?: unknown
        args?: unknown
        returns?: unknown
      }

      if (typeof candidate.symbol !== 'string' || candidate.symbol.trim().length === 0) {
        throw new Error(
          `[Frontron] Rust bridge binding "${namespace}.${methodName}.symbol" must be a non-empty string.`,
        )
      }

      if (typeof candidate.args !== 'undefined') {
        if (!Array.isArray(candidate.args)) {
          throw new Error(
            `[Frontron] Rust bridge binding "${namespace}.${methodName}.args" must be an array.`,
          )
        }

        for (const [index, arg] of candidate.args.entries()) {
          if (arg === 'void') {
            throw new Error(
              `[Frontron] Rust bridge binding "${namespace}.${methodName}.args[${index}]" cannot use "void".`,
            )
          }

          validateRustValueType(
            arg,
            `Rust bridge binding "${namespace}.${methodName}.args[${index}]"`,
          )
        }
      }

      if (typeof candidate.returns !== 'undefined') {
        validateRustValueType(
          candidate.returns,
          `Rust bridge binding "${namespace}.${methodName}.returns"`,
        )
      }
    }
  }
}

function validateBaseConfig(config: unknown): asserts config is FrontronConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('[Frontron] The config must export an object.')
  }

  const candidate = config as Partial<FrontronConfig>

  if (!candidate.app || typeof candidate.app !== 'object') {
    throw new Error('[Frontron] Missing required "app" config.')
  }

  if (typeof candidate.app.name !== 'string' || candidate.app.name.length === 0) {
    throw new Error('[Frontron] Missing required "app.name" string.')
  }

  if (typeof candidate.app.id !== 'string' || candidate.app.id.length === 0) {
    throw new Error('[Frontron] Missing required "app.id" string.')
  }

  if (typeof candidate.app.description !== 'undefined') {
    validateOptionalString(candidate.app.description, '"app.description"')
  }

  if (typeof candidate.app.author !== 'undefined') {
    validateOptionalString(candidate.app.author, '"app.author"')
  }

  if (typeof candidate.app.copyright !== 'undefined') {
    validateOptionalString(candidate.app.copyright, '"app.copyright"')
  }

  if (typeof candidate.bridge !== 'undefined') {
    if (!candidate.bridge || typeof candidate.bridge !== 'object' || Array.isArray(candidate.bridge)) {
      throw new Error('[Frontron] "bridge" must be an object of namespaces.')
    }

    for (const [namespace, methods] of Object.entries(candidate.bridge)) {
      if (!methods || typeof methods !== 'object' || Array.isArray(methods)) {
        throw new Error(
          `[Frontron] Bridge namespace "${namespace}" must be an object of handlers.`,
        )
      }

      for (const [methodName, handler] of Object.entries(methods)) {
        if (typeof handler !== 'function') {
          throw new Error(
            `[Frontron] Bridge handler "${namespace}.${methodName}" must be a function.`,
          )
        }
      }
    }
  }

  if (typeof candidate.menu !== 'undefined') {
    validateMenuItems(candidate.menu, '"menu"')
  }

  if (typeof candidate.tray !== 'undefined') {
    if (!candidate.tray || typeof candidate.tray !== 'object' || Array.isArray(candidate.tray)) {
      throw new Error('[Frontron] "tray" must be an object.')
    }

    const tray = candidate.tray as {
      items?: unknown
      onClick?: unknown
    }

    if (typeof tray.onClick !== 'undefined' && typeof tray.onClick !== 'function') {
      throw new Error('[Frontron] "tray.onClick" must be a function.')
    }

    if (typeof tray.items !== 'undefined') {
      validateMenuItems(tray.items, '"tray.items"')
    }
  }

  if (typeof candidate.hooks !== 'undefined') {
    validateHooks(candidate.hooks)
  }

  if (typeof candidate.build !== 'undefined') {
    validateBuild(candidate.build)
  }

  if (typeof candidate.windows !== 'undefined') {
    validateWindows(candidate.windows)
  }

  if (typeof candidate.rust !== 'undefined') {
    validateRust(candidate.rust)
  }
}

function validateResolvedRust(rust: ResolvedFrontronConfig['rust']) {
  if (!rust?.enabled) {
    return
  }

  if (!existsSync(rust.cargoTomlPath)) {
    throw new Error(
      `[Frontron] Rust is enabled but Cargo.toml was not found in the official slot: ${rust.cargoTomlPath}`,
    )
  }

  if (!existsSync(rust.libRsPath)) {
    throw new Error(
      `[Frontron] Rust is enabled but src/lib.rs was not found in the official slot: ${rust.libRsPath}`,
    )
  }
}

function resolveExtensionlessSpecifier(specifier: string, parentUrl: string | undefined) {
  if (!parentUrl || !isFileUrl(parentUrl)) {
    return null
  }

  const parentPath = fileURLToPath(parentUrl)
  const basePath = resolve(dirname(parentPath), specifier)
  const candidates = [
    ...SUPPORTED_FILE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...SUPPORTED_FILE_EXTENSIONS.map((extension) => join(basePath, `index${extension}`)),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href
    }
  }

  return null
}

function registerTypeScriptHooks() {
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (isRelativeSpecifier(specifier) && extname(specifier).length === 0) {
        const resolvedUrl = resolveExtensionlessSpecifier(specifier, context.parentURL)

        if (resolvedUrl) {
          return {
            shortCircuit: true,
            url: resolvedUrl,
          }
        }
      }

      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (!isFileUrl(url)) {
        return nextLoad(url, context)
      }

      const filePath = fileURLToPath(url)

      if (!SUPPORTED_FILE_EXTENSIONS.includes(extname(filePath)) || isNodeModulesPath(filePath)) {
        return nextLoad(url, context)
      }

      if (!filePath.endsWith('.ts') && !filePath.endsWith('.mts') && !filePath.endsWith('.cts')) {
        return nextLoad(url, context)
      }

      const source = readFileSync(filePath, 'utf8')

      return {
        format: inferModuleFormat(filePath),
        shortCircuit: true,
        source: stripTypeScriptTypes(source, {
          mode: 'transform',
        }),
      }
    },
  })
}

export function defineConfig<T extends FrontronConfig>(config: T): T {
  return config
}

export function findConfigPath(options: LoadConfigOptions = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())

  if (options.configFile) {
    const explicitPath = resolve(cwd, options.configFile)

    if (!existsSync(explicitPath)) {
      throw new Error(`[Frontron] Config file not found: ${explicitPath}`)
    }

    return explicitPath
  }

  let currentDir = cwd

  while (true) {
    const candidate = join(currentDir, OFFICIAL_CONFIG_FILE)

    if (existsSync(candidate)) {
      return candidate
    }

    const parentDir = dirname(currentDir)

    if (parentDir === currentDir) {
      return null
    }

    currentDir = parentDir
  }
}

export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<LoadedFrontronConfig> {
  const configPath = findConfigPath(options)

  if (!configPath) {
    throw new Error(
      `[Frontron] Could not find "${OFFICIAL_CONFIG_FILE}" from ${resolve(options.cwd ?? process.cwd())}.`,
    )
  }

  const hooks = registerTypeScriptHooks()
  const configUrl = `${pathToFileURL(configPath).href}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`

  try {
    const configModule = await import(configUrl)
    const config = (configModule.default ?? configModule) as unknown
    const rootDir = dirname(configPath)

    validateBaseConfig(config)
    const normalizedConfig = normalizeConfig(rootDir, config)
    validateResolvedRust(normalizedConfig.rust)

    return {
      rootDir,
      configPath,
      config: normalizedConfig,
    }
  } finally {
    hooks.deregister()
  }
}
