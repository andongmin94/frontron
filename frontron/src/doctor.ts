import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { createFileHash, MANIFEST_PATH, readManifest } from './init/manifest'
import { inspectManifestClaim } from './init/manifest-claim-status'
import { hasOwnString, readPackageJsonPath } from './init/package-json-path'
import { isValidAppVersion } from './init/package-json'
import { hasPackageDependency } from './init/detect'
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
import {
  assertProjectPathSafe,
  formatProjectPathBlocker,
  inspectProjectPath,
  isInsideDirectory,
} from './project-paths'

export interface DoctorOutput {
  info(message: string): void
}

export interface DoctorContext {
  cwd: string
  output: DoctorOutput
}

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

// createDoctorNextSteps 함수는 doctor 결과에 따라 사용자가 다음에 할 일을 안내하는 문구를 만든다.
function createDoctorNextSteps(manifestFound: boolean, warnings: string[], blockers: string[]) {
  if (!manifestFound) {
    return ['Run "frontron init --dry-run" to preview the retrofit plan.']
  }

  if (blockers.length > 0) {
    return ['Run "frontron update --dry-run" to inspect a guarded refresh plan.']
  }

  if (warnings.length > 0) {
    return ['Review the warnings above before refreshing or cleaning generated files.']
  }

  return ['No action needed.']
}

// writeDoctorReport 함수는 수집한 점검 결과를 일관된 doctor 보고서로 출력한다.
function writeDoctorReport(
  context: DoctorContext,
  status: string,
  manifestFound: boolean,
  checks: string[],
  warnings: string[],
  blockers: string[],
) {
  const lines = ['Frontron Doctor', '', `Status: ${status}`, '']
  addList(lines, 'Checks:', checks, '(none)')
  lines.push('')
  addList(lines, 'Warnings:', warnings, 'No warnings found.')
  lines.push('')
  addList(lines, 'Blockers:', blockers, 'No blockers found.')
  lines.push('')
  addList(lines, 'Next steps:', createDoctorNextSteps(manifestFound, warnings, blockers), '(none)')

  context.output.info(lines.join('\n'))
}

// resolveDoctorManifestFile 함수는 doctor가 읽을 manifest 항목의 실제 경로가 안전한지 확인한다.
function resolveDoctorManifestFile(cwd: string, filePath: string) {
  const root = resolve(cwd)

  if (isAbsolute(filePath)) {
    return {
      path: resolve(filePath),
      blocker: `Manifest file entry must be relative: ${filePath}`,
    }
  }

  const absolutePath = resolve(root, filePath)

  if (!isInsideDirectory(root, absolutePath) || absolutePath === root) {
    return {
      path: absolutePath,
      blocker: `Manifest file entry points outside the project: ${filePath}`,
    }
  }

  const inspection = inspectProjectPath(root, absolutePath)

  if (!inspection.safe) {
    return {
      path: absolutePath,
      blocker: formatProjectPathBlocker(root, `Manifest file entry (${filePath})`, inspection),
    }
  }

  return { path: absolutePath, blocker: null }
}

