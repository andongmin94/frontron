import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

import { assertProjectPathSafe, isInsideDirectory } from '../project-paths'
import {
  beginTransaction,
  commitTransaction,
  createTransactionSourceHash,
  rollbackTransaction,
  type TransactionHandle,
  type TransactionTarget,
} from '../transaction-journal'
import { createFileHash, type PackageJsonOwnershipClaim } from '../init/manifest'
import {
  deletePackageJsonPath,
  readPackageJsonPath,
  writePackageJsonPath,
} from '../init/package-json-path'
import { restorePnpmWorkspaceYamlClaim } from '../init/pnpm-workspace-yaml'
import type { PackageJson } from '../init/shared'
import { restoreYarnRcYamlClaim, YARN_RC_YAML_PATH } from '../init/yarnrc-yaml'
import { restoreTsconfigJsonClaims } from './tsconfig-source'
import type { CleanPlan } from './types'

type FileSnapshot = {
  path: string
  safetyRoot: string
  existed: boolean
  content: Buffer | null
  mode: number | null
}

// createCurrentExpectedHash 함수는 clean이 lock을 기다리는 동안 원문이 바뀌는지 확인할 해시를 만든다.
function createCurrentExpectedHash(filePath: string) {
  return existsSync(filePath) ? createTransactionSourceHash(readFileSync(filePath)) : null
}

// uniqueStrings 함수는 문자열 배열에서 중복 값을 제거한다.
function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

