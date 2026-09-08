import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { formatProjectPathBlocker, inspectProjectPath } from '../project-paths'
import { createFileHash, MANIFEST_PATH, readManifest } from '../init/manifest'
import { readPackageJsonPath, valuesEqual } from '../init/package-json-path'
import { inspectManagedFile, inspectManagedScript } from '../managed-state'
import {
  findPnpmWorkspaceYamlPath,
  readPnpmWorkspaceYamlClaimValue,
} from '../init/pnpm-workspace-yaml'
import type { PackageJson } from '../init/shared'
import { readTsconfigJson } from '../init/tsconfig-json'
import {
  readYarnRcYamlClaimValue,
  resolveYarnRcClaimPath,
  YARN_RC_YAML_PATH,
} from '../init/yarnrc-yaml'
import type {
  ClaimReadResult,
  CleanFileChange,
  CleanMissingSourceGuard,
  CleanOptions,
  CleanPackageJsonChange,
  CleanPlan,
  CleanPnpmWorkspaceChange,
  CleanScriptChange,
  CleanTsconfigJsonChange,
  CleanYarnRcChange,
} from './types'

type ManifestValueClaim = {
  path: string
  action?: 'set' | 'array-value'
  value: unknown
}

type Manifest = NonNullable<ReturnType<typeof readManifest>>

// uniqueStrings 함수는 문자열 배열에서 중복 값을 제거한다.
function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

// recordMissingSourceGuard 함수는 같은 부재 경로와 안전 경계를 계획에 한 번만 기록한다.
function recordMissingSourceGuard(
  guards: CleanMissingSourceGuard[],
  path: string,
  safetyRoot: string,
) {
  const guard = { path: resolve(path), safetyRoot: resolve(safetyRoot) }

  if (
    !guards.some(
      (current) => current.path === guard.path && current.safetyRoot === guard.safetyRoot,
    )
  ) {
    guards.push(guard)
  }
}

// resolveManifestClaimRestore 함수는 clean 시 manifest claim을 복구할지 경고만 남길지 결정한다.
function resolveManifestClaimRestore(
  label: string,
  claim: ManifestValueClaim,
  current: ClaimReadResult,
  options: CleanOptions,
) {
  const action = claim.action ?? 'set'
  const ownedLabel = label === 'Package.json' ? 'package.json' : label

  // clean은 보수적으로 동작한다. --force가 없으면 Frontron이 쓴 값이
  // 그대로 남아 있을 때만 복구하고, 사용자가 만진 값은 그대로 둔다.
  if (action === 'array-value') {
    if (Array.isArray(current.value)) {
      return current.value.some((value) => valuesEqual(value, claim.value))
        ? { restore: true }
        : {
            restore: false,
            warning: `Manifest-owned ${ownedLabel} array value is already missing: ${claim.path}`,
          }
    }

    if (!current.exists) {
      return {
        restore: false,
        warning: `Manifest-owned ${ownedLabel} field is already missing: ${claim.path}`,
      }
    }

    return options.force
      ? {
          restore: true,
          warning: `${label} field will be restored because --force was used: ${claim.path}`,
        }
      : {
          restore: false,
          warning: `${label} field has local edits and was left intact: ${claim.path}`,
        }
  }

  if (current.exists && valuesEqual(current.value, claim.value)) {
    return { restore: true }
  }

  if (!current.exists) {
    return {
      restore: false,
      warning: `Manifest-owned ${ownedLabel} field is already missing: ${claim.path}`,
    }
  }

  return options.force
    ? {
        restore: true,
        warning: `${label} field will be restored because --force was used: ${claim.path}`,
      }
    : {
        restore: false,
        warning: `${label} field has local edits and was left intact: ${claim.path}`,
      }
}

