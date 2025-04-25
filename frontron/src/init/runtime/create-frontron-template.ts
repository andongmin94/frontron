import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { InitPreset, InitTemplateInfo, InitTemplateResolvedFrom } from '../shared'
import { usesStarterBridge } from '../shared'

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

type CreateFrontronTemplateCandidate = {
  templateDir: string
  resolvedFrom: InitTemplateResolvedFrom
  packageJsonPath?: string
}

// inferRelativeTemplateResolvedFrom 함수는 템플릿 경로가 env, repo, dependency 중 어디서 왔는지 추론한다.
function inferRelativeTemplateResolvedFrom(templateDir: string): InitTemplateResolvedFrom {
  return path.basename(path.dirname(path.dirname(templateDir))) === 'node_modules'
    ? 'dependency'
    : 'repo'
}

// resolveCreateFrontronDependencyTemplateDir 함수는 설치된 create-frontron 패키지의 템플릿 경로를 찾는다.
function resolveCreateFrontronDependencyTemplateDir() {
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

// createFrontronTemplateDirCandidates 함수는 create-frontron 템플릿을 찾을 후보 경로들을 만든다.
function createFrontronTemplateDirCandidates() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const dependencyTemplateDir = resolveCreateFrontronDependencyTemplateDir()
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
    dependencyTemplateDir
      ? {
          ...dependencyTemplateDir,
          resolvedFrom: 'dependency',
        }
      : null,
  ]

  return candidates.filter((candidate): candidate is CreateFrontronTemplateCandidate =>
    Boolean(candidate),
  )
}

// findMissingTemplateFiles 함수는 create-frontron 템플릿에서 필요한 파일 중 빠진 항목을 찾는다.
function findMissingTemplateFiles(templateDir: string) {
  return REQUIRED_CREATE_FRONTRON_TEMPLATE_FILES.filter(
    (relativePath) => !existsSync(path.join(templateDir, relativePath)),
  )
}

// resolveCreateFrontronTemplate 함수는 env, repo, dependency 후보 중 사용할 create-frontron 템플릿을 결정한다.
function resolveCreateFrontronTemplate() {
  const candidates = createFrontronTemplateDirCandidates()
  const envCandidate = candidates.find((candidate) => candidate.resolvedFrom === 'env')

  // An explicit env override is treated as authoritative so CI and local release
  // checks fail loudly when they point at an incomplete template.
  if (envCandidate) {
    const missing = findMissingTemplateFiles(envCandidate.templateDir)

    if (missing.length > 0) {
      throw new Error(
        `FRONTRON_CREATE_TEMPLATE_DIR does not contain a complete create-frontron template. Missing: ${missing.join(', ')}`,
      )
    }

    return envCandidate
  }

  for (const candidate of candidates) {
    if (findMissingTemplateFiles(candidate.templateDir).length === 0) {
      return candidate
    }
  }

  const searched = candidates
    .map((candidate) => {
      const missing = findMissingTemplateFiles(candidate.templateDir)
      const missingSummary = missing.length > 0 ? ` missing ${missing.join(', ')}` : ''

      return `${candidate.templateDir}${missingSummary}`
    })
    .join('; ')

  throw new Error(
    `Unable to find a complete create-frontron template. Reinstall frontron or set FRONTRON_CREATE_TEMPLATE_DIR. Searched: ${searched}`,
  )
}

// readCreateFrontronPackageVersion 함수는 create-frontron package.json에서 템플릿 버전을 읽는다.
function readCreateFrontronPackageVersion(packageJsonPath: string | undefined) {
  if (!packageJsonPath || !existsSync(packageJsonPath)) {
    return null
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: unknown
      version?: unknown
    }

    if (packageJson.name !== 'create-frontron' || typeof packageJson.version !== 'string') {
      return null
    }

    return packageJson.version
  } catch {
    return null
  }
}

// getInitTemplateInfo 함수는 선택한 preset이 어떤 템플릿 출처를 쓰는지 알려준다.
export function getInitTemplateInfo(preset: InitPreset): InitTemplateInfo {
  if (!usesStarterBridge(preset)) {
    return {
      source: 'frontron:minimal',
    }
  }

  const template = resolveCreateFrontronTemplate()

  return {
    source: 'create-frontron',
    packageName: 'create-frontron',
    packageVersion: readCreateFrontronPackageVersion(template.packageJsonPath),
    resolvedFrom: template.resolvedFrom,
  }
}

// readCreateFrontronTemplateFile 함수는 선택된 create-frontron 템플릿 파일을 읽는다.
export function readCreateFrontronTemplateFile(relativePath: string) {
  return readFileSync(path.join(resolveCreateFrontronTemplate().templateDir, relativePath), 'utf8')
}

// adaptCreateFrontronElectronSource 함수는 adaptCreateFrontronElectronSource 처리 단계를 수행한다.
function adaptCreateFrontronElectronSource(source: string) {
  return source.split('../../public/').join('../public/')
}

// renderCreateFrontronElectronFile 함수는 create-frontron 템플릿의 Electron 파일을 frontron용으로 렌더링한다.
export function renderCreateFrontronElectronFile(relativePath: string) {
  return adaptCreateFrontronElectronSource(
    readCreateFrontronTemplateFile(`src/electron/${relativePath}`),
  )
}
