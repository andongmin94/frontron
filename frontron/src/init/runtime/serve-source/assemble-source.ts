export type ServeSourceSections = Readonly<{
  headerAndConfig: string
  childProcessRuntime: string
  rendererRuntime: string
  devAndBuild: string
}>

const SECTION_SEPARATOR = '\n\n'

// assertNonEmptySection 함수는 생성 소스의 필수 구간이 조립 과정에서 빠지는 실수를 즉시 알린다.
function assertNonEmptySection(name: keyof ServeSourceSections, source: string) {
  if (source.trim().length > 0) return

  throw new Error(`Generated serve source section "${name}" must not be empty.`)
}

// assembleServeSource 함수는 의존 관계에 맞는 고정 순서로 런타임 구간을 하나의 serve.ts로 조립한다.
export function assembleServeSource(sections: ServeSourceSections) {
  // 각 구간은 뒤 구간이 앞 구간의 import, 상수, 도우미를 사용하므로 순서를 바꾸면 안 된다.
  const orderedSections = [
    ['headerAndConfig', sections.headerAndConfig],
    ['childProcessRuntime', sections.childProcessRuntime],
    ['rendererRuntime', sections.rendererRuntime],
    ['devAndBuild', sections.devAndBuild],
  ] as const

  for (const [name, source] of orderedSections) {
    assertNonEmptySection(name, source)
  }

  // 기존 생성 결과와 동일하게 구간 사이는 빈 줄 하나, 파일 끝에는 개행 하나만 둔다.
  return `${orderedSections.map(([, source]) => source).join(SECTION_SEPARATOR)}\n`
}
