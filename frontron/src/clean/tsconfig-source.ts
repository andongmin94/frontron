import {
  applyEdits,
  createScanner,
  modify,
  SyntaxKind,
  type Edit,
  type FormattingOptions,
  type JSONPath,
  type ModificationOptions,
  type Node,
} from 'jsonc-parser'

import { findUniqueJsoncProperty, parseJsoncTree } from '../init/jsonc'
import type { PackageJsonOwnershipClaim } from '../init/manifest'

type TsconfigDocument = {
  root: Node
  excludeProperty?: Node
  excludeArray?: Node
}

// jsonc-parser의 트리 offset과 edit API는 원문 전체를 다시 쓰지 않고 exclude 한 곳만 수정하므로 줄바꿈, 들여쓰기, 주석을 보존하기에 적합하다.

// readTsconfigDocument 함수는 유효한 최상위 객체와 하나뿐인 문자열 exclude 배열을 트리로 읽는다.
function readTsconfigDocument(source: string): TsconfigDocument {
  let root: Node

  try {
    root = parseJsoncTree(source)
  } catch (error) {
    throw new Error(
      `tsconfig.json could not be parsed as JSON or JSONC: ${(error as Error).message}`,
      { cause: error },
    )
  }

  if (root.type !== 'object') {
    throw new Error('tsconfig.json must contain a top-level object.')
  }

  const excludeProperty = findUniqueJsoncProperty(root, 'exclude', 'tsconfig.json')
  const excludeArray = excludeProperty?.children?.[1]

  if (
    excludeProperty &&
    (excludeArray?.type !== 'array' ||
      (excludeArray.children ?? []).some((element) => element.type !== 'string'))
  ) {
    throw new Error('tsconfig.json exclude must remain an array of strings.')
  }

  return { root, excludeProperty, excludeArray }
}

// detectFormattingOptions 함수는 다중 행 원문의 줄바꿈과 첫 들여쓰기 단위를 edit API에 전달한다.
function detectFormattingOptions(source: string): FormattingOptions | undefined {
  const content = source.trimEnd()

  if (!/[\r\n]/.test(content)) {
    return undefined
  }

  const indent = content.match(/(?:^|\r?\n)([\t ]+)(?=\S)/)?.[1] ?? '  '
  const insertSpaces = !indent.includes('\t')

  return {
    insertSpaces,
    tabSize: insertSpaces ? Math.max(indent.length, 1) : 1,
    eol: source.includes('\r\n') ? '\r\n' : '\n',
    keepLines: true,
  }
}

// applyJsoncModification 함수는 modify가 계산한 국소 편집을 적용하고 compact 배열의 기존 쉼표 간격을 유지한다.
function applyJsoncModification(
  source: string,
  path: JSONPath,
  value: unknown,
  options: ModificationOptions = {},
  spaceAfterInsertedComma = false,
) {
  const formattingOptions = detectFormattingOptions(source)
  let edits = modify(source, path, value, { ...options, formattingOptions })

  if (!formattingOptions && spaceAfterInsertedComma) {
    edits = edits.map((edit) => ({ ...edit, content: edit.content.replace(/^,/, ', ') }))
  }

  return applyEdits(source, edits)
}

// findTokenOffset 함수는 jsonc-parser 스캐너로 지정 범위의 실제 구두점 위치만 찾는다.
function findTokenOffset(source: string, start: number, end: number, kind: SyntaxKind) {
  const scanner = createScanner(source, true)
  scanner.setPosition(start)

  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (scanner.getTokenOffset() >= end) {
      break
    }

    if (token === kind) {
      return scanner.getTokenOffset()
    }
  }

  return undefined
}

// hasComment 함수는 지정 범위에 사용자가 남긴 줄 또는 블록 주석이 있는지 확인한다.
function hasComment(source: string, start: number, end: number) {
  const scanner = createScanner(source, false)
  scanner.setPosition(start)

  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (scanner.getTokenOffset() >= end) {
      break
    }

    if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) {
      return true
    }
  }

  return false
}

// lineStartAt 함수는 위치가 속한 줄의 시작 offset을 반환한다.
function lineStartAt(source: string, position: number) {
  return (
    Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1
  )
}

// lineEndAt 함수는 현재 줄의 줄바꿈까지 포함한 끝 offset을 반환한다.
function lineEndAt(source: string, position: number) {
  const newline = source.indexOf('\n', position)
  return newline === -1 ? source.length : newline + 1
}