// manifest 파일 목록을 안전 상태와 해시 기준으로 삭제 계획에 바꾼다.
function planManagedFiles(
  cwd: string,
  manifest: Manifest,
  options: CleanOptions,
  warnings: string[],
  blockers: string[],
) {
  const files: CleanFileChange[] = []
  const manifestFiles = uniqueStrings([...manifest.createdFiles, MANIFEST_PATH]).sort(
    (left, right) => {
      if (left === MANIFEST_PATH) return 1
      if (right === MANIFEST_PATH) return -1
      return 0
    },
  )

  for (const manifestPath of manifestFiles) {
    // manifest 자체는 파싱한 현재 원문을 계획 기준으로 삼고, 생성 파일은 기록된 해시를 사용한다.
    const manifestExpectedHash =
      manifestPath === MANIFEST_PATH && existsSync(resolve(cwd, manifestPath))
        ? createFileHash(readFileSync(resolve(cwd, manifestPath)))
        : manifest.fileHashes?.[manifestPath]
    const inspection = inspectManagedFile(cwd, manifestPath, manifestExpectedHash)

    if (inspection.state === 'unsafe') {
      const blocker = inspection.blocker ?? `Manifest file entry is unsafe: ${manifestPath}`
      blockers.push(blocker)
      files.push({
        manifestPath,
        absolutePath: inspection.absolutePath,
        action: 'blocked',
        reason: blocker,
      })
      continue
    }

    if (inspection.state === 'missing') {
      warnings.push(`Manifest file is already missing: ${manifestPath}`)
      files.push({
        manifestPath,
        absolutePath: inspection.absolutePath,
        action: 'missing',
        reason: 'File is already missing.',
      })
      continue
    }

    if (inspection.state === 'modified' && !options.force) {
      const blocker = `Manifest-owned file was modified and will not be removed without --force: ${manifestPath}`
      blockers.push(blocker)
      files.push({
        manifestPath,
        absolutePath: inspection.absolutePath,
        action: 'blocked',
        reason: blocker,
      })
      continue
    }

    if (inspection.state === 'unverifiable' && !options.force) {
      const blocker = `Manifest-owned file has no recorded hash and will not be removed without --force: ${manifestPath}`
      blockers.push(blocker)
      files.push({
        manifestPath,
        absolutePath: inspection.absolutePath,
        action: 'blocked',
        reason: blocker,
      })
      continue
    }

    if (inspection.state === 'modified') {
      warnings.push(
        `Modified manifest-owned file will be removed because --force was used: ${manifestPath}`,
      )
    } else if (inspection.state === 'unverifiable') {
      warnings.push(
        `Unverifiable manifest-owned file will be removed because --force was used: ${manifestPath}`,
      )
    }

    files.push({
      manifestPath,
      absolutePath: inspection.absolutePath,
      action: 'delete',
      reason: 'File is recorded in the Frontron manifest.',
      expectedHash: inspection.currentHash,
    })
  }

  return files
}

// manifest script 목록을 현재 package.json 명령과 비교해 제거 계획에 바꾼다.
function planManagedScripts(
  packageJson: PackageJson,
  manifest: Manifest,
  options: CleanOptions,
  warnings: string[],
  blockers: string[],
) {
  const scripts: CleanScriptChange[] = []

  for (const scriptName of uniqueStrings(manifest.scripts)) {
    const state = inspectManagedScript(packageJson.scripts, manifest.scriptCommands, scriptName)

    if (state === 'missing') {
      warnings.push(`Package script is already missing: ${scriptName}`)
      scripts.push({ name: scriptName, action: 'missing' })
      continue
    }

    if (state === 'modified' && !options.force) {
      const blocker = `Manifest-owned script was modified and will not be removed without --force: ${scriptName}`
      blockers.push(blocker)
      scripts.push({ name: scriptName, action: 'blocked' })
      continue
    }

    if (state === 'unverifiable' && !options.force) {
      const blocker = `Manifest-owned script has no recorded command and will not be removed without --force: ${scriptName}`
      blockers.push(blocker)
      scripts.push({ name: scriptName, action: 'blocked' })
      continue
    }

    if (state === 'modified') {
      warnings.push(
        `Modified manifest-owned script will be removed because --force was used: ${scriptName}`,
      )
    } else if (state === 'unverifiable') {
      warnings.push(
        `Unverifiable manifest-owned script will be removed because --force was used: ${scriptName}`,
      )
    }

    scripts.push({ name: scriptName, action: 'remove' })
  }

  return scripts
}

type CleanPlanningState = {
  warnings: string[]
  blockers: string[]
  packageJsonChanges: CleanPackageJsonChange[]
  tsconfigJsonChanges: CleanTsconfigJsonChange[]
  pnpmWorkspaceChanges: CleanPnpmWorkspaceChange[]
  yarnRcChanges: CleanYarnRcChange[]
  sourceHashes: Record<string, string>
  missingSourceGuards: CleanMissingSourceGuard[]
}

