import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { MANIFEST_PATH, readManifest, type FrontronManifest } from './init/manifest'
import {
  inspectToolDependencyDeclarations,
  isDependencyProtocol,
} from './init/dependency-compatibility'
import { inspectManifestClaim } from './init/manifest-claim-status'
import { readPackageJsonPath } from './init/package-json-path'
import { isValidAppVersion } from './init/package-json'
import { hasPackageDependency } from './init/detect'
import {
  findPnpmWorkspaceYamlPath,
  readPnpmWorkspaceYamlClaimValue,
} from './init/pnpm-workspace-yaml'
import { loadCreateFrontronTemplate } from './init/runtime/create-frontron-template'
import type { InitTemplateDependencies, PackageJson } from './init/shared'
import { readTsconfigJson } from './init/tsconfig-json'
import {
  readYarnRcYamlClaimValue,
  resolveYarnRcClaimPath,
  YARN_RC_YAML_PATH,
} from './init/yarnrc-yaml'
import { inspectManagedFile, inspectManagedScript } from './managed-state'
import {
  assertProjectPathSafe,
  formatProjectPathBlocker,
  inspectProjectPath,
} from './project-paths'
import {
  TRANSACTION_JOURNAL_PATH,
  TRANSACTION_JOURNAL_PREPARING_PREFIX,
  TRANSACTION_LOCK_PATH,
  TRANSACTION_LOCK_PREPARING_PREFIX,
  TRANSACTION_RECOVERY_LOCK_PATH,
  TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX,
} from './transaction-journal'

export interface DoctorOutput {
  info(message: string): void
}

export interface DoctorContext {
  cwd: string
  output: DoctorOutput
}

