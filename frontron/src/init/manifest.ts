import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { InitConfig } from './shared'
import { normalizePathValue } from './shared'

export const MANIFEST_PATH = '.frontron/manifest.json'

export type FrontronManifest = {
  schemaVersion: 1
  adapter: string
  adapterConfidence: string
  adapterReasons: string[]
  strategy: string
  preset: string
  desktopDir?: string
  appScript?: string
  buildScript?: string
  packageScript?: string
  webDevScript?: string
  webBuildScript?: string
  outDir?: string
  nodeServerSourceRoot?: string | null
  nodeServerEntry?: string | null
  productName?: string
  appId?: string
  createdFiles: string[]
  fileHashes?: Record<string, string>
  scripts: string[]
  scriptCommands?: Record<string, string>
  packageJsonClaims?: PackageJsonOwnershipClaim[]
}

export type PackageJsonOwnershipClaim = {
  path: string
  action?: 'set' | 'array-value'
  value: unknown
  previous:
    | {
        state: 'missing'
      }
    | {
        state: 'value'
        value: unknown
      }
}

export function normalizeManifestPath(cwd: string, filePath: string) {
  return normalizePathValue(relative(cwd, filePath), filePath)
}

export function createFileHash(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
  )
}

function isOptionalString(value: unknown) {
  return typeof value === 'undefined' || typeof value === 'string'
}

function isOptionalNullableString(value: unknown) {
  return typeof value === 'undefined' || value === null || typeof value === 'string'
}

function isPackageJsonOwnershipClaim(value: unknown): value is PackageJsonOwnershipClaim {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Partial<PackageJsonOwnershipClaim>
  const previous = candidate.previous

  return (
    typeof candidate.path === 'string' &&
    (typeof candidate.action === 'undefined' ||
      candidate.action === 'set' ||
      candidate.action === 'array-value') &&
    typeof previous === 'object' &&
    previous !== null &&
    !Array.isArray(previous) &&
    ((previous as { state?: unknown }).state === 'missing' ||
      (previous as { state?: unknown }).state === 'value')
  )
}

export function createManifest(
  config: InitConfig,
  fileSources: Map<string, string>,
  extraFilePaths: string[] = [],
  scriptCommands: Record<string, string> = {},
  packageJsonClaims: PackageJsonOwnershipClaim[] = [],
): FrontronManifest {
  const fileHashes: Record<string, string> = {}

  for (const [filePath, source] of fileSources) {
    fileHashes[normalizeManifestPath(config.cwd, filePath)] = createFileHash(source)
  }

  return {
    schemaVersion: 1,
    adapter: config.adapter,
    adapterConfidence: config.adapterConfidence,
    adapterReasons: config.adapterReasons,
    strategy: config.runtimeStrategy,
    preset: config.preset,
    desktopDir: config.desktopDir,
    appScript: config.appScript,
    buildScript: config.buildScript,
    packageScript: config.packageScript,
    webDevScript: config.webDevScript,
    webBuildScript: config.webBuildScript,
    outDir: config.outDir,
    nodeServerSourceRoot: config.nodeServerSourceRoot,
    nodeServerEntry: config.nodeServerEntry,
    productName: config.productName,
    appId: config.appId,
    createdFiles: [...fileSources.keys(), ...extraFilePaths].map((filePath) =>
      normalizeManifestPath(config.cwd, filePath),
    ),
    fileHashes,
    scripts: [config.appScript, config.buildScript, config.packageScript],
    scriptCommands,
    packageJsonClaims,
  }
}

export function renderManifestSource(manifest: FrontronManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function readManifest(cwd: string) {
  const manifestPath = join(cwd, MANIFEST_PATH)

  if (!existsSync(manifestPath)) {
    return null
  }

  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<FrontronManifest>

  if (
    !Array.isArray(parsed.createdFiles) ||
    parsed.createdFiles.some((entry) => typeof entry !== 'string') ||
    !Array.isArray(parsed.scripts) ||
    parsed.scripts.some((entry) => typeof entry !== 'string') ||
    !isOptionalString(parsed.desktopDir) ||
    !isOptionalString(parsed.appScript) ||
    !isOptionalString(parsed.buildScript) ||
    !isOptionalString(parsed.packageScript) ||
    !isOptionalString(parsed.webDevScript) ||
    !isOptionalString(parsed.webBuildScript) ||
    !isOptionalString(parsed.outDir) ||
    !isOptionalNullableString(parsed.nodeServerSourceRoot) ||
    !isOptionalNullableString(parsed.nodeServerEntry) ||
    !isOptionalString(parsed.productName) ||
    !isOptionalString(parsed.appId) ||
    (typeof parsed.fileHashes !== 'undefined' && !isStringRecord(parsed.fileHashes)) ||
    (typeof parsed.scriptCommands !== 'undefined' && !isStringRecord(parsed.scriptCommands)) ||
    (typeof parsed.packageJsonClaims !== 'undefined' &&
      (!Array.isArray(parsed.packageJsonClaims) ||
        parsed.packageJsonClaims.some((entry) => !isPackageJsonOwnershipClaim(entry))))
  ) {
    throw new Error(`${MANIFEST_PATH} is invalid.`)
  }

  return parsed as FrontronManifest
}

export function readExistingManifest(cwd: string) {
  const manifestPath = join(cwd, MANIFEST_PATH)

  if (!existsSync(manifestPath)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<FrontronManifest>

    if (!Array.isArray(parsed.createdFiles) || !Array.isArray(parsed.scripts)) {
      return null
    }

    return {
      createdFiles: new Set(
        parsed.createdFiles.filter((entry): entry is string => typeof entry === 'string'),
      ),
      scripts: new Set(parsed.scripts.filter((entry): entry is string => typeof entry === 'string')),
    }
  } catch {
    return null
  }
}

export function splitFileConflicts(
  cwd: string,
  conflicts: string[],
  force: boolean,
  existingManifest: ReturnType<typeof readExistingManifest>,
) {
  const manifestFiles = force ? existingManifest : null
  const safeToOverwrite: string[] = []
  const blocked: string[] = []

  for (const filePath of conflicts) {
    const relativePath = normalizeManifestPath(cwd, filePath)

    if (manifestFiles?.createdFiles.has(relativePath)) {
      safeToOverwrite.push(filePath)
    } else {
      blocked.push(filePath)
    }
  }

  return { safeToOverwrite, blocked }
}
