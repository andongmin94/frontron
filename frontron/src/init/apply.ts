import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

import { addTsconfigExcludeValues } from '../clean/tsconfig-source'
import { assertProjectPathSafe, isInsideDirectory } from '../project-paths'
import {
  beginTransaction,
  commitTransaction,
  createTransactionSourceHash,
  rollbackTransaction,
  type TransactionHandle,
  type TransactionTarget,
} from '../transaction-journal'
import { MANIFEST_PATH } from './manifest'
import type { InitPlan } from './plan'
import type { PackageJson } from './shared'
import type { TsconfigJsonPatchPlan } from './tsconfig-json'
import type { PnpmWorkspaceYamlPatchPlan } from './pnpm-workspace-yaml'
import type { YarnRcYamlPatchPlan } from './yarnrc-yaml'

type FileSnapshot = {
  path: string
  safetyRoot: string
  existed: boolean
  content: string | null
}

// createCurrentExpectedHash 함수는 lock 대기 중 파일이 바뀌는지 확인할 현재 원문 해시를 만든다.
function createCurrentExpectedHash(filePath: string) {
  return existsSync(filePath) ? createTransactionSourceHash(readFileSync(filePath)) : null
}

// createPlannedSourceExpectedHash 함수는 계획 원문과 생성 여부를 transaction expected hash로 바꾼다.
function createPlannedSourceExpectedHash(filePath: string, source: string, created: boolean) {
  if (created) return null

  if (!existsSync(filePath) && source === '') return null
  return createTransactionSourceHash(source)
}

// takeFileSnapshot 함수는 쓰기 전 파일 상태를 rollback용으로 저장한다.
function takeFileSnapshot(filePath: string, safetyRoot: string): FileSnapshot {
  assertProjectPathSafe(safetyRoot, filePath, 'Init target path')

  return existsSync(filePath)
    ? {
        path: filePath,
        safetyRoot,
        existed: true,
        content: readFileSync(filePath, 'utf8'),
      }
    : {
        path: filePath,
        safetyRoot,
        existed: false,
        content: null,
      }
}

// removeEmptyCreatedDirectories 함수는 rollback 후 새로 생긴 빈 디렉터리를 프로젝트 루트 안에서만 정리한다.
function removeEmptyCreatedDirectories(filePath: string, cleanupRoot: string) {
  const root = resolve(cleanupRoot)
  let currentDir = resolve(dirname(filePath))

  while (currentDir !== root && isInsideDirectory(root, currentDir)) {
    assertProjectPathSafe(root, currentDir, 'Init rollback directory')

    if (!existsSync(currentDir) || readdirSync(currentDir).length > 0) {
      return
    }

    rmdirSync(currentDir)
    currentDir = dirname(currentDir)
  }
}

// restoreFileSnapshot 함수는 저장된 snapshot을 기준으로 파일을 이전 상태로 되돌린다.
function restoreFileSnapshot(snapshot: FileSnapshot) {
  assertProjectPathSafe(snapshot.safetyRoot, snapshot.path, 'Init rollback target')

  if (!snapshot.existed) {
    rmSync(snapshot.path, { force: true })
    removeEmptyCreatedDirectories(snapshot.path, snapshot.safetyRoot)
    return
  }

  mkdirSync(dirname(snapshot.path), { recursive: true })
  writeFileSync(snapshot.path, snapshot.content ?? '', 'utf8')
}

// rememberSnapshot 함수는 같은 파일을 여러 번 써도 최초 상태만 rollback 기준으로 보관한다.
function rememberSnapshot(
  snapshots: Map<string, FileSnapshot>,
  filePath: string,
  safetyRoot: string,
) {
  const resolvedPath = resolve(filePath)

  if (!snapshots.has(resolvedPath)) {
    snapshots.set(resolvedPath, takeFileSnapshot(filePath, safetyRoot))
  }
}

