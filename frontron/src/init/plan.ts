import { relative } from 'node:path'

import { formatPackageJsonPatchChange, type PackageJsonPatchPlan } from './package-json'
import type { TsconfigJsonPatchPlan } from './tsconfig-json'
import type { PnpmWorkspaceYamlPatchPlan } from './pnpm-workspace-yaml'
import type { InitConfig, InitOptions, PackageJson } from './shared'
import { normalizePathValue } from './shared'
import type { YarnRcYamlPatchPlan } from './yarnrc-yaml'

export type FileChangeAction = 'create' | 'overwrite' | 'blocked'

export type FileChange = {
  path: string
  action: FileChangeAction
  reason: string
  content: string
}

export type InitPlan = {
  config: InitConfig
  files: FileChange[]
  packageJsonPlan: PackageJsonPatchPlan
  tsconfigJsonPlan?: TsconfigJsonPatchPlan | null
  pnpmWorkspacePlan?: PnpmWorkspaceYamlPatchPlan | null
  yarnRcPlan?: YarnRcYamlPatchPlan | null
  warnings: string[]
  blockers: string[]
}

// createInitPlan 함수는 생성 파일, 패키지 패치, 경고와 차단 사유를 하나의 init 계획으로 묶는다.
export function createInitPlan(input: {
  config: InitConfig
  filesToWrite: Map<string, string>
  packageJsonPlan: PackageJsonPatchPlan
  tsconfigJsonPlan?: TsconfigJsonPatchPlan | null
  pnpmWorkspacePlan?: PnpmWorkspaceYamlPatchPlan | null
  yarnRcPlan?: YarnRcYamlPatchPlan | null
  warnings: string[]
  blockers: string[]
  blockedFiles: string[]
  overwriteFiles: string[]
}): InitPlan {
  const blockedFiles = new Set(input.blockedFiles)
  const overwriteFiles = new Set(input.overwriteFiles)
  const files: FileChange[] = []

  for (const [filePath, content] of input.filesToWrite) {
    if (blockedFiles.has(filePath)) {
      files.push({
        path: filePath,
        action: 'blocked',
        reason: 'Target file already exists and is not recorded in the Frontron manifest.',
        content,
      })
      continue
    }

    if (overwriteFiles.has(filePath)) {
      files.push({
        path: filePath,
        action: 'overwrite',
        reason: 'File is recorded in the Frontron manifest and --force was used.',
        content,
      })
      continue
    }

    files.push({
      path: filePath,
      action: 'create',
      reason: 'File does not exist yet.',
      content,
    })
  }

  return {
    config: input.config,
    files,
    packageJsonPlan: input.packageJsonPlan,
    tsconfigJsonPlan: input.tsconfigJsonPlan,
    pnpmWorkspacePlan: input.pnpmWorkspacePlan,
    yarnRcPlan: input.yarnRcPlan,
    warnings: input.warnings,
    blockers: input.blockers,
  }
}

