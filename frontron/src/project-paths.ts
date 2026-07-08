import { isAbsolute, relative, resolve } from 'node:path'

// isInsideDirectory 함수는 대상 경로가 기준 디렉터리 안에 있는지 확인한다.
export function isInsideDirectory(root: string, target: string) {
  const pathFromRoot = relative(root, target)

  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
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

  return normalized
}
