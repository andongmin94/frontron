import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, relative, win32 } from 'node:path'

import type {
  AdapterConfidence,
  InitAdapterId,
  InitConfig,
  InitTemplateResolvedFrom,
  RuntimeStrategy,
} from './shared'
import { normalizePathValue, VALID_ADAPTERS } from './shared'
import type { YarnRcOwnershipClaim } from './yarnrc-yaml'

export const MANIFEST_PATH = '.frontron/manifest.json'
export const CURRENT_MANIFEST_SCHEMA_VERSION = 2

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

export type FrontronManifest = {
  schemaVersion: typeof CURRENT_MANIFEST_SCHEMA_VERSION
  adapter: InitAdapterId
  adapterConfidence: AdapterConfidence
  adapterReasons: string[]
  strategy: RuntimeStrategy
  desktopDir: string
  appScript: string
  buildScript: string
  packageScript: string
  webDevScript: string
  webBuildScript: string
  outDir: string
  nodeServerSourceRoot: string | null
  nodeServerSourceEntry: string | null
  nodeServerEntry: string | null
  productName: string
  appId: string
  templateSource: 'create-frontron'
  templatePackage: 'create-frontron'
  templateVersion: string
  templateResolvedFrom: InitTemplateResolvedFrom
  createdFiles: string[]
  fileHashes: Record<string, string>
  scripts: string[]
  scriptCommands: Record<string, string>
  packageJsonClaims: PackageJsonOwnershipClaim[]
  tsconfigJsonClaims: PackageJsonOwnershipClaim[]
  pnpmWorkspaceClaims: PackageJsonOwnershipClaim[]
  yarnRcClaims: YarnRcOwnershipClaim[]
}

const VALID_CONFIDENCE = new Set<AdapterConfidence>(['high', 'medium', 'low'])
const VALID_STRATEGIES = new Set<RuntimeStrategy>(['static-export', 'node-server'])
const VALID_TEMPLATE_RESOLUTIONS = new Set<InitTemplateResolvedFrom>(['env', 'repo', 'dependency'])
const FORBIDDEN_CLAIM_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const PACKAGE_JSON_CLAIM_PATH_ALLOWLIST = new Set([
  'version',
  'devDependencies.electron',
  'devDependencies.electron-builder',
  'devDependencies.@types/node',
  'devDependencies.typescript',
  'devDependencies.@remix-run/serve',
  'devDependencies.esbuild',
  'build.appId',
  'build.productName',
  'build.npmRebuild',
  'build.files',
  'build.asarUnpack',
  'build.directories.output',
  'build.extraMetadata.main',
])
const TSCONFIG_JSON_CLAIM_PATH_ALLOWLIST = new Set(['exclude'])
const PNPM_WORKSPACE_CLAIM_PATH_ALLOWLIST = new Set([
  'allowBuilds.electron',
  'allowBuilds.electron-winstaller',
])
const FIXED_CREATED_FILE_PATH_ALLOWLIST = new Set([
  'tsconfig.electron.json',
  'src/types/electron.d.ts',
  MANIFEST_PATH,
])
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export function normalizeManifestPath(cwd: string, filePath: string) {
  return normalizePathValue(relative(cwd, filePath), filePath)
}

export function createFileHash(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function isNormalizedManifestRelativePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.includes('\\') ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value)
  ) {
    return false
  }

  const segments = value.split('/')
  return (
    posix.normalize(value) === value &&
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  )
}

function isAllowedCreatedFilePath(filePath: string, desktopDir: string) {
  if (!isNormalizedManifestRelativePath(filePath)) return false
  if (FIXED_CREATED_FILE_PATH_ALLOWLIST.has(filePath)) return true

  return filePath.startsWith(`${desktopDir}/`)
}