// writeTrackedFile 함수는 파일을 쓰기 전에 snapshot을 남겨 실패 시 복구할 수 있게 한다.
function writeTrackedFile(
  snapshots: Map<string, FileSnapshot>,
  filePath: string,
  content: string,
  safetyRoot: string,
) {
  assertProjectPathSafe(safetyRoot, filePath, 'Init target path')
  rememberSnapshot(snapshots, filePath, safetyRoot)
  assertProjectPathSafe(safetyRoot, filePath, 'Init target path')
  mkdirSync(dirname(filePath), { recursive: true })
  assertProjectPathSafe(safetyRoot, filePath, 'Init target path')
  writeFileSync(filePath, content, 'utf8')
}

// rollbackSnapshots 함수는 성공한 쓰기를 역순으로 되돌려 부분 적용 상태를 최대한 제거한다.
function rollbackSnapshots(snapshots: Map<string, FileSnapshot>) {
  const rollbackErrors: string[] = []
  const orderedSnapshots = [...snapshots.values()].reverse()

  for (const snapshot of orderedSnapshots) {
    try {
      restoreFileSnapshot(snapshot)
    } catch (error) {
      rollbackErrors.push(`${snapshot.path}: ${(error as Error).message}`)
    }
  }

  return rollbackErrors
}

// createInitTransactionTargets 함수는 init이 쓸 모든 파일과 각 파일의 안전 경계를 한곳에 모은다.
function createInitTransactionTargets(
  projectRoot: string,
  packageJsonPath: string,
  writableFiles: InitPlan['files'],
  tsconfigJsonPlan: TsconfigJsonPatchPlan | null,
  pnpmWorkspacePlan: PnpmWorkspaceYamlPatchPlan | null,
  pnpmWorkspaceSafetyRoot: string,
  yarnRcPlan: YarnRcYamlPatchPlan | null,
  yarnRcSafetyRoot: string,
) {
  const targets: TransactionTarget[] = writableFiles.map((file) => ({
    path: file.path,
    safetyRoot: projectRoot,
    expectedHash: file.action === 'create' ? null : createCurrentExpectedHash(file.path),
  }))

  targets.push({
    path: packageJsonPath,
    safetyRoot: projectRoot,
    expectedHash: createCurrentExpectedHash(packageJsonPath),
  })

  if (
    tsconfigJsonPlan &&
    tsconfigJsonPlan.blockers.length === 0 &&
    tsconfigJsonPlan.changes.length > 0
  ) {
    targets.push({
      path: tsconfigJsonPlan.path,
      safetyRoot: projectRoot,
      expectedHash: createCurrentExpectedHash(tsconfigJsonPlan.path),
    })
  }

  if (
    pnpmWorkspacePlan &&
    pnpmWorkspacePlan.blockers.length === 0 &&
    pnpmWorkspacePlan.changes.length > 0
  ) {
    targets.push({
      path: pnpmWorkspacePlan.path,
      safetyRoot: pnpmWorkspaceSafetyRoot,
      expectedHash: createPlannedSourceExpectedHash(
        pnpmWorkspacePlan.path,
        pnpmWorkspacePlan.source,
        !existsSync(pnpmWorkspacePlan.path),
      ),
    })
  }

  if (yarnRcPlan && yarnRcPlan.blockers.length === 0 && yarnRcPlan.changes.length > 0) {
    targets.push({
      path: yarnRcPlan.path,
      safetyRoot: yarnRcSafetyRoot,
      expectedHash: createPlannedSourceExpectedHash(
        yarnRcPlan.path,
        yarnRcPlan.source,
        yarnRcPlan.created,
      ),
    })
  }

  return targets
}