type DoctorFindings = {
  checks: string[]
  warnings: string[]
  blockers: string[]
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
function createDoctorNextSteps(
  manifestFound: boolean,
  warnings: string[],
  blockers: string[],
  pendingTransactionState: boolean,
) {
  if (pendingTransactionState) {
    return [
      'Run a valid init, clean, or update command to recover the pending transaction, then run doctor again.',
    ]
  }

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
  pendingTransactionState = false,
) {
  const lines = ['Frontron Doctor', '', `Status: ${status}`, '']
  addList(lines, 'Checks:', checks, '(none)')
  lines.push('')
  addList(lines, 'Warnings:', warnings, 'No warnings found.')
  lines.push('')
  addList(lines, 'Blockers:', blockers, 'No blockers found.')
  lines.push('')
  addList(
    lines,
    'Next steps:',
    createDoctorNextSteps(manifestFound, warnings, blockers, pendingTransactionState),
    '(none)',
  )

  context.output.info(lines.join('\n'))
}

const TRANSACTION_STATE_NAMES = new Set([
  TRANSACTION_JOURNAL_PATH,
  TRANSACTION_LOCK_PATH,
  TRANSACTION_RECOVERY_LOCK_PATH,
  '.frontron-transaction.lock.releasing',
  '.frontron-transaction-recovery.lock.releasing',
])

const TRANSACTION_STATE_PREFIXES = [
  TRANSACTION_JOURNAL_PREPARING_PREFIX,
  TRANSACTION_LOCK_PREPARING_PREFIX,
  TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX,
]

// collectPendingTransactionState 함수는 복구가 필요한 저널과 잠금 파일을 읽기만 한다.
function collectPendingTransactionState(cwd: string) {
  return readdirSync(cwd)
    .filter(
      (entry) =>
        TRANSACTION_STATE_NAMES.has(entry) ||
        TRANSACTION_STATE_PREFIXES.some((prefix) => entry.startsWith(prefix)),
    )
    .sort()
}

// describePendingTransactionState 함수는 발견한 트랜잭션 파일의 역할을 설명한다.
function describePendingTransactionState(entry: string) {
  const isJournal =
    entry === TRANSACTION_JOURNAL_PATH || entry.startsWith(TRANSACTION_JOURNAL_PREPARING_PREFIX)

  return `Pending transaction ${isJournal ? 'journal' : 'lock'} detected: ${entry}`
}

// claim 판정 결과를 doctor의 check, warning, blocker 분류로 옮긴다.
function addClaimInspection(
  findings: DoctorFindings,
  inspection: ReturnType<typeof inspectManifestClaim>,
  prefix = '',
) {
  const check = inspection.check ? `${prefix}${inspection.check}` : null
  const warning = inspection.warning ? `${prefix}${inspection.warning}` : null

  if (inspection.state === 'unchanged') {
    if (check) findings.checks.push(check)
    return
  }

  // claim API가 unsafe를 돌려주게 확장되더라도 안전 문제를 단순 경고로 낮추지 않는다.
  if (inspection.state === 'unsafe') {
    findings.blockers.push(warning ?? `${prefix}Manifest-owned field is unsafe.`)
    return
  }

  findings.warnings.push(warning ?? `${prefix}Manifest-owned field could not be verified.`)
}

// manifest 소유 파일을 update/clean과 같은 공통 상태 판정기로 검사한다.
function inspectManifestFiles(cwd: string, manifest: FrontronManifest, findings: DoctorFindings) {
  for (const filePath of new Set(manifest.createdFiles)) {
    // manifest는 자신을 해시할 수 없고, 위에서 안전한 경로와 유효한 구조를 이미 검증했다.
    if (filePath === MANIFEST_PATH) continue

    const inspection = inspectManagedFile(cwd, filePath, manifest.fileHashes?.[filePath])

    if (inspection.state === 'unsafe') {
      findings.blockers.push(inspection.blocker ?? `Manifest file entry is unsafe: ${filePath}`)
      continue
    }

    if (inspection.state === 'missing') {
      findings.blockers.push(`Missing manifest file: ${filePath}`)
      continue
    }

    findings.checks.push(`${filePath} exists`)

    if (inspection.state === 'unchanged') {
      findings.checks.push(`${filePath} hash matches manifest`)
    } else if (inspection.state === 'modified') {
      findings.warnings.push(`Manifest-owned file has local edits: ${filePath}`)
    } else {
      findings.warnings.push(`Manifest-owned file has no recorded hash: ${filePath}`)
    }
  }
}

// manifest 소유 script를 update/clean과 같은 공통 상태 판정기로 검사한다.
function inspectManifestScripts(
  packageJson: PackageJson,
  manifest: FrontronManifest,
  findings: DoctorFindings,
) {
  for (const scriptName of new Set(manifest.scripts)) {
    const state = inspectManagedScript(packageJson.scripts, manifest.scriptCommands, scriptName)

    if (state === 'missing') {
      findings.blockers.push(`Missing package.json script: ${scriptName}`)
      continue
    }

    if (state === 'unsafe') {
      findings.blockers.push(`Manifest-owned script could not be inspected safely: ${scriptName}`)
      continue
    }

    findings.checks.push(`scripts.${scriptName} exists`)

    if (state === 'unchanged') {
      findings.checks.push(`scripts.${scriptName} matches manifest`)
    } else if (state === 'modified') {
      findings.warnings.push(`Manifest-owned script has local edits: ${scriptName}`)
    } else {
      findings.warnings.push(`Manifest-owned script has no recorded command: ${scriptName}`)
    }
  }
}

// 필수 Electron 도구의 존재 여부와 템플릿 기준 major 호환성을 함께 검사한다.
function inspectToolDependencies(
  packageJson: PackageJson,
  templateDependencies: InitTemplateDependencies | null,
  findings: DoctorFindings,
) {
  for (const inspection of inspectToolDependencyDeclarations(packageJson, templateDependencies)) {
    const { packageName, declaration, templateDeclaration, declaredMajor, templateMajor } =
      inspection

    if (!declaration) {
      findings.blockers.push(`Missing required dependency: ${packageName}`)
      continue
    }

    findings.checks.push(`${packageName} dependency found`)
    if (!templateDeclaration) continue

    if (declaredMajor === null || templateMajor === null) {
      const protocolNote = isDependencyProtocol(declaration)
        ? ' The protocol declaration is present and is not treated as an error.'
        : ''
      findings.warnings.push(
        `Could not verify ${packageName} version compatibility for "${declaration}" against create-frontron template baseline "${templateDeclaration}".${protocolNote}`,
      )
      continue
    }

    if (declaredMajor !== templateMajor) {
      findings.warnings.push(
        `${packageName} major ${declaredMajor} does not match create-frontron template baseline ${templateDeclaration} (major ${templateMajor}).`,
      )
      continue
    }

    findings.checks.push(
      `${packageName} major matches create-frontron template baseline (${declaredMajor})`,
    )
  }
}

// 동일 버전 create-frontron 템플릿과 manifest 및 도구 의존성을 한 스냅샷으로 대조한다.
function inspectTemplateState(
  manifest: FrontronManifest,
  packageJson: PackageJson,
  findings: DoctorFindings,
) {
  let templateDependencies: InitTemplateDependencies | null = null

  try {
    const template = loadCreateFrontronTemplate()
    templateDependencies = template.dependencies

    if (
      manifest.templateSource === 'create-frontron' &&
      manifest.templatePackage === 'create-frontron'
    ) {
      if (manifest.templateVersion === template.info.packageVersion) {
        findings.checks.push(
          `create-frontron template version matches frontron (${template.info.packageVersion})`,
        )
      } else {
        findings.warnings.push(
          `${MANIFEST_PATH} uses create-frontron@${manifest.templateVersion ?? 'unknown'}, but this frontron release requires create-frontron@${template.info.packageVersion}. Run "frontron update --yes" to refresh it.`,
        )
      }
    } else {
      findings.warnings.push(
        `${MANIFEST_PATH} does not include create-frontron template metadata. Run "frontron update --yes" to refresh it.`,
      )
    }
  } catch (error) {
    findings.blockers.push(
      `Unable to validate the required create-frontron template: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // 템플릿 로드가 실패해도 필수 의존성 자체가 빠졌는지는 독립적으로 보고한다.
  inspectToolDependencies(packageJson, templateDependencies, findings)
}

// runDoctor 함수는 현재 프로젝트의 Frontron 초기화 상태를 점검한다.
export async function runDoctor(context: DoctorContext) {
  const pendingTransactionState = collectPendingTransactionState(context.cwd)

  if (pendingTransactionState.length > 0) {
    writeDoctorReport(
      context,
      'blocked',
      existsSync(resolve(context.cwd, MANIFEST_PATH)),
      ['transaction state inspected without mutation'],
      ['Doctor did not recover or modify the pending transaction state.'],
      pendingTransactionState.map(describePendingTransactionState),
      true,
    )
    return 1
  }

  const packageJsonPath = join(context.cwd, 'package.json')

  assertProjectPathSafe(context.cwd, packageJsonPath, 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error('package.json was not found in the current directory.')
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
  const warnings: string[] = []
  const blockers: string[] = []
  const checks: string[] = ['package.json found']
  const findings = { checks, warnings, blockers }
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

          addClaimInspection(findings, status)
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
        const current = readPnpmWorkspaceYamlClaimValue(pnpmWorkspaceSource, claim.path)

        // 안전하게 판독할 수 없는 YAML은 누락 경고가 아니라 blocker로 보고한다.
        if (!current.safeToEdit) {
          blockers.push(current.blocker ?? 'Cannot safely inspect pnpm-workspace.yaml.')
          break
        }

        const status = inspectManifestClaim('pnpm-workspace.yaml', claim, current)

        addClaimInspection(findings, status)
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

    addClaimInspection(findings, status, `${claim.file}: `)
  }

  inspectTemplateState(manifest, packageJson, findings)
  inspectManifestFiles(context.cwd, manifest, findings)
  inspectManifestScripts(packageJson, manifest, findings)

  for (const claim of manifest.packageJsonClaims ?? []) {
    const status = inspectManifestClaim(
      'package.json',
      claim,
      readPackageJsonPath(packageJson, claim.path),
    )

    addClaimInspection(findings, status)
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
