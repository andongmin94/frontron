import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export type ProjectPathInspection =
  | {
      safe: true
      absolutePath: string
    }
  | {
      safe: false
      absolutePath: string
      reason: 'outside' | 'symbolic-link' | 'resolved-outside'
      component?: string
    }

// isInsideDirectory 함수는 대상 경로가 기준 디렉터리 안에 있는지 확인한다.
export function isInsideDirectory(root: string, target: string) {
  const pathFromRoot = relative(root, target)
  const pointsOutside = pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)

  return pathFromRoot === '' || (!pointsOutside && !isAbsolute(pathFromRoot))
}

// inspectProjectPath 함수는 경로의 문자열 위치와 실제 부모 구성요소를 함께 검사한다.
export function inspectProjectPath(root: string, target: string): ProjectPathInspection {
  const absoluteRoot = resolve(root)
  const absolutePath = resolve(target)

  if (!isInsideDirectory(absoluteRoot, absolutePath)) {
    return {
      safe: false,
      absolutePath,
      reason: 'outside',
    }
  }

  const components: string[] = []
  let currentPath = absolutePath

  while (relative(absoluteRoot, currentPath) !== '') {
    components.unshift(currentPath)

    const parentPath = dirname(currentPath)

    if (parentPath === currentPath) {
      return {
        safe: false,
        absolutePath,
        reason: 'outside',
      }
    }

    currentPath = parentPath
  }

  const realRoot = realpathSync.native(absoluteRoot)

  for (const component of components) {
    try {
      const stats = lstatSync(component)

      // Windows 정션도 lstat에서 symbolic link로 보고되므로 같은 규칙으로 막는다.
      if (stats.isSymbolicLink()) {
        return {
          safe: false,
          absolutePath,
          reason: 'symbolic-link',
          component,
        }
      }

      const realComponent = realpathSync.native(component)

      if (!isInsideDirectory(realRoot, realComponent)) {
        return {
          safe: false,
          absolutePath,
          reason: 'resolved-outside',
          component,
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      if (code === 'ENOENT' || code === 'ENOTDIR') {
        continue
      }

      throw error
    }
  }

  return {
    safe: true,
    absolutePath,
  }
}

// formatProjectPathBlocker 함수는 경로 검사 결과를 사용자에게 보여 줄 차단 사유로 만든다.
export function formatProjectPathBlocker(
  root: string,
  label: string,
  inspection: Exclude<ProjectPathInspection, { safe: true }>,
) {
  if (inspection.reason === 'outside') {
    return `${label} must stay inside the project.`
  }

  const component = inspection.component ?? inspection.absolutePath
  const displayPath = relative(resolve(root), component).replace(/\\/g, '/') || '.'

  if (inspection.reason === 'symbolic-link') {
    return `${label} must not pass through a symbolic link or junction: ${displayPath}`
  }

  return `${label} resolves outside the project: ${displayPath}`
}

// assertProjectPathSafe 함수는 프로젝트 밖으로 이어질 수 있는 파일 경로를 즉시 거부한다.
export function assertProjectPathSafe(root: string, target: string, label: string) {
  const inspection = inspectProjectPath(root, target)

  if (!inspection.safe) {
    throw new Error(formatProjectPathBlocker(root, label, inspection))
  }

  return inspection.absolutePath
}

// normalizeUserPath 함수는 사용자 경로 입력에서 공백, 역슬래시, 앞쪽 ./ 표기를 정리한다.
function normalizeUserPath(value: string, fallback: string) {
  const normalized = value.trim() || fallback

  return normalized.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

// normalizeProjectRelativePath 함수는 사용자 입력 경로가 프로젝트 내부 상대 경로인지 검증하고 정규화한다.
export function normalizeProjectRelativePath(
  cwd: string,
  value: string,
  fallback: string,
  label: string,
) {
  const normalized = normalizeUserPath(value, fallback)

  if (!normalized || normalized.includes('\0')) {
    throw new Error(`${label} must be a non-empty relative path inside the project.`)
  }

  if (isAbsolute(normalized)) {
    throw new Error(`${label} must be a relative path inside the project.`)
  }

  const pathSegments = normalized.split('/').filter(Boolean)

  // 사용자가 입력한 생성/패키징 경로는 프로젝트 밖으로 나가면 안 된다.
  // resolve 결과만 보지 않고 ".." 조각 자체를 막아 의도를 더 명확하게 제한한다.
  if (pathSegments.includes('..')) {
    throw new Error(`${label} must not contain ".." path segments.`)
  }

  const root = resolve(cwd)
  const absolutePath = resolve(root, normalized)

  if (!isInsideDirectory(root, absolutePath)) {
    throw new Error(`${label} must stay inside the project.`)
  }

  if (absolutePath === root) {
    throw new Error(`${label} cannot target the project root.`)
  }

  assertProjectPathSafe(root, absolutePath, label)

  // init이 항상 다루는 제어 파일도 계획 단계에서 검사해 링크 부모를 미리 차단한다.
  for (const [controlPath, controlLabel] of [
    ['package.json', 'package.json'],
    ['tsconfig.json', 'tsconfig.json'],
    ['tsconfig.electron.json', 'tsconfig.electron.json'],
    ['.frontron/manifest.json', 'Frontron manifest'],
    ['src/types/electron.d.ts', 'Electron type declaration'],
  ]) {
    assertProjectPathSafe(root, resolve(root, controlPath), controlLabel)
  }

  return normalized
}