// applyInitChanges 함수는 init 계획에 따라 생성 파일과 설정 파일을 실제 프로젝트에 기록한다.
export function applyInitChanges(
  packageJsonPath: string,
  packageJson: PackageJson,
  plan: InitPlan,
  tsconfigJsonPlan: TsconfigJsonPatchPlan | null = null,
  pnpmWorkspacePlan: PnpmWorkspaceYamlPatchPlan | null = null,
  yarnRcPlan: YarnRcYamlPatchPlan | null = null,
) {
  const writableFiles = plan.files.filter((file) => file.action !== 'blocked')
  const manifestPath = resolve(plan.config.cwd, MANIFEST_PATH)
  const generatedFiles = writableFiles.filter((file) => resolve(file.path) !== manifestPath)
  const manifestFiles = writableFiles.filter((file) => resolve(file.path) === manifestPath)
  const snapshots = new Map<string, FileSnapshot>()
  const projectRoot = resolve(plan.config.cwd)
  const pnpmWorkspaceSafetyRoot = pnpmWorkspacePlan
    ? isInsideDirectory(projectRoot, resolve(pnpmWorkspacePlan.path))
      ? projectRoot
      : dirname(resolve(pnpmWorkspacePlan.path))
    : projectRoot
  const yarnRcSafetyRoot = yarnRcPlan
    ? isInsideDirectory(projectRoot, resolve(yarnRcPlan.path))
      ? projectRoot
      : dirname(resolve(yarnRcPlan.path))
    : projectRoot
  const transactionTargets = createInitTransactionTargets(
    projectRoot,
    packageJsonPath,
    writableFiles,
    tsconfigJsonPlan,
    pnpmWorkspacePlan,
    pnpmWorkspaceSafetyRoot,
    yarnRcPlan,
    yarnRcSafetyRoot,
  )
  let transaction: TransactionHandle | null = null

  try {
    transaction = beginTransaction(projectRoot, 'init', transactionTargets)

    for (const file of generatedFiles) {
      writeTrackedFile(snapshots, file.path, file.content, projectRoot)
    }

    writeTrackedFile(
      snapshots,
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
      projectRoot,
    )

    if (
      tsconfigJsonPlan &&
      tsconfigJsonPlan.blockers.length === 0 &&
      tsconfigJsonPlan.changes.length > 0
    ) {
      assertProjectPathSafe(projectRoot, tsconfigJsonPlan.path, 'tsconfig.json')

      const unsupportedChange = tsconfigJsonPlan.changes.find((change) => change.path !== 'exclude')

      if (unsupportedChange) {
        throw new Error(
          `Cannot patch tsconfig.json without replacing JSONC formatting: ${unsupportedChange.path}`,
        )
      }

      const tsconfigSource = readFileSync(tsconfigJsonPlan.path, 'utf8')
      const nextTsconfigSource = addTsconfigExcludeValues(
        tsconfigSource,
        tsconfigJsonPlan.changes.map((change) => change.value),
      )

      writeTrackedFile(snapshots, tsconfigJsonPlan.path, nextTsconfigSource, projectRoot)
    }

    if (
      pnpmWorkspacePlan &&
      pnpmWorkspacePlan.blockers.length === 0 &&
      pnpmWorkspacePlan.changes.length > 0
    ) {
      writeTrackedFile(
        snapshots,
        pnpmWorkspacePlan.path,
        pnpmWorkspacePlan.nextSource,
        pnpmWorkspaceSafetyRoot,
      )
    }

    if (yarnRcPlan && yarnRcPlan.blockers.length === 0 && yarnRcPlan.changes.length > 0) {
      const yarnRcExists = existsSync(yarnRcPlan.path)

      // 계획 이후 바뀐 workspace 설정을 오래된 preview로 덮어쓰지 않는다.
      if (
        (yarnRcPlan.created && yarnRcExists) ||
        (!yarnRcPlan.created &&
          (!yarnRcExists || readFileSync(yarnRcPlan.path, 'utf8') !== yarnRcPlan.source))
      ) {
        throw new Error(`${yarnRcPlan.path} changed after the init plan was created.`)
      }

      writeTrackedFile(snapshots, yarnRcPlan.path, yarnRcPlan.nextSource, yarnRcSafetyRoot)
    }

    // manifest는 "적용 완료 증명서"에 가깝다.
    // 중간 쓰기가 실패하면 rollback 후 manifest가 남지 않도록 마지막에만 기록한다.
    for (const file of manifestFiles) {
      writeTrackedFile(snapshots, file.path, file.content, projectRoot)
    }

    commitTransaction(transaction)
  } catch (error) {
    const rollbackErrors = rollbackSnapshots(snapshots)

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
        : ' Written files were rolled back.'

    throw new Error(
      `Init failed while writing project changes: ${(error as Error).message}.${rollbackMessage}`,
    )
  }
}
