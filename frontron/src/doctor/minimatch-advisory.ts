import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { FrontronManifest } from '../init/manifest'
import {
  BUILDER_MINIMATCH_PARENTS,
  BUN_MINIMATCH_ADVISORY_WARNING,
  isMinimatchOverrideKey,
  MINIMATCH_FIRST_PATCHED_VERSION,
} from '../init/npm-builder-override'
import { inferPackageManager, type PackageJson } from '../init/shared'
import type { DoctorFindings } from './report'

type MinimatchRequest = { parent: string; range: string; affected: boolean }

// findInstalledPackageJson 함수는 cwd부터 상위 node_modules를 따라 설치된 패키지 메타데이터를 찾는다.
// 패키지 exports가 package.json을 숨길 수 있으므로 require.resolve 대신 경로를 직접 확인한다.
function findInstalledPackageJson(cwd: string, packageName: string) {
  let directory = resolve(cwd)

  while (true) {
    const candidate = join(directory, 'node_modules', packageName, 'package.json')
    if (existsSync(candidate)) return candidate

    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

// isRangeAffected 함수는 범위가 허용하는 최소 버전이 첫 패치 버전보다 낮은지 판정한다.
// `^10.2.5`, `~9.0.3`, `>=9`, `11.0.0`처럼 첫 버전 표기가 하한인 일반적인 범위를 대상으로 한다.
export function isRangeAffected(range: string) {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(range)
  if (!match) return false

  const version = [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
  for (const [index, patched] of MINIMATCH_FIRST_PATCHED_VERSION.entries()) {
    if (version[index] !== patched) return version[index] < patched
  }
  return false
}

function readMinimatchRequests(cwd: string) {
  const requests: MinimatchRequest[] = []

  for (const parent of BUILDER_MINIMATCH_PARENTS) {
    const packageJsonPath = findInstalledPackageJson(cwd, parent)
    if (!packageJsonPath) continue

    const metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
    const range = metadata.dependencies?.minimatch
    if (typeof range === 'string')
      requests.push({ parent, range, affected: isRangeAffected(range) })
  }

  return requests
}

function hasManagedMinimatchOverride(manifest: FrontronManifest) {
  return [...manifest.packageJsonClaims, ...manifest.pnpmWorkspaceClaims].some((claim) =>
    claim.path.split('.').some(isMinimatchOverrideKey),
  )
}

// inspectMinimatchAdvisory 함수는 electron-builder의 minimatch 권고 대응 상태를 읽기 전용으로 보고한다.
export function inspectMinimatchAdvisory(
  cwd: string,
  packageJson: PackageJson,
  manifest: FrontronManifest,
  findings: DoctorFindings,
) {
  if (inferPackageManager(cwd, packageJson) === 'bun') {
    findings.warnings.push(BUN_MINIMATCH_ADVISORY_WARNING)
    return
  }
  if (!hasManagedMinimatchOverride(manifest)) return

  const requests = readMinimatchRequests(cwd)
  if (requests.length === 0) return

  const affected = requests.filter((request) => request.affected)
  if (affected.length > 0) {
    const detail = affected.map((request) => `${request.parent} ${request.range}`).join(', ')
    findings.checks.push(`electron-builder minimatch override still applies (${detail})`)
    return
  }

  findings.checks.push(
    'electron-builder no longer requests a minimatch version affected by GHSA-g3hv-75wg-m249; ' +
      'the Frontron-managed override is redundant but harmless, and clean removes it',
  )
}
