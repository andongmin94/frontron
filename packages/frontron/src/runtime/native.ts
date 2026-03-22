import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import type {
  FrontronBridgeConfig,
  FrontronNativeStatus,
  FrontronRustBindingConfig,
  FrontronRustBridgeConfig,
  FrontronRustValueType,
  ResolvedFrontronRustConfig,
} from '../types'

const READY_SYMBOL_NAME = 'frontron_native_ready'
const ADD_SYMBOL_NAME = 'frontron_native_add'

interface RustLibrary {
  func(definition: string): (...args: unknown[]) => unknown
}

interface KoffiModuleLike {
  load(path: string): RustLibrary
}

export interface RustRuntimeHandle {
  getStatus(): FrontronNativeStatus
  isReady(): boolean
  add(left: number, right: number): number
  getBridge(): FrontronBridgeConfig
}

function readRustValueType(valueType: FrontronRustValueType) {
  switch (valueType) {
    case 'void':
      return 'void'
    case 'int':
      return 'int'
    case 'double':
      return 'double'
    case 'bool':
      return 'bool'
    case 'string':
      return 'string'
    default:
      return 'void'
  }
}

function readRequiredArgumentCount(binding: FrontronRustBindingConfig) {
  return binding.args?.length ?? 0
}

function readFiniteNumber(
  value: unknown,
  owner: string,
  integer: boolean,
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`[Frontron] Native bridge method "${owner}" requires a finite number.`)
  }

  if (integer && !Number.isInteger(value)) {
    throw new Error(`[Frontron] Native bridge method "${owner}" requires an integer.`)
  }

  return value
}

function normalizeRustInputValue(
  namespace: string,
  methodName: string,
  valueType: FrontronRustValueType,
  value: unknown,
  index: number,
) {
  const owner = `${namespace}.${methodName}(arg${index + 1})`

  switch (valueType) {
    case 'int':
      return readFiniteNumber(value, owner, true)
    case 'double':
      return readFiniteNumber(value, owner, false)
    case 'bool':
      if (typeof value !== 'boolean') {
        throw new Error(`[Frontron] Native bridge method "${owner}" requires a boolean.`)
      }

      return value
    case 'string':
      if (typeof value !== 'string') {
        throw new Error(`[Frontron] Native bridge method "${owner}" requires a string.`)
      }

      return value
    case 'void':
      throw new Error(`[Frontron] Native bridge method "${owner}" cannot use "void" arguments.`)
    default:
      return value
  }
}

function normalizeRustOutputValue(
  namespace: string,
  methodName: string,
  valueType: FrontronRustValueType,
  value: unknown,
) {
  const owner = `${namespace}.${methodName}()`

  switch (valueType) {
    case 'void':
      return null
    case 'int':
      return readFiniteNumber(value, owner, true)
    case 'double':
      return readFiniteNumber(value, owner, false)
    case 'bool':
      if (typeof value === 'boolean') {
        return value
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        return value !== 0
      }

      throw new Error(`[Frontron] Native bridge method "${owner}" returned a non-boolean value.`)
    case 'string':
      if (typeof value !== 'string') {
        throw new Error(`[Frontron] Native bridge method "${owner}" returned a non-string value.`)
      }

      return value
    default:
      return value
  }
}

function createRustBindingHandler(
  rust: ResolvedFrontronRustConfig,
  namespace: string,
  methodName: string,
  binding: FrontronRustBindingConfig,
  library: RustLibrary | undefined,
) {
  if (!rust.enabled) {
    return async () => {
      throw new Error(
        `[Frontron] Native bridge method "${namespace}.${methodName}" is unavailable because rust.enabled is false.`,
      )
    }
  }

  if (!library) {
    return async () => {
      throw new Error(
        `[Frontron] Native bridge method "${namespace}.${methodName}" is unavailable because the Rust runtime is not loaded.`,
      )
    }
  }

  const args = (binding.args ?? []).map(readRustValueType)
  const runtimeInputTypes = binding.args ?? []
  const runtimeReturnType = binding.returns ?? 'void'
  const returnType = readRustValueType(runtimeReturnType)
  const definition = `${returnType} ${binding.symbol}(${args.length === 0 ? 'void' : args.join(', ')})`

  try {
    const nativeFunction = library.func(definition)

    return async (...input: unknown[]) => {
      const expectedArgumentCount = readRequiredArgumentCount(binding)

      if (input.length !== expectedArgumentCount) {
        throw new Error(
          `[Frontron] Native bridge method "${namespace}.${methodName}" requires ${expectedArgumentCount} argument(s), received ${input.length}.`,
        )
      }

      const normalizedInput = runtimeInputTypes.map((valueType, index) =>
        normalizeRustInputValue(namespace, methodName, valueType, input[index], index),
      )
      const result = nativeFunction(...normalizedInput)

      return normalizeRustOutputValue(namespace, methodName, runtimeReturnType, result)
    }
  } catch {
    return async () => {
      throw new Error(
        `[Frontron] Native bridge method "${namespace}.${methodName}" is unavailable. Export "${binding.symbol}" from ${rust.libRsPath}.`,
      )
    }
  }
}

