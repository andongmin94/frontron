import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { InitTemplateInfo, InitTemplateResolvedFrom } from '../shared'

const REQUIRED_CREATE_FRONTRON_TEMPLATE_FILES = [
  'src/electron/main.ts',
  'src/electron/window.ts',
  'src/electron/preload.ts',
  'src/electron/ipc.ts',
  'src/electron/dev.ts',
  'src/electron/splash.ts',
  'src/electron/tray.ts',
  'src/types/electron.d.ts',
]

type PackageIdentity = {
  name: string
  version: string
}

type CreateFrontronTemplateCandidate = {
  templateDir: string
  resolvedFrom: InitTemplateResolvedFrom
  packageJsonPath: string
}

type ResolvedCreateFrontronTemplate = CreateFrontronTemplateCandidate & {
  packageVersion: string
}

// readPackageIdentity 함수는 package.json에서 검증 가능한 패키지 이름과 버전을 읽는다.
function readPackageIdentity(packageJsonPath: string, expectedName: string) {
  if (!existsSync(packageJsonPath)) {
    return null
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: unknown
      version?: unknown
    }

    if (
      packageJson.name !== expectedName ||
      typeof packageJson.version !== 'string' ||
      packageJson.version.trim().length === 0
    ) {
      return null
    }

    return {
      name: packageJson.name,
      version: packageJson.version,
    } satisfies PackageIdentity
  } catch {
    return null
  }
}

// createFrontronPackageJsonCandidates 함수는 소스 실행과 배포 번들 실행에서 frontron package.json 후보를 만든다.
function createFrontronPackageJsonCandidates() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(moduleDir, '../../../package.json'),
    path.resolve(moduleDir, '../package.json'),
  ]

  try {
    const require = createRequire(import.meta.url)
    candidates.unshift(require.resolve('frontron/package.json'))
  } catch {
    // package exports가 자기 참조를 노출하지 않아도 상대 경로 후보로 계속 확인한다.
  }

  return [...new Set(candidates)]
}

// resolveFrontronPackageIdentity 함수는 현재 실행 중인 frontron 패키지의 정확한 버전을 찾는다.
function resolveFrontronPackageIdentity() {
  const candidates = createFrontronPackageJsonCandidates()

  for (const packageJsonPath of candidates) {
    const identity = readPackageIdentity(packageJsonPath, 'frontron')

    if (identity) {
      return identity
    }
  }

  throw new Error(
    `Unable to read the current frontron package version. Searched: ${candidates.join('; ')}`,
  )
}

// inferRelativeTemplateResolvedFrom 함수는 상대 템플릿 경로가 저장소인지 설치 의존성인지 구분한다.
function inferRelativeTemplateResolvedFrom(templateDir: string): InitTemplateResolvedFrom {
  return path.basename(path.dirname(path.dirname(templateDir))) === 'node_modules'
    ? 'dependency'
    : 'repo'
}

// resolveCreateFrontronDependencyTemplate 함수는 설치된 create-frontron 패키지의 템플릿 위치를 찾는다.
function resolveCreateFrontronDependencyTemplate() {
  try {
    const require = createRequire(import.meta.url)
    const packageJsonPath = require.resolve('create-frontron/package.json')

    return {
      templateDir: path.join(path.dirname(packageJsonPath), 'template'),
      packageJsonPath,
    }
  } catch {
    return null
  }
}

// createFrontronTemplateCandidates 함수는 환경 변수, 저장소, 설치 의존성 순서의 템플릿 후보를 만든다.
function createFrontronTemplateCandidates() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const dependencyTemplate = resolveCreateFrontronDependencyTemplate()
  const envTemplateDir = process.env.FRONTRON_CREATE_TEMPLATE_DIR?.trim()
  const monorepoTemplateDir = path.resolve(moduleDir, '../../../../create-frontron/template')
  const bundledTemplateDir = path.resolve(moduleDir, '../../create-frontron/template')
  const candidates: Array<CreateFrontronTemplateCandidate | null> = [
    envTemplateDir
      ? {
          templateDir: envTemplateDir,
          resolvedFrom: 'env',
          packageJsonPath: path.resolve(envTemplateDir, '..', 'package.json'),
        }
      : null,
    {
      templateDir: monorepoTemplateDir,
      resolvedFrom: inferRelativeTemplateResolvedFrom(monorepoTemplateDir),
      packageJsonPath: path.resolve(moduleDir, '../../../../create-frontron/package.json'),
    },
    {
      templateDir: bundledTemplateDir,
      resolvedFrom: inferRelativeTemplateResolvedFrom(bundledTemplateDir),
      packageJsonPath: path.resolve(moduleDir, '../../create-frontron/package.json'),
    },
    dependencyTemplate
      ? {
          ...dependencyTemplate,
          resolvedFrom: 'dependency',
        }
      : null,
  ]

  return candidates.filter((candidate): candidate is CreateFrontronTemplateCandidate =>
    Boolean(candidate),
  )
}

