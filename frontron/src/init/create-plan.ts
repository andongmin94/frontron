import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { addManifestSource, createInitFileSources } from './file-sources'
import {
  createFileHash,
  MANIFEST_PATH,
  normalizeManifestPath,
  readExistingManifest,
  readManifest,
  splitFileConflicts,
} from './manifest'
import { mergePackageJsonClaims, replacePackageJsonClaims } from './ownership-claims'
import { previewPackageJsonPatch } from './package-json'
import { createInitPlan, type ObsoleteFileChange } from './plan'
import { previewPnpmWorkspaceYamlPatch } from './pnpm-workspace-yaml'
import type { CreateFrontronTemplateSnapshot } from './runtime/create-frontron-template'
import type { InitConfig } from './shared'
import { previewTsconfigJsonPatch } from './tsconfig-json'
import { mergeYarnRcClaims, previewYarnRcYamlPatch } from './yarnrc-yaml'
import { inspectManagedFile } from '../managed-state'

type InitPatchPlans = ReturnType<typeof createPatchPlans>

export type CreateInitProjectPlanInput = {
  config: InitConfig
  template: CreateFrontronTemplateSnapshot
  packageJsonSource: string
  existingManifest: ReturnType<typeof readExistingManifest>
  existingManifestDetails: ReturnType<typeof readManifest>
  force: boolean
  configurationWarnings: string[]
  packageMetadataBlockers: string[]
}

// package.json과 패키지 매니저별 설정 파일을 실제 쓰기 없이 미리 계산한다.
function createPatchPlans(config: InitConfig, manifest: ReturnType<typeof readManifest>) {
  return {
    packageJson: previewPackageJsonPatch(config, manifest?.packageJsonClaims),
    tsconfigJson: previewTsconfigJsonPatch(config.cwd, config.desktopDir),
    pnpmWorkspace: previewPnpmWorkspaceYamlPatch(config.cwd, config.packageManager),
    yarnRc: previewYarnRcYamlPatch(config.cwd, config.packageManager),
  }
}

// 이전 manifest의 소유권과 이번 패치의 소유권을 병합해 update·clean의 기준을 보존한다.
function mergePatchClaims(manifest: ReturnType<typeof readManifest>, patchPlans: InitPatchPlans) {
  return {
    packageJson: replacePackageJsonClaims(
      manifest?.packageJsonClaims,
      patchPlans.packageJson.ownershipClaims,
    ),
    tsconfigJson: mergePackageJsonClaims(
      manifest?.tsconfigJsonClaims,
      patchPlans.tsconfigJson?.ownershipClaims,
    ),
    pnpmWorkspace: mergePackageJsonClaims(
      manifest?.pnpmWorkspaceClaims,
      patchPlans.pnpmWorkspace?.ownershipClaims,
    ),
    yarnRc: mergeYarnRcClaims(manifest?.yarnRcClaims, patchPlans.yarnRc?.ownershipClaims),
  }
}

// 각 설정 패치기가 발견한 경고를 실행 설정 경고와 같은 계획에 모은다.
function collectPlanWarnings(input: CreateInitProjectPlanInput, patchPlans: InitPatchPlans) {
  return [
    ...input.configurationWarnings,
    ...patchPlans.packageJson.warnings,
    ...(patchPlans.tsconfigJson?.warnings ?? []),
    ...(patchPlans.pnpmWorkspace?.warnings ?? []),
    ...(patchPlans.yarnRc?.warnings ?? []),
  ]
}

// 각 설정 패치기가 발견한 차단 사유를 누락 없이 하나의 목록으로 모은다.
function collectPlanBlockers(
  input: CreateInitProjectPlanInput,
  patchPlans: InitPatchPlans,
  obsoleteFileBlockers: string[],
) {
  return [
    ...patchPlans.packageJson.blockers,
    ...(patchPlans.tsconfigJson?.blockers ?? []),
    ...(patchPlans.pnpmWorkspace?.blockers ?? []),
    ...(patchPlans.yarnRc?.blockers ?? []),
    ...obsoleteFileBlockers,
    ...input.packageMetadataBlockers,
  ]
}

// createObsoleteFilePlan 함수는 새 템플릿에서 빠진 기존 소유 파일을 검증 가능한 삭제 계획으로 만든다.
function createObsoleteFilePlan(
  input: CreateInitProjectPlanInput,
  filesToWrite: Map<string, string>,
) {
  const obsoleteFiles: ObsoleteFileChange[] = []
  const blockers: string[] = []
  const manifest = input.existingManifestDetails

  if (!manifest) return { obsoleteFiles, blockers }

  const nextManifestPaths = new Set(
    [...filesToWrite.keys()].map((filePath) => normalizeManifestPath(input.config.cwd, filePath)),
  )

  for (const manifestPath of new Set(manifest.createdFiles)) {
    if (manifestPath === MANIFEST_PATH || nextManifestPaths.has(manifestPath)) continue

    const inspection = inspectManagedFile(
      input.config.cwd,
      manifestPath,
      manifest.fileHashes?.[manifestPath],
    )

    if (inspection.state === 'missing') continue
    if (inspection.state === 'unsafe') {
      blockers.push(inspection.blocker ?? `Obsolete manifest file is unsafe: ${manifestPath}`)
      continue
    }

    const path = resolve(input.config.cwd, manifestPath)
    obsoleteFiles.push({
      path,
      manifestPath,
      expectedHash: createFileHash(readFileSync(path)),
    })
  }

  return { obsoleteFiles, blockers }
}

// 해시와 소유권이 포함된 완전한 init 계획을 만들되 프로젝트에는 아직 쓰지 않는다.
export function createInitProjectPlan(input: CreateInitProjectPlanInput) {
  const filesToWrite = createInitFileSources(input.config, input.template)
  const patchPlans = createPatchPlans(input.config, input.existingManifestDetails)
  const obsoleteFilePlan = createObsoleteFilePlan(input, filesToWrite)
  const claims = mergePatchClaims(input.existingManifestDetails, patchPlans)
  addManifestSource(
    input.config,
    filesToWrite,
    claims.packageJson,
    claims.tsconfigJson,
    claims.pnpmWorkspace,
    claims.yarnRc,
  )

  const conflicts = [...filesToWrite.keys()].filter((filePath) => existsSync(filePath))
  const conflictPlan = splitFileConflicts(
    input.config.cwd,
    conflicts,
    input.force,
    input.existingManifest,
  )

  return createInitPlan({
    config: input.config,
    filesToWrite,
    obsoleteFiles: obsoleteFilePlan.obsoleteFiles,
    packageJsonPlan: patchPlans.packageJson,
    packageJsonExpectedHash: createFileHash(input.packageJsonSource),
    tsconfigJsonPlan: patchPlans.tsconfigJson,
    pnpmWorkspacePlan: patchPlans.pnpmWorkspace,
    yarnRcPlan: patchPlans.yarnRc,
    warnings: collectPlanWarnings(input, patchPlans),
    blockers: collectPlanBlockers(input, patchPlans, obsoleteFilePlan.blockers),
    blockedFiles: conflictPlan.blocked,
    overwriteFiles: conflictPlan.safeToOverwrite,
  })
}