function createPlanningState(cwd: string, packageJsonSource: string): CleanPlanningState {
  return {
    warnings: [],
    blockers: [],
    packageJsonChanges: [],
    tsconfigJsonChanges: [],
    pnpmWorkspaceChanges: [],
    yarnRcChanges: [],
    sourceHashes: { [resolve(cwd, 'package.json')]: createFileHash(packageJsonSource) },
    missingSourceGuards: [],
  }
}

// 오래된 manifest는 안전하게 읽을 수 있어도 소유권 정보가 부족할 수 있으므로 갱신을 안내한다.
function addManifestRefreshWarnings(manifest: Manifest, warnings: string[]) {
  const missing = [
    [manifest.fileHashes, 'file hashes'],
    [manifest.scriptCommands, 'script commands'],
    [manifest.packageJsonClaims, 'package.json ownership'],
  ] as const
  for (const [value, label] of missing) {
    if (!value) {
      warnings.push(
        `${MANIFEST_PATH} does not include ${label}. Run "frontron update --yes" to refresh it.`,
      )
    }
  }
}

function planPackageJsonClaims(
  packageJson: PackageJson,
  manifest: Manifest,
  options: CleanOptions,
  state: CleanPlanningState,
) {
  for (const claim of manifest.packageJsonClaims ?? []) {
    const restore = resolveManifestClaimRestore(
      'Package.json',
      claim,
      readPackageJsonPath(packageJson, claim.path),
      options,
    )
    if (restore.warning) state.warnings.push(restore.warning)
    if (restore.restore) state.packageJsonChanges.push({ claim, action: 'restore' })
  }
}

// tsconfig은 JSONC 원문을 보존해야 하므로 파싱 가능할 때만 claim을 계획한다.
function planTsconfigClaims(
  cwd: string,
  manifest: Manifest,
  options: CleanOptions,
  state: CleanPlanningState,
) {
  if ((manifest.tsconfigJsonClaims ?? []).length === 0) return
  const path = join(cwd, 'tsconfig.json')
  const inspection = inspectProjectPath(cwd, path)
  if (!inspection.safe) {
    state.blockers.push(formatProjectPathBlocker(cwd, 'tsconfig.json', inspection))
    return
  }
  if (!existsSync(path)) {
    recordMissingSourceGuard(state.missingSourceGuards, path, cwd)
    state.warnings.push(
      'Manifest-owned tsconfig.json changes are already missing because tsconfig.json is missing.',
    )
    return
  }

  try {
    state.sourceHashes[resolve(path)] = createFileHash(readFileSync(path))
    const tsconfigJson = readTsconfigJson(path)
    for (const claim of manifest.tsconfigJsonClaims ?? []) {
      const restore = resolveManifestClaimRestore(
        'tsconfig.json',
        claim,
        readPackageJsonPath(tsconfigJson, claim.path),
        options,
      )
      if (restore.warning) state.warnings.push(restore.warning)
      if (restore.restore) state.tsconfigJsonChanges.push({ path, claim, action: 'restore' })
    }
  } catch {
    state.warnings.push('tsconfig.json could not be parsed as JSON or JSONC and was left intact.')
  }
}

function planPnpmWorkspaceClaims(
  cwd: string,
  manifest: Manifest,
  options: CleanOptions,
  state: CleanPlanningState,
) {
  if ((manifest.pnpmWorkspaceClaims ?? []).length === 0) return
  const path = findPnpmWorkspaceYamlPath(cwd)
  const safetyRoot = dirname(path)
  const inspection = inspectProjectPath(safetyRoot, path)
  if (!inspection.safe) {
    state.blockers.push(formatProjectPathBlocker(safetyRoot, 'pnpm-workspace.yaml', inspection))
    return
  }
  if (!existsSync(path)) {
    recordMissingSourceGuard(state.missingSourceGuards, path, safetyRoot)
    state.warnings.push(
      'Manifest-owned pnpm-workspace.yaml changes are already missing because pnpm-workspace.yaml is missing.',
    )
    return
  }

  const source = readFileSync(path, 'utf8')
  state.sourceHashes[resolve(path)] = createFileHash(source)
  for (const claim of manifest.pnpmWorkspaceClaims ?? []) {
    const current = readPnpmWorkspaceYamlClaimValue(source, claim.path)
    // 안전하게 판독할 수 없는 YAML은 --force로도 복구하지 않는다.
    if (!current.safeToEdit) {
      state.blockers.push(current.blocker ?? 'Cannot safely inspect pnpm-workspace.yaml.')
      return
    }
    const restore = resolveManifestClaimRestore('pnpm-workspace.yaml', claim, current, options)
    if (restore.warning) state.warnings.push(restore.warning)
    if (restore.restore) state.pnpmWorkspaceChanges.push({ path, claim, action: 'restore' })
  }
}

