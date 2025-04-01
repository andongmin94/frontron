import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  createFileHash,
  MANIFEST_PATH,
  type PackageJsonOwnershipClaim,
  readManifest,
} from './init/manifest'
import {
  deletePackageJsonPath,
  readPackageJsonPath,
  valuesEqual,
  writePackageJsonPath,
} from './init/package-json-path'
import type { PackageJson } from './init/shared'
import { normalizePathValue } from './init/shared'

export interface CleanOptions {
  yes: boolean
  force: boolean
  dryRun?: boolean
}

export interface CleanOutput {
  info(message: string): void
}

export interface CleanContext {
  cwd: string
  output: CleanOutput
}

type CleanFileChange = {
  manifestPath: string
  absolutePath: string
  action: 'delete' | 'missing' | 'blocked'
  reason: string
}

type CleanScriptChange = {
  name: string
  action: 'remove' | 'missing' | 'blocked'
}

type CleanPackageJsonChange = {
  claim: PackageJsonOwnershipClaim
  action: 'restore'
}

type CleanPlan = {
  files: CleanFileChange[]
  scripts: CleanScriptChange[]
  packageJsonChanges: CleanPackageJsonChange[]
  warnings: string[]
  blockers: string[]
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function isInsideDirectory(root: string, target: string) {
  const pathFromRoot = relative(root, target)

  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

function hasOwnString(record: Record<string, string> | undefined, key: string) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key))
}

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

function resolveManifestFile(cwd: string, manifestPath: string) {
  const root = resolve(cwd)

  if (isAbsolute(manifestPath)) {
    return {
      absolutePath: resolve(manifestPath),
      blocker: `Manifest file entry must be relative: ${manifestPath}`,
    }
  }

  const absolutePath = resolve(root, manifestPath)

  if (!isInsideDirectory(root, absolutePath)) {
    return {
      absolutePath,
      blocker: `Manifest file entry points outside the project: ${manifestPath}`,
    }
  }

  if (absolutePath === root) {
    return {
      absolutePath,
      blocker: `Manifest file entry cannot target the project root: ${manifestPath}`,
    }
  }

  return { absolutePath, blocker: null }
}

