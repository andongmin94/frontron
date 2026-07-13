import { normalizePathValue } from '../init/shared'
import type { CleanOptions, CleanPlan } from './types'

// addList 함수는 제목과 항목 목록을 리포트 출력 줄에 추가한다.
function addList(lines: string[], title: string, values: string[], emptyMessage: string) {
  lines.push(title)

  if (values.length === 0) {
    lines.push(`  ${emptyMessage}`)
    return
  }

  for (const value of values) {
    lines.push(`  - ${value}`)
  }
}

// renderCleanPlan 함수는 clean 계획을 터미널에 보여줄 문자열로 만든다.
export function renderCleanPlan(plan: CleanPlan, options: CleanOptions) {
  const lines = ['Frontron Clean', '']
  const filesToDelete = plan.files
    .filter((file) => file.action === 'delete')
    .map((file) => normalizePathValue(file.manifestPath, file.manifestPath))
  const scriptsToRemove = plan.scripts
    .filter((script) => script.action === 'remove')
    .map((script) => `scripts.${script.name}`)
  const packageJsonFieldsToRestore = plan.packageJsonChanges.map((change) =>
    change.claim.action === 'array-value'
      ? `${change.claim.path}: ${String(change.claim.value)}`
      : change.claim.path,
  )
  const tsconfigJsonFieldsToRestore = plan.tsconfigJsonChanges.map((change) =>
    change.claim.action === 'array-value'
      ? `${change.claim.path}: ${String(change.claim.value)}`
      : change.claim.path,
  )
  const pnpmWorkspaceFieldsToRestore = plan.pnpmWorkspaceChanges.map((change) => change.claim.path)
  const yarnRcFieldsToRestore = plan.yarnRcChanges.map(
    (change) => `${change.claim.file}: ${change.claim.path}`,
  )

  addList(lines, 'Files to delete:', filesToDelete, '(none)')
  lines.push('')
  addList(lines, 'package.json scripts to remove:', scriptsToRemove, '(none)')
  lines.push('')
  addList(lines, 'package.json fields to restore:', packageJsonFieldsToRestore, '(none)')
  lines.push('')
  addList(lines, 'tsconfig.json fields to restore:', tsconfigJsonFieldsToRestore, '(none)')
  lines.push('')
  addList(lines, 'pnpm-workspace.yaml fields to restore:', pnpmWorkspaceFieldsToRestore, '(none)')
  lines.push('')
  addList(lines, '.yarnrc.yml fields to restore:', yarnRcFieldsToRestore, '(none)')
  lines.push('')
  addList(lines, 'Warnings:', plan.warnings, 'No warnings found.')
  lines.push('')
  addList(lines, 'Blockers:', plan.blockers, 'No blockers found.')

  if (options.dryRun) {
    lines.push('', 'No changes were written because --dry-run was used.')
  } else if (!options.yes) {
    lines.push('', 'No changes were written because --yes was not used.')
    lines.push('Run "frontron clean --yes" to apply this plan.')
  }

  return lines.join('\n')
}