function hasValidManifestFileOwnership(
  createdFilesValue: unknown,
  fileHashesValue: unknown,
  desktopDirValue: unknown,
) {
  if (
    !isStringArray(createdFilesValue) ||
    !isStringRecord(fileHashesValue) ||
    !isNormalizedManifestRelativePath(desktopDirValue)
  ) {
    return false
  }

  const createdFiles = createdFilesValue
  const fileHashes = fileHashesValue
  const desktopDir = desktopDirValue
  const createdFileSet = new Set(createdFiles)
  const generatedFiles = createdFiles.filter((filePath) => filePath !== MANIFEST_PATH)

  return (
    createdFileSet.size === createdFiles.length &&
    createdFileSet.has(MANIFEST_PATH) &&
    createdFiles.every((filePath) => isAllowedCreatedFilePath(filePath, desktopDir)) &&
    generatedFiles.every((filePath) => SHA256_PATTERN.test(fileHashes[filePath] ?? '')) &&
    Object.entries(fileHashes).every(
      ([filePath, hash]) =>
        filePath !== MANIFEST_PATH &&
        generatedFiles.includes(filePath) &&
        SHA256_PATTERN.test(hash),
    )
  )
}

function isSafeClaimPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false

  return value
    .split('.')
    .every((segment) => segment.length > 0 && !FORBIDDEN_CLAIM_PATH_SEGMENTS.has(segment))
}

function isPackageJsonOwnershipClaim(value: unknown): value is PackageJsonOwnershipClaim {
  if (!isRecord(value) || !isSafeClaimPath(value.path)) return false
  if (!Object.prototype.hasOwnProperty.call(value, 'value')) return false
  if (value.action !== undefined && value.action !== 'set' && value.action !== 'array-value') {
    return false
  }
  if (value.action === 'array-value' && typeof value.value !== 'string') return false

  const previous = value.previous
  if (!isRecord(previous)) return false
  if (previous.state === 'missing') return true

  return previous.state === 'value' && Object.prototype.hasOwnProperty.call(previous, 'value')
}

function isClaimArray(value: unknown, pathAllowlist: ReadonlySet<string>) {
  return (
    Array.isArray(value) &&
    value.every(
      (claim) => isPackageJsonOwnershipClaim(claim) && pathAllowlist.has(claim.path),
    )
  )
}

function isYarnRcOwnershipClaim(value: unknown): value is YarnRcOwnershipClaim {
  if (!isRecord(value) || !isRecord(value.previous)) return false

  if (
    typeof value.file !== 'string' ||
    value.file.length === 0 ||
    value.path !== 'nodeLinker' ||
    value.value !== 'node-modules' ||
    typeof value.created !== 'boolean' ||
    typeof value.changed !== 'boolean' ||
    (value.created && value.file !== '.yarnrc.yml')
  ) {
    return false
  }

  const previous = value.previous

  if (previous.state === 'missing') {
    return (
      value.changed === true &&
      typeof previous.previousHadFinalEol === 'boolean' &&
      typeof previous.previousSourceHash === 'string' &&
      SHA256_PATTERN.test(previous.previousSourceHash)
    )
  }

  return (
    previous.state === 'value' &&
    (previous.value === 'pnp' || previous.value === 'node-modules') &&
    typeof previous.source === 'string' &&
    !value.created &&
    (value.changed || previous.value === 'node-modules')
  )
}

function isManifest(value: Record<string, unknown>): value is FrontronManifest {
  const requiredStrings = [
    'desktopDir',
    'appScript',
    'buildScript',
    'packageScript',
    'webDevScript',
    'webBuildScript',
    'outDir',
    'productName',
    'appId',
    'templateVersion',
  ]

  if (
    value.schemaVersion !== CURRENT_MANIFEST_SCHEMA_VERSION ||
    typeof value.adapter !== 'string' ||
    !VALID_ADAPTERS.includes(value.adapter as InitAdapterId) ||
    typeof value.adapterConfidence !== 'string' ||
    !VALID_CONFIDENCE.has(value.adapterConfidence as AdapterConfidence) ||
    !isStringArray(value.adapterReasons) ||
    typeof value.strategy !== 'string' ||
    !VALID_STRATEGIES.has(value.strategy as RuntimeStrategy) ||
    !requiredStrings.every((key) => typeof value[key] === 'string') ||
    (value.nodeServerSourceRoot !== null && typeof value.nodeServerSourceRoot !== 'string') ||
    (value.nodeServerSourceEntry !== null && typeof value.nodeServerSourceEntry !== 'string') ||
    (value.nodeServerEntry !== null && typeof value.nodeServerEntry !== 'string') ||
    value.templateSource !== 'create-frontron' ||
    value.templatePackage !== 'create-frontron' ||
    typeof value.templateResolvedFrom !== 'string' ||
    !VALID_TEMPLATE_RESOLUTIONS.has(value.templateResolvedFrom as InitTemplateResolvedFrom) ||
    !hasValidManifestFileOwnership(value.createdFiles, value.fileHashes, value.desktopDir) ||
    !isStringArray(value.scripts) ||
    new Set(value.scripts).size !== value.scripts.length ||
    !isStringRecord(value.scriptCommands) ||
    !value.scripts.every((scriptName) =>
      Object.prototype.hasOwnProperty.call(value.scriptCommands, scriptName),
    ) ||
    !isClaimArray(value.packageJsonClaims, PACKAGE_JSON_CLAIM_PATH_ALLOWLIST) ||
    !isClaimArray(value.tsconfigJsonClaims, TSCONFIG_JSON_CLAIM_PATH_ALLOWLIST) ||
    !isClaimArray(value.pnpmWorkspaceClaims, PNPM_WORKSPACE_CLAIM_PATH_ALLOWLIST) ||
    !Array.isArray(value.yarnRcClaims) ||
    !value.yarnRcClaims.every(isYarnRcOwnershipClaim)
  ) {
    return false
  }

  return true
}