// runDoctor 함수는 현재 프로젝트의 Frontron 초기화 상태를 점검한다.
export async function runDoctor(context: DoctorContext) {
  const packageJsonPath = join(context.cwd, 'package.json')

  assertProjectPathSafe(context.cwd, packageJsonPath, 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error('package.json was not found in the current directory.')
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
  const warnings: string[] = []
  const blockers: string[] = []
  const checks: string[] = ['package.json found']
  const manifestPath = resolve(context.cwd, MANIFEST_PATH)
  const manifestInspection = inspectProjectPath(context.cwd, manifestPath)

  if (!manifestInspection.safe) {
    blockers.push(formatProjectPathBlocker(context.cwd, 'Frontron manifest', manifestInspection))
    writeDoctorReport(context, 'blocked', true, checks, warnings, blockers)
    return 1
  }

  const manifest = readManifest(context.cwd)

  if (!manifest) {
    warnings.push(`${MANIFEST_PATH} was not found. Run "frontron init" before doctor.`)
    blockers.push('Frontron has not been initialized in this project.')
    writeDoctorReport(context, 'not initialized', false, checks, warnings, blockers)
    return 1
  }

  checks.push(`${MANIFEST_PATH} found`)

  if (!manifest.fileHashes) {
    warnings.push(
      `${MANIFEST_PATH} does not include file hashes. Run "frontron update --yes" to refresh it.`,
    )
  }

  if (!manifest.scriptCommands) {
    warnings.push(
      `${MANIFEST_PATH} does not include script commands. Run "frontron update --yes" to refresh it.`,
    )
  }

  if (!manifest.packageJsonClaims) {
    warnings.push(
      `${MANIFEST_PATH} does not include package.json ownership. Run "frontron update --yes" to refresh it.`,
    )
  }

  const tsconfigJsonClaims = manifest.tsconfigJsonClaims ?? []

  if (tsconfigJsonClaims.length > 0) {
    const tsconfigPath = join(context.cwd, 'tsconfig.json')
    const tsconfigInspection = inspectProjectPath(context.cwd, tsconfigPath)

    if (!tsconfigInspection.safe) {
      blockers.push(formatProjectPathBlocker(context.cwd, 'tsconfig.json', tsconfigInspection))
    } else if (!existsSync(tsconfigPath)) {
      warnings.push(
        'Manifest-owned tsconfig.json changes cannot be checked because tsconfig.json is missing.',
      )
    } else {
      try {
        const tsconfigJson = readTsconfigJson(tsconfigPath)

        for (const claim of tsconfigJsonClaims) {
          const status = inspectManifestClaim(
            'tsconfig.json',
            claim,
            readPackageJsonPath(tsconfigJson, claim.path),
          )

          if (status.check) checks.push(status.check)
          if (status.warning) warnings.push(status.warning)
        }
      } catch {
        warnings.push('tsconfig.json could not be parsed as JSON or JSONC.')
      }
    }
  }

  const pnpmWorkspaceClaims = manifest.pnpmWorkspaceClaims ?? []

  if (pnpmWorkspaceClaims.length > 0) {
    const pnpmWorkspacePath = findPnpmWorkspaceYamlPath(context.cwd)
    const pnpmWorkspaceRoot = dirname(pnpmWorkspacePath)
    const pnpmWorkspaceInspection = inspectProjectPath(pnpmWorkspaceRoot, pnpmWorkspacePath)

    if (!pnpmWorkspaceInspection.safe) {
      blockers.push(
        formatProjectPathBlocker(pnpmWorkspaceRoot, 'pnpm-workspace.yaml', pnpmWorkspaceInspection),
      )
    } else if (!existsSync(pnpmWorkspacePath)) {
      warnings.push(
        'Manifest-owned pnpm-workspace.yaml changes cannot be checked because pnpm-workspace.yaml is missing.',
      )
    } else {
      const pnpmWorkspaceSource = readFileSync(pnpmWorkspacePath, 'utf8')

      for (const claim of pnpmWorkspaceClaims) {
        const status = inspectManifestClaim(
          'pnpm-workspace.yaml',
          claim,
          readPnpmWorkspaceYamlClaimValue(pnpmWorkspaceSource, claim.path),
        )

        if (status.check) checks.push(status.check)
        if (status.warning) warnings.push(status.warning)
      }
    }
  }

  const yarnRcClaims = manifest.yarnRcClaims ?? []

  for (const claim of yarnRcClaims) {
    const resolution = resolveYarnRcClaimPath(context.cwd, claim.file)

    if (!resolution.safe) {
      blockers.push(resolution.blocker)
      continue
    }

    if (!existsSync(resolution.path)) {
      warnings.push(
        `Manifest-owned ${YARN_RC_YAML_PATH} changes cannot be checked because ${claim.file} is missing.`,
      )
      continue
    }

    const stats = lstatSync(resolution.path)

    if (!stats.isFile()) {
      blockers.push(`Manifest-owned ${YARN_RC_YAML_PATH} is not a regular file: ${claim.file}`)
      continue
    }

    if (stats.nlink !== 1) {
      blockers.push(
        `Manifest-owned ${YARN_RC_YAML_PATH} must have exactly one hard link: ${claim.file}`,
      )
      continue
    }

    const current = readYarnRcYamlClaimValue(readFileSync(resolution.path, 'utf8'))

    if (!current.safeToEdit) {
      blockers.push(current.blocker ?? `Cannot safely inspect ${claim.file}.`)
      continue
    }

    const status = inspectManifestClaim(YARN_RC_YAML_PATH, claim, current)

    if (status.check) checks.push(`${claim.file}: ${status.check}`)
    if (status.warning) warnings.push(`${claim.file}: ${status.warning}`)
  }

  if (manifest.preset === 'starter-like') {
    if (
      manifest.templateSource === 'create-frontron' &&
      manifest.templatePackage === 'create-frontron'
    ) {
      checks.push(
        manifest.templateVersion
          ? `create-frontron template metadata found (${manifest.templateVersion})`
          : 'create-frontron template metadata found',
      )
    } else {
      warnings.push(
        `${MANIFEST_PATH} does not include create-frontron template metadata. Run "frontron update --yes" to refresh it.`,
      )
    }
  }

  for (const filePath of manifest.createdFiles) {
    const resolvedFile = resolveDoctorManifestFile(context.cwd, filePath)

    if (resolvedFile.blocker) {
      blockers.push(resolvedFile.blocker)
      continue
    }

    const absolutePath = resolvedFile.path

    if (!existsSync(absolutePath)) {
      blockers.push(`Missing manifest file: ${filePath}`)
      continue
    }

    const stats = lstatSync(absolutePath)

    if (!stats.isFile()) {
      blockers.push(`Manifest file entry is not a regular file: ${filePath}`)
      continue
    }

    checks.push(`${filePath} exists`)
    const expectedHash = manifest.fileHashes?.[filePath]

    if (expectedHash) {
      const currentHash = createFileHash(readFileSync(absolutePath))

      if (currentHash === expectedHash) {
        checks.push(`${filePath} hash matches manifest`)
      } else {
        warnings.push(`Manifest-owned file has local edits: ${filePath}`)
      }
    } else if (filePath !== MANIFEST_PATH && manifest.fileHashes) {
      warnings.push(`Manifest file hash is missing for: ${filePath}`)
    }
  }

  for (const scriptName of manifest.scripts) {
    if (!hasOwnString(packageJson.scripts, scriptName)) {
      blockers.push(`Missing package.json script: ${scriptName}`)
      continue
    }

    checks.push(`scripts.${scriptName} exists`)
    const currentCommand = packageJson.scripts?.[scriptName]
    const hasExpectedCommand = hasOwnString(manifest.scriptCommands, scriptName)
    const expectedCommand = manifest.scriptCommands?.[scriptName]

    if (hasExpectedCommand && currentCommand === expectedCommand) {
      checks.push(`scripts.${scriptName} matches manifest`)
    } else if (hasExpectedCommand) {
      warnings.push(`Manifest-owned script has local edits: ${scriptName}`)
    } else if (manifest.scriptCommands) {
      warnings.push(`Manifest script command is missing for: ${scriptName}`)
    }
  }

  for (const claim of manifest.packageJsonClaims ?? []) {
    const status = inspectManifestClaim(
      'package.json',
      claim,
      readPackageJsonPath(packageJson, claim.path),
    )

    if (status.check) checks.push(status.check)
    if (status.warning) warnings.push(status.warning)
  }

  for (const packageName of ['electron', 'electron-builder', 'typescript', '@types/node']) {
    if (hasPackageDependency(packageJson, packageName)) {
      checks.push(`${packageName} dependency found`)
    } else {
      warnings.push(`Missing dependency: ${packageName}`)
    }
  }

  if (isValidAppVersion(packageJson.version)) {
    checks.push(`package.json version is valid (${packageJson.version})`)
  } else {
    blockers.push('package.json version must be a valid SemVer value for Electron packaging')
  }

  if (manifest?.adapter === 'remix-node-server') {
    if (hasPackageDependency(packageJson, '@remix-run/serve')) {
      checks.push('@remix-run/serve dependency found')
    } else {
      blockers.push('Remix packaging requires @remix-run/serve')
    }

    if (hasPackageDependency(packageJson, 'esbuild')) {
      checks.push('esbuild dependency found')
    } else {
      blockers.push('Remix packaging requires esbuild')
    }
  }

  if (packageJson.build?.extraMetadata?.main === 'dist-electron/main.js') {
    checks.push('build.extraMetadata.main points to dist-electron/main.js')
  } else {
    blockers.push('build.extraMetadata.main must point to dist-electron/main.js')
  }

  const electronTsconfigPath = join(context.cwd, 'tsconfig.electron.json')
  const electronTsconfigInspection = inspectProjectPath(context.cwd, electronTsconfigPath)

  if (!electronTsconfigInspection.safe) {
    blockers.push(
      formatProjectPathBlocker(context.cwd, 'tsconfig.electron.json', electronTsconfigInspection),
    )
  } else if (existsSync(electronTsconfigPath)) {
    checks.push('tsconfig.electron.json exists')
  } else {
    blockers.push('Missing tsconfig.electron.json')
  }

  const status = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warnings' : 'healthy'
  writeDoctorReport(context, status, true, checks, warnings, blockers)

  return blockers.length > 0 ? 1 : 0
}
