import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

import { formatPackageJsonPatchChange, type PackageJsonPatchPlan } from './package-json'
import { createFileHash } from './manifest'
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
  expectedHash: string | null
}

export type ObsoleteFileChange = {
  path: string
  manifestPath: string
  expectedHash: string
}

export type InitPlan = {
  config: InitConfig
  files: FileChange[]
  obsoleteFiles: ObsoleteFileChange[]
  packageJsonPlan: PackageJsonPatchPlan
  packageJsonExpectedHash: string
  tsconfigJsonPlan?: TsconfigJsonPatchPlan | null
  pnpmWorkspacePlan?: PnpmWorkspaceYamlPatchPlan | null
  yarnRcPlan?: YarnRcYamlPatchPlan | null
  warnings: string[]
  blockers: string[]
}

export function createInitPlan(input: {
  config: InitConfig
  filesToWrite: Map<string, string>
  obsoleteFiles?: ObsoleteFileChange[]
  packageJsonPlan: PackageJsonPatchPlan
  packageJsonExpectedHash: string
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
        expectedHash: createFileHash(readFileSync(filePath)),
      })
      continue
    }

    if (overwriteFiles.has(filePath)) {
      files.push({
        path: filePath,
        action: 'overwrite',
        reason: 'File is recorded in the Frontron manifest and --force was used.',
        content,
        expectedHash: createFileHash(readFileSync(filePath)),
      })
      continue
    }

    files.push({
      path: filePath,
      action: 'create',
      reason: 'File does not exist yet.',
      content,
      expectedHash: null,
    })
  }

  return {
    config: input.config,
    files,
    obsoleteFiles: input.obsoleteFiles ?? [],
    packageJsonPlan: input.packageJsonPlan,
    packageJsonExpectedHash: input.packageJsonExpectedHash,
    tsconfigJsonPlan: input.tsconfigJsonPlan,
    pnpmWorkspacePlan: input.pnpmWorkspacePlan,
    yarnRcPlan: input.yarnRcPlan,
    warnings: input.warnings,
    blockers: input.blockers,
  }
}

// appendSection 함수는 dry-run 보고서의 공통 섹션 출력 규칙을 통일한다.
function appendSection(lines: string[], title: string, entries: string[]) {
  lines.push('', title)
  lines.push(...(entries.length > 0 ? entries : ['  (none)']))
}

// formatPlannedFileChanges 함수는 생성/덮어쓰기/제거 파일을 섹션별 문자열로 만든다.
function formatPlannedFileChanges(plan: InitPlan) {
  const cwd = plan.config.cwd
  const formatPath = (filePath: string) => normalizePathValue(relative(cwd, filePath), filePath)
  return {
    create: plan.files
      .filter((file) => file.action === 'create')
      .map((file) => `  + ${formatPath(file.path)}`),
    overwrite: plan.files
      .filter((file) => file.action === 'overwrite')
      .map((file) => `  ~ ${formatPath(file.path)}`),
    remove: plan.obsoleteFiles.map((file) => `  - ${file.manifestPath}`),
    blocked: plan.files
      .filter((file) => file.action === 'blocked')
      .map((file) => `  - Existing file will not be overwritten automatically: ${formatPath(file.path)}`),
  }
}

// formatConfigChanges 함수는 각 설정 파일 계획을 dry-run 표시용 문자열로 변환한다.
function formatConfigChanges(plan: InitPlan) {
  const config = plan.config
  const yarnRcDisplayPath = plan.yarnRcPlan
    ? normalizePathValue(relative(config.cwd, plan.yarnRcPlan.path), plan.yarnRcPlan.path)
    : '.yarnrc.yml'
  return {
    packageJson: plan.packageJsonPlan.changes.map(formatPackageJsonPatchChange),
    tsconfig:
      plan.tsconfigJsonPlan?.changes.map((change) => `  + ${change.path}: ${change.value}`) ?? [],
    pnpm:
      plan.pnpmWorkspacePlan?.changes.map(
        (change) => `  + ${change.path}: ${String(change.value)}`,
      ) ?? [],
    yarn:
      plan.yarnRcPlan?.changes.map((change) => {
        const marker = change.action === 'create' || change.action === 'add' ? '+' : '~'
        const previous = change.previous === 'missing' ? '(missing)' : change.previous
        return `  ${marker} ${yarnRcDisplayPath} ${change.path}: ${previous} -> ${change.value}`
      }) ?? [],
  }
}

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
    lines.push('  Reasons:', ...config.adapterReasons.map((reason) => `    - ${reason}`))
  }

  const files = formatPlannedFileChanges(plan)
  appendSection(lines, 'Files to create:', files.create)
  appendSection(lines, 'Files to overwrite:', files.overwrite)
  appendSection(lines, 'Files to remove:', files.remove)

  const configChanges = formatConfigChanges(plan)
  appendSection(lines, 'package.json changes:', configChanges.packageJson)
  appendSection(lines, 'tsconfig.json changes:', configChanges.tsconfig)
  appendSection(lines, 'pnpm-workspace.yaml changes:', configChanges.pnpm)
  appendSection(lines, '.yarnrc.yml changes:', configChanges.yarn)

  if (plan.warnings.length > 0) {
    appendSection(lines, 'Warnings:', plan.warnings.map((warning) => `  - ${warning}`))
  }

  const blockers = [...plan.blockers.map((blocker) => `  - ${blocker}`), ...files.blocked]
  if (blockers.length > 0) appendSection(lines, 'Blockers:', blockers)

  lines.push('', 'No changes were written because --dry-run was used.')
  return lines.join('\n')
}

export function createScriptFallbackWarnings(
  packageJson: PackageJson,
  options: InitOptions,
  scripts: {
    appScript: string
    buildScript: string
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
  ]) {
    if (!entry.explicit && entry.selected !== entry.label && packageJson.scripts?.[entry.label]) {
      warnings.push(`Existing "${entry.label}" script found. Using "${entry.selected}" instead.`)
    }
  }

  return warnings
}
