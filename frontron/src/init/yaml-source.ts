import {
  isAlias,
  isScalar,
  LineCounter,
  parseDocument,
  type Node,
  type Pair,
  type Scalar,
  type YAMLMap,
} from 'yaml'

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

export type ParsedYamlDocument = ReturnType<typeof parseDocument>
export type ParsedYamlMap = YAMLMap<Node, Node | null>
export type ParsedYamlPair = Pair<Node, Node | null>

export type YamlPairMatch = {
  pair: ParsedYamlPair
  keyReference: YamlReferenceKind | null
}

export type YamlReferenceKind = 'alias' | 'anchor' | 'tag'

export type YamlTextEdit = {
  start: number
  end: number
  text: string
}

export type YamlLineRange = {
  start: number
  contentEnd: number
  end: number
}

// parseYamlSource 함수는 yaml이 만든 Document와 CST/range를 이후 국소 편집의 기준으로 제공한다.
export function parseYamlSource(source: string): ParseResult<ParsedYamlDocument> {
  const lineCounter = new LineCounter()
  const document = parseDocument(source, {
    keepSourceTokens: true,
    lineCounter,
    prettyErrors: false,
    uniqueKeys: false,
  })
  const error = document.errors[0]

  if (error) {
    const { line } = lineCounter.linePos(error.pos[0])
    return {
      ok: false,
      reason: `${error.message.replace(/\.$/, '')} (line ${line})`,
    }
  }

  return { ok: true, value: document }
}

// findPreferredEol 함수는 새 줄에 사용할 원문의 첫 줄바꿈 표기를 선택한다.
export function findPreferredEol(source: string) {
  return source.match(/\r\n|\n|\r/)?.[0] ?? '\n'
}

// hasFinalEol 함수는 편집 전후에 EOF 줄바꿈 유무를 보존할 때 사용한다.
export function hasFinalEol(source: string) {
  return /(?:\r\n|\n|\r)$/.test(source)
}

// getYamlReferenceKind 함수는 대상 노드의 alias, anchor, explicit tag를 구분한다.
export function getYamlReferenceKind(node: Node | null | undefined): YamlReferenceKind | null {
  if (!node) return null
  if (isAlias(node)) return 'alias'
  if (node.anchor) return 'anchor'
  if (node.tag) return 'tag'
  return null
}

// findYamlPairsByKey 함수는 scalar 또는 alias key의 실제 값을 따라 대상 pair만 찾는다.
export function findYamlPairsByKey(document: ParsedYamlDocument, map: ParsedYamlMap, key: string) {
  const matches: YamlPairMatch[] = []

  for (const pair of map.items as ParsedYamlPair[]) {
    const keyNode = pair.key
    let resolvedKey: Node | undefined = keyNode

    if (isAlias(keyNode)) {
      resolvedKey = keyNode.resolve(document)
    }

    if (!isScalar(resolvedKey) || resolvedKey.value !== key) {
      continue
    }

    matches.push({
      pair,
      keyReference: getYamlReferenceKind(keyNode),
    })
  }

  return matches
}

// isEmptyYamlPairValue 함수는 CST에 value 토큰이 없는 `key:` 표기만 빈 값으로 판별한다.
export function isEmptyYamlPairValue(pair: ParsedYamlPair) {
  return Boolean(pair.srcToken && typeof pair.srcToken.value === 'undefined')
}

// parseSimpleYamlScalar 함수는 claim에 저장 가능한 한 줄 scalar 토큰 하나만 읽는다.
export function parseSimpleYamlScalar(source: string): ParseResult<Scalar> {
  const parsed = parseYamlSource(source)

  if (!parsed.ok) return parsed

  const node = parsed.value.contents
  const tokenType = isScalar(node) ? node.srcToken?.type : undefined

  if (
    !isScalar(node) ||
    !node.range ||
    !['scalar', 'single-quoted-scalar', 'double-quoted-scalar'].includes(tokenType ?? '') ||
    node.range[0] !== 0 ||
    node.range[1] !== source.length ||
    node.range[2] !== source.length ||
    getYamlReferenceKind(node)
  ) {
    return { ok: false, reason: 'value must be one unreferenced, single-line YAML scalar' }
  }

  return { ok: true, value: node }
}

// getYamlNodeSource 함수는 노드 range의 값 토큰만 잘라 따옴표와 원래 철자를 보존한다.
export function getYamlNodeSource(source: string, node: Node) {
  return node.range ? source.slice(node.range[0], node.range[1]) : null
}

