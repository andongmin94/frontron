import { relative } from 'node:path'

import {
  formatPackageJsonPatchChange,
  type PackageJsonPatchPlan,
} from './package-json'
import type { InitConfig, InitOptions, PackageJson } from './shared'
import { normalizePathValue } from './shared'

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
  warnings: string[]
  blockers: string[]
}

export function createInitPlan(input: {
  config: InitConfig
  filesToWrite: Map<string, string>
  packageJsonPlan: PackageJsonPatchPlan
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
    warnings: input.warnings,
    blockers: input.blockers,
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
      warnings.push(
        `Existing "${entry.label}" script found. Using "${entry.selected}" instead.`,
      )
    }
  }

  return warnings
}
