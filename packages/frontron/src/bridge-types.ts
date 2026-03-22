import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'

import type { LoadedFrontronConfig } from './types'

export const GENERATED_BRIDGE_TYPES_RELATIVE_PATH = join(
  '.frontron',
  'types',
  'frontron-client.d.ts',
)

function renderMethodNames(methods: Record<string, unknown>) {
  const methodNames = Object.keys(methods).sort()

  if (methodNames.length === 0) {
    return ['      // No custom methods are registered yet.']
  }

  return methodNames.map(
    (methodName) =>
      `      ${JSON.stringify(methodName)}: (...args: unknown[]) => Promise<unknown>`,
  )
}

function renderNamespace(namespace: string, methods: Record<string, unknown>) {
  return [
    `    ${JSON.stringify(namespace)}: {`,
    ...renderMethodNames(methods),
    '    }',
  ]
}

export function getGeneratedBridgeTypesPath(rootDir: string) {
  return join(rootDir, GENERATED_BRIDGE_TYPES_RELATIVE_PATH)
}

function toTypeImportSpecifier(fromFilePath: string, targetFilePath: string) {
  const relativePath = relative(dirname(fromFilePath), targetFilePath).replace(/\\/g, '/')
  const withoutExtension = relativePath.slice(0, relativePath.length - extname(relativePath).length)

  if (withoutExtension.startsWith('.')) {
    return withoutExtension
  }

  return `./${withoutExtension}`
}

export function renderBridgeTypes(loadedConfig: LoadedFrontronConfig) {
  const generatedTypesPath = getGeneratedBridgeTypesPath(loadedConfig.rootDir)
  const importSpecifier = toTypeImportSpecifier(generatedTypesPath, loadedConfig.configPath)
  const namespaceMap = new Map<string, Record<string, unknown>>()

  for (const [namespace, methods] of Object.entries(loadedConfig.config.rust?.bridge ?? {})) {
    namespaceMap.set(namespace, { ...methods })
  }

  for (const [namespace, methods] of Object.entries(loadedConfig.config.bridge ?? {})) {
    namespaceMap.set(namespace, {
      ...(namespaceMap.get(namespace) ?? {}),
      ...methods,
    })
  }

  const namespaces = [...namespaceMap.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )

  const lines = [
    `type FrontronConfigModule = typeof import(${JSON.stringify(importSpecifier)})`,
    'type FrontronConfigValue = FrontronConfigModule extends { default: infer Default } ? Default : never',
    'type FrontronBridgeSource = FrontronConfigValue extends { bridge: infer Bridge } ? Bridge : unknown',
    'type FrontronRustConfigValue = FrontronConfigValue extends { rust: infer Rust } ? Rust : unknown',
    'type FrontronRustBridgeSource = FrontronRustConfigValue extends { bridge: infer Bridge } ? Bridge : unknown',
    'type FrontronBridgeMethod<T> = T extends (...args: infer Args) => infer Result',
    '  ? (...args: Args) => Promise<Awaited<Result>>',
    '  : never',
    'type FrontronBridgeNamespace<T> = {',
    '  [Method in keyof T]: FrontronBridgeMethod<T[Method]>',
    '}',
    'type FrontronBridgeMap<T> = {',
    '  [Namespace in keyof T]: T[Namespace] extends Record<string, unknown>',
    '    ? FrontronBridgeNamespace<T[Namespace]>',
    '    : never',
    '}',
    "type FrontronRustPrimitive<T extends string> = T extends 'int' | 'double'",
    '  ? number',
    "  : T extends 'bool'",
    '    ? boolean',
    "    : T extends 'string'",
    '      ? string',
    '      : null',
    'type FrontronRustBindingArgs<T> = T extends { args: infer Args extends readonly string[] }',
    '  ? { [Index in keyof Args]: FrontronRustPrimitive<Args[Index] & string> }',
    '  : []',
    'type FrontronRustBindingReturn<T> = T extends { returns: infer ReturnType extends string }',
    '  ? FrontronRustPrimitive<ReturnType>',
    '  : null',
    'type FrontronRustBridgeMethod<T> = (...args: FrontronRustBindingArgs<T>) => Promise<FrontronRustBindingReturn<T>>',
    'type FrontronRustBridgeNamespace<T> = {',
    '  [Method in keyof T]: FrontronRustBridgeMethod<T[Method]>',
    '}',
    'type FrontronRustBridgeMap<T> = {',
    '  [Namespace in keyof T]: T[Namespace] extends Record<string, unknown>',
    '    ? FrontronRustBridgeNamespace<T[Namespace]>',
    '    : never',
    '}',
    '',
    "declare module 'frontron/client' {",
    '  interface FrontronGeneratedBridge extends FrontronBridgeMap<FrontronBridgeSource>, FrontronRustBridgeMap<FrontronRustBridgeSource> {',
  ]

  if (namespaces.length === 0) {
    lines.push('    // No custom bridge namespaces are registered yet.')
  } else {
    for (const [namespace, methods] of namespaces) {
      lines.push(...renderNamespace(namespace, methods))
    }
  }

  lines.push('  }')
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

export function writeBridgeTypes(loadedConfig: LoadedFrontronConfig) {
  const filePath = getGeneratedBridgeTypesPath(loadedConfig.rootDir)

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, renderBridgeTypes(loadedConfig))

  return filePath
}
