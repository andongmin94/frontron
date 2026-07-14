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

type ManifestFields = {
  adapter: InitAdapterId
  adapterConfidence: AdapterConfidence
  adapterReasons: string[]
  strategy: RuntimeStrategy
  desktopDir?: string
  appScript?: string
  buildScript?: string
  packageScript?: string
  webDevScript?: string
  webBuildScript?: string
  outDir?: string
  nodeServerSourceRoot?: string | null
  nodeServerSourceEntry?: string | null
  nodeServerEntry?: string | null
  productName?: string
  appId?: string
  templateSource?: 'create-frontron'
  templatePackage?: 'create-frontron'
  templateVersion?: string | null
  templateResolvedFrom?: InitTemplateResolvedFrom
  createdFiles: string[]
  fileHashes?: Record<string, string>
  scripts: string[]
  scriptCommands?: Record<string, string>
  packageJsonClaims?: PackageJsonOwnershipClaim[]
  tsconfigJsonClaims?: PackageJsonOwnershipClaim[]
  pnpmWorkspaceClaims?: PackageJsonOwnershipClaim[]
  yarnRcClaims?: YarnRcOwnershipClaim[]
}

/**
 * schemaVersion 1은 이전 릴리스가 만든 manifest를 갱신하기 위한 읽기 전용 호환 형식이다.
 * 새 manifest는 항상 v2이며, 안전한 update/clean에 필요한 모든 소유권 정보를 포함한다.
 */
export type LegacyFrontronManifest = Omit<ManifestFields, 'templateSource' | 'templatePackage'> & {
  schemaVersion: 1
  preset?: string
  templateSource?: string
  templatePackage?: string
}

export type FrontronManifestV2 = Required<
  Omit<
    ManifestFields,
    | 'nodeServerSourceRoot'
    | 'nodeServerSourceEntry'
    | 'nodeServerEntry'
    | 'templateVersion'
    | 'tsconfigJsonClaims'
    | 'pnpmWorkspaceClaims'
    | 'yarnRcClaims'
  >
> & {
  schemaVersion: typeof CURRENT_MANIFEST_SCHEMA_VERSION
  preset?: string
  nodeServerSourceRoot: string | null
  nodeServerSourceEntry: string | null
  nodeServerEntry: string | null
  templateVersion: string
  tsconfigJsonClaims: PackageJsonOwnershipClaim[]
  pnpmWorkspaceClaims: PackageJsonOwnershipClaim[]
  yarnRcClaims: YarnRcOwnershipClaim[]
}

export type FrontronManifest = LegacyFrontronManifest | FrontronManifestV2

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
const LEGACY_CREATED_FILE_PATH_ALLOWLIST = new Set([
  ...FIXED_CREATED_FILE_PATH_ALLOWLIST,
  'electron/serve.ts',
  'electron/package.json',
  'electron/dev.ts',
  'electron/ipc.ts',
  'electron/main.ts',
  'electron/preload.ts',
  'electron/splash.ts',
  'electron/tray.ts',
  'electron/window.ts',
])
const SHA256_PATTERN = /^[a-f0-9]{64}$/

// manifest에는 운영체제별 구분자가 아닌 프로젝트 기준 슬래시 경로를 기록한다.
export function normalizeManifestPath(cwd: string, filePath: string) {
  return normalizePathValue(relative(cwd, filePath), filePath)
}

// 생성 파일의 변경 여부를 비교할 SHA-256 해시를 만든다.
export function createFileHash(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

// null 및 배열을 제외한 JSON 객체인지 확인한다.
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// 값이 문자열 배열인지 확인한다.
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

// 값이 문자열 값만 가진 객체인지 확인한다.
function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

// manifest 파일 경로가 슬래시로 정규화된 프로젝트 내부 상대 경로인지 확인한다.
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

// 생성 파일 경로가 고정 파일 또는 신뢰할 수 있는 Electron 소스 범위에 속하는지 확인한다.
function isAllowedCreatedFilePath(filePath: string, desktopDir: string | undefined) {
  if (!isNormalizedManifestRelativePath(filePath)) return false
  if (FIXED_CREATED_FILE_PATH_ALLOWLIST.has(filePath)) return true

  return desktopDir === undefined
    ? LEGACY_CREATED_FILE_PATH_ALLOWLIST.has(filePath)
    : filePath.startsWith(`${desktopDir}/`)
}

// createdFiles와 fileHashes가 중복 없이 동일한 manifest 소유 범위만 가리키는지 확인한다.
function hasValidManifestFileOwnership(
  createdFiles: unknown,
  fileHashes: unknown,
  desktopDir: unknown,
  allowMissingDesktopDir: boolean,
) {
  if (!isStringArray(createdFiles)) return false

  if (desktopDir === undefined) {
    if (!allowMissingDesktopDir) return false
  } else if (!isNormalizedManifestRelativePath(desktopDir)) {
    return false
  }

  const normalizedDesktopDir = typeof desktopDir === 'string' ? desktopDir : undefined
  const createdFileSet = new Set(createdFiles)

  if (
    createdFileSet.size !== createdFiles.length ||
    !createdFiles.every((filePath) => isAllowedCreatedFilePath(filePath, normalizedDesktopDir))
  ) {
    return false
  }

  if (fileHashes === undefined) return true
  if (!isStringRecord(fileHashes)) return false

  return Object.keys(fileHashes).every(
    (filePath) =>
      filePath !== MANIFEST_PATH &&
      createdFileSet.has(filePath) &&
      isAllowedCreatedFilePath(filePath, normalizedDesktopDir),
  )
}

// package.json 경로가 프로토타입 객체를 건드리지 않는 안전한 점 표기 경로인지 확인한다.
function isSafeClaimPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false

  const segments = value.split('.')
  return segments.every(
    (segment) => segment.length > 0 && !FORBIDDEN_CLAIM_PATH_SEGMENTS.has(segment),
  )
}

