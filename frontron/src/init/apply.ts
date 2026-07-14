import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { addTsconfigExcludeValues } from '../clean/tsconfig-source'
import { assertProjectPathSafe, isInsideDirectory } from '../project-paths'
import {
  beginTransaction,
  commitTransaction,
  createTransactionSourceHash,
  removeTransactionFile,
  rollbackTransaction,
  writeTransactionFile,
  type TransactionHandle,
  type TransactionTarget,
} from '../transaction-journal'
import { MANIFEST_PATH } from './manifest'
import type { InitPlan } from './plan'
import type { TsconfigJsonPatchPlan } from './tsconfig-json'
import type { PnpmWorkspaceYamlPatchPlan } from './pnpm-workspace-yaml'
import type { YarnRcYamlPatchPlan } from './yarnrc-yaml'

// createPlannedSourceExpectedHash 함수는 계획 원문과 생성 여부를 transaction expected hash로 바꾼다.
function createPlannedSourceExpectedHash(source: string, created: boolean) {
  if (created) return null
  return createTransactionSourceHash(source)
}

// writeTrackedFile 함수는 transaction 저널이 보호하는 파일을 안전 경로 재검사 후 기록한다.
function writeTrackedFile(
  transaction: TransactionHandle,
  filePath: string,
  content: string,
  safetyRoot: string,
) {
  assertProjectPathSafe(safetyRoot, filePath, 'Init target path')
  mkdirSync(dirname(filePath), { recursive: true })
  writeTransactionFile(transaction, filePath, content, safetyRoot)
}

// createInitTransactionTargets 함수는 init이 쓸 모든 파일과 각 파일의 안전 경계를 한곳에 모은다.
function createInitTransactionTargets(
  projectRoot: string,
  packageJsonPath: string,
  packageJsonExpectedHash: string,
  writableFiles: InitPlan['files'],
  obsoleteFiles: InitPlan['obsoleteFiles'],
  tsconfigJsonPlan: TsconfigJsonPatchPlan | null,
  pnpmWorkspacePlan: PnpmWorkspaceYamlPatchPlan | null,
  pnpmWorkspaceSafetyRoot: string,
  yarnRcPlan: YarnRcYamlPatchPlan | null,
  yarnRcSafetyRoot: string,
) {
  const targets: TransactionTarget[] = writableFiles.map((file) => ({
    path: file.path,
    safetyRoot: projectRoot,
    expectedHash: file.expectedHash,
  }))

  for (const file of obsoleteFiles) {
    targets.push({
      path: file.path,
      safetyRoot: projectRoot,
      expectedHash: file.expectedHash,
    })
  }

  targets.push({
    path: packageJsonPath,
    safetyRoot: projectRoot,
    expectedHash: packageJsonExpectedHash,
  })

  if (
    tsconfigJsonPlan &&
    tsconfigJsonPlan.blockers.length === 0 &&
    tsconfigJsonPlan.changes.length > 0
  ) {
    targets.push({
      path: tsconfigJsonPlan.path,
      safetyRoot: projectRoot,
      expectedHash: createTransactionSourceHash(tsconfigJsonPlan.source),
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
        pnpmWorkspacePlan.source,
        pnpmWorkspacePlan.created,
      ),
    })
  }

  if (yarnRcPlan && yarnRcPlan.blockers.length === 0 && yarnRcPlan.changes.length > 0) {
    targets.push({
      path: yarnRcPlan.path,
      safetyRoot: yarnRcSafetyRoot,
      expectedHash: createPlannedSourceExpectedHash(yarnRcPlan.source, yarnRcPlan.created),
    })
  }

  return targets
}

// applyInitChanges 함수는 init 계획에 따라 생성 파일과 설정 파일을 실제 프로젝트에 기록한다.
export function applyInitChanges(packageJsonPath: string, plan: InitPlan) {
  const {
    packageJsonPlan: { packageJson },
    tsconfigJsonPlan = null,
    pnpmWorkspacePlan = null,
    yarnRcPlan = null,
  } = plan
  const writableFiles = plan.files.filter((file) => file.action !== 'blocked')
  const obsoleteFiles = plan.obsoleteFiles ?? []
  const manifestPath = resolve(plan.config.cwd, MANIFEST_PATH)
  const generatedFiles = writableFiles.filter((file) => resolve(file.path) !== manifestPath)
  const manifestFiles = writableFiles.filter((file) => resolve(file.path) === manifestPath)
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
    plan.packageJsonExpectedHash,
    writableFiles,
    obsoleteFiles,
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
      writeTrackedFile(transaction, file.path, file.content, projectRoot)
    }

    writeTrackedFile(
      transaction,
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

      const nextTsconfigSource = addTsconfigExcludeValues(
        tsconfigJsonPlan.source,
        tsconfigJsonPlan.changes.map((change) => change.value),
      )

      writeTrackedFile(transaction, tsconfigJsonPlan.path, nextTsconfigSource, projectRoot)
    }

    if (
      pnpmWorkspacePlan &&
      pnpmWorkspacePlan.blockers.length === 0 &&
      pnpmWorkspacePlan.changes.length > 0
    ) {
      writeTrackedFile(
        transaction,
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

      writeTrackedFile(transaction, yarnRcPlan.path, yarnRcPlan.nextSource, yarnRcSafetyRoot)
    }

    // manifest는 "적용 완료 증명서"에 가깝다.
    // 중간 쓰기가 실패하면 rollback 후 manifest가 남지 않도록 마지막에만 기록한다.
    for (const file of obsoleteFiles) {
      removeTransactionFile(transaction, file.path, projectRoot)
    }

    for (const file of manifestFiles) {
      writeTrackedFile(transaction, file.path, file.content, projectRoot)
    }

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
        : ' Written files were rolled back.'

    throw new Error(
      `Init failed while writing project changes: ${(error as Error).message}.${rollbackMessage}`,
      { cause: error },
    )
  }
}
