import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type {
  FrontronConfig,
  FrontronRustBridgeConfig,
  FrontronRustValueType,
  LoadConfigOptions,
  LoadedFrontronConfig,
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

  if (extension === '.mts' || extension === '.mjs') {
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