export function parseManifest(value: unknown): FrontronManifest {
  if (isRecord(value) && value.schemaVersion !== CURRENT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `${MANIFEST_PATH} uses unsupported schema version ${String(value.schemaVersion)}. Remove the old retrofit layer and run "frontron init" again.`,
    )
  }

  if (!isRecord(value) || !isManifest(value)) {
    throw new Error(`${MANIFEST_PATH} is invalid.`)
  }

  return value
}

export function createManifest(
  config: InitConfig,
  fileSources: Map<string, string>,
  extraFilePaths: string[] = [],
  scriptCommands: Record<string, string> = {},
  packageJsonClaims: PackageJsonOwnershipClaim[] = [],
  tsconfigJsonClaims: PackageJsonOwnershipClaim[] = [],
  pnpmWorkspaceClaims: PackageJsonOwnershipClaim[] = [],
  yarnRcClaims: YarnRcOwnershipClaim[] = [],
): FrontronManifest {
  const fileHashes: Record<string, string> = {}

  for (const [filePath, source] of fileSources) {
    fileHashes[normalizeManifestPath(config.cwd, filePath)] = createFileHash(source)
  }

  return {
    schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
    adapter: config.adapter,
    adapterConfidence: config.adapterConfidence,
    adapterReasons: config.adapterReasons,
    strategy: config.runtimeStrategy,
    desktopDir: config.desktopDir,
    appScript: config.appScript,
    buildScript: config.buildScript,
    packageScript: config.packageScript,
    webDevScript: config.webDevScript,
    webBuildScript: config.webBuildScript,
    outDir: config.outDir,
    nodeServerSourceRoot: config.nodeServerSourceRoot,
    nodeServerSourceEntry: config.nodeServerSourceEntry ?? null,
    nodeServerEntry: config.nodeServerEntry,
    productName: config.productName,
    appId: config.appId,
    templateSource: config.templateInfo.source,
    templatePackage: config.templateInfo.packageName,
    templateVersion: config.templateInfo.packageVersion,
    templateResolvedFrom: config.templateInfo.resolvedFrom,
    createdFiles: [...fileSources.keys(), ...extraFilePaths].map((filePath) =>
      normalizeManifestPath(config.cwd, filePath),
    ),
    fileHashes,
    scripts: [config.appScript, config.buildScript, config.packageScript],
    scriptCommands,
    packageJsonClaims,
    tsconfigJsonClaims,
    pnpmWorkspaceClaims,
    yarnRcClaims,
  }
}

export function renderManifestSource(manifest: FrontronManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function readManifest(cwd: string) {
  const manifestPath = join(cwd, MANIFEST_PATH)
  if (!existsSync(manifestPath)) return null

  return parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
}

export function readExistingManifest(cwd: string) {
  try {
    const manifest = readManifest(cwd)
    if (!manifest) return null

    return {
      createdFiles: new Set(manifest.createdFiles),
      scripts: new Set(manifest.scripts),
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
