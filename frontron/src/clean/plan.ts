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

// resolveManifestFile 함수는 manifest의 상대 파일 경로를 안전한 절대 경로로 해석한다.
// createCleanPlan 함수는 manifest를 기준으로 clean이 지울 항목과 막아야 할 항목을 계산한다.
export function createCleanPlan(
  cwd: string,
  packageJson: PackageJson,
  packageJsonSourceOrOptions: string | CleanOptions,
  maybeOptions?: CleanOptions,
): CleanPlan {
  const packageJsonSource =
    typeof packageJsonSourceOrOptions === 'string'
      ? packageJsonSourceOrOptions
      : readFileSync(resolve(cwd, 'package.json'), 'utf8')
  const options =
    typeof packageJsonSourceOrOptions === 'string'
      ? (maybeOptions as CleanOptions)
      : packageJsonSourceOrOptions
  const manifestAbsolutePath = resolve(cwd, MANIFEST_PATH)
  const manifestInspection = inspectProjectPath(cwd, manifestAbsolutePath)

  if (!manifestInspection.safe) {
    throw new Error(formatProjectPathBlocker(cwd, 'Frontron manifest', manifestInspection))
  }

  const manifest = readManifest(cwd)

  if (!manifest) {
    throw new Error(`${MANIFEST_PATH} was not found. Nothing can be cleaned safely.`)
  }

  const warnings: string[] = []

  if (!manifest.fileHashes) {
    warnings.push(
      `${MANIFEST_PATH} does not include file hashes. Run "frontron update --yes" to refresh it.`,
    )
  }

  if (!manifest.scriptCommands) {
    warnings.push(
      `${MANIFEST_PATH} does not include script commands. Run "frontron update --yes" to refresh it.`,
    )
  }

  if (!manifest.packageJsonClaims) {
    warnings.push(
      `${MANIFEST_PATH} does not include package.json ownership. Run "frontron update --yes" to refresh it.`,
    )
  }

  const blockers: string[] = []
  const files = planManagedFiles(cwd, manifest, options, warnings, blockers)
  const scripts = planManagedScripts(packageJson, manifest, options, warnings, blockers)
  const packageJsonChanges: CleanPackageJsonChange[] = []
  const tsconfigJsonChanges: CleanTsconfigJsonChange[] = []
  const pnpmWorkspaceChanges: CleanPnpmWorkspaceChange[] = []
  const yarnRcChanges: CleanYarnRcChange[] = []
  const sourceHashes: Record<string, string> = {
    [resolve(cwd, 'package.json')]: createFileHash(packageJsonSource),
  }
  const missingSourceGuards: CleanMissingSourceGuard[] = []
  for (const claim of manifest.packageJsonClaims ?? []) {
    const restore = resolveManifestClaimRestore(
      'Package.json',
      claim,
      readPackageJsonPath(packageJson, claim.path),
      options,
    )

    if (restore.warning) {
      warnings.push(restore.warning)
    }

    if (restore.restore) {
      packageJsonChanges.push({
        claim,
        action: 'restore',
      })
    }
  }

  const tsconfigJsonClaims = manifest.tsconfigJsonClaims ?? []

  if (tsconfigJsonClaims.length > 0) {
    const tsconfigPath = join(cwd, 'tsconfig.json')
    const tsconfigInspection = inspectProjectPath(cwd, tsconfigPath)

    if (!tsconfigInspection.safe) {
      blockers.push(formatProjectPathBlocker(cwd, 'tsconfig.json', tsconfigInspection))
    } else if (!existsSync(tsconfigPath)) {
      recordMissingSourceGuard(missingSourceGuards, tsconfigPath, cwd)
      warnings.push(
        'Manifest-owned tsconfig.json changes are already missing because tsconfig.json is missing.',
      )
    } else {
      try {
        sourceHashes[resolve(tsconfigPath)] = createFileHash(readFileSync(tsconfigPath))
        const tsconfigJson = readTsconfigJson(tsconfigPath)

        for (const claim of tsconfigJsonClaims) {
          const restore = resolveManifestClaimRestore(
            'tsconfig.json',
            claim,
            readPackageJsonPath(tsconfigJson, claim.path),
            options,
          )

          if (restore.warning) {
            warnings.push(restore.warning)
          }

          if (restore.restore) {
            tsconfigJsonChanges.push({
              path: tsconfigPath,
              claim,
              action: 'restore',
            })
          }
        }
      } catch {
        warnings.push('tsconfig.json could not be parsed as JSON or JSONC and was left intact.')
      }
    }
  }

  const pnpmWorkspaceClaims = manifest.pnpmWorkspaceClaims ?? []

  if (pnpmWorkspaceClaims.length > 0) {
    const pnpmWorkspacePath = findPnpmWorkspaceYamlPath(cwd)
    const pnpmWorkspaceRoot = dirname(pnpmWorkspacePath)
    const pnpmWorkspaceInspection = inspectProjectPath(pnpmWorkspaceRoot, pnpmWorkspacePath)

    if (!pnpmWorkspaceInspection.safe) {
      blockers.push(
        formatProjectPathBlocker(pnpmWorkspaceRoot, 'pnpm-workspace.yaml', pnpmWorkspaceInspection),
      )
    } else if (!existsSync(pnpmWorkspacePath)) {
      recordMissingSourceGuard(missingSourceGuards, pnpmWorkspacePath, pnpmWorkspaceRoot)
      warnings.push(
        'Manifest-owned pnpm-workspace.yaml changes are already missing because pnpm-workspace.yaml is missing.',
      )
    } else {
      const pnpmWorkspaceSource = readFileSync(pnpmWorkspacePath, 'utf8')
      sourceHashes[resolve(pnpmWorkspacePath)] = createFileHash(pnpmWorkspaceSource)

      for (const claim of pnpmWorkspaceClaims) {
        const current = readPnpmWorkspaceYamlClaimValue(pnpmWorkspaceSource, claim.path)

        // 안전하게 판독할 수 없는 YAML은 --force로도 복구하거나 제거하지 않는다.
        if (!current.safeToEdit) {
          blockers.push(current.blocker ?? 'Cannot safely inspect pnpm-workspace.yaml.')
          break
        }

        const restore = resolveManifestClaimRestore('pnpm-workspace.yaml', claim, current, options)

        if (restore.warning) {
          warnings.push(restore.warning)
        }

        if (restore.restore) {
          pnpmWorkspaceChanges.push({
            path: pnpmWorkspacePath,
            claim,
            action: 'restore',
          })
        }
      }
    }
  }

  for (const claim of manifest.yarnRcClaims ?? []) {
    if (!claim.changed) {
      continue
    }

    const resolution = resolveYarnRcClaimPath(cwd, claim.file)

    if (!resolution.safe) {
      blockers.push(resolution.blocker)
      continue
    }

    if (!existsSync(resolution.path)) {
      recordMissingSourceGuard(missingSourceGuards, resolution.path, resolution.safetyRoot)
      warnings.push(
        `Manifest-owned ${YARN_RC_YAML_PATH} changes are already missing because ${claim.file} is missing.`,
      )
      continue
    }

    const stats = lstatSync(resolution.path)

    if (!stats.isFile()) {
      blockers.push(`Manifest-owned ${YARN_RC_YAML_PATH} is not a regular file: ${claim.file}`)
      continue
    }

    if (stats.nlink !== 1) {
      blockers.push(
        `Manifest-owned ${YARN_RC_YAML_PATH} must have exactly one hard link: ${claim.file}`,
      )
      continue
    }

    const yarnRcSource = readFileSync(resolution.path, 'utf8')
    sourceHashes[resolve(resolution.path)] = createFileHash(yarnRcSource)
    const current = readYarnRcYamlClaimValue(yarnRcSource)

    if (!current.safeToEdit) {
      blockers.push(current.blocker ?? `Cannot safely inspect ${claim.file}.`)
      continue
    }

    const restore = resolveManifestClaimRestore(YARN_RC_YAML_PATH, claim, current, options)

    if (restore.warning) {
      warnings.push(`${claim.file}: ${restore.warning}`)
    }

    if (restore.restore) {
      yarnRcChanges.push({
        path: resolution.path,
        claim,
        action: 'restore',
      })
    }
  }

  return {
    files,
    scripts,
    packageJsonChanges,
    tsconfigJsonChanges,
    pnpmWorkspaceChanges,
    yarnRcChanges,
    sourceHashes,
    missingSourceGuards,
    warnings,
    blockers,
  }
}
