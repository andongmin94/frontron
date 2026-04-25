import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { CliOutput } from '../cli'

export type PackageJson = {
  name?: string
  version?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  build?: {
    appId?: string
    productName?: string
    files?: unknown
    asarUnpack?: unknown
    directories?: {
      output?: string
    }
    extraMetadata?: Record<string, unknown>
    [key: string]: unknown
  }
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

export interface InitPrompter {
  text(message: string, defaultValue: string): Promise<string>
  confirm(message: string, defaultValue: boolean): Promise<boolean>
  close(): Promise<void> | void
}

export interface InitContext {
  cwd: string
  output: CliOutput
  prompter?: InitPrompter
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
}

export interface InitOptions {
  yes: boolean
  force: boolean
  dryRun?: boolean
  adapter?: string
  desktopDir?: string
  appScript?: string
  buildScript?: string
  packageScript?: string
  webDevScript?: string
  webBuildScript?: string
  outDir?: string
  serverRoot?: string
  serverEntry?: string
  productName?: string
  appId?: string
  preset?: string
}

export type InitPreset = 'minimal' | 'starter-like'
export type InitAdapterId =
  | 'generic-static'
  | 'next-export'
  | 'next-standalone'
  | 'nuxt-node-server'
  | 'remix-node-server'
  | 'sveltekit-static'
  | 'sveltekit-node'
  | 'generic-node-server'

export type RuntimeStrategy = 'static-export' | 'node-server'
export type AdapterConfidence = 'high' | 'medium' | 'low'

export type AdapterDetectionResult = {
  matched: boolean
  confidence: AdapterConfidence
  reasons: string[]
  warnings: string[]
}

export type CopyTarget = {
  from: string
  to: string
}

export type AdapterDefaults = {
  webDevScript: string
  webBuildScript: string
  outDir: string | null
  nodeServerSourceRoot?: string | null
  nodeServerEntry?: string | null
  nodeServerCopyTargets?: CopyTarget[]
}

export type InitAdapter = {
  id: InitAdapterId
  runtimeStrategy: RuntimeStrategy
  detect(cwd: string, packageJson: PackageJson): AdapterDetectionResult
  inferDefaults(cwd: string, packageJson: PackageJson): AdapterDefaults
  resolveBuildCommand(packageJson: PackageJson, webBuildScript: string): string
}

export interface InitConfig {
  cwd: string
  packageJson: PackageJson
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  adapter: InitAdapterId
  adapterConfidence: AdapterConfidence
  adapterReasons: string[]
  runtimeStrategy: RuntimeStrategy
  desktopDir: string
  appScript: string
  buildScript: string
  packageScript: string
  webDevScript: string
  webBuildScript: string
  webBuildCommand: string
  outDir: string
  nodeServerSourceRoot: string | null
  nodeServerEntry: string | null
  nodeServerCopyTargets: CopyTarget[]
  productName: string
  appId: string
  preset: InitPreset
  allowExtraMetadataMainOverride: boolean
}

export const ELECTRON_VERSION = '^40.1.0'
export const ELECTRON_BUILDER_VERSION = '^26.0.12'
export const TYPESCRIPT_VERSION = '~6.0.2'
export const NODE_TYPES_VERSION = '^25.5.0'

export const VALID_PRESETS: readonly InitPreset[] = ['minimal', 'starter-like']
export const VALID_ADAPTERS: readonly InitAdapterId[] = [
  'generic-static',
  'next-export',
  'next-standalone',
  'nuxt-node-server',
  'remix-node-server',
  'sveltekit-static',
  'sveltekit-node',
  'generic-node-server',
]

export const DEFAULT_NEXT_STANDALONE_OUT_DIR = '.frontron/runtime/next-standalone'
export const DEFAULT_NUXT_NODE_SERVER_OUT_DIR = '.frontron/runtime/nuxt-node-server'
export const DEFAULT_REMIX_NODE_SERVER_OUT_DIR = '.frontron/runtime/remix-node-server'
export const DEFAULT_SVELTEKIT_STATIC_OUT_DIR = 'build'
export const DEFAULT_SVELTEKIT_NODE_OUT_DIR = '.frontron/runtime/sveltekit-node'
export const DEFAULT_GENERIC_NODE_SERVER_OUT_DIR = '.frontron/runtime/node-server'

export function normalizeValue(value: string, fallback: string) {
  const normalized = value.trim()
  return normalized || fallback
}

export function normalizePathValue(value: string, fallback: string) {
  return normalizeValue(value, fallback).replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[\\/]/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function titleCase(value: string) {
  return value
    .replace(/^@/, '')
    .replace(/[\\/]/g, ' ')
    .replace(/[-_.]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function createDefaultAppId(packageName: string) {
  const slug = slugify(packageName || 'desktop-app') || 'desktop-app'
  return `com.local.${slug}`
}

export function normalizePresetValue(
  value: string | undefined,
  fallback: InitPreset = 'minimal',
): InitPreset {
  const normalized = normalizeValue(value ?? fallback, fallback).toLowerCase() as InitPreset

  if (VALID_PRESETS.includes(normalized)) {
    return normalized
  }

  throw new Error(`Unknown preset "${value}". Expected "minimal" or "starter-like".`)
}

export function normalizeAdapterValue(
  value: string | undefined,
  fallback: InitAdapterId = 'generic-static',
): InitAdapterId {
  const normalized = normalizeValue(value ?? fallback, fallback).toLowerCase() as InitAdapterId

  if (VALID_ADAPTERS.includes(normalized)) {
    return normalized
  }

  throw new Error(
    `Unknown adapter "${value}". Expected "generic-static", "next-export", "next-standalone", "nuxt-node-server", "remix-node-server", "sveltekit-static", "sveltekit-node", or "generic-node-server".`,
  )
}

export function usesStarterBridge(preset: InitPreset) {
  return preset === 'starter-like'
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

function parseDeclaredPackageManager(value: unknown): PackageManager | null {
  if (typeof value !== 'string') {
    return null
  }

  const name = value.match(/^(npm|pnpm|yarn|bun)(?:@|$)/)?.[1]
  return name ? (name as PackageManager) : null
}

function inferLockfilePackageManager(cwd: string): PackageManager | null {
  let currentDir = resolve(cwd)

  while (true) {
    if (existsSync(join(currentDir, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(join(currentDir, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(currentDir, 'bun.lockb')) || existsSync(join(currentDir, 'bun.lock'))) return 'bun'
    if (existsSync(join(currentDir, 'package-lock.json')) || existsSync(join(currentDir, 'npm-shrinkwrap.json'))) {
      return 'npm'
    }

    const parentDir = dirname(currentDir)

    if (parentDir === currentDir) {
      break
    }

    currentDir = parentDir
  }

  return null
}

export function inferPackageManager(cwd: string, packageJson?: PackageJson): PackageManager {
  const declaredPackageManager = parseDeclaredPackageManager(packageJson?.packageManager)

  if (declaredPackageManager) {
    return declaredPackageManager
  }

  const lockfilePackageManager = inferLockfilePackageManager(cwd)

  if (lockfilePackageManager) {
    return lockfilePackageManager
  }

  return 'npm'
}
