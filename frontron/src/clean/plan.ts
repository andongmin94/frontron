import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { isInsideDirectory } from '../project-paths'
import {
  createFileHash,
  MANIFEST_PATH,
  type PackageJsonOwnershipClaim,
  readManifest,
} from '../init/manifest'
import { readPackageJsonPath, valuesEqual } from '../init/package-json-path'
import {
  findPnpmWorkspaceYamlPath,
  readPnpmWorkspaceYamlClaimValue,
} from '../init/pnpm-workspace-yaml'
import type { PackageJson } from '../init/shared'
import { readTsconfigJson } from '../init/tsconfig-json'
import type {
  ClaimReadResult,
  CleanFileChange,
  CleanOptions,
  CleanPackageJsonChange,
  CleanPlan,
  CleanPnpmWorkspaceChange,
  CleanScriptChange,
  CleanTsconfigJsonChange,
} from './types'

// uniqueStrings 함수는 문자열 배열에서 중복 값을 제거한다.
function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

// hasOwnString 함수는 객체가 특정 문자열 키를 직접 가지고 있는지 확인한다.
function hasOwnString(record: Record<string, string> | undefined, key: string) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key))
}

// resolveManifestClaimRestore 함수는 clean 시 manifest claim을 복구할지 경고만 남길지 결정한다.
function resolveManifestClaimRestore(
  label: string,
  claim: PackageJsonOwnershipClaim,
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

// resolveManifestFile 함수는 manifest의 상대 파일 경로를 안전한 절대 경로로 해석한다.
function resolveManifestFile(cwd: string, manifestPath: string) {
  const root = resolve(cwd)

  if (isAbsolute(manifestPath)) {
    return {
      absolutePath: resolve(manifestPath),
      blocker: `Manifest file entry must be relative: ${manifestPath}`,
    }
  }

  const absolutePath = resolve(root, manifestPath)

  if (!isInsideDirectory(root, absolutePath)) {
    return {
      absolutePath,
      blocker: `Manifest file entry points outside the project: ${manifestPath}`,
    }
  }

  if (absolutePath === root) {
    return {
      absolutePath,
      blocker: `Manifest file entry cannot target the project root: ${manifestPath}`,
    }
  }

  return { absolutePath, blocker: null }
}

// createCleanPlan 함수는 manifest를 기준으로 clean이 지울 항목과 막아야 할 항목을 계산한다.
export function createCleanPlan(
  cwd: string,
  packageJson: PackageJson,
  options: CleanOptions,
): CleanPlan {
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
  const files: CleanFileChange[] = []
  const scripts: CleanScriptChange[] = []
  const packageJsonChanges: CleanPackageJsonChange[] = []
  const tsconfigJsonChanges: CleanTsconfigJsonChange[] = []
  const pnpmWorkspaceChanges: CleanPnpmWorkspaceChange[] = []
  const manifestFiles = uniqueStrings([...manifest.createdFiles, MANIFEST_PATH]).sort(
    (left, right) => {
      if (left === MANIFEST_PATH) return 1
      if (right === MANIFEST_PATH) return -1
      return 0
    },
  )

  for (const manifestPath of manifestFiles) {
    const resolved = resolveManifestFile(cwd, manifestPath)

    if (resolved.blocker) {
      blockers.push(resolved.blocker)
      files.push({
        manifestPath,
        absolutePath: resolved.absolutePath,
        action: 'blocked',
        reason: resolved.blocker,
      })
      continue
    }

    if (!existsSync(resolved.absolutePath)) {
      warnings.push(`Manifest file is already missing: ${manifestPath}`)
      files.push({
        manifestPath,
        absolutePath: resolved.absolutePath,
        action: 'missing',
        reason: 'File is already missing.',
      })
      continue
    }

    const stats = lstatSync(resolved.absolutePath)

    if (stats.isSymbolicLink()) {
      const blocker = `Manifest file entry points to a symbolic link and will not be removed: ${manifestPath}`
      blockers.push(blocker)
      files.push({
        manifestPath,
        absolutePath: resolved.absolutePath,
        action: 'blocked',
        reason: blocker,
      })
      continue
    }

    if (stats.isDirectory()) {
      const blocker = `Manifest file entry points to a directory and will not be removed: ${manifestPath}`
      blockers.push(blocker)
      files.push({
        manifestPath,
        absolutePath: resolved.absolutePath,
        action: 'blocked',
        reason: blocker,
      })
      continue
    }

    const expectedHash = manifest.fileHashes?.[manifestPath]

    if (expectedHash) {
      const currentHash = createFileHash(readFileSync(resolved.absolutePath))

      if (currentHash !== expectedHash && !options.force) {
        const blocker = `Manifest-owned file was modified and will not be removed without --force: ${manifestPath}`
        blockers.push(blocker)
        files.push({
          manifestPath,
          absolutePath: resolved.absolutePath,
          action: 'blocked',
          reason: blocker,
        })
        continue
      }

      if (currentHash !== expectedHash) {
        warnings.push(
          `Modified manifest-owned file will be removed because --force was used: ${manifestPath}`,
        )
      }
    } else if (manifestPath !== MANIFEST_PATH && manifest.fileHashes) {
      warnings.push(`Manifest file hash is missing for: ${manifestPath}`)
    }

    files.push({
      manifestPath,
      absolutePath: resolved.absolutePath,
      action: 'delete',
      reason: 'File is recorded in the Frontron manifest.',
    })
  }

  for (const scriptName of uniqueStrings(manifest.scripts)) {
    const currentCommand = packageJson.scripts?.[scriptName]

    if (!hasOwnString(packageJson.scripts, scriptName)) {
      warnings.push(`Package script is already missing: ${scriptName}`)
      scripts.push({ name: scriptName, action: 'missing' })
      continue
    }

    const expectedCommand = manifest.scriptCommands?.[scriptName]

    if (
      hasOwnString(manifest.scriptCommands, scriptName) &&
      currentCommand !== expectedCommand &&
      !options.force
    ) {
      const blocker = `Manifest-owned script was modified and will not be removed without --force: ${scriptName}`
      blockers.push(blocker)
      scripts.push({ name: scriptName, action: 'blocked' })
      continue
    }

    if (hasOwnString(manifest.scriptCommands, scriptName) && currentCommand !== expectedCommand) {
      warnings.push(
        `Modified manifest-owned script will be removed because --force was used: ${scriptName}`,
      )
    } else if (!hasOwnString(manifest.scriptCommands, scriptName) && manifest.scriptCommands) {
      warnings.push(`Manifest script command is missing for: ${scriptName}`)
    }

    scripts.push({ name: scriptName, action: 'remove' })
  }

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

    if (!existsSync(tsconfigPath)) {
      warnings.push(
        'Manifest-owned tsconfig.json changes are already missing because tsconfig.json is missing.',
      )
    } else {
      try {
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

    if (!existsSync(pnpmWorkspacePath)) {
      warnings.push(
        'Manifest-owned pnpm-workspace.yaml changes are already missing because pnpm-workspace.yaml is missing.',
      )
    } else {
      const pnpmWorkspaceSource = readFileSync(pnpmWorkspacePath, 'utf8')

      for (const claim of pnpmWorkspaceClaims) {
        const restore = resolveManifestClaimRestore(
          'pnpm-workspace.yaml',
          claim,
          readPnpmWorkspaceYamlClaimValue(pnpmWorkspaceSource, claim.path),
          options,
        )

        if (restore.warning) {
          warnings.push(restore.warning)
        }

        if (restore.restore) {
          pnpmWorkspaceChanges.push({
            claim,
            action: 'restore',
          })
        }
      }
    }
  }

  return {
    files,
    scripts,
    packageJsonChanges,
    tsconfigJsonChanges,
    pnpmWorkspaceChanges,
    warnings,
    blockers,
  }
}