function planYarnRcClaims(
  cwd: string,
  manifest: Manifest,
  options: CleanOptions,
  state: CleanPlanningState,
) {
  for (const claim of manifest.yarnRcClaims ?? []) {
    if (!claim.changed) continue
    const resolution = resolveYarnRcClaimPath(cwd, claim.file)
    if (!resolution.safe) {
      state.blockers.push(resolution.blocker)
      continue
    }
    if (!existsSync(resolution.path)) {
      recordMissingSourceGuard(state.missingSourceGuards, resolution.path, resolution.safetyRoot)
      state.warnings.push(
        `Manifest-owned ${YARN_RC_YAML_PATH} changes are already missing because ${claim.file} is missing.`,
      )
      continue
    }

    const stats = lstatSync(resolution.path)
    if (!stats.isFile() || stats.nlink !== 1) {
      state.blockers.push(
        !stats.isFile()
          ? `Manifest-owned ${YARN_RC_YAML_PATH} is not a regular file: ${claim.file}`
          : `Manifest-owned ${YARN_RC_YAML_PATH} must have exactly one hard link: ${claim.file}`,
      )
      continue
    }

    const source = readFileSync(resolution.path, 'utf8')
    state.sourceHashes[resolve(resolution.path)] = createFileHash(source)
    const current = readYarnRcYamlClaimValue(source)
    if (!current.safeToEdit) {
      state.blockers.push(current.blocker ?? `Cannot safely inspect ${claim.file}.`)
      continue
    }

    const restore = resolveManifestClaimRestore(YARN_RC_YAML_PATH, claim, current, options)
    if (restore.warning) state.warnings.push(`${claim.file}: ${restore.warning}`)
    if (restore.restore) {
      state.yarnRcChanges.push({ path: resolution.path, claim, action: 'restore' })
    }
  }
}

function readCleanManifest(cwd: string) {
  const path = resolve(cwd, MANIFEST_PATH)
  const inspection = inspectProjectPath(cwd, path)
  if (!inspection.safe) {
    throw new Error(formatProjectPathBlocker(cwd, 'Frontron manifest', inspection))
  }
  const manifest = readManifest(cwd)
  if (!manifest) {
    throw new Error(`${MANIFEST_PATH} was not found. Nothing can be cleaned safely.`)
  }
  return manifest
}

// createCleanPlan 함수는 파일 삭제 계획과 설정 복구 계획을 조합만 한다.
export function createCleanPlan(
  cwd: string,
  packageJson: PackageJson,
  packageJsonSource: string,
  options: CleanOptions,
): CleanPlan {
  // runClean이 계획 직전에 읽은 원문을 그대로 받아 적용 단계와 같은 해시 기준을 사용한다.
  const manifest = readCleanManifest(cwd)
  const state = createPlanningState(cwd, packageJsonSource)

  addManifestRefreshWarnings(manifest, state.warnings)
  const files = planManagedFiles(cwd, manifest, options, state.warnings, state.blockers)
  const scripts = planManagedScripts(packageJson, manifest, options, state.warnings, state.blockers)
  planPackageJsonClaims(packageJson, manifest, options, state)
  planTsconfigClaims(cwd, manifest, options, state)
  planPnpmWorkspaceClaims(cwd, manifest, options, state)
  planYarnRcClaims(cwd, manifest, options, state)

  return {
    files,
    scripts,
    packageJsonChanges: state.packageJsonChanges,
    tsconfigJsonChanges: state.tsconfigJsonChanges,
    pnpmWorkspaceChanges: state.pnpmWorkspaceChanges,
    yarnRcChanges: state.yarnRcChanges,
    sourceHashes: state.sourceHashes,
    missingSourceGuards: state.missingSourceGuards,
    warnings: state.warnings,
    blockers: state.blockers,
  }
}