// createDryRunReport 함수는 init dry-run 결과를 사람이 읽을 수 있는 리포트로 만든다.
export function createDryRunReport(plan: InitPlan) {
  const config = plan.config
  const lines = [
    'Detected:',
    `  Adapter: ${config.adapter}`,
    `  Confidence: ${config.adapterConfidence}`,
    `  Strategy: ${config.runtimeStrategy}`,
    `  Web dev script: ${config.webDevScript}`,
    `  Web build script: ${config.webBuildScript}`,
  ]

  if (config.adapterReasons.length > 0) {
    lines.push('  Reasons:')

    for (const reason of config.adapterReasons) {
      lines.push(`    - ${reason}`)
    }
  }

  lines.push('', 'Files to create:')

  for (const file of plan.files) {
    if (file.action !== 'create') {
      continue
    }

    lines.push(`  + ${normalizePathValue(relative(config.cwd, file.path), file.path)}`)
  }

  const overwriteFiles = plan.files.filter((file) => file.action === 'overwrite')

  if (overwriteFiles.length > 0) {
    lines.push('', 'Files to overwrite:')

    for (const file of overwriteFiles) {
      lines.push(`  ~ ${normalizePathValue(relative(config.cwd, file.path), file.path)}`)
    }
  }

  lines.push('', 'package.json changes:')
  const packageJsonChangeLines = plan.packageJsonPlan.changes.map(formatPackageJsonPatchChange)
  lines.push(...(packageJsonChangeLines.length > 0 ? packageJsonChangeLines : ['  (none)']))

  lines.push('', 'tsconfig.json changes:')
  const tsconfigJsonChangeLines =
    plan.tsconfigJsonPlan?.changes.map((change) => `  + ${change.path}: ${change.value}`) ?? []
  lines.push(...(tsconfigJsonChangeLines.length > 0 ? tsconfigJsonChangeLines : ['  (none)']))

  lines.push('', 'pnpm-workspace.yaml changes:')
  const pnpmWorkspaceChangeLines =
    plan.pnpmWorkspacePlan?.changes.map(
      (change) => `  + ${change.path}: ${String(change.value)}`,
    ) ?? []
  lines.push(...(pnpmWorkspaceChangeLines.length > 0 ? pnpmWorkspaceChangeLines : ['  (none)']))

  lines.push('', '.yarnrc.yml changes:')
  const yarnRcDisplayPath = plan.yarnRcPlan
    ? normalizePathValue(relative(config.cwd, plan.yarnRcPlan.path), plan.yarnRcPlan.path)
    : '.yarnrc.yml'
  const yarnRcChangeLines =
    plan.yarnRcPlan?.changes.map((change) => {
      const marker = change.action === 'create' || change.action === 'add' ? '+' : '~'
      const previous = change.previous === 'missing' ? '(missing)' : change.previous
      return `  ${marker} ${yarnRcDisplayPath} ${change.path}: ${previous} -> ${change.value}`
    }) ?? []
  lines.push(...(yarnRcChangeLines.length > 0 ? yarnRcChangeLines : ['  (none)']))

  if (plan.warnings.length > 0) {
    lines.push('', 'Warnings:')

    for (const warning of plan.warnings) {
      lines.push(`  - ${warning}`)
    }
  }

  const blockedFiles = plan.files.filter((file) => file.action === 'blocked')

  if (blockedFiles.length > 0 || plan.blockers.length > 0) {
    lines.push('', 'Blockers:')

    for (const blocker of plan.blockers) {
      lines.push(`  - ${blocker}`)
    }

    for (const file of blockedFiles) {
      lines.push(
        `  - Existing file will not be overwritten automatically: ${normalizePathValue(
          relative(config.cwd, file.path),
          file.path,
        )}`,
      )
    }
  }

  lines.push('', 'No changes were written because --dry-run was used.')

  return lines.join('\n')
}

// createScriptFallbackWarnings 함수는 기본 script 이름이 이미 있어 대체 이름을 쓴 경우 경고를 만든다.
export function createScriptFallbackWarnings(
  packageJson: PackageJson,
  options: InitOptions,
  scripts: {
    appScript: string
    buildScript: string
    packageScript: string
  },
) {
  const warnings: string[] = []

  for (const entry of [
    {
      label: 'frontron:dev',
      selected: scripts.appScript,
      explicit: Boolean(options.appScript),
    },
    {
      label: 'frontron:build',
      selected: scripts.buildScript,
      explicit: Boolean(options.buildScript),
    },
    {
      label: 'frontron:package',
      selected: scripts.packageScript,
      explicit: Boolean(options.packageScript),
    },
  ]) {
    if (!entry.explicit && entry.selected !== entry.label && packageJson.scripts?.[entry.label]) {
      warnings.push(`Existing "${entry.label}" script found. Using "${entry.selected}" instead.`)
    }
  }

  return warnings
}