function createRustBridge(
  bridgeConfig: FrontronRustBridgeConfig | undefined,
  rust: ResolvedFrontronRustConfig,
  library?: RustLibrary,
): FrontronBridgeConfig {
  if (!bridgeConfig) {
    return {}
  }

  const bridge: FrontronBridgeConfig = {}

  for (const [namespace, methods] of Object.entries(bridgeConfig)) {
    bridge[namespace] = {}

    for (const [methodName, binding] of Object.entries(methods)) {
      bridge[namespace][methodName] = createRustBindingHandler(
        rust,
        namespace,
        methodName,
        binding,
        library,
      )
    }
  }

  return bridge
}

function createDisabledRustRuntime(rust?: ResolvedFrontronRustConfig): RustRuntimeHandle {
  const enabled = rust?.enabled ?? false
  const bridge = rust ? createRustBridge(rust.bridge, rust) : {}

  return {
    getStatus() {
      return {
        enabled,
        loaded: false,
        ready: false,
      }
    },
    isReady() {
      return false
    },
    add() {
      throw new Error(
        enabled
          ? '[Frontron] Native bridge method "native.add" is unavailable because the Rust runtime is not loaded.'
          : '[Frontron] Native bridge method "native.add" is unavailable because rust.enabled is false.',
      )
    },
    getBridge() {
      return bridge
    },
  }
}

export function loadKoffiModule(): KoffiModuleLike {
  const require = createRequire(import.meta.url)
  return require('koffi') as KoffiModuleLike
}

export function readRustPackageName(cargoTomlPath: string) {
  const source = readFileSync(cargoTomlPath, 'utf8')
  const lines = source.split(/\r?\n/)
  let inPackageSection = false

  for (const line of lines) {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue
    }

    if (trimmedLine.startsWith('[')) {
      inPackageSection = trimmedLine === '[package]'
      continue
    }

    if (!inPackageSection) {
      continue
    }

    const match = /^name\s*=\s*"([^"]+)"$/.exec(trimmedLine)

    if (match?.[1]) {
      return match[1]
    }
  }

  throw new Error(`[Frontron] Could not read the Rust package name from ${cargoTomlPath}`)
}

export function resolveRustArtifactBasename(
  packageName: string,
  platform = process.platform,
) {
  if (platform === 'win32') {
    return `${packageName}.dll`
  }

  if (platform === 'darwin') {
    return `lib${packageName}.dylib`
  }

  return `lib${packageName}.so`
}

export function resolveRustArtifactPath(
  rust: ResolvedFrontronRustConfig,
  mode: 'development' | 'production',
  platform = process.platform,
) {
  const profile = mode === 'production' ? 'release' : 'debug'
  const packageName = readRustPackageName(rust.cargoTomlPath)
  const artifactBasename = resolveRustArtifactBasename(packageName, platform)

  return join(rust.path, 'target', profile, artifactBasename)
}

export function loadRustRuntime(
  rust: ResolvedFrontronRustConfig | undefined,
  mode: 'development' | 'production',
  koffi?: KoffiModuleLike,
): RustRuntimeHandle {
  if (!rust) {
    return createDisabledRustRuntime()
  }

  if (!rust.enabled) {
    return createDisabledRustRuntime(rust)
  }

  const artifactPath = resolveRustArtifactPath(rust, mode)

  if (!existsSync(artifactPath)) {
    const rustCommand = mode === 'production' ? 'cargo build --release' : 'cargo build'

    throw new Error(
      `[Frontron] Rust native artifact not found: ${artifactPath}. Run "${rustCommand}" in ${rust.path}.`,
    )
  }

  const library = (koffi ?? loadKoffiModule()).load(artifactPath)
  let readyFunction: (() => unknown) | null = null
  let addFunction: ((left: number, right: number) => unknown) | null = null

  try {
    readyFunction = library.func(`int ${READY_SYMBOL_NAME}(void)`) as () => unknown
  } catch {
    readyFunction = null
  }

  try {
    addFunction = library.func(`int ${ADD_SYMBOL_NAME}(int, int)`) as (
      left: number,
      right: number,
    ) => unknown
  } catch {
    addFunction = null
  }

  const readReady = () => {
    if (!readyFunction) {
      return false
    }

    return Number(readyFunction()) !== 0
  }

  const rustBridge = createRustBridge(rust.bridge, rust, library)

  return {
    getStatus() {
      return {
        enabled: true,
        loaded: true,
        ready: readReady(),
        artifactPath,
        symbolName: READY_SYMBOL_NAME,
      }
    },
    isReady() {
      return readReady()
    },
    add(left: number, right: number) {
      if (!addFunction) {
        throw new Error(
          `[Frontron] Native bridge method "native.add" is unavailable. Export "${ADD_SYMBOL_NAME}" from ${rust.libRsPath}.`,
        )
      }

      return Number(addFunction(left, right))
    },
    getBridge() {
      return rustBridge
    },
  }
}