// getYamlLineRange 함수는 한 YAML offset이 속한 줄과 원래 줄바꿈 범위를 계산한다.
export function getYamlLineRange(source: string, offset: number): YamlLineRange {
  let start = Math.min(Math.max(offset, 0), source.length)

  while (start > 0 && source[start - 1] !== '\n' && source[start - 1] !== '\r') {
    start -= 1
  }

  let contentEnd = Math.min(Math.max(offset, 0), source.length)

  while (contentEnd < source.length && source[contentEnd] !== '\n' && source[contentEnd] !== '\r') {
    contentEnd += 1
  }

  let end = contentEnd

  if (source[end] === '\r' && source[end + 1] === '\n') {
    end += 2
  } else if (source[end] === '\r' || source[end] === '\n') {
    end += 1
  }

  return { start, contentEnd, end }
}

// getYamlLineNumber 함수는 range offset을 사용자에게 표시할 1-based 줄 번호로 바꾼다.
export function getYamlLineNumber(source: string, offset: number) {
  return source.slice(0, Math.max(offset, 0)).split(/\r\n|\n|\r/).length
}

// getPreviousYamlLineRange 함수는 삽입 지점 바로 앞의 완전한 줄 범위를 찾는다.
export function getPreviousYamlLineRange(source: string, offset: number) {
  if (offset <= 0) return null

  let contentEnd = Math.min(offset, source.length)

  if (source[contentEnd - 1] === '\n') {
    contentEnd -= source[contentEnd - 2] === '\r' ? 2 : 1
  } else if (source[contentEnd - 1] === '\r') {
    contentEnd -= 1
  }

  let start = contentEnd

  while (start > 0 && source[start - 1] !== '\n' && source[start - 1] !== '\r') {
    start -= 1
  }

  return { start, contentEnd, end: offset } satisfies YamlLineRange
}

// getYamlPairLineEnd 함수는 block pair의 중첩 값까지 포함한 마지막 줄 다음 offset을 찾는다.
export function getYamlPairLineEnd(source: string, pair: ParsedYamlPair) {
  const keyEnd = pair.key.range?.[2] ?? pair.key.range?.[1] ?? 0
  const valueEnd = pair.value?.range?.[2] ?? pair.value?.range?.[1] ?? 0
  const nodeEnd = Math.max(keyEnd, valueEnd)

  if (nodeEnd > 0 && (source[nodeEnd - 1] === '\n' || source[nodeEnd - 1] === '\r')) {
    return nodeEnd
  }

  return getYamlLineRange(source, Math.max(nodeEnd - 1, pair.key.range?.[0] ?? 0)).end
}

// getYamlDocumentAppendOffset 함수는 명시적 `...` 앞, 그 외에는 원문 끝을 안전한 추가 지점으로 고른다.
export function getYamlDocumentAppendOffset(document: ParsedYamlDocument, source: string) {
  return document.directives?.docEnd && document.range ? document.range[1] : source.length
}

// getLastYamlLineText 함수는 마지막 실제 줄의 text만 반환해 구분용 빈 줄 추가 여부를 정한다.
export function getLastYamlLineText(source: string) {
  if (!source) return ''

  const withoutLastEol = source.replace(/(?:\r\n|\n|\r)$/, '')
  const start = Math.max(withoutLastEol.lastIndexOf('\n'), withoutLastEol.lastIndexOf('\r')) + 1
  return withoutLastEol.slice(start)
}

// removeFinalEol 함수는 복원 해시가 요구할 때 마지막 줄바꿈 하나만 제거한다.
export function removeFinalEol(source: string) {
  return source.replace(/(?:\r\n|\n|\r)$/, '')
}

// applyYamlTextEdits 함수는 겹치지 않는 range를 뒤에서부터 바꿔 나머지 원문 byte를 그대로 둔다.
export function applyYamlTextEdits(source: string, edits: YamlTextEdit[]) {
  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end)

  for (let index = 0; index < ordered.length; index += 1) {
    const edit = ordered[index]
    const previous = ordered[index - 1]

    if (
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length ||
      (previous && edit.start < previous.end)
    ) {
      throw new Error('Invalid or overlapping YAML text edit range.')
    }
  }

  let nextSource = source

  for (const edit of ordered.reverse()) {
    nextSource = `${nextSource.slice(0, edit.start)}${edit.text}${nextSource.slice(edit.end)}`
  }

  return nextSource
}