function createCleanPlan(cwd: string, packageJson: PackageJson, options: CleanOptions): CleanPlan {
  const manifest = readManifest(cwd)

  if (!manifest) {
    throw new Error(`${MANIFEST_PATH} was not found. Nothing can be cleaned safely.`)
  }

  const warnings: string[] = []

  if (!manifest.fileHashes) {
    warnings.push(`${MANIFEST_PATH} does not include file hashes. Run "frontron update --yes" to refresh it.`)
  }

  if (!manifest.scriptCommands) {
    warnings.push(`${MANIFEST_PATH} does not include script commands. Run "frontron update --yes" to refresh it.`)
  }

  if (!manifest.packageJsonClaims) {
    warnings.push(`${MANIFEST_PATH} does not include package.json ownership. Run "frontron update --yes" to refresh it.`)
  }

  const blockers: string[] = []
  const files: CleanFileChange[] = []
  const scripts: CleanScriptChange[] = []
  const packageJsonChanges: CleanPackageJsonChange[] = []
  const manifestFiles = uniqueStrings([...manifest.createdFiles, MANIFEST_PATH]).sort((left, right) => {
    if (left === MANIFEST_PATH) return 1
    if (right === MANIFEST_PATH) return -1
    return 0
  })

  for (const manifestPath of manifestFiles) {
    const resolved = resolveManifestFile(cwd, manifestPath)

    if (resolved.blocker) {
      blockers.push(resolved.blocker)
      files.push({
        manifestPath,
        absolutePath: resolved.absolutePath,
        action: 'blocked',
        reason: resolved.blocker,
      })
      continue
    }

    if (!existsSync(resolved.absolutePath)) {
      warnings.push(`Manifest file is already missing: ${manifestPath}`)
      files.push({
        manifestPath,
        absolutePath: resolved.absolutePath,
        action: 'missing',
        reason: 'File is already missing.',
      })
      continue
    }

    const stats = lstatSync(resolved.absolutePath)

    if (stats.isSymbolicLink()) {
      const blocker = `Manifest file entry points to a symbolic link and will not be removed: ${manifestPath}`
      blockers.push(blocker)
      files.push({
        manifestPath,
        absolutePath: resolved.absolutePath,
        action: 'blocked',
        reason: blocker,
      })
      continue
    }

    if (stats.isDirectory()) {
      const blocker = `Manifest file entry points to a directory and will not be removed: ${manifestPath}`
      blockers.push(blocker)
      files.push({
        manifestPath,
        absolutePath: resolved.absolutePath,
        action: 'blocked',
        reason: blocker,
      })
      continue
    }

    const expectedHash = manifest.fileHashes?.[manifestPath]

    if (expectedHash) {
      const currentHash = createFileHash(readFileSync(resolved.absolutePath))

      if (currentHash !== expectedHash && !options.force) {
        const blocker = `Manifest-owned file was modified and will not be removed without --force: ${manifestPath}`
        blockers.push(blocker)
        files.push({
          manifestPath,
          absolutePath: resolved.absolutePath,
          action: 'blocked',
          reason: blocker,
        })
        continue
      }

      if (currentHash !== expectedHash) {
        warnings.push(`Modified manifest-owned file will be removed because --force was used: ${manifestPath}`)
      }
    } else if (manifestPath !== MANIFEST_PATH && manifest.fileHashes) {
      warnings.push(`Manifest file hash is missing for: ${manifestPath}`)
    }

    files.push({
      manifestPath,
      absolutePath: resolved.absolutePath,
      action: 'delete',
      reason: 'File is recorded in the Frontron manifest.',
    })
  }

  for (const scriptName of uniqueStrings(manifest.scripts)) {
    const currentCommand = packageJson.scripts?.[scriptName]

    if (!hasOwnString(packageJson.scripts, scriptName)) {
      warnings.push(`Package script is already missing: ${scriptName}`)
      scripts.push({ name: scriptName, action: 'missing' })
      continue
    }

    const expectedCommand = manifest.scriptCommands?.[scriptName]

    if (hasOwnString(manifest.scriptCommands, scriptName) && currentCommand !== expectedCommand && !options.force) {
      const blocker = `Manifest-owned script was modified and will not be removed without --force: ${scriptName}`
      blockers.push(blocker)
      scripts.push({ name: scriptName, action: 'blocked' })
      continue
    }

    if (hasOwnString(manifest.scriptCommands, scriptName) && currentCommand !== expectedCommand) {
      warnings.push(`Modified manifest-owned script will be removed because --force was used: ${scriptName}`)
    } else if (!hasOwnString(manifest.scriptCommands, scriptName) && manifest.scriptCommands) {
      warnings.push(`Manifest script command is missing for: ${scriptName}`)
    }

    scripts.push({ name: scriptName, action: 'remove' })
  }

  for (const claim of manifest.packageJsonClaims ?? []) {
    const current = readPackageJsonPath(packageJson, claim.path)
    const action = claim.action ?? 'set'

    if (action === 'array-value') {
      if (Array.isArray(current.value)) {
        if (current.value.some((value) => valuesEqual(value, claim.value))) {
          packageJsonChanges.push({
            claim,
            action: 'restore',
          })
        } else {
          warnings.push(`Manifest-owned package.json array value is already missing: ${claim.path}`)
        }
      } else if (!current.exists) {
        warnings.push(`Manifest-owned package.json field is already missing: ${claim.path}`)
      } else if (options.force) {
        warnings.push(`Package.json field will be restored because --force was used: ${claim.path}`)
        packageJsonChanges.push({
          claim,
          action: 'restore',
        })
      } else {
        warnings.push(`Package.json field has local edits and was left intact: ${claim.path}`)
      }

      continue
    }

    if (current.exists && valuesEqual(current.value, claim.value)) {
      packageJsonChanges.push({
        claim,
        action: 'restore',
      })
    } else if (!current.exists) {
      warnings.push(`Manifest-owned package.json field is already missing: ${claim.path}`)
    } else if (options.force) {
      warnings.push(`Package.json field will be restored because --force was used: ${claim.path}`)
      packageJsonChanges.push({
        claim,
        action: 'restore',
      })
    } else {
      warnings.push(`Package.json field has local edits and was left intact: ${claim.path}`)
    }
  }

  return { files, scripts, packageJsonChanges, warnings, blockers }
}

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

function renderCleanPlan(plan: CleanPlan, options: CleanOptions) {
  const lines = ['Frontron Clean', '']
  const filesToDelete = plan.files
    .filter((file) => file.action === 'delete')
    .map((file) => normalizePathValue(file.manifestPath, file.manifestPath))
  const scriptsToRemove = plan.scripts
    .filter((script) => script.action === 'remove')
    .map((script) => `scripts.${script.name}`)
  const packageJsonFieldsToRestore = plan.packageJsonChanges
    .map((change) =>
      change.claim.action === 'array-value'
        ? `${change.claim.path}: ${String(change.claim.value)}`
        : change.claim.path,
    )

  addList(lines, 'Files to delete:', filesToDelete, '(none)')
  lines.push('')
  addList(lines, 'package.json scripts to remove:', scriptsToRemove, '(none)')
  lines.push('')
  addList(lines, 'package.json fields to restore:', packageJsonFieldsToRestore, '(none)')
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
      // Non-empty or concurrently changed directories are intentionally left alone.
    }
  }
}

function applyCleanPlan(cwd: string, packageJsonPath: string, packageJson: PackageJson, plan: CleanPlan) {
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

export async function runClean(options: CleanOptions, context: CleanContext) {
  const packageJsonPath = join(context.cwd, 'package.json')

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

  applyCleanPlan(context.cwd, packageJsonPath, packageJson, plan)
  context.output.info(renderCleanPlan(plan, options))
  context.output.info('')
  context.output.info('[Frontron] Removed manifest-owned Electron retrofit files and scripts.')

  return 0
}
