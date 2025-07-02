import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { applyInitChanges } from './init/apply'
import { createInitProjectPlan } from './init/create-plan'
import { readExistingManifest, readManifest } from './init/manifest'
import { createDryRunReport, type InitPlan } from './init/plan'
import { createReadlinePrompter } from './init/prompts'
import { resolveInitConfig } from './init/resolve-config'
import { loadCreateFrontronTemplate } from './init/runtime/create-frontron-template'
import type { InitContext, InitOptions, InitPrompter, PackageJson } from './init/shared'
import { normalizePathValue } from './init/shared'
import { writeInitSuccessReport } from './init/success-report'

export type { InitContext, InitOptions, InitPrompter } from './init/shared'

type InitProjectInput = {
  packageJsonPath: string
  packageJsonSource: string
  packageJson: PackageJson
  template: ReturnType<typeof loadCreateFrontronTemplate>
  existingManifest: ReturnType<typeof readExistingManifest>
  existingManifestDetails: ReturnType<typeof readManifest>
}

// 강제 재설정에서는 이전 소유권 정보를 이어 쓰되, 손상된 manifest는 새 설치처럼 처리한다.
function readExistingManifestDetails(cwd: string, force: boolean) {
  if (!force) return null

  try {
    return readManifest(cwd)
  } catch {
    return null
  }
}

// init에 필요한 프로젝트 원문과 create-frontron 템플릿 스냅샷을 한 번만 읽는다.
function readInitProjectInput(cwd: string, force: boolean): InitProjectInput {
  const packageJsonPath = join(cwd, 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error('package.json was not found in the current directory.')
  }

  const packageJsonSource = readFileSync(packageJsonPath, 'utf8')

  return {
    packageJsonPath,
    packageJsonSource,
    packageJson: JSON.parse(packageJsonSource) as PackageJson,
    template: loadCreateFrontronTemplate(),
    existingManifest: force ? readExistingManifest(cwd) : null,
    existingManifestDetails: readExistingManifestDetails(cwd, force),
  }
}

// 대화형 실행에만 readline 프롬프터를 만들고, 자동·dry-run 실행에는 만들지 않는다.
function createInitPrompter(
  options: InitOptions,
  context: InitContext,
): { promptEnabled: boolean; prompter: InitPrompter | null } {
  const promptEnabled = !options.yes && !options.dryRun
  const prompter = promptEnabled
    ? (context.prompter ??
      createReadlinePrompter(context.stdin ?? process.stdin, context.stdout ?? process.stdout))
    : null

  return { promptEnabled, prompter }
}

// 실제 쓰기 전에 계획에 남은 파일 충돌과 설정 차단 사유를 사용자에게 명확히 알린다.
function assertInitPlanCanApply(cwd: string, plan: InitPlan) {
  const blockedFiles = plan.files.filter((file) => file.action === 'blocked')

  if (blockedFiles.length > 0) {
    const paths = blockedFiles
      .map((file) => normalizePathValue(relative(cwd, file.path), file.path))
      .join(', ')

    throw new Error(`Init aborted because one or more target files already exist: ${paths}`)
  }

  if (plan.blockers.length > 0) {
    throw new Error(
      `Init aborted because package.json cannot be patched: ${plan.blockers.join('; ')}`,
    )
  }
}

// 여러 패치 단계에서 같은 경고가 합쳐져도 성공 보고에는 한 번만 표시한다.
function deduplicateWarnings(warnings: string[]) {
  return [...new Set(warnings)]
}

// 기존 웹 프로젝트를 읽고 설정을 해석한 뒤, 하나의 계획을 원자적으로 적용한다.
export async function runInit(options: InitOptions, context: InitContext) {
  const project = readInitProjectInput(context.cwd, options.force)
  const promptSession = createInitPrompter(options, context)

  try {
    const resolved = await resolveInitConfig({
      cwd: context.cwd,
      packageJson: project.packageJson,
      options,
      prompter: promptSession.prompter,
      promptEnabled: promptSession.promptEnabled,
      allowedExistingScriptNames: project.existingManifest?.scripts ?? new Set<string>(),
      template: project.template,
    })
    const plan = createInitProjectPlan({
      config: resolved.config,
      template: project.template,
      packageJsonSource: project.packageJsonSource,
      existingManifest: project.existingManifest,
      existingManifestDetails: project.existingManifestDetails,
      force: options.force,
      configurationWarnings: resolved.successWarnings,
      packageMetadataBlockers: resolved.packageMetadataBlockers,
    })

    if (options.dryRun) {
      context.output.info(createDryRunReport(plan))
      return 0
    }

    assertInitPlanCanApply(context.cwd, plan)
    applyInitChanges(project.packageJsonPath, plan)
    writeInitSuccessReport(context.output, resolved.config, deduplicateWarnings(plan.warnings))

    return 0
  } finally {
    await promptSession.prompter?.close()
  }
}
