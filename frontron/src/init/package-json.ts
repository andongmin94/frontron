import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { type InitConfig, type PackageJson, ESBUILD_VERSION } from './shared'
import { loadCreateFrontronTemplate } from './runtime/create-frontron-template'
import { inspectToolDependencyDeclarations } from './dependency-compatibility'
import type { PackageJsonOwnershipClaim } from './manifest'
import {
  cloneJsonValue,
  deletePackageJsonPath,
  readPackageJsonPath,
  valuesEqual,
  writePackageJsonPath,
} from './package-json-path'

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const ROOT_RUNTIME_DEPENDENCY_ADAPTERS = new Set(['generic-node-server', 'sveltekit-node'])
const BUN_TRUSTED_DEPENDENCIES = ['electron', 'electron-winstaller']

export function isValidAppVersion(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_PATTERN.test(value)
}

function usesRootRuntimeDependencies(config: InitConfig) {
  return ROOT_RUNTIME_DEPENDENCY_ADAPTERS.has(config.adapter)
}

function ensureArray(value: unknown, label: string) {
  if (typeof value === 'undefined') return []

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings to preserve existing packaging rules.`)
  }

  return [...value]
}

function ensureObject<T extends object>(value: unknown, label: string, fallback: T) {
  if (typeof value === 'undefined') return fallback

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as T
  }

  throw new Error(`${label} must be an object to preserve existing packaging rules.`)
}

function shouldUseFrontronTypescriptVersion(packageJson: PackageJson) {
  const declaredVersion =
    packageJson.dependencies?.typescript ?? packageJson.devDependencies?.typescript
  return typeof declaredVersion === 'undefined'
}

function inspectToolVersionCompatibility(config: InitConfig) {
  const template = config.templateDependencies ?? loadCreateFrontronTemplate().dependencies
  const warnings: string[] = []
  const blockers: string[] = []

  for (const inspection of inspectToolDependencyDeclarations(config.packageJson, template)) {
    const {
      packageName,
      declaration: declaredVersion,
      templateDeclaration: templateVersion,
      declaredMajor,
      templateMajor,
    } = inspection
    if (!declaredVersion || !templateVersion) continue

    if (declaredMajor === null || templateMajor === null) {
      warnings.push(
        `Could not verify ${packageName} version compatibility for "${declaredVersion}"; the existing declaration was preserved.`,
      )
      continue
    }

    if (packageName === 'typescript' && declaredMajor < 5) {
      blockers.push(
        `Existing typescript ${declaredVersion} is too old for the generated NodeNext Electron sources. Upgrade to TypeScript 5 or newer.`,
      )
      continue
    }

    if (declaredMajor < templateMajor) {
      warnings.push(
        `Existing ${packageName} ${declaredVersion} is older than the create-frontron template baseline ${templateVersion}; it was preserved.`,
      )
    }
  }

  return { warnings, blockers }
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

function addRecordChanges(
  changes: PackageJsonPatchChange[],
  before: Record<string, string> | undefined,
  after: Record<string, string> | undefined,
  prefix: string,
) {
  for (const [name, value] of Object.entries(after ?? {})) {
    if (before?.[name] === value) continue

    changes.push({
      action: typeof before?.[name] === 'undefined' ? 'add' : 'update',
      path: `${prefix}.${name}`,
    })
  }
}

function addScalarChange(
  changes: PackageJsonPatchChange[],
  before: unknown,
  after: unknown,
  path: string,
) {
  if (typeof after === 'undefined' || before === after) return

  changes.push({
    action: typeof before === 'undefined' ? 'add' : 'update',
    path,
  })
}

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
      changes.push({ action: 'add', path, value })
    }
  }
}

function addPathScalarChange(
  changes: PackageJsonPatchChange[],
  before: PackageJson,
  after: PackageJson,
  path: string,
) {
  addScalarChange(
    changes,
    readPackageJsonPath(before, path).value,
    readPackageJsonPath(after, path).value,
    path,
  )
}

function addPathArrayValueChanges(
  changes: PackageJsonPatchChange[],
  before: PackageJson,
  after: PackageJson,
  path: string,
) {
  addArrayValueChanges(
    changes,
    readPackageJsonPath(before, path).value,
    readPackageJsonPath(after, path).value,
    path,
  )
}

// 변경 목록은 record, 배열 원소, scalar 경로별로 순회해 build 중첩 분기를 만들지 않는다.
function createPackageJsonPatchChanges(before: PackageJson, after: PackageJson) {
  const changes: PackageJsonPatchChange[] = []
  const recordSections: Array<[
    string,
    Record<string, string> | undefined,
    Record<string, string> | undefined,
  ]> = [
    ['scripts', before.scripts, after.scripts],
    ['dependencies', before.dependencies, after.dependencies],
    ['devDependencies', before.devDependencies, after.devDependencies],
  ]

  for (const [prefix, beforeRecord, afterRecord] of recordSections) {
    addRecordChanges(changes, beforeRecord, afterRecord, prefix)
  }

  for (const path of ['trustedDependencies', 'build.files', 'build.asarUnpack']) {
    addPathArrayValueChanges(changes, before, after, path)
  }

  for (const path of [
    'version',
    'build.icon',
    'build.appId',
    'build.productName',
    'build.npmRebuild',
    'build.directories.output',
    'build.extraMetadata.main',
  ]) {
    addPathScalarChange(changes, before, after, path)
  }

  return changes
}

function addOwnershipClaim(
  claims: PackageJsonOwnershipClaim[],
  before: PackageJson,
  after: PackageJson,
  path: string,
) {
  const beforeValue = readPackageJsonPath(before, path)
  const afterValue = readPackageJsonPath(after, path)

  if (!afterValue.exists || valuesEqual(beforeValue.value, afterValue.value)) return

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
    if (typeof value !== 'string' || beforeValues.includes(value)) continue

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
    'build.icon',
    'build.appId',
    'build.productName',
    'build.npmRebuild',
    'build.directories.output',
    'build.extraMetadata.main',
  ]) {
    addOwnershipClaim(claims, before, after, path)
  }

  addArrayValueOwnershipClaims(claims, before, after, 'trustedDependencies')
  addArrayValueOwnershipClaims(claims, before, after, 'build.files')
  addArrayValueOwnershipClaims(claims, before, after, 'build.asarUnpack')

  return claims
}

export function formatPackageJsonPatchChange(change: PackageJsonPatchChange) {
  const marker = change.action === 'add' ? '+' : '~'
  const value = change.value ? `: ${change.value}` : ''

  return `  ${marker} ${change.path}${value}`
}

function removeOwnedPackageJsonValues(
  packageJson: PackageJson,
  claims: PackageJsonOwnershipClaim[],
) {
  for (const claim of claims) {
    if (claim.action !== 'array-value') {
      deletePackageJsonPath(packageJson, claim.path)
      continue
    }

    const current = readPackageJsonPath(packageJson, claim.path)
    if (!Array.isArray(current.value)) continue
    const remaining = current.value.filter((value) => !valuesEqual(value, claim.value))

    if (remaining.length === 0 && claim.previous.state === 'missing') {
      deletePackageJsonPath(packageJson, claim.path)
    } else {
      writePackageJsonPath(packageJson, claim.path, remaining)
    }
  }
}

export function previewPackageJsonPatch(
  config: InitConfig,
  ownedClaims: PackageJsonOwnershipClaim[] = [],
): PackageJsonPatchPlan {
  const preview = cloneJsonValue(config.packageJson)
  removeOwnedPackageJsonValues(preview, ownedClaims)
  const ownershipBaseline = cloneJsonValue(preview)
  const previewConfig = { ...config, packageJson: preview }
  const compatibility = inspectToolVersionCompatibility(previewConfig)
  const blockers: string[] = [...compatibility.blockers]

  try {
    patchPackageJson(previewConfig)
  } catch (error) {
    blockers.push((error as Error).message)
  }

  const packageJson = blockers.length > 0 ? cloneJsonValue(config.packageJson) : preview

  return {
    packageJson,
    changes: createPackageJsonPatchChanges(config.packageJson, packageJson),
    ownershipClaims:
      blockers.length > 0 ? [] : createPackageJsonOwnershipClaims(ownershipBaseline, packageJson),
    warnings: compatibility.warnings,
    blockers,
  }
}

export function createDesktopScriptCommands(config: InitConfig) {
  const prepareRuntimePackageCommand = `node -e "const fs=require('node:fs');fs.mkdirSync('dist-electron',{recursive:true});fs.writeFileSync('dist-electron/package.json', JSON.stringify({type:'module'}, null, 2) + '\\n')"`

  return {
    [config.appScript]:
      `tsc -p tsconfig.electron.json && ${prepareRuntimePackageCommand} && ` +
      'node --no-deprecation dist-electron/serve.js --dev-app',
    [config.buildScript]:
      `${config.webBuildCommand} && tsc -p tsconfig.electron.json && ` +
      `${prepareRuntimePackageCommand} && ` +
      'node --no-deprecation dist-electron/serve.js --prepare-build && ' +
      'electron-builder --publish never',
  }
}

// Keep icon discovery separate from dependency and packaging changes.
function applyDefaultAppIcon(
  config: InitConfig,
  build: NonNullable<PackageJson['build']>,
  resourceDirectory: unknown,
) {
  if (typeof build.icon !== 'undefined') return

  const buildResources = resourceDirectory ?? 'build'
  if (typeof buildResources !== 'string') {
    throw new Error('build.directories.buildResources must be a string.')
  }

  // Preserve electron-builder's resource discovery and leave image conversion
  // to the installed builder rather than introducing an icon dependency.
  const iconNames = ['icon.ico', 'icon.icns', 'icon.png', 'icon.svg', 'icons', 'icon']
  const hasExistingIcon = [buildResources, '.'].some((directory) =>
    iconNames.some((name) => existsSync(join(config.cwd, directory, name))),
  )
  if (!hasExistingIcon) build.icon = `${config.desktopDir}/icon.svg`
}

// 패키지 버전은 electron-builder가 읽을 수 있는 SemVer로 정규화한다.
function normalizePackageVersion(packageJson: PackageJson) {
  if (typeof packageJson.version === 'undefined') {
    packageJson.version = '0.0.0'
    return
  }

  if (!isValidAppVersion(packageJson.version)) {
    throw new Error(
      `package.json version must be a valid SemVer value for Electron packaging: ${String(packageJson.version)}`,
    )
  }
}

// 기존 프로젝트의 의존성은 우선 보존하고, 빠진 Electron 도구만 개발 의존성으로 채운다.
function applyToolDependencies(
  packageJson: PackageJson,
  devDependencies: Record<string, string>,
  templateDependencies: InitConfig['templateDependencies'],
) {
  const template = templateDependencies ?? loadCreateFrontronTemplate().dependencies

  if (!packageJson.dependencies?.electron) {
    devDependencies.electron ??= template.electron
  }
  if (!packageJson.dependencies?.['electron-builder']) {
    devDependencies['electron-builder'] ??= template.electronBuilder
  }
  if (!packageJson.dependencies?.['@types/node']) {
    devDependencies['@types/node'] ??= template.nodeTypes
  }
  if (!packageJson.dependencies?.typescript && shouldUseFrontronTypescriptVersion(packageJson)) {
    devDependencies.typescript = template.typescript
  }
}

// Bun은 네이티브 설치 스크립트를 실행할 패키지를 명시적으로 신뢰 목록에 넣어야 한다.
function applyBunTrustedDependencies(packageJson: PackageJson) {
  const trustedDependencies = ensureArray(packageJson.trustedDependencies, 'trustedDependencies')

  for (const dependencyName of BUN_TRUSTED_DEPENDENCIES) {
    if (!trustedDependencies.includes(dependencyName)) trustedDependencies.push(dependencyName)
  }

  packageJson.trustedDependencies = trustedDependencies
}

// Remix 런타임에만 필요한 도구는 중복 선언 없이 보충한다.
function applyRemixDependencies(
  packageJson: PackageJson,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
) {
  if (!dependencies['@remix-run/serve'] && !devDependencies['@remix-run/serve']) {
    devDependencies['@remix-run/serve'] =
      packageJson.devDependencies?.['@remix-run/serve'] ??
      packageJson.dependencies?.['@remix-run/node'] ??
      packageJson.devDependencies?.['@remix-run/dev'] ??
      '^2.0.0'
  }

  // dependencies에 이미 esbuild가 있으면 devDependencies에 다시 만들지 않는다.
  if (!dependencies.esbuild && !devDependencies.esbuild) {
    devDependencies.esbuild = ESBUILD_VERSION
  }
}

// electron-builder가 가져갈 파일·asar·출력 경로를 한곳에서 구성한다.
function applyBuildPackaging(
  config: InitConfig,
  build: NonNullable<PackageJson['build']>,
  directories: { output?: string; buildResources?: string },
  extraMetadata: Record<string, unknown>,
  files: string[],
) {
  applyDefaultAppIcon(config, build, directories.buildResources)
  build.appId ??= config.appId
  build.productName ??= config.productName

  const packageRootRuntimeDependencies = usesRootRuntimeDependencies(config)
  if (!packageRootRuntimeDependencies) build.npmRebuild ??= false

  const filePatterns = ['dist-electron{,/**/*}', `${config.outDir}{,/**/*}`, 'package.json']
  if (!packageRootRuntimeDependencies) filePatterns.push('!node_modules{,/**/*}')
  filePatterns.push('public{,/**/*}')

  for (const pattern of filePatterns) {
    if (!files.includes(pattern)) files.push(pattern)
  }
  build.files = files

  if (config.runtimeStrategy === 'node-server') {
    const asarUnpack = ensureArray(build.asarUnpack, 'build.asarUnpack')
    const unpackPattern = `${config.outDir}{,/**/*}`
    if (!asarUnpack.includes(unpackPattern)) asarUnpack.push(unpackPattern)
    build.asarUnpack = asarUnpack
  }

  directories.output ??= 'release'
  build.directories = directories
  if (typeof extraMetadata.main === 'undefined' || config.allowExtraMetadataMainOverride) {
    extraMetadata.main = 'dist-electron/main.js'
  }
  build.extraMetadata = extraMetadata
}

// patchPackageJson 함수는 세부 정책을 조합만 하고, 각 정책의 분기는 전용 helper가 담당한다.
export function patchPackageJson(config: InitConfig) {
  const packageJson = config.packageJson
  const scripts = { ...(packageJson.scripts ?? {}) }
  const dependencies = { ...(packageJson.dependencies ?? {}) }
  const devDependencies = { ...(packageJson.devDependencies ?? {}) }
  const build = ensureObject<NonNullable<PackageJson['build']>>(packageJson.build, 'build', {})
  const directories = ensureObject<{ output?: string; buildResources?: string }>(
    build.directories,
    'build.directories',
    {},
  )
  const extraMetadata = ensureObject<Record<string, unknown>>(
    build.extraMetadata,
    'build.extraMetadata',
    {},
  )
  const files = ensureArray(build.files, 'build.files')

  normalizePackageVersion(packageJson)
  Object.assign(scripts, createDesktopScriptCommands(config))
  applyToolDependencies(packageJson, devDependencies, config.templateDependencies)

  if (config.packageManager === 'bun') applyBunTrustedDependencies(packageJson)
  if (config.adapter === 'remix-node-server') {
    applyRemixDependencies(packageJson, dependencies, devDependencies)
  }

  applyBuildPackaging(config, build, directories, extraMetadata, files)

  packageJson.scripts = scripts
  if (Object.keys(dependencies).length > 0 || packageJson.dependencies) {
    packageJson.dependencies = dependencies
  }
  packageJson.devDependencies = devDependencies
  packageJson.build = build
}