// package.json 및 설정 파일의 소유권 claim 구조를 엄격하게 검증한다.
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

// 소유권 claim이 해당 설정 category에서 Frontron이 생성할 수 있는 경로만 가리키는지 확인한다.
function isAllowedOwnershipClaim(
  value: unknown,
  pathAllowlist: ReadonlySet<string>,
): value is PackageJsonOwnershipClaim {
  return isPackageJsonOwnershipClaim(value) && pathAllowlist.has(value.path)
}

// 필수 claim 배열의 구조와 category별 허용 경로를 함께 검증한다.
function isClaimArray(value: unknown, pathAllowlist: ReadonlySet<string>) {
  return (
    Array.isArray(value) && value.every((claim) => isAllowedOwnershipClaim(claim, pathAllowlist))
  )
}

// Yarn nodeLinker 변경을 되돌릴 수 있는 claim인지 확인한다.
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

// 선택적인 claim 배열도 존재할 때는 category별 허용 경로까지 검증한다.
function isOptionalClaimArray(value: unknown, pathAllowlist: ReadonlySet<string>) {
  return value === undefined || isClaimArray(value, pathAllowlist)
}

// v1과 v2가 공통으로 요구하는 식별 및 생성 목록 필드를 검증한다.
function hasValidCoreFields(value: Record<string, unknown>) {
  return (
    typeof value.adapter === 'string' &&
    VALID_ADAPTERS.includes(value.adapter as InitAdapterId) &&
    typeof value.adapterConfidence === 'string' &&
    VALID_CONFIDENCE.has(value.adapterConfidence as AdapterConfidence) &&
    isStringArray(value.adapterReasons) &&
    typeof value.strategy === 'string' &&
    VALID_STRATEGIES.has(value.strategy as RuntimeStrategy) &&
    isStringArray(value.createdFiles) &&
    isStringArray(value.scripts)
  )
}

// v1에서 선택적이었던 안전성 메타데이터의 타입을 검증한다.
function hasValidLegacyMetadata(value: Record<string, unknown>) {
  const optionalStrings = [
    'desktopDir',
    'appScript',
    'buildScript',
    'packageScript',
    'webDevScript',
    'webBuildScript',
    'outDir',
    'productName',
    'appId',
    'preset',
  ]

  return (
    optionalStrings.every((key) => value[key] === undefined || typeof value[key] === 'string') &&
    [
      value.nodeServerSourceRoot,
      value.nodeServerSourceEntry,
      value.nodeServerEntry,
      value.templateVersion,
    ].every((entry) => entry === undefined || entry === null || typeof entry === 'string') &&
    (value.templateSource === undefined || typeof value.templateSource === 'string') &&
    (value.templatePackage === undefined || typeof value.templatePackage === 'string') &&
    (value.templateResolvedFrom === undefined ||
      (typeof value.templateResolvedFrom === 'string' &&
        VALID_TEMPLATE_RESOLUTIONS.has(value.templateResolvedFrom as InitTemplateResolvedFrom))) &&
    hasValidManifestFileOwnership(value.createdFiles, value.fileHashes, value.desktopDir, true) &&
    (value.scriptCommands === undefined || isStringRecord(value.scriptCommands)) &&
    isOptionalClaimArray(value.packageJsonClaims, PACKAGE_JSON_CLAIM_PATH_ALLOWLIST) &&
    isOptionalClaimArray(value.tsconfigJsonClaims, TSCONFIG_JSON_CLAIM_PATH_ALLOWLIST) &&
    isOptionalClaimArray(value.pnpmWorkspaceClaims, PNPM_WORKSPACE_CLAIM_PATH_ALLOWLIST) &&
    (value.yarnRcClaims === undefined ||
      (Array.isArray(value.yarnRcClaims) && value.yarnRcClaims.every(isYarnRcOwnershipClaim)))
  )
}