// trailingCommaOffset 함수는 배열 마지막 값 뒤의 허용된 trailing comma 위치를 찾는다.
function trailingCommaOffset(source: string, array: Node) {
  const lastElement = array.children?.at(-1)

  return lastElement
    ? findTokenOffset(
        source,
        lastElement.offset + lastElement.length,
        array.offset + array.length - 1,
        SyntaxKind.CommaToken,
      )
    : undefined
}

// assertPropertyInsertionSafe 함수는 기존 공개 계약대로 닫는 중괄호가 독립 줄이 아닌 다중 행 객체 추가를 거부한다.
function assertPropertyInsertionSafe(source: string, root: Node) {
  const closeOffset = root.offset + root.length - 1

  if (
    /[\r\n]/.test(source.slice(root.offset, closeOffset)) &&
    !/^[\t ]*$/.test(source.slice(lineStartAt(source, closeOffset), closeOffset))
  ) {
    throw new Error(
      'tsconfig.json closing brace must start on its own line to preserve formatting.',
    )
  }
}

// appendExcludeValue 함수는 배열 끝에 한 값만 추가해 기존 배열 바깥의 원문을 그대로 둔다.
function appendExcludeValue(
  source: string,
  document: TsconfigDocument,
  value: string,
  spaceAfterInsertedComma: boolean,
) {
  const index = document.excludeArray?.children?.length ?? 0

  return applyJsoncModification(
    source,
    ['exclude', index],
    value,
    { isArrayInsertion: true },
    spaceAfterInsertedComma,
  )
}

// removeArrayElement 함수는 소유 값의 노드와 구조 쉼표만 지우고 인접한 사용자 주석은 남긴다.
function removeArrayElement(source: string, array: Node, index: number) {
  const elements = array.children ?? []
  const element = elements[index]

  if (!element) {
    return source
  }

  const previous = elements[index - 1]
  const next = elements[index + 1]
  const elementEnd = element.offset + element.length
  const commaAfter = findTokenOffset(
    source,
    elementEnd,
    next?.offset ?? array.offset + array.length - 1,
    SyntaxKind.CommaToken,
  )
  const commaBefore = previous
    ? findTokenOffset(
        source,
        previous.offset + previous.length,
        element.offset,
        SyntaxKind.CommaToken,
      )
    : undefined
  const structuralEnd = typeof commaAfter === 'number' ? commaAfter + 1 : elementEnd
  const lineStart = lineStartAt(source, element.offset)
  const lineEnd = lineEndAt(source, structuralEnd)
  const lineContentEnd = source.slice(lineStart, lineEnd).replace(/\r?\n$/, '').length + lineStart
  const commentAfterElement =
    typeof commaAfter === 'number' && hasComment(source, elementEnd, commaAfter)

  if (
    !commentAfterElement &&
    /^[\t ]*$/.test(source.slice(lineStart, element.offset)) &&
    /^[\t ]*$/.test(source.slice(structuralEnd, lineContentEnd))
  ) {
    return applyEdits(source, [{ offset: lineStart, length: lineEnd - lineStart, content: '' }])
  }

  if (typeof commaAfter === 'number') {
    const edits: Edit[] = commentAfterElement
      ? [
          { offset: element.offset, length: element.length, content: '' },
          { offset: commaAfter, length: 1, content: '' },
        ]
      : [
          {
            offset: element.offset,
            length: commaAfter + 1 - element.offset,
            content: '',
          },
        ]

    return applyEdits(source, edits)
  }

  if (typeof commaBefore === 'number') {
    const commentBeforeElement = hasComment(source, commaBefore + 1, element.offset)
    const edits: Edit[] = commentBeforeElement
      ? [
          { offset: commaBefore, length: 1, content: '' },
          { offset: element.offset, length: element.length, content: '' },
        ]
      : [
          {
            offset: commaBefore,
            length: elementEnd - commaBefore,
            content: '',
          },
        ]

    return applyEdits(source, edits)
  }

  return applyEdits(source, [{ offset: element.offset, length: element.length, content: '' }])
}

