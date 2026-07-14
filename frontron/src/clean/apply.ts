import { existsSync, lstatSync, readFileSync, readdirSync, rmdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { assertProjectPathSafe, isInsideDirectory } from '../project-paths'
import {
  assertTransactionTargetUnchanged,
  beginTransaction,
  commitTransaction,
  removeTransactionFile,
  rollbackTransaction,
  writeTransactionFile,
  type TransactionHandle,
  type TransactionTarget,
} from '../transaction-journal'
import { createFileHash, type PackageJsonOwnershipClaim } from '../init/manifest'
import {
  cloneJsonValue,
  deletePackageJsonPath,
  readPackageJsonPath,
  writePackageJsonPath,
} from '../init/package-json-path'
import { restorePnpmWorkspaceYamlClaim } from '../init/pnpm-workspace-yaml'
import type { PackageJson } from '../init/shared'
import { restoreYarnRcYamlClaim, YARN_RC_YAML_PATH } from '../init/yarnrc-yaml'
import { restoreTsconfigJsonClaims } from './tsconfig-source'
import type { CleanPlan } from './types'

// uniqueStrings 함수는 문자열 배열에서 중복 값을 제거한다.
function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

// restorePackageJsonClaim 함수는 manifest claim에 기록된 이전 상태로 package.json 값을 되돌린다.
function restorePackageJsonClaim(packageJson: PackageJson, claim: PackageJsonOwnershipClaim) {
  if (claim.action === 'array-value') {
    const current = readPackageJsonPath(packageJson, claim.path)

    if (Array.isArray(current.value)) {
      const nextValues = current.value.filter((value) => value !== claim.value)

      if (nextValues.length > 0) {
        writePackageJsonPath(packageJson, claim.path, nextValues)
      } else if (claim.previous.state === 'missing') {
        deletePackageJsonPath(packageJson, claim.path)
      } else {
        writePackageJsonPath(packageJson, claim.path, [])
      }
    } else if (claim.previous.state === 'value') {
      writePackageJsonPath(packageJson, claim.path, claim.previous.value)
    } else {
      deletePackageJsonPath(packageJson, claim.path)
    }

    return
  }

  if (claim.previous.state === 'value') {
    writePackageJsonPath(packageJson, claim.path, claim.previous.value)
  } else {
    deletePackageJsonPath(packageJson, claim.path)
  }
}

// removeEmptyParents 함수는 파일 삭제 후 비어 있는 생성 폴더를 프로젝트 안에서만 정리한다.
function removeEmptyParents(cwd: string, filePaths: string[]) {
  const root = resolve(cwd)
  const directories = uniqueStrings(filePaths.map((filePath) => dirname(filePath))).sort(
    (left, right) => right.length - left.length,
  )

  for (const directory of directories) {
    if (directory === root || !isInsideDirectory(root, directory) || !existsSync(directory)) {
      continue
    }

    try {
      assertProjectPathSafe(root, directory, 'Clean directory')

      if (readdirSync(directory).length === 0) {
        rmdirSync(directory)
      }
    } catch {
      // 비어 있지 않거나 동시에 바뀐 폴더는 사용자 파일일 수 있으므로 그대로 둔다.
    }
  }
}

// groupClaimsByPath 함수는 같은 설정 파일에 적용할 claim을 한 번의 원문 편집으로 묶는다.
function groupClaimsByPath<TClaim>(changes: Array<{ path: string; claim: TClaim }>) {
  const grouped = new Map<string, TClaim[]>()

  for (const change of changes) {
    const claims = grouped.get(change.path) ?? []
    claims.push(change.claim)
    grouped.set(change.path, claims)
  }

  return grouped
}

// writeSafeFile 함수는 실제 쓰기 직전에 링크 부모가 생기지 않았는지 다시 검사한다.
function writeSafeFile(
  transaction: TransactionHandle,
  filePath: string,
  content: string | Buffer,
  safetyRoot: string,
) {
  assertProjectPathSafe(safetyRoot, filePath, 'Clean target path')
  writeTransactionFile(transaction, filePath, content, safetyRoot)
}

// createCleanTransactionTargets 함수는 clean이 수정·삭제할 파일과 지울 수 있는 빈 디렉터리를 모은다.
function createCleanTransactionTargets(
  projectRoot: string,
  packageJsonPath: string,
  packageJsonChanged: boolean,
  tsconfigPaths: Iterable<string>,
  pnpmWorkspacePaths: Iterable<string>,
  yarnRcPaths: Iterable<string>,
  managedFiles: CleanPlan['files'],
  sourceHashes: CleanPlan['sourceHashes'],
  missingSourceGuards: CleanPlan['missingSourceGuards'],
) {
  const targets: TransactionTarget[] = []
  // getPlannedHash 함수는 clean 계획에 고정된 원본 해시만 transaction target에 전달한다.
  const getPlannedHash = (filePath: string) => {
    const hash = sourceHashes[resolve(filePath)]
    if (!hash) throw new Error(`Clean plan is missing the source hash for: ${filePath}`)
    return hash
  }

  if (packageJsonChanged) {
    targets.push({
      path: packageJsonPath,
      safetyRoot: projectRoot,
      expectedHash: getPlannedHash(packageJsonPath),
    })
  }

  for (const tsconfigPath of tsconfigPaths) {
    targets.push({
      path: tsconfigPath,
      safetyRoot: projectRoot,
      expectedHash: getPlannedHash(tsconfigPath),
    })
  }

  for (const pnpmWorkspacePath of pnpmWorkspacePaths) {
    targets.push({
      path: pnpmWorkspacePath,
      safetyRoot: dirname(resolve(pnpmWorkspacePath)),
      expectedHash: getPlannedHash(pnpmWorkspacePath),
    })
  }

  for (const yarnRcPath of yarnRcPaths) {
    targets.push({
      path: yarnRcPath,
      safetyRoot: isInsideDirectory(projectRoot, resolve(yarnRcPath))
        ? projectRoot
        : dirname(resolve(yarnRcPath)),
      expectedHash: getPlannedHash(yarnRcPath),
    })
  }

  for (const file of managedFiles) {
    if (file.action === 'delete') {
      const expectedHash = file.expectedHash

      if (!expectedHash) {
        throw new Error(`Clean plan is missing the file hash for: ${file.manifestPath}`)
      }

      targets.push({
        path: file.absolutePath,
        safetyRoot: projectRoot,
        expectedHash,
      })
    } else if (file.action === 'missing') {
      targets.push({
        path: file.absolutePath,
        safetyRoot: projectRoot,
        expectedHash: null,
      })
    }
  }

  for (const guard of missingSourceGuards) {
    targets.push({
      path: guard.path,
      safetyRoot: guard.safetyRoot,
      expectedHash: null,
    })
  }

  const removableDirectories = uniqueStrings(
    managedFiles
      .filter((file) => file.action === 'delete')
      .map((file) => resolve(dirname(file.absolutePath))),
  ).filter((directory) => directory !== projectRoot)

  for (const directory of removableDirectories) {
    targets.push({
      path: directory,
      safetyRoot: projectRoot,
      kind: 'directory',
    })
  }

  return targets
}

// applyCleanPlan 함수는 모든 대상의 스냅샷을 만든 뒤 clean 계획을 하나의 트랜잭션으로 적용한다.
export function applyCleanPlan(
  cwd: string,
  packageJsonPath: string,
  packageJson: PackageJson,
  plan: CleanPlan,
) {
  const projectRoot = resolve(cwd)
  const nextPackageJson = cloneJsonValue(packageJson)
  const scripts = { ...(nextPackageJson.scripts ?? {}) }
  let packageJsonChanged = false

  for (const script of plan.scripts) {
    if (script.action === 'remove') {
      delete scripts[script.name]
      packageJsonChanged = true
    }
  }

  for (const change of plan.packageJsonChanges) {
    restorePackageJsonClaim(nextPackageJson, change.claim)
    packageJsonChanged = true
  }

  if (packageJsonChanged) {
    nextPackageJson.scripts = scripts
  }

  const tsconfigClaimsByPath = groupClaimsByPath(plan.tsconfigJsonChanges)
  const pnpmClaimsByPath = groupClaimsByPath(plan.pnpmWorkspaceChanges)
  const yarnRcClaimsByPath = groupClaimsByPath(plan.yarnRcChanges)
  const filesToDelete = plan.files.filter((file) => file.action === 'delete')
  const missingFiles = plan.files.filter((file) => file.action === 'missing')
  const missingSourceGuards = plan.missingSourceGuards ?? []
  const transactionTargets = createCleanTransactionTargets(
    projectRoot,
    packageJsonPath,
    packageJsonChanged,
    tsconfigClaimsByPath.keys(),
    pnpmClaimsByPath.keys(),
    yarnRcClaimsByPath.keys(),
    plan.files,
    plan.sourceHashes,
    missingSourceGuards,
  )
  let transaction: TransactionHandle | null = null

  try {
    transaction = beginTransaction(projectRoot, 'clean', transactionTargets)

    if (packageJsonChanged) {
      writeSafeFile(
        transaction,
        packageJsonPath,
        `${JSON.stringify(nextPackageJson, null, 2)}\n`,
        projectRoot,
      )
    }

    for (const [tsconfigPath, claims] of tsconfigClaimsByPath) {
      assertProjectPathSafe(projectRoot, tsconfigPath, 'tsconfig.json')
      const source = readFileSync(tsconfigPath, 'utf8')
      const nextSource = restoreTsconfigJsonClaims(source, claims)
      writeSafeFile(transaction, tsconfigPath, nextSource, projectRoot)
    }

    for (const [pnpmWorkspacePath, claims] of pnpmClaimsByPath) {
      const safetyRoot = dirname(resolve(pnpmWorkspacePath))
      assertProjectPathSafe(safetyRoot, pnpmWorkspacePath, 'pnpm-workspace.yaml')
      let source = readFileSync(pnpmWorkspacePath, 'utf8')

      for (const claim of claims) {
        source = restorePnpmWorkspaceYamlClaim(source, claim)
      }

      assertProjectPathSafe(safetyRoot, pnpmWorkspacePath, 'pnpm-workspace.yaml')

      if (source.trim()) {
        writeSafeFile(transaction, pnpmWorkspacePath, source, safetyRoot)
      } else {
        removeTransactionFile(transaction, pnpmWorkspacePath, safetyRoot)
      }
    }

    for (const [yarnRcPath, claims] of yarnRcClaimsByPath) {
      const safetyRoot = isInsideDirectory(projectRoot, resolve(yarnRcPath))
        ? projectRoot
        : dirname(resolve(yarnRcPath))
      assertProjectPathSafe(safetyRoot, yarnRcPath, YARN_RC_YAML_PATH)
      let source = readFileSync(yarnRcPath, 'utf8')

      for (const claim of claims) {
        const restored = restoreYarnRcYamlClaim(source, claim)

        if (restored.blocker) {
          throw new Error(restored.blocker)
        }

        source = restored.source
      }

      assertProjectPathSafe(safetyRoot, yarnRcPath, YARN_RC_YAML_PATH)

      if (source === '' && claims.some((claim) => claim.created)) {
        removeTransactionFile(transaction, yarnRcPath, safetyRoot)
      } else {
        writeSafeFile(transaction, yarnRcPath, source, safetyRoot)
      }
    }

    const deletedFiles: string[] = []

    for (const file of filesToDelete) {
      assertProjectPathSafe(projectRoot, file.absolutePath, 'Manifest file entry')

      if (existsSync(file.absolutePath)) {
        const stats = lstatSync(file.absolutePath)

        if (!stats.isFile()) {
          throw new Error(`Manifest file entry is no longer a regular file: ${file.manifestPath}`)
        }

        if (
          file.expectedHash &&
          createFileHash(readFileSync(file.absolutePath)) !== file.expectedHash
        ) {
          throw new Error(`Manifest-owned file changed after planning: ${file.manifestPath}`)
        }
      }

      assertProjectPathSafe(projectRoot, file.absolutePath, 'Manifest file entry')
      removeTransactionFile(transaction, file.absolutePath, projectRoot)
      deletedFiles.push(file.absolutePath)
    }

    for (const file of missingFiles) {
      assertTransactionTargetUnchanged(transaction, file.absolutePath, projectRoot)
    }

    for (const guard of missingSourceGuards) {
      assertTransactionTargetUnchanged(transaction, guard.path, guard.safetyRoot)
    }

    removeEmptyParents(cwd, deletedFiles)
    commitTransaction(transaction)
  } catch (error) {
    const rollbackErrors: string[] = []

    if (transaction) {
      try {
        rollbackTransaction(transaction)
      } catch (rollbackError) {
        rollbackErrors.push(`persistent journal: ${(rollbackError as Error).message}`)
      }
    }

    const rollbackMessage =
      rollbackErrors.length > 0
        ? ` Rollback also failed for: ${rollbackErrors.join('; ')}`
        : ' Project files were rolled back from the persistent journal.'

    throw new Error(
      `Clean failed while applying project changes: ${(error as Error).message}.${rollbackMessage}`,
      { cause: error },
    )
  }
}
