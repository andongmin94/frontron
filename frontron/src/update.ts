import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { runInit, type InitContext, type InitOptions } from './init'
import { MANIFEST_PATH, readManifest, type FrontronManifest } from './init/manifest'
import { inspectManifestClaim } from './init/manifest-claim-status'
import { readPackageJsonPath } from './init/package-json-path'
import {
  findPnpmWorkspaceYamlPath,
  readPnpmWorkspaceYamlClaimValue,
} from './init/pnpm-workspace-yaml'
import type { PackageJson } from './init/shared'
import { readTsconfigJson } from './init/tsconfig-json'
import {
  readYarnRcYamlClaimValue,
  resolveYarnRcClaimPath,
  YARN_RC_YAML_PATH,
} from './init/yarnrc-yaml'
import { createManifestInitOptions } from './manifest-migration'
import { inspectManagedFile, inspectManagedScript } from './managed-state'
import {
  assertProjectPathSafe,
  formatProjectPathBlocker,
  inspectProjectPath,
} from './project-paths'

type UpdateOptions = Pick<InitOptions, 'yes' | 'force' | 'dryRun'>

type UpdateInspection = {
  localChanges: string[]
  safetyBlockers: string[]
}

// claim 검사 결과를 update가 사용자에게 보여 줄 덮어쓰기 사유로 바꾼다.
function addClaimBlocker(
  blockers: string[],
  label: string,
  claimPath: string,
  state: ReturnType<typeof inspectManifestClaim>['state'],
) {
  if (state === 'unchanged') return

  const reason = state === 'missing' ? 'is missing' : 'has local edits'
  blockers.push(`Manifest-owned ${label} field ${reason}: ${claimPath}`)
}

// package.json의 manifest 소유 필드를 현재 값과 비교한다.
function inspectPackageJsonClaims(
  manifest: FrontronManifest,
  packageJson: PackageJson,
  localChanges: string[],
) {
  if (!manifest.packageJsonClaims) {
    localChanges.push('Legacy manifest has no package.json ownership metadata')
    return
  }

  for (const claim of manifest.packageJsonClaims) {
    const status = inspectManifestClaim(
      'package.json',
      claim,
      readPackageJsonPath(packageJson, claim.path),
    )
    addClaimBlocker(localChanges, 'package.json', claim.path, status.state)
  }
}

// tsconfig.json의 manifest 소유 필드를 검사한다.
function inspectTsconfigClaims(
  cwd: string,
  manifest: FrontronManifest,
  localChanges: string[],
  safetyBlockers: string[],
) {
  const claims = manifest.tsconfigJsonClaims ?? []
  if (claims.length === 0) return

  const path = resolve(cwd, 'tsconfig.json')
  const inspection = inspectProjectPath(cwd, path)

  if (!inspection.safe) {
    safetyBlockers.push(formatProjectPathBlocker(cwd, 'tsconfig.json', inspection))
    return
  }
  if (!existsSync(path)) return

  try {
    const tsconfig = readTsconfigJson(path)

    for (const claim of claims) {
      const status = inspectManifestClaim(
        'tsconfig.json',
        claim,
        readPackageJsonPath(tsconfig, claim.path),
      )
      addClaimBlocker(localChanges, 'tsconfig.json', claim.path, status.state)
    }
  } catch {
    localChanges.push('Manifest-owned tsconfig.json cannot be verified because it is invalid')
  }
}

// pnpm-workspace.yaml의 manifest 소유 필드를 검사한다.
function inspectPnpmWorkspaceClaims(
  cwd: string,
  manifest: FrontronManifest,
  localChanges: string[],
  safetyBlockers: string[],
) {
  const claims = manifest.pnpmWorkspaceClaims ?? []
  if (claims.length === 0) return

  const path = findPnpmWorkspaceYamlPath(cwd)
  const root = dirname(path)
  const inspection = inspectProjectPath(root, path)

  if (!inspection.safe) {
    safetyBlockers.push(formatProjectPathBlocker(root, 'pnpm-workspace.yaml', inspection))
    return
  }
  if (!existsSync(path)) return

  try {
    const source = readFileSync(path, 'utf8')

    for (const claim of claims) {
      const current = readPnpmWorkspaceYamlClaimValue(source, claim.path)

      if (!current.safeToEdit) {
        safetyBlockers.push(current.blocker ?? 'Cannot safely inspect pnpm-workspace.yaml.')
        continue
      }

      const status = inspectManifestClaim('pnpm-workspace.yaml', claim, current)
      addClaimBlocker(localChanges, 'pnpm-workspace.yaml', claim.path, status.state)
    }
  } catch {
    localChanges.push('Manifest-owned pnpm-workspace.yaml cannot be verified because it is invalid')
  }
}