// removeTrailingComma 함수는 init 추가 과정에서 필요해진 마지막 쉼표만 제거한다.
function removeTrailingComma(source: string) {
  const { excludeArray } = readTsconfigDocument(source)

  if (!excludeArray) {
    return source
  }

  const comma = trailingCommaOffset(source, excludeArray)
  return typeof comma === 'number'
    ? applyEdits(source, [{ offset: comma, length: 1, content: '' }])
    : source
}

// removeEmptyOwnedProperty 함수는 사용자가 주석이나 값을 남기지 않은 새 exclude 속성만 제거한다.
function removeEmptyOwnedProperty(source: string) {
  const { excludeProperty, excludeArray } = readTsconfigDocument(source)

  if (!excludeProperty || !excludeArray || (excludeArray.children?.length ?? 0) > 0) {
    return source
  }

  const propertyLineStart = lineStartAt(source, excludeProperty.offset)
  const propertyLineEnd = lineEndAt(source, excludeProperty.offset + excludeProperty.length)

  if (
    hasComment(source, excludeArray.offset + 1, excludeArray.offset + excludeArray.length - 1) ||
    hasComment(source, propertyLineStart, propertyLineEnd)
  ) {
    return source
  }

  return applyJsoncModification(source, ['exclude'], undefined)
}

// validateTsconfigSource 함수는 편집 결과도 동일한 엄격한 JSONC 및 exclude 규칙을 만족하는지 확인한다.
function validateTsconfigSource(source: string) {
  readTsconfigDocument(source)
  return source
}

// addTsconfigExcludeValues 함수는 init이 소유할 새 exclude 값만 중복 없이 국소 추가한다.
export function addTsconfigExcludeValues(source: string, values: string[]) {
  const uniqueValues = [...new Set(values)]

  if (uniqueValues.length === 0) {
    return source
  }

  const document = readTsconfigDocument(source)
  const currentValues = new Set(
    document.excludeArray?.children?.map((element) => element.value) ?? [],
  )
  const missingValues = uniqueValues.filter((value) => !currentValues.has(value))

  if (missingValues.length === 0) {
    return source
  }

  if (!document.excludeProperty) {
    assertPropertyInsertionSafe(source, document.root)
    return validateTsconfigSource(applyJsoncModification(source, ['exclude'], missingValues))
  }

  const hadTrailingComma = Boolean(
    document.excludeArray && typeof trailingCommaOffset(source, document.excludeArray) === 'number',
  )
  let nextSource = source

  for (const [index, value] of missingValues.entries()) {
    nextSource = appendExcludeValue(
      nextSource,
      readTsconfigDocument(nextSource),
      value,
      !hadTrailingComma || index > 0,
    )
  }

  return validateTsconfigSource(nextSource)
}

// restoreTsconfigJsonClaims 함수는 clean claim의 소유 문자열만 제거하고 이전에 없던 빈 속성만 정리한다.
export function restoreTsconfigJsonClaims(source: string, claims: PackageJsonOwnershipClaim[]) {
  const unsupportedClaim = claims.find(
    (claim) =>
      claim.path !== 'exclude' || claim.action !== 'array-value' || typeof claim.value !== 'string',
  )

  if (unsupportedClaim) {
    throw new Error(
      `Cannot restore tsconfig.json claim without replacing JSONC formatting: ${unsupportedClaim.path}`,
    )
  }

  const initialDocument = readTsconfigDocument(source)
  const ownedValues = new Set(claims.map((claim) => claim.value as string))
  const lastElement = initialDocument.excludeArray?.children?.at(-1)
  const removeAddedTrailingComma = Boolean(
    initialDocument.excludeArray &&
    lastElement &&
    ownedValues.has(lastElement.value as string) &&
    typeof trailingCommaOffset(source, initialDocument.excludeArray) !== 'number',
  )
  let nextSource = source

  for (const value of ownedValues) {
    const document = readTsconfigDocument(nextSource)
    const index =
      document.excludeArray?.children?.findIndex((element) => element.value === value) ?? -1

    if (document.excludeArray && index >= 0) {
      nextSource = removeArrayElement(nextSource, document.excludeArray, index)
    }
  }

  if (removeAddedTrailingComma) {
    nextSource = removeTrailingComma(nextSource)
  }

  if (claims.some((claim) => claim.previous.state === 'missing')) {
    nextSource = removeEmptyOwnedProperty(nextSource)
  }

  return validateTsconfigSource(nextSource)
}
