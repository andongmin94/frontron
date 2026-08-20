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
  addArrayValueChanges(changes, before.build?.asarUnpack, after.build?.asarUnpack, 'build.asarUnpack')
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
      ? { state: 'value', value: cloneJsonValue(beforeValue.value) }
      : { state: 'missing' },
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
        ? { state: 'value', value: cloneJsonValue(beforeValue.value) }
        : { state: 'missing' },
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
    [config.appScript]: `tsc -p tsconfig.electron.json && ${prepareRuntimePackageCommand} && node --no-deprecation dist-electron/serve.js --dev-app`,
    [config.buildScript]: `${config.webBuildCommand} && tsc -p tsconfig.electron.json && ${prepareRuntimePackageCommand} && node --no-deprecation dist-electron/serve.js --prepare-build && electron-builder --publish never`,
  }
}

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
  const templateDependencies =
    config.templateDependencies ?? loadCreateFrontronTemplate().dependencies

  if (typeof packageJson.version === 'undefined') {
    packageJson.version = '0.0.0'
  } else if (!isValidAppVersion(packageJson.version)) {
    throw new Error(
      `package.json version must be a valid SemVer value for Electron packaging: ${String(packageJson.version)}`,
    )
  }

  Object.assign(scripts, createDesktopScriptCommands(config))

  if (!packageJson.dependencies?.electron) {
    devDependencies.electron ??= templateDependencies.electron
  }

  if (!packageJson.dependencies?.['electron-builder']) {
    devDependencies['electron-builder'] ??= templateDependencies.electronBuilder
  }

  if (!packageJson.dependencies?.['@types/node']) {
    devDependencies['@types/node'] ??= templateDependencies.nodeTypes
  }

  if (!packageJson.dependencies?.typescript && shouldUseFrontronTypescriptVersion(packageJson)) {
    devDependencies.typescript = templateDependencies.typescript
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
    build.npmRebuild ??= false
  }

  const filePatterns = ['dist-electron{,/**/*}', `${config.outDir}{,/**/*}`, 'package.json']

  if (!packageRootRuntimeDependencies) {
    filePatterns.push('!node_modules{,/**/*}')
  }

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

  packageJson.scripts = scripts
  if (Object.keys(dependencies).length > 0 || packageJson.dependencies) {
    packageJson.dependencies = dependencies
  }
  packageJson.devDependencies = devDependencies
  packageJson.build = build
}