// findMissingTemplateFiles 함수는 create-frontron 템플릿에 필요한 파일 중 빠진 목록을 찾는다.
function findMissingTemplateFiles(templateDir: string) {
  return REQUIRED_CREATE_FRONTRON_TEMPLATE_FILES.filter(
    (relativePath) => !existsSync(path.join(templateDir, relativePath)),
  )
}

// listRelativeTypeScriptFiles 함수는 템플릿 하위의 TypeScript 소스를 재귀적으로 열거한다.
function listRelativeTypeScriptFiles(rootDir: string, currentDir = rootDir): string[] {
  const files: string[] = []

  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const absolutePath = path.join(currentDir, entry.name)

    if (entry.isDirectory()) {
      files.push(...listRelativeTypeScriptFiles(rootDir, absolutePath))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path.relative(rootDir, absolutePath).split(path.sep).join('/'))
    }
  }

  return files.sort()
}

// inspectTemplateCandidate 함수는 템플릿 완전성과 frontron과의 정확한 버전 일치를 함께 검사한다.
function inspectTemplateCandidate(
  candidate: CreateFrontronTemplateCandidate,
  frontronVersion: string,
) {
  const problems: string[] = []
  const missing = findMissingTemplateFiles(candidate.templateDir)
  const identity = readPackageIdentity(candidate.packageJsonPath, 'create-frontron')

  if (missing.length > 0) {
    problems.push(`missing ${missing.join(', ')}`)
  }

  if (!identity) {
    problems.push(
      `missing or invalid create-frontron package metadata at ${candidate.packageJsonPath}`,
    )
  } else if (identity.version !== frontronVersion) {
    problems.push(`create-frontron@${identity.version} does not match frontron@${frontronVersion}`)
  }

  return {
    problems,
    packageVersion: identity?.version ?? null,
  }
}

// resolveCreateFrontronTemplate 함수는 완전하고 동일 버전인 create-frontron 템플릿만 선택한다.
function resolveCreateFrontronTemplate(): ResolvedCreateFrontronTemplate {
  const frontron = resolveFrontronPackageIdentity()
  const candidates = createFrontronTemplateCandidates()
  const envCandidate = candidates.find((candidate) => candidate.resolvedFrom === 'env')

  // 환경 변수는 명시적 계약이므로 잘못 지정되면 다른 후보로 조용히 우회하지 않는다.
  if (envCandidate) {
    const inspection = inspectTemplateCandidate(envCandidate, frontron.version)

    if (inspection.problems.length > 0 || !inspection.packageVersion) {
      throw new Error(
        `FRONTRON_CREATE_TEMPLATE_DIR must point to a complete create-frontron@${frontron.version} template. ${inspection.problems.join('; ')}`,
      )
    }

    return {
      ...envCandidate,
      packageVersion: inspection.packageVersion,
    }
  }

  for (const candidate of candidates) {
    const inspection = inspectTemplateCandidate(candidate, frontron.version)

    if (inspection.problems.length === 0 && inspection.packageVersion) {
      return {
        ...candidate,
        packageVersion: inspection.packageVersion,
      }
    }
  }

  const searched = candidates
    .map((candidate) => {
      const inspection = inspectTemplateCandidate(candidate, frontron.version)
      return `${candidate.templateDir}: ${inspection.problems.join(', ')}`
    })
    .join('; ')

  throw new Error(
    `Unable to find the create-frontron@${frontron.version} template required by frontron@${frontron.version}. Reinstall frontron. Searched: ${searched}`,
  )
}

// getInitTemplateInfo 함수는 init에 사용될 동일 버전 create-frontron 템플릿 정보를 돌려준다.
export function getInitTemplateInfo(): InitTemplateInfo {
  const template = resolveCreateFrontronTemplate()

  return {
    source: 'create-frontron',
    packageName: 'create-frontron',
    packageVersion: template.packageVersion,
    resolvedFrom: template.resolvedFrom,
  }
}

// readCreateFrontronTemplateFile 함수는 검증된 create-frontron 템플릿 파일을 읽는다.
export function readCreateFrontronTemplateFile(relativePath: string) {
  return readFileSync(path.join(resolveCreateFrontronTemplate().templateDir, relativePath), 'utf8')
}

// listCreateFrontronElectronFiles 함수는 어댑터 전용 serve.ts를 제외한 Electron 템플릿 소스를 찾는다.
export function listCreateFrontronElectronFiles() {
  const template = resolveCreateFrontronTemplate()
  const electronDir = path.join(template.templateDir, 'src', 'electron')

  return listRelativeTypeScriptFiles(electronDir).filter(
    (relativePath) => relativePath !== 'serve.ts',
  )
}

// adaptCreateFrontronElectronSource 함수는 starter와 retrofit의 디렉터리 깊이 차이에 맞게 asset 경로를 바꾼다.
function adaptCreateFrontronElectronSource(source: string) {
  return source.split('../../public/').join('../public/')
}

// renderCreateFrontronElectronFile 함수는 create-frontron의 Electron 파일을 retrofit 경로에 맞춰 렌더링한다.
export function renderCreateFrontronElectronFile(relativePath: string) {
  return adaptCreateFrontronElectronSource(
    readCreateFrontronTemplateFile(`src/electron/${relativePath}`),
  )
}
