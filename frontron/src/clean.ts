import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PackageJson } from './init/shared'
import { applyCleanPlan } from './clean/apply'
import { createCleanPlan } from './clean/plan'
import { renderCleanPlan } from './clean/render'
import type { CleanContext, CleanOptions } from './clean/types'
import { assertProjectPathSafe } from './project-paths'

export type { CleanContext, CleanOptions, CleanOutput } from './clean/types'

// runClean 함수는 frontron clean 명령의 전체 실행 흐름을 처리한다.
export async function runClean(options: CleanOptions, context: CleanContext) {
  const packageJsonPath = join(context.cwd, 'package.json')

  assertProjectPathSafe(context.cwd, packageJsonPath, 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error('package.json was not found in the current directory.')
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
  const plan = createCleanPlan(context.cwd, packageJson, options)
  const shouldApply = options.yes && !options.dryRun

  if (!shouldApply) {
    context.output.info(renderCleanPlan(plan, options))
    return 0
  }

  if (plan.blockers.length > 0) {
    context.output.info(renderCleanPlan(plan, options))
    context.output.info('')
    context.output.info('No changes were written because blockers were found.')
    return 1
  }

  // runClean은 전체 흐름만 조율한다. 실제 삭제/복구 규칙은 applyCleanPlan에 모아
  // 계획 수립 단계와 실행 단계를 쉽게 구분할 수 있게 한다.
  applyCleanPlan(context.cwd, packageJsonPath, packageJson, plan)
  context.output.info(renderCleanPlan(plan, options))
  context.output.info('')
  context.output.info('[Frontron] Removed manifest-owned Electron retrofit files and scripts.')

  return 0
}