// .yarnrc.yml의 manifest 소유 nodeLinker 값을 검사한다.
function inspectYarnRcClaims(
  cwd: string,
  manifest: FrontronManifest,
  localChanges: string[],
  safetyBlockers: string[],
) {
  for (const claim of manifest.yarnRcClaims ?? []) {
    const resolution = resolveYarnRcClaimPath(cwd, claim.file)

    if (!resolution.safe) {
      safetyBlockers.push(resolution.blocker)
      continue
    }
    if (!existsSync(resolution.path)) continue

    const stats = lstatSync(resolution.path)
    if (!stats.isFile() || stats.nlink !== 1) {
      safetyBlockers.push(
        `Manifest-owned ${YARN_RC_YAML_PATH} must be a regular file with one hard link: ${claim.file}`,
      )
      continue
    }

    const current = readYarnRcYamlClaimValue(readFileSync(resolution.path, 'utf8'))
    if (!current.safeToEdit) {
      safetyBlockers.push(current.blocker ?? `Cannot safely inspect ${claim.file}.`)
      continue
    }

    const status = inspectManifestClaim(YARN_RC_YAML_PATH, claim, current)
    addClaimBlocker(localChanges, claim.file, claim.path, status.state)
  }
}

// update 직전에 모든 manifest 소유 항목을 동일한 상태 규칙으로 검사한다.
function inspectUpdateState(cwd: string, manifest: FrontronManifest): UpdateInspection {
  const localChanges: string[] = []
  const safetyBlockers: string[] = []
  const packageJsonPath = resolve(cwd, 'package.json')

  assertProjectPathSafe(cwd, packageJsonPath, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson

  for (const filePath of new Set(manifest.createdFiles)) {
    if (filePath === MANIFEST_PATH) continue

    const inspection = inspectManagedFile(cwd, filePath, manifest.fileHashes?.[filePath])

    if (inspection.state === 'unsafe') {
      safetyBlockers.push(inspection.blocker ?? `Manifest file entry is unsafe: ${filePath}`)
    } else if (inspection.state === 'modified') {
      localChanges.push(`Manifest-owned file has local edits: ${filePath}`)
    } else if (inspection.state === 'unverifiable') {
      localChanges.push(`Manifest-owned file has no recorded hash: ${filePath}`)
    }
  }

  for (const scriptName of new Set(manifest.scripts)) {
    const state = inspectManagedScript(packageJson.scripts, manifest.scriptCommands, scriptName)

    if (state === 'modified') {
      localChanges.push(`Manifest-owned script has local edits: ${scriptName}`)
    } else if (state === 'unverifiable') {
      localChanges.push(`Manifest-owned script has no recorded command: ${scriptName}`)
    }
  }

  inspectPackageJsonClaims(manifest, packageJson, localChanges)
  inspectTsconfigClaims(cwd, manifest, localChanges, safetyBlockers)
  inspectPnpmWorkspaceClaims(cwd, manifest, localChanges, safetyBlockers)
  inspectYarnRcClaims(cwd, manifest, localChanges, safetyBlockers)

  return {
    localChanges: [...new Set(localChanges)],
    safetyBlockers: [...new Set(safetyBlockers)],
  }
}

// manifest 설정을 유지하면서 생성 파일과 프로젝트 설정을 최신 템플릿으로 갱신한다.
export async function runUpdate(options: UpdateOptions, context: InitContext) {
  const manifestPath = resolve(context.cwd, MANIFEST_PATH)
  assertProjectPathSafe(context.cwd, manifestPath, 'Frontron manifest')

  const manifest = readManifest(context.cwd)
  if (!manifest) {
    throw new Error(`${MANIFEST_PATH} was not found. Run "frontron init" before update.`)
  }

  const inspection = inspectUpdateState(context.cwd, manifest)

  if (inspection.safetyBlockers.length > 0) {
    throw new Error(
      `Update aborted because managed paths are unsafe: ${inspection.safetyBlockers.join('; ')}`,
    )
  }

  if (inspection.localChanges.length > 0 && !options.force) {
    throw new Error(
      `Update aborted because manifest-owned local changes would be overwritten: ${inspection.localChanges.join('; ')}. Re-run with --force to replace them.`,
    )
  }

  const shouldApply = options.yes && !options.dryRun
  const exitCode = await runInit(
    {
      ...createManifestInitOptions(manifest, context.cwd),
      yes: true,
      force: true,
      dryRun: !shouldApply,
    },
    context,
  )

  if (!shouldApply && exitCode === 0) {
    context.output.info('')
    context.output.info('Run "frontron update --yes" to apply this plan.')
  }

  return exitCode
}
