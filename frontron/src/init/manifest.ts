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
  templateSource?: string
  templatePackage?: string
  templateVersion?: string | null
  templateResolvedFrom?: string
  createdFiles: string[]
  fileHashes?: Record<string, string>
  scripts: string[]
  scriptCommands?: Record<string, string>
  packageJsonClaims?: PackageJsonOwnershipClaim[]
  tsconfigJsonClaims?: PackageJsonOwnershipClaim[]
  pnpmWorkspaceClaims?: PackageJsonOwnershipClaim[]
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

// normalizeManifestPath 함수는 절대 파일 경로를 manifest에 저장할 프로젝트 상대 경로로 바꾼다.
export function normalizeManifestPath(cwd: string, filePath: string) {
  return normalizePathValue(relative(cwd, filePath), filePath)
}

// createFileHash 함수는 파일 내용 비교에 사용할 SHA-256 해시를 만든다.
export function createFileHash(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

// isStringRecord 함수는 객체의 모든 값이 문자열인지 확인한다.
function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
  )
}

// isOptionalString 함수는 값이 없거나 문자열인지 확인한다.
function isOptionalString(value: unknown) {
  return typeof value === 'undefined' || typeof value === 'string'
}

// isOptionalNullableString 함수는 값이 없거나 null이거나 문자열인지 확인한다.
function isOptionalNullableString(value: unknown) {
  return typeof value === 'undefined' || value === null || typeof value === 'string'
}

// isPackageJsonOwnershipClaim 함수는 값이 package.json 소유권 claim 구조인지 검사한다.
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

// createManifest 함수는 현재 init 설정과 소유권 정보를 Frontron manifest 객체로 만든다.
export function createManifest(
  config: InitConfig,
  fileSources: Map<string, string>,
  extraFilePaths: string[] = [],
  scriptCommands: Record<string, string> = {},
  packageJsonClaims: PackageJsonOwnershipClaim[] = [],
  tsconfigJsonClaims: PackageJsonOwnershipClaim[] = [],
  pnpmWorkspaceClaims: PackageJsonOwnershipClaim[] = [],
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
    tsconfigJsonClaims: tsconfigJsonClaims.length > 0 ? tsconfigJsonClaims : undefined,
    pnpmWorkspaceClaims: pnpmWorkspaceClaims.length > 0 ? pnpmWorkspaceClaims : undefined,
  }
}

// renderManifestSource 함수는 manifest 객체를 파일에 쓸 JSON 문자열로 바꾼다.
export function renderManifestSource(manifest: FrontronManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

// readManifest 함수는 프로젝트의 Frontron manifest를 읽고 구조를 검증한다.
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
    !isOptionalString(parsed.templateSource) ||
    !isOptionalString(parsed.templatePackage) ||
    !isOptionalNullableString(parsed.templateVersion) ||
    !isOptionalString(parsed.templateResolvedFrom) ||
    (typeof parsed.fileHashes !== 'undefined' && !isStringRecord(parsed.fileHashes)) ||
    (typeof parsed.scriptCommands !== 'undefined' && !isStringRecord(parsed.scriptCommands)) ||
    (typeof parsed.packageJsonClaims !== 'undefined' &&
      (!Array.isArray(parsed.packageJsonClaims) ||
        parsed.packageJsonClaims.some((entry) => !isPackageJsonOwnershipClaim(entry)))) ||
    (typeof parsed.tsconfigJsonClaims !== 'undefined' &&
      (!Array.isArray(parsed.tsconfigJsonClaims) ||
        parsed.tsconfigJsonClaims.some((entry) => !isPackageJsonOwnershipClaim(entry)))) ||
    (typeof parsed.pnpmWorkspaceClaims !== 'undefined' &&
      (!Array.isArray(parsed.pnpmWorkspaceClaims) ||
        parsed.pnpmWorkspaceClaims.some((entry) => !isPackageJsonOwnershipClaim(entry))))
  ) {
    throw new Error(`${MANIFEST_PATH} is invalid.`)
  }

  return parsed as FrontronManifest
}

// readExistingManifest 함수는 --force 판단에 필요한 기존 manifest의 파일과 script 목록을 읽는다.
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
      scripts: new Set(
        parsed.scripts.filter((entry): entry is string => typeof entry === 'string'),
      ),
    }
  } catch {
    return null
  }
}

// splitFileConflicts 함수는 기존 파일 충돌을 덮어써도 되는 파일과 차단할 파일로 나눈다.
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
