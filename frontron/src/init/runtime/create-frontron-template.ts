import { lstatSync, readFileSync, readdirSync, type Stats } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  InitTemplateDependencies,
  InitTemplateInfo,
  InitTemplateResolvedFrom,
} from '../shared'

const REQUIRED_CREATE_FRONTRON_TEMPLATE_FILES = [
  'package.json',
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

export type CreateFrontronTemplateSnapshot = {
  info: InitTemplateInfo
  dependencies: InitTemplateDependencies
  electronFiles: ReadonlyMap<string, string>
  electronTypeSource: string
}

// describeTemplateEntryType 함수는 진단 메시지에 사용할 파일 시스템 항목 종류를 구분한다.
function describeTemplateEntryType(stats: Stats) {
  if (stats.isSymbolicLink()) return 'a symbolic link or junction'
  if (stats.isDirectory()) return 'a directory'
  if (stats.isFile()) return 'a regular file'
  if (stats.isBlockDevice()) return 'a block device'
  if (stats.isCharacterDevice()) return 'a character device'
  if (stats.isFIFO()) return 'a FIFO'
  if (stats.isSocket()) return 'a socket'
  return 'an unsupported file system entry'
}

// inspectSafeRegularFile 함수는 링크를 따라가지 않고 단일 링크 일반 파일인지 검사한다.
function inspectSafeRegularFile(filePath: string) {
  let stats: Stats

  try {
    stats = lstatSync(filePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code

    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return 'is missing'
    }

    return `could not be inspected: ${error instanceof Error ? error.message : String(error)}`
  }

  if (!stats.isFile()) {
    return `must be a regular file; found ${describeTemplateEntryType(stats)}`
  }

  if (stats.nlink !== 1) {
    return `must have exactly one hard link; found ${stats.nlink}`
  }

  return null
}

// readPackageIdentity 함수는 package.json에서 검증 가능한 패키지 이름과 버전을 읽는다.
function readPackageIdentity(packageJsonPath: string, expectedName: string) {
  if (inspectSafeRegularFile(packageJsonPath)) {
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

// inspectTemplateFilePath 함수는 템플릿 내부 경로의 부모와 파일을 링크 없이 검사한다.
function inspectTemplateFilePath(templateDir: string, relativePath: string) {
  const pathSegments = relativePath.split('/')
  let currentPath = templateDir

  for (const segment of pathSegments.slice(0, -1)) {
    currentPath = path.join(currentPath, segment)

    let stats: Stats

    try {
      stats = lstatSync(currentPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return `cannot be reached because ${path.relative(templateDir, currentPath)} is missing`
      }

      return `cannot inspect ${path.relative(templateDir, currentPath)}: ${error instanceof Error ? error.message : String(error)}`
    }

    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      return `requires ${path.relative(templateDir, currentPath)} to be a directory; found ${describeTemplateEntryType(stats)}`
    }
  }

  return inspectSafeRegularFile(path.join(templateDir, relativePath))
}

// findInvalidTemplateFiles 함수는 필수 템플릿 경로가 안전한 일반 파일인지 모두 검사한다.
function findInvalidTemplateFiles(templateDir: string) {
  return REQUIRED_CREATE_FRONTRON_TEMPLATE_FILES.flatMap((relativePath) => {
    const problem = inspectTemplateFilePath(templateDir, relativePath)

    return problem ? [`${relativePath} ${problem}`] : []
  })
}

// readTemplateEntryStats 함수는 트리 항목 검사 실패를 템플릿 경로와 함께 명확히 알린다.
function readTemplateEntryStats(entryPath: string) {
  try {
    return lstatSync(entryPath)
  } catch (error) {
    throw new Error(
      `Unable to inspect create-frontron template tree entry at ${entryPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

// readTemplateDirectoryEntries 함수는 디렉터리 열거 실패를 대상 경로와 함께 전달한다.
function readTemplateDirectoryEntries(directoryPath: string) {
  try {
    return readdirSync(directoryPath)
  } catch (error) {
    throw new Error(
      `Unable to read create-frontron template directory at ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

// assertTemplateTreeDirectory 함수는 수집할 디렉터리가 링크가 아닌 실제 디렉터리인지 확인한다.
function assertTemplateTreeDirectory(directoryPath: string) {
  const stats = readTemplateEntryStats(directoryPath)

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `Invalid create-frontron template tree entry at ${directoryPath}: expected a directory, found ${describeTemplateEntryType(stats)}.`,
    )
  }
}

// listRelativeTypeScriptFiles 함수는 안전한 일반 파일과 디렉터리만 따라 TypeScript 소스를 수집한다.
function listRelativeTypeScriptFiles(rootDir: string, currentDir = rootDir): string[] {
  const files: string[] = []

  if (currentDir === rootDir) {
    assertTemplateTreeDirectory(rootDir)
  }

  for (const entryName of readTemplateDirectoryEntries(currentDir)) {
    const absolutePath = path.join(currentDir, entryName)
    const stats = readTemplateEntryStats(absolutePath)

    if (stats.isSymbolicLink()) {
      throw new Error(
        `Invalid create-frontron template tree entry at ${absolutePath}: expected a regular file or directory, found ${describeTemplateEntryType(stats)}.`,
      )
    }

    if (stats.isDirectory()) {
      files.push(...listRelativeTypeScriptFiles(rootDir, absolutePath))
      continue
    }

    if (!stats.isFile()) {
      throw new Error(
        `Invalid create-frontron template tree entry at ${absolutePath}: expected a regular file or directory, found ${describeTemplateEntryType(stats)}.`,
      )
    }

    if (stats.nlink !== 1) {
      throw new Error(
        `Invalid create-frontron template tree entry at ${absolutePath}: regular files must have exactly one hard link; found ${stats.nlink}.`,
      )
    }

    if (entryName.endsWith('.ts')) {
      files.push(path.relative(rootDir, absolutePath).split(path.sep).join('/'))
    }
  }

  return files.sort()
}

// 템플릿 package.json에서 retrofit이 실제로 주입해야 할 도구 버전을 읽는다.
function readTemplateDependencies(templateDir: string): InitTemplateDependencies {
  const templatePackageJsonPath = path.join(templateDir, 'package.json')

  try {
    const packageJson = JSON.parse(readFileSync(templatePackageJsonPath, 'utf8')) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
    }
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }
    // readVersion 함수는 create-frontron 템플릿 package.json에서 필수 도구 버전을 읽는다.
    const readVersion = (packageName: string) => {
      const version = dependencies[packageName]

      if (typeof version !== 'string' || version.trim().length === 0) {
        throw new Error(`missing ${packageName}`)
      }

      return version
    }

    return {
      electron: readVersion('electron'),
      electronBuilder: readVersion('electron-builder'),
      typescript: readVersion('typescript'),
      nodeTypes: readVersion('@types/node'),
    }
  } catch (error) {
    throw new Error(
      `Unable to read Electron tool versions from ${templatePackageJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

// inspectTemplateCandidate 함수는 템플릿 완전성과 frontron과의 정확한 버전 일치를 함께 검사한다.
function inspectTemplateCandidate(
  candidate: CreateFrontronTemplateCandidate,
  frontronVersion: string,
) {
  const problems: string[] = []
  const invalidTemplateFiles = findInvalidTemplateFiles(candidate.templateDir)
  const packageMetadataProblem = inspectSafeRegularFile(candidate.packageJsonPath)
  const identity = packageMetadataProblem
    ? null
    : readPackageIdentity(candidate.packageJsonPath, 'create-frontron')

  if (invalidTemplateFiles.length > 0) {
    problems.push(...invalidTemplateFiles)
  } else {
    try {
      listRelativeTypeScriptFiles(path.join(candidate.templateDir, 'src', 'electron'))
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (packageMetadataProblem) {
    problems.push(
      `create-frontron package metadata at ${candidate.packageJsonPath} ${packageMetadataProblem}`,
    )
  } else if (!identity) {
    problems.push(`invalid create-frontron package metadata at ${candidate.packageJsonPath}`)
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

// 한 번 선택한 create-frontron 템플릿의 소스와 버전을 불변 스냅샷으로 읽는다.
export function loadCreateFrontronTemplate(): CreateFrontronTemplateSnapshot {
  const template = resolveCreateFrontronTemplate()
  const electronDir = path.join(template.templateDir, 'src', 'electron')
  const electronFiles = new Map<string, string>()

  for (const relativePath of listRelativeTypeScriptFiles(electronDir)) {
    if (relativePath === 'serve.ts') continue

    electronFiles.set(
      relativePath,
      adaptCreateFrontronElectronSource(readFileSync(path.join(electronDir, relativePath), 'utf8')),
    )
  }

  return {
    info: {
      source: 'create-frontron',
      packageName: 'create-frontron',
      packageVersion: template.packageVersion,
      resolvedFrom: template.resolvedFrom,
    },
    dependencies: readTemplateDependencies(template.templateDir),
    electronFiles,
    electronTypeSource: readFileSync(
      path.join(template.templateDir, 'src', 'types', 'electron.d.ts'),
      'utf8',
    ),
  }
}

// renderCreateFrontronElectronFile 함수는 create-frontron의 Electron 파일을 retrofit 경로에 맞춰 렌더링한다.
export function renderCreateFrontronElectronFile(relativePath: string) {
  return adaptCreateFrontronElectronSource(
    readCreateFrontronTemplateFile(`src/electron/${relativePath}`),
  )
}
