import { resolve } from 'node:path'

import { MANIFEST_PATH, readManifest } from '../init/manifest'
import type { PackageJson } from '../init/shared'
import { formatProjectPathBlocker, inspectProjectPath } from '../project-paths'
import { createClaimCleanPlan } from './claim-plan'
import { createManagedCleanPlan } from './managed-plan'
import type { CleanOptions, CleanPlan } from './types'

// manifest 경로 자체가 안전하고 현재 schema로 검증된 경우에만 clean 계획을 시작한다.
function readCleanManifest(cwd: string) {
  const path = resolve(cwd, MANIFEST_PATH)
  const inspection = inspectProjectPath(cwd, path)
  if (!inspection.safe) {
    throw new Error(formatProjectPathBlocker(cwd, 'Frontron manifest', inspection))
  }

  const manifest = readManifest(cwd)
  if (!manifest) {
    throw new Error(`${MANIFEST_PATH} was not found. Nothing can be cleaned safely.`)
  }

  return manifest
}

// 파일/script 삭제와 설정 claim 복구를 독립적으로 계획한 뒤 기존 출력 순서대로 합친다.
export function createCleanPlan(
  cwd: string,
  packageJson: PackageJson,
  packageJsonSource: string,
  options: CleanOptions,
): CleanPlan {
  const manifest = readCleanManifest(cwd)
  const managed = createManagedCleanPlan(cwd, packageJson, manifest, options)
  const claims = createClaimCleanPlan(cwd, packageJson, packageJsonSource, manifest, options)

  return {
    files: managed.files,
    scripts: managed.scripts,
    packageJsonChanges: claims.packageJsonChanges,
    tsconfigJsonChanges: claims.tsconfigJsonChanges,
    pnpmWorkspaceChanges: claims.pnpmWorkspaceChanges,
    yarnRcChanges: claims.yarnRcChanges,
    sourceHashes: claims.sourceHashes,
    missingSourceGuards: claims.missingSourceGuards,
    warnings: [...managed.warnings, ...claims.warnings],
    blockers: [...managed.blockers, ...claims.blockers],
  }
}
