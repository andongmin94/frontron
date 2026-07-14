import {
  parse,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
  type ParseOptions,
} from 'jsonc-parser'

const JSONC_PARSE_OPTIONS = { allowTrailingComma: true } satisfies ParseOptions

// jsonc-parser는 주석과 trailing comma를 원문 위치와 함께 처리하며, 오류 복구 결과와 오류 목록을 분리해 손상된 JSONC도 확실히 거부할 수 있다.

// createJsoncSyntaxError 함수는 첫 파서 오류를 호출자가 진단할 수 있는 SyntaxError로 바꾼다.
function createJsoncSyntaxError(error?: ParseError) {
  const detail = error
    ? `${printParseErrorCode(error.error)} at offset ${error.offset}`
    : 'ValueExpected at offset 0'

  return new SyntaxError(`Invalid JSONC: ${detail}.`)
}

// parseJsoncTree 함수는 허용된 JSONC 문법만 트리로 읽고 복구형 파싱에서 나온 오류를 빠짐없이 거부한다.
export function parseJsoncTree(source: string): Node {
  const errors: ParseError[] = []
  const tree = parseTree(source, errors, JSONC_PARSE_OPTIONS)

  if (!tree || errors.length > 0) {
    throw createJsoncSyntaxError(errors[0])
  }

  return tree
}

// findUniqueJsoncProperty 함수는 최상위 객체에서 이름이 같은 속성을 찾아 중복 키의 모호성을 차단한다.
export function findUniqueJsoncProperty(root: Node, key: string, label: string) {
  const properties =
    root.type === 'object'
      ? (root.children ?? []).filter((property) => property.children?.[0]?.value === key)
      : []

  if (properties.length > 1) {
    throw new Error(`${label} contains duplicate "${key}" properties.`)
  }

  return properties[0]
}

// parseJsonc 함수는 파서 오류를 확인한 뒤 기존 공개 계약과 같은 일반 JavaScript 값을 반환한다.
export function parseJsonc<T>(source: string) {
  const errors: ParseError[] = []
  const value = parse(source, errors, JSONC_PARSE_OPTIONS)

  if (errors.length > 0) {
    throw createJsoncSyntaxError(errors[0])
  }

  return value as T
}
