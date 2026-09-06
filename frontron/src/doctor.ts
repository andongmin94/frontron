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
import { TRANSACTION_JOURNAL_PATH } from './transaction-journal'

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
      'Run init, clean, or update with --yes (without --dry-run) to recover the pending transaction, then inspect the project and rerun doctor.',
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

// collectPendingTransactionState 함수는 복구가 필요한 현재 저널만 읽기 전용으로 확인한다.
function collectPendingTransactionState(cwd: string) {
  return readdirSync(cwd).filter((entry) => entry === TRANSACTION_JOURNAL_PATH)
}

function describePendingTransactionState(entry: string) {
  return `Pending transaction journal detected: ${entry}`
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

// manifest의 선택적 메타데이터가 빠졌을 때 갱신 필요성을 한곳에서 안내한다.
function inspectManifestMetadata(manifest: FrontronManifest, findings: DoctorFindings) {
  const fields = [
    [manifest.fileHashes, 'file hashes'],
    [manifest.scriptCommands, 'script commands'],
    [manifest.packageJsonClaims, 'package.json ownership'],
  ] as const

  for (const [value, label] of fields) {
    if (!value) {
      findings.warnings.push(
        `${MANIFEST_PATH} does not include ${label}. Run "frontron update --yes" to refresh it.`,
      )
    }
  }
}

// tsconfig claim은 JSONC 파싱 실패와 경로 안전 문제를 별도로 보고한다.
function inspectTsconfigClaims(cwd: string, manifest: FrontronManifest, findings: DoctorFindings) {
  if (manifest.tsconfigJsonClaims.length === 0) return

  const tsconfigPath = join(cwd, 'tsconfig.json')
  const inspection = inspectProjectPath(cwd, tsconfigPath)
  if (!inspection.safe) {
    findings.blockers.push(formatProjectPathBlocker(cwd, 'tsconfig.json', inspection))
    return
  }
  if (!existsSync(tsconfigPath)) {
    findings.warnings.push(
      'Manifest-owned tsconfig.json changes cannot be checked because tsconfig.json is missing.',
    )
    return
  }

  try {
    const tsconfigJson = readTsconfigJson(tsconfigPath)
    for (const claim of manifest.tsconfigJsonClaims) {
      addClaimInspection(
        findings,
        inspectManifestClaim('tsconfig.json', claim, readPackageJsonPath(tsconfigJson, claim.path)),
      )
    }
  } catch {
    findings.warnings.push('tsconfig.json could not be parsed as JSON or JSONC.')
  }
}

// pnpm workspace claim은 파일 자체의 안전성과 YAML 편집 가능성을 모두 검사한다.
function inspectPnpmWorkspaceClaims(
  cwd: string,
  manifest: FrontronManifest,
  findings: DoctorFindings,
) {
  if (manifest.pnpmWorkspaceClaims.length === 0) return

  const workspacePath = findPnpmWorkspaceYamlPath(cwd)
  const workspaceRoot = dirname(workspacePath)
  const inspection = inspectProjectPath(workspaceRoot, workspacePath)
  if (!inspection.safe) {
    findings.blockers.push(
      formatProjectPathBlocker(workspaceRoot, 'pnpm-workspace.yaml', inspection),
    )
    return
  }
  if (!existsSync(workspacePath)) {
    findings.warnings.push(
      'Manifest-owned pnpm-workspace.yaml changes cannot be checked because pnpm-workspace.yaml is missing.',
    )
    return
  }

  const source = readFileSync(workspacePath, 'utf8')
  for (const claim of manifest.pnpmWorkspaceClaims) {
    const current = readPnpmWorkspaceYamlClaimValue(source, claim.path)
    if (!current.safeToEdit) {
      findings.blockers.push(current.blocker ?? 'Cannot safely inspect pnpm-workspace.yaml.')
      return
    }
    addClaimInspection(findings, inspectManifestClaim('pnpm-workspace.yaml', claim, current))
  }
}

// Yarn 설정은 프로젝트 밖 상위 workspace 파일을 가리킬 수 있어 해석된 safetyRoot를 그대로 따른다.
function inspectYarnRcClaims(cwd: string, manifest: FrontronManifest, findings: DoctorFindings) {
  for (const claim of manifest.yarnRcClaims) {
    const resolution = resolveYarnRcClaimPath(cwd, claim.file)
    if (!resolution.safe) {
      findings.blockers.push(resolution.blocker)
      continue
    }
    if (!existsSync(resolution.path)) {
      findings.warnings.push(
        `Manifest-owned ${YARN_RC_YAML_PATH} changes cannot be checked because ${claim.file} is missing.`,
      )
      continue
    }

    const stats = lstatSync(resolution.path)
    if (!stats.isFile() || stats.nlink !== 1) {
      findings.blockers.push(
        !stats.isFile()
          ? `Manifest-owned ${YARN_RC_YAML_PATH} is not a regular file: ${claim.file}`
          : `Manifest-owned ${YARN_RC_YAML_PATH} must have exactly one hard link: ${claim.file}`,
      )
      continue
    }

    const current = readYarnRcYamlClaimValue(readFileSync(resolution.path, 'utf8'))
    if (!current.safeToEdit) {
      findings.blockers.push(current.blocker ?? `Cannot safely inspect ${claim.file}.`)
      continue
    }

    addClaimInspection(
      findings,
      inspectManifestClaim(YARN_RC_YAML_PATH, claim, current),
      `${claim.file}: `,
    )
  }
}

function inspectPackageJsonClaims(
  packageJson: PackageJson,
  manifest: FrontronManifest,
  findings: DoctorFindings,
) {
  for (const claim of manifest.packageJsonClaims) {
    addClaimInspection(
      findings,
      inspectManifestClaim('package.json', claim, readPackageJsonPath(packageJson, claim.path)),
    )
  }
}

// 런타임별 필수 조건과 Electron 진입점을 별도 검증해 runDoctor의 분기를 줄인다.
function inspectRuntimeRequirements(
  cwd: string,
  packageJson: PackageJson,
  manifest: FrontronManifest,
  findings: DoctorFindings,
) {
  if (isValidAppVersion(packageJson.version)) {
    findings.checks.push(`package.json version is valid (${packageJson.version})`)
  } else {
    findings.blockers.push(
      'package.json version must be a valid SemVer value for Electron packaging',
    )
  }

  if (manifest.adapter === 'remix-node-server') {
    for (const dependency of ['@remix-run/serve', 'esbuild']) {
      if (hasPackageDependency(packageJson, dependency)) {
        findings.checks.push(`${dependency} dependency found`)
      } else {
        findings.blockers.push(`Remix packaging requires ${dependency}`)
      }
    }
  }

  if (packageJson.build?.extraMetadata?.main === 'dist-electron/main.js') {
    findings.checks.push('build.extraMetadata.main points to dist-electron/main.js')
  } else {
    findings.blockers.push('build.extraMetadata.main must point to dist-electron/main.js')
  }

  const electronTsconfigPath = join(cwd, 'tsconfig.electron.json')
  const inspection = inspectProjectPath(cwd, electronTsconfigPath)
  if (!inspection.safe) {
    findings.blockers.push(formatProjectPathBlocker(cwd, 'tsconfig.electron.json', inspection))
  } else if (existsSync(electronTsconfigPath)) {
    findings.checks.push('tsconfig.electron.json exists')
  } else {
    findings.blockers.push('Missing tsconfig.electron.json')
  }
}

function createDoctorStatus(findings: DoctorFindings) {
  if (findings.blockers.length > 0) return 'blocked'
  if (findings.warnings.length > 0) return 'warnings'
  return 'healthy'
}

// runDoctor 함수는 읽기 전용 진입점으로서 각 검사 모듈을 순서대로 조율한다.
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
  const findings: DoctorFindings = { checks: ['package.json found'], warnings: [], blockers: [] }
  const manifestPath = resolve(context.cwd, MANIFEST_PATH)
  const manifestInspection = inspectProjectPath(context.cwd, manifestPath)
  if (!manifestInspection.safe) {
    findings.blockers.push(
      formatProjectPathBlocker(context.cwd, 'Frontron manifest', manifestInspection),
    )
    writeDoctorReport(
      context,
      'blocked',
      true,
      findings.checks,
      findings.warnings,
      findings.blockers,
    )
    return 1
  }

  const manifest = readManifest(context.cwd)
  if (!manifest) {
    findings.warnings.push(`${MANIFEST_PATH} was not found. Run "frontron init" before doctor.`)
    findings.blockers.push('Frontron has not been initialized in this project.')
    writeDoctorReport(
      context,
      'not initialized',
      false,
      findings.checks,
      findings.warnings,
      findings.blockers,
    )
    return 1
  }

  findings.checks.push(`${MANIFEST_PATH} found`)
  inspectManifestMetadata(manifest, findings)
  inspectTsconfigClaims(context.cwd, manifest, findings)
  inspectPnpmWorkspaceClaims(context.cwd, manifest, findings)
  inspectYarnRcClaims(context.cwd, manifest, findings)
  inspectTemplateState(manifest, packageJson, findings)
  inspectManifestFiles(context.cwd, manifest, findings)
  inspectManifestScripts(packageJson, manifest, findings)
  inspectPackageJsonClaims(packageJson, manifest, findings)
  inspectRuntimeRequirements(context.cwd, packageJson, manifest, findings)

  writeDoctorReport(
    context,
    createDoctorStatus(findings),
    true,
    findings.checks,
    findings.warnings,
    findings.blockers,
  )
  return findings.blockers.length > 0 ? 1 : 0
}