// clonePackageJson 함수는 clean 계산 중 호출자가 가진 package.json 객체를 바꾸지 않게 복사한다.
function clonePackageJson(packageJson: PackageJson): PackageJson {
  return JSON.parse(JSON.stringify(packageJson)) as PackageJson
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

// takeFileSnapshot 함수는 clean 변경 전 원문 바이트와 파일 모드를 저장한다.
function takeFileSnapshot(filePath: string, safetyRoot: string): FileSnapshot {
  assertProjectPathSafe(safetyRoot, filePath, 'Clean target path')

  if (!existsSync(filePath)) {
    return {
      path: resolve(filePath),
      safetyRoot,
      existed: false,
      content: null,
      mode: null,
    }
  }

  const stats = lstatSync(filePath)

  if (!stats.isFile()) {
    throw new Error(`Clean target is not a regular file: ${filePath}`)
  }

  return {
    path: resolve(filePath),
    safetyRoot,
    existed: true,
    content: readFileSync(filePath),
    mode: stats.mode,
  }
}

// rememberSnapshot 함수는 같은 경로가 여러 변경에 포함돼도 최초 상태만 보관한다.
function rememberSnapshot(
  snapshots: Map<string, FileSnapshot>,
  filePath: string,
  safetyRoot: string,
) {
  const absolutePath = resolve(filePath)

  if (!snapshots.has(absolutePath)) {
    snapshots.set(absolutePath, takeFileSnapshot(absolutePath, safetyRoot))
  }
}

// removeEmptySnapshotParents 함수는 rollback 중 새 파일을 지운 뒤 생긴 빈 폴더만 정리한다.
function removeEmptySnapshotParents(filePath: string, safetyRoot: string) {
  const root = resolve(safetyRoot)
  let currentDirectory = resolve(dirname(filePath))

  while (currentDirectory !== root && isInsideDirectory(root, currentDirectory)) {
    assertProjectPathSafe(root, currentDirectory, 'Clean rollback directory')

    if (!existsSync(currentDirectory) || readdirSync(currentDirectory).length > 0) {
      return
    }

    rmdirSync(currentDirectory)
    currentDirectory = dirname(currentDirectory)
  }
}

// restoreFileSnapshot 함수는 스냅샷의 원문과 모드를 파일시스템에 복구한다.
function restoreFileSnapshot(snapshot: FileSnapshot) {
  assertProjectPathSafe(snapshot.safetyRoot, snapshot.path, 'Clean rollback target')

  if (!snapshot.existed) {
    rmSync(snapshot.path, { force: true })
    removeEmptySnapshotParents(snapshot.path, snapshot.safetyRoot)
    return
  }

  mkdirSync(dirname(snapshot.path), { recursive: true })
  assertProjectPathSafe(snapshot.safetyRoot, snapshot.path, 'Clean rollback target')
  writeFileSync(snapshot.path, snapshot.content ?? Buffer.alloc(0))

  if (snapshot.mode !== null) {
    chmodSync(snapshot.path, snapshot.mode)
  }
}

// rollbackSnapshots 함수는 실제 변경을 시작한 파일만 스냅샷 역순으로 복구한다.
function rollbackSnapshots(snapshots: Map<string, FileSnapshot>, mutatedPaths: Set<string>) {
  const rollbackErrors: string[] = []

  for (const snapshot of [...snapshots.values()].reverse()) {
    if (!mutatedPaths.has(snapshot.path)) {
      continue
    }

    try {
      restoreFileSnapshot(snapshot)
    } catch (error) {
      rollbackErrors.push(`${snapshot.path}: ${(error as Error).message}`)
    }
  }

  return rollbackErrors
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
function writeSafeFile(filePath: string, content: string | Buffer, safetyRoot: string) {
  assertProjectPathSafe(safetyRoot, filePath, 'Clean target path')
  writeFileSync(filePath, content)
}

// createCleanTransactionTargets 함수는 clean이 수정·삭제할 파일과 지울 수 있는 빈 디렉터리를 모은다.
function createCleanTransactionTargets(
  projectRoot: string,
  packageJsonPath: string,
  packageJsonChanged: boolean,
  tsconfigPaths: Iterable<string>,
  pnpmWorkspacePaths: Iterable<string>,
  yarnRcPaths: Iterable<string>,
  filesToDelete: CleanPlan['files'],
) {
  const targets: TransactionTarget[] = []

  if (packageJsonChanged) {
    targets.push({
      path: packageJsonPath,
      safetyRoot: projectRoot,
      expectedHash: createCurrentExpectedHash(packageJsonPath),
    })
  }

  for (const tsconfigPath of tsconfigPaths) {
    targets.push({
      path: tsconfigPath,
      safetyRoot: projectRoot,
      expectedHash: createCurrentExpectedHash(tsconfigPath),
    })
  }

  for (const pnpmWorkspacePath of pnpmWorkspacePaths) {
    targets.push({
      path: pnpmWorkspacePath,
      safetyRoot: dirname(resolve(pnpmWorkspacePath)),
      expectedHash: createCurrentExpectedHash(pnpmWorkspacePath),
    })
  }

  for (const yarnRcPath of yarnRcPaths) {
    targets.push({
      path: yarnRcPath,
      safetyRoot: isInsideDirectory(projectRoot, resolve(yarnRcPath))
        ? projectRoot
        : dirname(resolve(yarnRcPath)),
      expectedHash: createCurrentExpectedHash(yarnRcPath),
    })
  }

  for (const file of filesToDelete) {
    targets.push({
      path: file.absolutePath,
      safetyRoot: projectRoot,
      expectedHash: file.expectedHash ?? createCurrentExpectedHash(file.absolutePath),
    })
  }

  const removableDirectories = uniqueStrings(
    filesToDelete.map((file) => resolve(dirname(file.absolutePath))),
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
  const nextPackageJson = clonePackageJson(packageJson)
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
  const snapshots = new Map<string, FileSnapshot>()
  const mutatedPaths = new Set<string>()
  const transactionTargets = createCleanTransactionTargets(
    projectRoot,
    packageJsonPath,
    packageJsonChanged,
    tsconfigClaimsByPath.keys(),
    pnpmClaimsByPath.keys(),
    yarnRcClaimsByPath.keys(),
    filesToDelete,
  )
  let transaction: TransactionHandle | null = null

  try {
    if (packageJsonChanged) {
      rememberSnapshot(snapshots, packageJsonPath, projectRoot)
    }

    for (const tsconfigPath of tsconfigClaimsByPath.keys()) {
      rememberSnapshot(snapshots, tsconfigPath, projectRoot)
    }

    for (const pnpmWorkspacePath of pnpmClaimsByPath.keys()) {
      rememberSnapshot(snapshots, pnpmWorkspacePath, dirname(resolve(pnpmWorkspacePath)))
    }

    for (const yarnRcPath of yarnRcClaimsByPath.keys()) {
      const safetyRoot = isInsideDirectory(projectRoot, resolve(yarnRcPath))
        ? projectRoot
        : dirname(resolve(yarnRcPath))
      rememberSnapshot(snapshots, yarnRcPath, safetyRoot)
    }

    for (const file of filesToDelete) {
      rememberSnapshot(snapshots, file.absolutePath, projectRoot)
    }

    transaction = beginTransaction(projectRoot, 'clean', transactionTargets)

    if (packageJsonChanged) {
      mutatedPaths.add(resolve(packageJsonPath))
      writeSafeFile(packageJsonPath, `${JSON.stringify(nextPackageJson, null, 2)}\n`, projectRoot)
    }

    for (const [tsconfigPath, claims] of tsconfigClaimsByPath) {
      assertProjectPathSafe(projectRoot, tsconfigPath, 'tsconfig.json')
      const source = readFileSync(tsconfigPath, 'utf8')
      const nextSource = restoreTsconfigJsonClaims(source, claims)
      mutatedPaths.add(resolve(tsconfigPath))
      writeSafeFile(tsconfigPath, nextSource, projectRoot)
    }

    for (const [pnpmWorkspacePath, claims] of pnpmClaimsByPath) {
      const safetyRoot = dirname(resolve(pnpmWorkspacePath))
      assertProjectPathSafe(safetyRoot, pnpmWorkspacePath, 'pnpm-workspace.yaml')
      let source = readFileSync(pnpmWorkspacePath, 'utf8')

      for (const claim of claims) {
        source = restorePnpmWorkspaceYamlClaim(source, claim)
      }

      assertProjectPathSafe(safetyRoot, pnpmWorkspacePath, 'pnpm-workspace.yaml')
      mutatedPaths.add(resolve(pnpmWorkspacePath))

      if (source.trim()) {
        writeSafeFile(pnpmWorkspacePath, source, safetyRoot)
      } else {
        rmSync(pnpmWorkspacePath, { force: true })
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
      mutatedPaths.add(resolve(yarnRcPath))

      if (source === '' && claims.some((claim) => claim.created)) {
        rmSync(yarnRcPath, { force: true })
      } else {
        writeSafeFile(yarnRcPath, source, safetyRoot)
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
      mutatedPaths.add(resolve(file.absolutePath))
      rmSync(file.absolutePath, { force: true })
      deletedFiles.push(file.absolutePath)
    }

    removeEmptyParents(cwd, deletedFiles)
    commitTransaction(transaction)
  } catch (error) {
    const rollbackErrors = rollbackSnapshots(snapshots, mutatedPaths)

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
        : ' Project files were rolled back from snapshots.'

    throw new Error(
      `Clean failed while applying project changes: ${(error as Error).message}.${rollbackMessage}`,
    )
  }
}
