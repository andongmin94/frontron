import type { InitTemplateDependencies, PackageJson } from './shared'

export const TOOL_DEPENDENCIES = [
  ['electron', 'electron'],
  ['electron-builder', 'electronBuilder'],
  ['typescript', 'typescript'],
  ['@types/node', 'nodeTypes'],
] as const satisfies ReadonlyArray<readonly [string, keyof InitTemplateDependencies]>

const DEPENDENCY_PROTOCOL_PATTERN = /^(?:workspace|catalog|file|link|portal|patch|npm):/i

// package manager가 해석해야 하는 workspace/catalog/file 계열 선언인지 확인한다.
export function isDependencyProtocol(value: string) {
  return DEPENDENCY_PROTOCOL_PATTERN.test(value)
}

// dependencies와 devDependencies에서 하나의 도구 버전 선언을 읽는다.
export function readDependencyDeclaration(packageJson: PackageJson, packageName: string) {
  const value =
    packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName]

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

// 단일 major로 확정 가능한 일반 SemVer 선언만 숫자로 변환한다.
export function parseDeclaredMajor(value: string) {
  if (isDependencyProtocol(value) || value === 'latest' || value.includes('||')) return null

  const match = value.match(
    /^(?:[~^]|=|>=?|<=?)?\s*v?(\d+)(?:\.(?:\d+|x|X|\*)){0,2}(?:-[0-9A-Za-z.-]+)?$/,
  )

  return match ? Number.parseInt(match[1], 10) : null
}

// 프로젝트 선언과 create-frontron 기준 선언을 같은 자료 구조로 비교한다.
export function inspectToolDependencyDeclarations(
  packageJson: PackageJson,
  templateDependencies: InitTemplateDependencies | null,
) {
  return TOOL_DEPENDENCIES.map(([packageName, templateKey]) => {
    const declaration = readDependencyDeclaration(packageJson, packageName)
    const templateDeclaration = templateDependencies?.[templateKey] ?? null

    return {
      packageName,
      declaration,
      templateDeclaration,
      declaredMajor: declaration ? parseDeclaredMajor(declaration) : null,
      templateMajor: templateDeclaration ? parseDeclaredMajor(templateDeclaration) : null,
      protocol: declaration ? isDependencyProtocol(declaration) : false,
    }
  })
}
