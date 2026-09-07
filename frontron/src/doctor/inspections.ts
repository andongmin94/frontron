import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  inspectToolDependencyDeclarations,
  isDependencyProtocol,
} from '../init/dependency-compatibility'
import { hasPackageDependency } from '../init/detect'
import { MANIFEST_PATH, type FrontronManifest } from '../init/manifest'
import { inspectManifestClaim } from '../init/manifest-claim-status'
import { isValidAppVersion } from '../init/package-json'
import { readPackageJsonPath } from '../init/package-json-path'
import {
  findPnpmWorkspaceYamlPath,
  readPnpmWorkspaceYamlClaimValue,
} from '../init/pnpm-workspace-yaml'
import { loadCreateFrontronTemplate } from '../init/runtime/create-frontron-template'
import type { InitTemplateDependencies, PackageJson } from '../init/shared'
import { readTsconfigJson } from '../init/tsconfig-json'
import {
  readYarnRcYamlClaimValue,
  resolveYarnRcClaimPath,
  YARN_RC_YAML_PATH,
} from '../init/yarnrc-yaml'
import { inspectManagedFile, inspectManagedScript } from '../managed-state'
import { formatProjectPathBlocker, inspectProjectPath } from '../project-paths'
import type { DoctorFindings } from './report'

// doctor는 읽기 전용이므로 소유권 상태를 update/clean과 같은 판정기로 해석만 한다.
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

  // 향후 claim API가 unsafe를 반환해도 안전 문제를 단순 경고로 낮추지 않는다.
  if (inspection.state === 'unsafe') {
    findings.blockers.push(warning ?? `${prefix}Manifest-owned field is unsafe.`)
    return
  }

  findings.warnings.push(warning ?? `${prefix}Manifest-owned field could not be verified.`)
}

function inspectManifestFiles(cwd: string, manifest: FrontronManifest, findings: DoctorFindings) {
  for (const filePath of new Set(manifest.createdFiles)) {
    // manifest는 자신을 해시할 수 없으므로 관리 파일 검사에서 제외한다.
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

  // 템플릿 로드 실패와 필수 의존성 누락은 서로 다른 문제이므로 독립적으로 검사한다.
  inspectToolDependencies(packageJson, templateDependencies, findings)
}

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

    // 상위 workspace 설정일 수 있으므로 실제 해석된 파일의 링크 상태까지 확인한다.
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

// 검사 순서는 기존 doctor 출력 순서를 유지한다. 테스트와 사용자 비교가 불필요하게 흔들리지 않는다.
export function inspectDoctorState(
  cwd: string,
  packageJson: PackageJson,
  manifest: FrontronManifest,
  findings: DoctorFindings,
) {
  inspectManifestMetadata(manifest, findings)
  inspectTsconfigClaims(cwd, manifest, findings)
  inspectPnpmWorkspaceClaims(cwd, manifest, findings)
  inspectYarnRcClaims(cwd, manifest, findings)
  inspectTemplateState(manifest, packageJson, findings)
  inspectManifestFiles(cwd, manifest, findings)
  inspectManifestScripts(packageJson, manifest, findings)
  inspectPackageJsonClaims(packageJson, manifest, findings)
  inspectRuntimeRequirements(cwd, packageJson, manifest, findings)
}
