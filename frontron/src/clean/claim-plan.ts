import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { createFileHash, type FrontronManifest } from '../init/manifest'
import { readPackageJsonPath, valuesEqual } from '../init/package-json-path'
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
import { formatProjectPathBlocker, inspectProjectPath } from '../project-paths'
import type {
  ClaimReadResult,
  CleanMissingSourceGuard,
  CleanOptions,
  CleanPackageJsonChange,
  CleanPnpmWorkspaceChange,
  CleanTsconfigJsonChange,
  CleanYarnRcChange,
} from './types'

type ManifestValueClaim = {
  path: string
  action?: 'set' | 'array-value'
  value: unknown
}

type ClaimCleanPlan = {
  packageJsonChanges: CleanPackageJsonChange[]
  tsconfigJsonChanges: CleanTsconfigJsonChange[]
  pnpmWorkspaceChanges: CleanPnpmWorkspaceChange[]
  yarnRcChanges: CleanYarnRcChange[]
  sourceHashes: Record<string, string>
  missingSourceGuards: CleanMissingSourceGuard[]
  warnings: string[]
  blockers: string[]
}

// 계획 당시 없던 설정 파일은 경로 안전 경계와 함께 한 번만 기록한다.
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

// 현재 값과 manifest claim을 비교해 clean에서 원래 값으로 복구할지 결정한다.
function resolveManifestClaimRestore(
  label: string,
  claim: ManifestValueClaim,
  current: ClaimReadResult,
  options: CleanOptions,
) {
  const action = claim.action ?? 'set'
  const ownedLabel = label === 'Package.json' ? 'package.json' : label

  // --force가 없으면 Frontron이 쓴 값이 그대로 남아 있을 때만 복구한다.
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

  if (current.exists && valuesEqual(current.value, claim.value)) return { restore: true }

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

function createClaimPlanningState(cwd: string, packageJsonSource: string): ClaimCleanPlan {
  return {
    packageJsonChanges: [],
    tsconfigJsonChanges: [],
    pnpmWorkspaceChanges: [],
    yarnRcChanges: [],
    sourceHashes: { [resolve(cwd, 'package.json')]: createFileHash(packageJsonSource) },
    missingSourceGuards: [],
    warnings: [],
    blockers: [],
  }
}

function planPackageJsonClaims(
  packageJson: PackageJson,
  manifest: FrontronManifest,
  options: CleanOptions,
  state: ClaimCleanPlan,
) {
  for (const claim of manifest.packageJsonClaims) {
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

// tsconfig은 JSONC 원문을 보존해야 하므로 안전하게 파싱할 수 있을 때만 복구 계획에 넣는다.
function planTsconfigClaims(
  cwd: string,
  manifest: FrontronManifest,
  options: CleanOptions,
  state: ClaimCleanPlan,
) {
  if (manifest.tsconfigJsonClaims.length === 0) return

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

    for (const claim of manifest.tsconfigJsonClaims) {
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
  manifest: FrontronManifest,
  options: CleanOptions,
  state: ClaimCleanPlan,
) {
  if (manifest.pnpmWorkspaceClaims.length === 0) return

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

  for (const claim of manifest.pnpmWorkspaceClaims) {
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
  manifest: FrontronManifest,
  options: CleanOptions,
  state: ClaimCleanPlan,
) {
  for (const claim of manifest.yarnRcClaims) {
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

// package.json과 패키지 매니저 설정의 원상 복구 계획만 만든다.
export function createClaimCleanPlan(
  cwd: string,
  packageJson: PackageJson,
  packageJsonSource: string,
  manifest: FrontronManifest,
  options: CleanOptions,
): ClaimCleanPlan {
  const state = createClaimPlanningState(cwd, packageJsonSource)

  planPackageJsonClaims(packageJson, manifest, options, state)
  planTsconfigClaims(cwd, manifest, options, state)
  planPnpmWorkspaceClaims(cwd, manifest, options, state)
  planYarnRcClaims(cwd, manifest, options, state)

  return state
}
