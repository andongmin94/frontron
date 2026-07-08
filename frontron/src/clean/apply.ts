import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { isInsideDirectory } from '../project-paths'
import type { PackageJsonOwnershipClaim } from '../init/manifest'
import {
  deletePackageJsonPath,
  readPackageJsonPath,
  writePackageJsonPath,
} from '../init/package-json-path'
import {
  findPnpmWorkspaceYamlPath,
  restorePnpmWorkspaceYamlClaim,
} from '../init/pnpm-workspace-yaml'
import type { PackageJson } from '../init/shared'
import { readTsconfigJson, type TsconfigJson } from '../init/tsconfig-json'
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
      if (readdirSync(directory).length === 0) {
        rmdirSync(directory)
      }
    } catch {
      // 비어 있지 않거나 동시에 바뀐 폴더는 사용자 파일일 수 있으므로 그대로 둔다.
    }
  }
}

// applyCleanPlan 함수는 clean 계획에 따라 파일 삭제와 package.json 복구를 실제로 적용한다.
export function applyCleanPlan(
  cwd: string,
  packageJsonPath: string,
  packageJson: PackageJson,
  plan: CleanPlan,
) {
  const scripts = { ...(packageJson.scripts ?? {}) }
  let packageJsonChanged = false

  for (const script of plan.scripts) {
    if (script.action === 'remove') {
      delete scripts[script.name]
      packageJsonChanged = true
    }
  }

  for (const change of plan.packageJsonChanges) {
    restorePackageJsonClaim(packageJson, change.claim)
    packageJsonChanged = true
  }

  if (packageJsonChanged) {
    packageJson.scripts = scripts
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  }

  if (plan.tsconfigJsonChanges.length > 0) {
    const tsconfigPath = join(cwd, 'tsconfig.json')
    const tsconfigJson = readTsconfigJson(tsconfigPath) as TsconfigJson

    for (const change of plan.tsconfigJsonChanges) {
      restorePackageJsonClaim(tsconfigJson, change.claim)
    }

    writeFileSync(tsconfigPath, `${JSON.stringify(tsconfigJson, null, 2)}\n`, 'utf8')
  }

  if (plan.pnpmWorkspaceChanges.length > 0) {
    const pnpmWorkspacePath = findPnpmWorkspaceYamlPath(cwd)
    let pnpmWorkspaceSource = readFileSync(pnpmWorkspacePath, 'utf8')

    for (const change of plan.pnpmWorkspaceChanges) {
      pnpmWorkspaceSource = restorePnpmWorkspaceYamlClaim(pnpmWorkspaceSource, change.claim)
    }

    if (pnpmWorkspaceSource.trim()) {
      writeFileSync(pnpmWorkspacePath, pnpmWorkspaceSource, 'utf8')
    } else {
      rmSync(pnpmWorkspacePath, { force: true })
    }
  }

  const deletedFiles: string[] = []

  for (const file of plan.files) {
    if (file.action !== 'delete') {
      continue
    }

    rmSync(file.absolutePath, { force: true })
    deletedFiles.push(file.absolutePath)
  }

  removeEmptyParents(cwd, deletedFiles)
}
