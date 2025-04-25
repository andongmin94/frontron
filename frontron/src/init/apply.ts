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

import { isInsideDirectory } from '../project-paths'
import { MANIFEST_PATH } from './manifest'
import type { InitPlan } from './plan'
import type { PackageJson } from './shared'
import type { TsconfigJsonPatchPlan } from './tsconfig-json'
import type { PnpmWorkspaceYamlPatchPlan } from './pnpm-workspace-yaml'

type FileSnapshot = {
  path: string
  existed: boolean
  content: string | null
}

// takeFileSnapshot 함수는 쓰기 전 파일 상태를 rollback용으로 저장한다.
function takeFileSnapshot(filePath: string): FileSnapshot {
  return existsSync(filePath)
    ? {
        path: filePath,
        existed: true,
        content: readFileSync(filePath, 'utf8'),
      }
    : {
        path: filePath,
        existed: false,
        content: null,
      }
}

// removeEmptyCreatedDirectories 함수는 rollback 후 새로 생긴 빈 디렉터리를 프로젝트 루트 안에서만 정리한다.
function removeEmptyCreatedDirectories(filePath: string, cleanupRoot: string) {
  const root = resolve(cleanupRoot)
  let currentDir = resolve(dirname(filePath))

  while (currentDir !== root && isInsideDirectory(root, currentDir)) {
    if (!existsSync(currentDir) || readdirSync(currentDir).length > 0) {
      return
    }

    rmdirSync(currentDir)
    currentDir = dirname(currentDir)
  }
}

// restoreFileSnapshot 함수는 저장된 snapshot을 기준으로 파일을 이전 상태로 되돌린다.
function restoreFileSnapshot(snapshot: FileSnapshot, cleanupRoot: string) {
  if (!snapshot.existed) {
    rmSync(snapshot.path, { force: true })
    removeEmptyCreatedDirectories(snapshot.path, cleanupRoot)
    return
  }

  mkdirSync(dirname(snapshot.path), { recursive: true })
  writeFileSync(snapshot.path, snapshot.content ?? '', 'utf8')
}

// rememberSnapshot 함수는 같은 파일을 여러 번 써도 최초 상태만 rollback 기준으로 보관한다.
function rememberSnapshot(snapshots: Map<string, FileSnapshot>, filePath: string) {
  const resolvedPath = resolve(filePath)

  if (!snapshots.has(resolvedPath)) {
    snapshots.set(resolvedPath, takeFileSnapshot(filePath))
  }
}

// writeTrackedFile 함수는 파일을 쓰기 전에 snapshot을 남겨 실패 시 복구할 수 있게 한다.
function writeTrackedFile(snapshots: Map<string, FileSnapshot>, filePath: string, content: string) {
  rememberSnapshot(snapshots, filePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

// rollbackSnapshots 함수는 성공한 쓰기를 역순으로 되돌려 부분 적용 상태를 최대한 제거한다.
function rollbackSnapshots(snapshots: Map<string, FileSnapshot>, cleanupRoot: string) {
  const rollbackErrors: string[] = []
  const orderedSnapshots = [...snapshots.values()].reverse()

  for (const snapshot of orderedSnapshots) {
    try {
      restoreFileSnapshot(snapshot, cleanupRoot)
    } catch (error) {
      rollbackErrors.push(`${snapshot.path}: ${(error as Error).message}`)
    }
  }

  return rollbackErrors
}

// applyInitChanges 함수는 init 계획에 따라 생성 파일과 설정 파일을 실제 프로젝트에 기록한다.
export function applyInitChanges(
  packageJsonPath: string,
  packageJson: PackageJson,
  plan: InitPlan,
  tsconfigJsonPlan: TsconfigJsonPatchPlan | null = null,
  pnpmWorkspacePlan: PnpmWorkspaceYamlPatchPlan | null = null,
) {
  const writableFiles = plan.files.filter((file) => file.action !== 'blocked')
  const manifestPath = resolve(plan.config.cwd, MANIFEST_PATH)
  const generatedFiles = writableFiles.filter((file) => resolve(file.path) !== manifestPath)
  const manifestFiles = writableFiles.filter((file) => resolve(file.path) === manifestPath)
  const snapshots = new Map<string, FileSnapshot>()

  try {
    for (const file of generatedFiles) {
      writeTrackedFile(snapshots, file.path, file.content)
    }

    writeTrackedFile(snapshots, packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    if (tsconfigJsonPlan && tsconfigJsonPlan.blockers.length === 0) {
      writeTrackedFile(
        snapshots,
        tsconfigJsonPlan.path,
        `${JSON.stringify(tsconfigJsonPlan.tsconfigJson, null, 2)}\n`,
      )
    }

    if (
      pnpmWorkspacePlan &&
      pnpmWorkspacePlan.blockers.length === 0 &&
      pnpmWorkspacePlan.changes.length > 0
    ) {
      writeTrackedFile(snapshots, pnpmWorkspacePlan.path, pnpmWorkspacePlan.nextSource)
    }

    // manifest는 "적용 완료 증명서"에 가깝다.
    // 중간 쓰기가 실패하면 rollback 후 manifest가 남지 않도록 마지막에만 기록한다.
    for (const file of manifestFiles) {
      writeTrackedFile(snapshots, file.path, file.content)
    }
  } catch (error) {
    const rollbackErrors = rollbackSnapshots(snapshots, plan.config.cwd)
    const rollbackMessage =
      rollbackErrors.length > 0
        ? ` Rollback also failed for: ${rollbackErrors.join('; ')}`
        : ' Written files were rolled back.'

    throw new Error(
      `Init failed while writing project changes: ${(error as Error).message}.${rollbackMessage}`,
    )
  }
}
