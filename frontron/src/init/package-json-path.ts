import type { PackageJson } from './shared'

// cloneJsonValue 함수는 JSON 값의 깊은 복사본을 만든다.
export function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// valuesEqual 함수는 두 값을 JSON 직렬화 기준으로 비교한다.
export function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

// readPackageJsonPath 함수는 점 표기법 경로로 package.json 값을 읽는다.
export function readPackageJsonPath(packageJson: PackageJson, path: string) {
  const parts = path.split('.')
  let target: unknown = packageJson

  for (const [index, part] of parts.entries()) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return { exists: false, value: undefined }
    }

    if (!Object.prototype.hasOwnProperty.call(target, part)) {
      return { exists: false, value: undefined }
    }

    target = (target as Record<string, unknown>)[part]

    if (index === parts.length - 1) {
      return { exists: true, value: target }
    }
  }

  return { exists: false, value: undefined }
}

// ensureObjectPath 함수는 점 표기법 경로를 쓰기 위해 중간 객체들을 준비한다.
function ensureObjectPath(root: Record<string, unknown>, parts: string[]) {
  let target = root

  for (const part of parts) {
    const current = target[part]

    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      target[part] = {}
    }

    target = target[part] as Record<string, unknown>
  }

  return target
}

// writePackageJsonPath 함수는 점 표기법 경로에 package.json 값을 쓴다.
export function writePackageJsonPath(packageJson: PackageJson, path: string, value: unknown) {
  const parts = path.split('.')
  const parent = ensureObjectPath(packageJson, parts.slice(0, -1))

  parent[parts[parts.length - 1]] = cloneJsonValue(value)
}

// deletePackageJsonPath 함수는 점 표기법 경로에 해당하는 package.json 값을 삭제한다.
export function deletePackageJsonPath(packageJson: PackageJson, path: string) {
  const parts = path.split('.')
  const stack: Array<{ target: Record<string, unknown>; key: string }> = []
  let target: unknown = packageJson

  for (const part of parts.slice(0, -1)) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return
    }

    stack.push({ target: target as Record<string, unknown>, key: part })
    target = (target as Record<string, unknown>)[part]
  }

  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return
  }

  delete (target as Record<string, unknown>)[parts[parts.length - 1]]

  for (const { target: parent, key } of stack.reverse()) {
    const value = parent[key]

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      delete parent[key]
    }
  }
}
