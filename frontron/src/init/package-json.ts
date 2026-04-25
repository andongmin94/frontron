import {
  type InitConfig,
  type PackageJson,
  ELECTRON_BUILDER_VERSION,
  ELECTRON_VERSION,
  NODE_TYPES_VERSION,
  TYPESCRIPT_VERSION,
} from './shared'
import type { PackageJsonOwnershipClaim } from './manifest'
import { cloneJsonValue, readPackageJsonPath, valuesEqual } from './package-json-path'

function ensureArray(value: unknown, label: string) {
  if (typeof value === 'undefined') {
    return []
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings to preserve existing packaging rules.`)
  }

  return [...value]
}

function ensureObject<T extends object>(value: unknown, label: string, fallback: T) {
  if (typeof value === 'undefined') {
    return fallback
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as T
  }

  throw new Error(`${label} must be an object to preserve existing packaging rules.`)
}

function clonePackageJson(packageJson: PackageJson): PackageJson {
  return JSON.parse(JSON.stringify(packageJson)) as PackageJson
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
    if (before?.[name] === value) {
      continue
    }

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
  if (typeof after === 'undefined' || before === after) {
    return
  }

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
      changes.push({
        action: 'add',
        path,
        value,
      })
    }
  }
}

function createPackageJsonPatchChanges(before: PackageJson, after: PackageJson) {
  const changes: PackageJsonPatchChange[] = []

  addRecordChanges(changes, before.scripts, after.scripts, 'scripts')
  addRecordChanges(changes, before.devDependencies, after.devDependencies, 'devDependencies')
  addScalarChange(changes, before.build?.appId, after.build?.appId, 'build.appId')
  addScalarChange(changes, before.build?.productName, after.build?.productName, 'build.productName')
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

function createPackageJsonOwnershipClaims(before: PackageJson, after: PackageJson) {
  const claims: PackageJsonOwnershipClaim[] = []

  for (const dependencyName of Object.keys(after.devDependencies ?? {})) {
    addOwnershipClaim(claims, before, after, `devDependencies.${dependencyName}`)
  }

  for (const path of [
    'build.appId',
    'build.productName',
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

export function previewPackageJsonPatch(config: InitConfig): PackageJsonPatchPlan {
  const preview = clonePackageJson(config.packageJson)
  const blockers: string[] = []

  try {
    patchPackageJson({
      ...config,
      packageJson: preview,
    })
  } catch (error) {
    blockers.push((error as Error).message)
  }

  const packageJson = blockers.length > 0 ? clonePackageJson(config.packageJson) : preview

  return {
    packageJson,
    changes: createPackageJsonPatchChanges(config.packageJson, packageJson),
    ownershipClaims: createPackageJsonOwnershipClaims(config.packageJson, packageJson),
    warnings: [],
    blockers,
  }
}

export function createDesktopScriptCommands(config: InitConfig) {
  return {
    [config.appScript]: 'tsc -p tsconfig.electron.json && node dist-electron/serve.js --dev-app',
    [config.buildScript]:
      `${config.webBuildCommand} && tsc -p tsconfig.electron.json && node dist-electron/serve.js --prepare-build`,
    [config.packageScript]:
      `${config.webBuildCommand} && tsc -p tsconfig.electron.json && node dist-electron/serve.js --prepare-build && electron-builder`,
  }
}

export function patchPackageJson(config: InitConfig) {
  const packageJson = config.packageJson
  const scripts = { ...(packageJson.scripts ?? {}) }
  const devDependencies = { ...(packageJson.devDependencies ?? {}) }
  const build = ensureObject<NonNullable<PackageJson['build']>>(packageJson.build, 'build', {})
  const directories = ensureObject<{ output?: string }>(build.directories, 'build.directories', {})
  const extraMetadata = ensureObject<Record<string, unknown>>(
    build.extraMetadata,
    'build.extraMetadata',
    {},
  )
  const files = ensureArray(build.files, 'build.files')

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

  if (!packageJson.dependencies?.typescript) {
    devDependencies.typescript ??= TYPESCRIPT_VERSION
  }

  build.appId ??= config.appId
  build.productName ??= config.productName

  for (const pattern of ['dist-electron{,/**/*}', `${config.outDir}{,/**/*}`, 'package.json']) {
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
  packageJson.devDependencies = devDependencies
  packageJson.build = build
}
