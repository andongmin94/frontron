import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { formatProjectPathBlocker, inspectProjectPath, isInsideDirectory } from '../project-paths'
import { createFileHash, MANIFEST_PATH, readManifest } from '../init/manifest'
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
import type {
  ClaimReadResult,
  CleanFileChange,
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

  const inspection = inspectProjectPath(root, absolutePath)

  if (!inspection.safe) {
    const blocker =
      inspection.reason === 'outside'
        ? `Manifest file entry points outside the project: ${manifestPath}`
        : `Manifest file entry uses a symbolic link or junction and will not be removed: ${manifestPath}`

    return {
      absolutePath,
      blocker,
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
  const files: CleanFileChange[] = []
  const scripts: CleanScriptChange[] = []
  const packageJsonChanges: CleanPackageJsonChange[] = []
  const tsconfigJsonChanges: CleanTsconfigJsonChange[] = []
  const pnpmWorkspaceChanges: CleanPnpmWorkspaceChange[] = []
  const yarnRcChanges: CleanYarnRcChange[] = []
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
    const currentHash = createFileHash(readFileSync(resolved.absolutePath))

    if (expectedHash) {
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
      expectedHash: currentHash,
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
    const tsconfigInspection = inspectProjectPath(cwd, tsconfigPath)

    if (!tsconfigInspection.safe) {
      blockers.push(formatProjectPathBlocker(cwd, 'tsconfig.json', tsconfigInspection))
    } else if (!existsSync(tsconfigPath)) {
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

    const current = readYarnRcYamlClaimValue(readFileSync(resolution.path, 'utf8'))

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
    warnings,
    blockers,
  }
}
