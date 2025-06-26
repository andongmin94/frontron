import {
  type InitConfig,
  type PackageJson,
  ELECTRON_BUILDER_VERSION,
  ELECTRON_VERSION,
  NODE_TYPES_VERSION,
  ESBUILD_VERSION,
  TYPESCRIPT_VERSION,
} from './shared'
import type { PackageJsonOwnershipClaim } from './manifest'
import { cloneJsonValue, readPackageJsonPath, valuesEqual } from './package-json-path'

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const ROOT_RUNTIME_DEPENDENCY_ADAPTERS = new Set(['generic-node-server', 'sveltekit-node'])

// isValidAppVersion 함수는 electron-builder가 받을 수 있는 SemVer 앱 버전인지 확인한다.
export function isValidAppVersion(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_PATTERN.test(value)
}

// usesRootRuntimeDependencies 함수는 패키지 루트의 production dependency가 실행 시 필요한 어댑터인지 확인한다.
function usesRootRuntimeDependencies(config: InitConfig) {
  return ROOT_RUNTIME_DEPENDENCY_ADAPTERS.has(config.adapter)
}

// ensureArray 함수는 기존 설정 값이 문자열 배열인지 확인하고 복사본을 돌려준다.
function ensureArray(value: unknown, label: string) {
  if (typeof value === 'undefined') {
    return []
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings to preserve existing packaging rules.`)
  }

  return [...value]
}

// ensureObject 함수는 기존 설정 값이 객체인지 확인하고 아니면 기본 객체를 사용한다.
function ensureObject<T extends object>(value: unknown, label: string, fallback: T) {
  if (typeof value === 'undefined') {
    return fallback
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as T
  }

  throw new Error(`${label} must be an object to preserve existing packaging rules.`)
}

// parseMajorVersion 함수는 버전 문자열에서 major 버전을 숫자로 읽어낸다.
function parseMajorVersion(value: string | undefined) {
  const version = value?.match(/\d+(?:\.\d+){0,2}/)?.[0]

  return version ? Number.parseInt(version.split('.')[0] ?? '', 10) : null
}

// shouldUseFrontronTypescriptVersion 함수는 프로젝트 TypeScript 버전에 Frontron 기본 버전을 넣어야 하는지 판단한다.
function shouldUseFrontronTypescriptVersion(packageJson: PackageJson) {
  const declaredVersion =
    packageJson.dependencies?.typescript ?? packageJson.devDependencies?.typescript
  const major = parseMajorVersion(declaredVersion)

  return major === null || major < 5
}

export type PackageJsonPatchChangeAction = 'add' | 'update'

export type PackageJsonPatchChange = {
  action: PackageJsonPatchChangeAction
  path: string
  value?: string
}

export type PackageJsonPatchPlan = {
  packageJson: PackageJson
  changes: PackageJsonPatchChange[]
  ownershipClaims: PackageJsonOwnershipClaim[]
  warnings: string[]
  blockers: string[]
}

// addRecordChanges 함수는 객체 필드에서 추가되거나 바뀐 키를 변경 목록에 추가한다.
function addRecordChanges(
  changes: PackageJsonPatchChange[],
  before: Record<string, string> | undefined,
  after: Record<string, string> | undefined,
  prefix: string,
) {
  for (const [name, value] of Object.entries(after ?? {})) {
    if (before?.[name] === value) {
      continue
    }

    changes.push({
      action: typeof before?.[name] === 'undefined' ? 'add' : 'update',
      path: `${prefix}.${name}`,
    })
  }
}

// addScalarChange 함수는 스칼라 값 변경을 package.json 변경 목록에 추가한다.
function addScalarChange(
  changes: PackageJsonPatchChange[],
  before: unknown,
  after: unknown,
  path: string,
) {
  if (typeof after === 'undefined' || before === after) {
    return
  }

  changes.push({
    action: typeof before === 'undefined' ? 'add' : 'update',
    path,
  })
}

// addArrayValueChanges 함수는 배열 필드에 새로 추가된 값들을 변경 목록으로 기록한다.
function addArrayValueChanges(
  changes: PackageJsonPatchChange[],
  before: unknown,
  after: unknown,
  path: string,
) {
  const beforeValues = Array.isArray(before) ? before : []
  const afterValues = Array.isArray(after) ? after : []

  for (const value of afterValues) {
    if (typeof value === 'string' && !beforeValues.includes(value)) {
      changes.push({
        action: 'add',
        path,
        value,
      })
    }
  }
}

// createPackageJsonPatchChanges 함수는 package.json 패치 전후 차이를 dry-run용 변경 목록으로 만든다.
function createPackageJsonPatchChanges(before: PackageJson, after: PackageJson) {
  const changes: PackageJsonPatchChange[] = []

  addRecordChanges(changes, before.scripts, after.scripts, 'scripts')
  addRecordChanges(changes, before.dependencies, after.dependencies, 'dependencies')
  addRecordChanges(changes, before.devDependencies, after.devDependencies, 'devDependencies')
  addScalarChange(changes, before.version, after.version, 'version')
  addScalarChange(changes, before.build?.appId, after.build?.appId, 'build.appId')
  addScalarChange(changes, before.build?.productName, after.build?.productName, 'build.productName')
  addScalarChange(changes, before.build?.npmRebuild, after.build?.npmRebuild, 'build.npmRebuild')
  addArrayValueChanges(changes, before.build?.files, after.build?.files, 'build.files')
  addArrayValueChanges(
    changes,
    before.build?.asarUnpack,
    after.build?.asarUnpack,
    'build.asarUnpack',
  )
  addScalarChange(
    changes,
    before.build?.directories?.output,
    after.build?.directories?.output,
    'build.directories.output',
  )
  addScalarChange(
    changes,
    before.build?.extraMetadata?.main,
    after.build?.extraMetadata?.main,
    'build.extraMetadata.main',
  )

  return changes
}

// addOwnershipClaim 함수는 package.json의 단일 필드 변경에 대한 소유권 기록을 추가한다.
function addOwnershipClaim(
  claims: PackageJsonOwnershipClaim[],
  before: PackageJson,
  after: PackageJson,
  path: string,
) {
  const beforeValue = readPackageJsonPath(before, path)
  const afterValue = readPackageJsonPath(after, path)

  if (!afterValue.exists || valuesEqual(beforeValue.value, afterValue.value)) {
    return
  }

  claims.push({
    path,
    action: 'set',
    value: cloneJsonValue(afterValue.value),
    previous: beforeValue.exists
      ? {
          state: 'value',
          value: cloneJsonValue(beforeValue.value),
        }
      : {
          state: 'missing',
        },
  })
}

// addArrayValueOwnershipClaims 함수는 배열 필드에 Frontron이 추가한 값들의 소유권 기록을 만든다.
function addArrayValueOwnershipClaims(
  claims: PackageJsonOwnershipClaim[],
  before: PackageJson,
  after: PackageJson,
  path: string,
) {
  const beforeValue = readPackageJsonPath(before, path)
  const afterValue = readPackageJsonPath(after, path)
  const beforeValues = Array.isArray(beforeValue.value) ? beforeValue.value : []
  const afterValues = Array.isArray(afterValue.value) ? afterValue.value : []

  for (const value of afterValues) {
    if (typeof value !== 'string' || beforeValues.includes(value)) {
      continue
    }

    claims.push({
      path,
      action: 'array-value',
      value,
      previous: beforeValue.exists
        ? {
            state: 'value',
            value: cloneJsonValue(beforeValue.value),
          }
        : {
            state: 'missing',
          },
    })
  }
}

// createPackageJsonOwnershipClaims 함수는 package.json 패치가 Frontron 소유로 추가한 필드 기록을 만든다.
function createPackageJsonOwnershipClaims(before: PackageJson, after: PackageJson) {
  const claims: PackageJsonOwnershipClaim[] = []

  for (const dependencyName of Object.keys(after.dependencies ?? {})) {
    addOwnershipClaim(claims, before, after, `dependencies.${dependencyName}`)
  }

  for (const dependencyName of Object.keys(after.devDependencies ?? {})) {
    addOwnershipClaim(claims, before, after, `devDependencies.${dependencyName}`)
  }

  for (const path of [
    'version',
    'build.appId',
    'build.productName',
    'build.npmRebuild',
    'build.directories.output',
    'build.extraMetadata.main',
  ]) {
    addOwnershipClaim(claims, before, after, path)
  }

  addArrayValueOwnershipClaims(claims, before, after, 'build.files')
  addArrayValueOwnershipClaims(claims, before, after, 'build.asarUnpack')

  return claims
}

// formatPackageJsonPatchChange 함수는 package.json 변경 항목을 dry-run 리포트 한 줄로 만든다.
export function formatPackageJsonPatchChange(change: PackageJsonPatchChange) {
  const marker = change.action === 'add' ? '+' : '~'
  const value = change.value ? `: ${change.value}` : ''

  return `  ${marker} ${change.path}${value}`
}

// previewPackageJsonPatch 함수는 package.json 패치를 실제 적용 전 미리 계산한다.
export function previewPackageJsonPatch(config: InitConfig): PackageJsonPatchPlan {
  const preview = cloneJsonValue(config.packageJson)
  const blockers: string[] = []

  try {
    patchPackageJson({
      ...config,
      packageJson: preview,
    })
  } catch (error) {
    blockers.push((error as Error).message)
  }

  const packageJson = blockers.length > 0 ? cloneJsonValue(config.packageJson) : preview

  return {
    packageJson,
    changes: createPackageJsonPatchChanges(config.packageJson, packageJson),
    ownershipClaims: createPackageJsonOwnershipClaims(config.packageJson, packageJson),
    warnings: [],
    blockers,
  }
}

// createDesktopScriptCommands 함수는 Electron 개발, 빌드, 패키징에 필요한 npm script 명령을 만든다.
export function createDesktopScriptCommands(config: InitConfig) {
  const prepareRuntimePackageCommand = `node -e "const fs=require('node:fs');fs.mkdirSync('dist-electron',{recursive:true});fs.writeFileSync('dist-electron/package.json', JSON.stringify({type:'module'}, null, 2) + '\\n')"`

  return {
    [config.appScript]: `tsc -p tsconfig.electron.json && ${prepareRuntimePackageCommand} && node --no-deprecation dist-electron/serve.js --dev-app`,
    [config.buildScript]: `${config.webBuildCommand} && tsc -p tsconfig.electron.json && ${prepareRuntimePackageCommand} && node --no-deprecation dist-electron/serve.js --prepare-build`,
    [config.packageScript]: `${config.webBuildCommand} && tsc -p tsconfig.electron.json && ${prepareRuntimePackageCommand} && node --no-deprecation dist-electron/serve.js --prepare-build && electron-builder --publish never`,
  }
}

// patchPackageJson 함수는 package.json에 Electron 실행과 패키징 설정을 반영한다.
export function patchPackageJson(config: InitConfig) {
  const packageJson = config.packageJson
  const scripts = { ...(packageJson.scripts ?? {}) }
  const dependencies = { ...(packageJson.dependencies ?? {}) }
  const devDependencies = { ...(packageJson.devDependencies ?? {}) }
  const build = ensureObject<NonNullable<PackageJson['build']>>(packageJson.build, 'build', {})
  const directories = ensureObject<{ output?: string }>(build.directories, 'build.directories', {})
  const extraMetadata = ensureObject<Record<string, unknown>>(
    build.extraMetadata,
    'build.extraMetadata',
    {},
  )
  const files = ensureArray(build.files, 'build.files')

  if (typeof packageJson.version === 'undefined') {
    packageJson.version = '0.0.0'
  } else if (!isValidAppVersion(packageJson.version)) {
    throw new Error(
      `package.json version must be a valid SemVer value for Electron packaging: ${String(packageJson.version)}`,
    )
  }

  Object.assign(scripts, createDesktopScriptCommands(config))

  if (!packageJson.dependencies?.electron) {
    devDependencies.electron ??= ELECTRON_VERSION
  }

  if (!packageJson.dependencies?.['electron-builder']) {
    devDependencies['electron-builder'] ??= ELECTRON_BUILDER_VERSION
  }

  if (!packageJson.dependencies?.['@types/node']) {
    devDependencies['@types/node'] ??= NODE_TYPES_VERSION
  }

  if (!packageJson.dependencies?.typescript && shouldUseFrontronTypescriptVersion(packageJson)) {
    devDependencies.typescript = TYPESCRIPT_VERSION
  }

  if (
    config.adapter === 'remix-node-server' &&
    !dependencies['@remix-run/serve'] &&
    !devDependencies['@remix-run/serve']
  ) {
    devDependencies['@remix-run/serve'] =
      packageJson.devDependencies?.['@remix-run/serve'] ??
      packageJson.dependencies?.['@remix-run/node'] ??
      packageJson.devDependencies?.['@remix-run/dev'] ??
      '^2.0.0'
  }

  if (config.adapter === 'remix-node-server' && !devDependencies.esbuild) {
    devDependencies.esbuild = ESBUILD_VERSION
  }

  build.appId ??= config.appId
  build.productName ??= config.productName

  const packageRootRuntimeDependencies = usesRootRuntimeDependencies(config)

  if (!packageRootRuntimeDependencies) {
    // 자급식 산출물에는 웹 프레임워크의 빌드 전용 의존성을 다시 포함하거나 재빌드하지 않는다.
    build.npmRebuild ??= false
  }

  const filePatterns = ['dist-electron{,/**/*}', `${config.outDir}{,/**/*}`, 'package.json']

  if (!packageRootRuntimeDependencies) {
    filePatterns.push('!node_modules{,/**/*}')
  }

  filePatterns.push('public{,/**/*}')

  for (const pattern of filePatterns) {
    if (!files.includes(pattern)) {
      files.push(pattern)
    }
  }

  build.files = files

  if (config.runtimeStrategy === 'node-server') {
    const asarUnpack = ensureArray(build.asarUnpack, 'build.asarUnpack')
    const unpackPattern = `${config.outDir}{,/**/*}`

    if (!asarUnpack.includes(unpackPattern)) {
      asarUnpack.push(unpackPattern)
    }

    build.asarUnpack = asarUnpack
  }

  directories.output ??= 'release'
  build.directories = directories

  if (typeof extraMetadata.main === 'undefined' || config.allowExtraMetadataMainOverride) {
    extraMetadata.main = 'dist-electron/main.js'
  }

  build.extraMetadata = extraMetadata

  packageJson.scripts = scripts
  if (Object.keys(dependencies).length > 0 || packageJson.dependencies) {
    packageJson.dependencies = dependencies
  }
  packageJson.devDependencies = devDependencies
  packageJson.build = build
}