// v2가 안전한 update와 clean에 필요한 모든 필드를 완전하게 기록했는지 확인한다.
function isManifestV2(value: Record<string, unknown>): value is FrontronManifestV2 {
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
    value.preset !== undefined ||
    !hasValidCoreFields(value) ||
    !requiredStrings.every((key) => typeof value[key] === 'string') ||
    (value.nodeServerSourceRoot !== null && typeof value.nodeServerSourceRoot !== 'string') ||
    (value.nodeServerSourceEntry !== null && typeof value.nodeServerSourceEntry !== 'string') ||
    (value.nodeServerEntry !== null && typeof value.nodeServerEntry !== 'string') ||
    value.templateSource !== 'create-frontron' ||
    value.templatePackage !== 'create-frontron' ||
    typeof value.templateResolvedFrom !== 'string' ||
    !VALID_TEMPLATE_RESOLUTIONS.has(value.templateResolvedFrom as InitTemplateResolvedFrom) ||
    !isStringRecord(value.fileHashes) ||
    !hasValidManifestFileOwnership(value.createdFiles, value.fileHashes, value.desktopDir, false) ||
    !Object.values(value.fileHashes).every((hash) => SHA256_PATTERN.test(hash)) ||
    !isStringRecord(value.scriptCommands) ||
    !isClaimArray(value.packageJsonClaims, PACKAGE_JSON_CLAIM_PATH_ALLOWLIST) ||
    !isClaimArray(value.tsconfigJsonClaims, TSCONFIG_JSON_CLAIM_PATH_ALLOWLIST) ||
    !isClaimArray(value.pnpmWorkspaceClaims, PNPM_WORKSPACE_CLAIM_PATH_ALLOWLIST) ||
    !Array.isArray(value.yarnRcClaims) ||
    !value.yarnRcClaims.every(isYarnRcOwnershipClaim)
  ) {
    return false
  }

  const createdFiles = value.createdFiles as string[]
  const fileHashes = value.fileHashes as Record<string, string>
  const scripts = value.scripts as string[]
  const scriptCommands = value.scriptCommands as Record<string, string>
  const generatedFiles = createdFiles.filter((filePath) => filePath !== MANIFEST_PATH)
  return (
    generatedFiles.every((filePath) => SHA256_PATTERN.test(fileHashes[filePath] ?? '')) &&
    Object.keys(fileHashes).every((filePath) => generatedFiles.includes(filePath)) &&
    scripts.every((scriptName) => Object.prototype.hasOwnProperty.call(scriptCommands, scriptName))
  )
}

// JSON 값 하나를 지원되는 manifest 버전으로 해석한다.
export function parseManifest(value: unknown): FrontronManifest {
  if (!isRecord(value) || !hasValidCoreFields(value)) {
    throw new Error(`${MANIFEST_PATH} is invalid.`)
  }

  if (value.schemaVersion === 1 && hasValidLegacyMetadata(value)) {
    return value as LegacyFrontronManifest
  }

  if (isManifestV2(value)) return value

  throw new Error(`${MANIFEST_PATH} is invalid.`)
}

// 현재 init 설정과 소유권 정보를 최신 manifest 객체로 만든다.
export function createManifest(
  config: InitConfig,
  fileSources: Map<string, string>,
  extraFilePaths: string[] = [],
  scriptCommands: Record<string, string> = {},
  packageJsonClaims: PackageJsonOwnershipClaim[] = [],
  tsconfigJsonClaims: PackageJsonOwnershipClaim[] = [],
  pnpmWorkspaceClaims: PackageJsonOwnershipClaim[] = [],
  yarnRcClaims: YarnRcOwnershipClaim[] = [],
): FrontronManifestV2 {
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

// manifest 객체를 최종 개행을 포함한 JSON 소스로 직렬화한다.
export function renderManifestSource(manifest: FrontronManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

// 프로젝트 manifest를 읽고 버전별 전체 구조를 한 경로에서 검증한다.
export function readManifest(cwd: string) {
  const manifestPath = join(cwd, MANIFEST_PATH)
  if (!existsSync(manifestPath)) return null

  return parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
}

// --force init이 덮어쓸 수 있는 기존 생성 파일과 script 목록을 읽는다.
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

// 기존 파일 충돌을 manifest 소유 파일과 사용자 파일로 나눈다.
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
