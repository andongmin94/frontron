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

import { parseTsconfigDocument, type TsconfigDocument } from '../init/tsconfig-json'
import type { PackageJsonOwnershipClaim } from '../init/manifest'

function formattingOptions(source: string): FormattingOptions | undefined {
  const content = source.trimEnd()
  if (!/[\r\n]/.test(content)) return undefined

  const indent = content.match(/(?:^|\r?\n)([\t ]+)(?=\S)/)?.[1] ?? '  '
  const insertSpaces = !indent.includes('\t')

  return {
    insertSpaces,
    tabSize: insertSpaces ? Math.max(indent.length, 1) : 1,
    eol: source.includes('\r\n') ? '\r\n' : '\n',
    keepLines: true,
  }
}

function editJsonc(
  source: string,
  path: JSONPath,
  value: unknown,
  options: ModificationOptions = {},
  spaceAfterComma = false,
) {
  const formatting = formattingOptions(source)
  let edits = modify(source, path, value, { ...options, formattingOptions: formatting })

  if (!formatting && spaceAfterComma) {
    edits = edits.map((edit) => ({ ...edit, content: edit.content.replace(/^,/, ', ') }))
  }

  return applyEdits(source, edits)
}

function tokenOffset(source: string, start: number, end: number, kind: SyntaxKind) {
  const scanner = createScanner(source, true)
  scanner.setPosition(start)

  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (scanner.getTokenOffset() >= end) break
    if (token === kind) return scanner.getTokenOffset()
  }

  return undefined
}

function containsComment(source: string, start: number, end: number) {
  const scanner = createScanner(source, false)
  scanner.setPosition(start)

  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (scanner.getTokenOffset() >= end) break
    if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) return true
  }

  return false
}

function lineStart(source: string, position: number) {
  return Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1
}

function lineEnd(source: string, position: number) {
  const newline = source.indexOf('\n', position)
  return newline === -1 ? source.length : newline + 1
}

function trailingComma(source: string, array: Node) {
  const last = array.children?.at(-1)
  return last
    ? tokenOffset(
        source,
        last.offset + last.length,
        array.offset + array.length - 1,
        SyntaxKind.CommaToken,
      )
    : undefined
}

function assertPropertyInsertionSafe(source: string, root: Node) {
  const close = root.offset + root.length - 1

  if (
    /[\r\n]/.test(source.slice(root.offset, close)) &&
    !/^[\t ]*$/.test(source.slice(lineStart(source, close), close))
  ) {
    throw new Error('tsconfig.json closing brace must start on its own line to preserve formatting.')
  }
}

function appendExclude(source: string, document: TsconfigDocument, value: string, space: boolean) {
  return editJsonc(
    source,
    ['exclude', document.excludeArray?.children?.length ?? 0],
    value,
    { isArrayInsertion: true },
    space,
  )
}

function removeElement(source: string, array: Node, index: number) {
  const elements = array.children ?? []
  const element = elements[index]
  if (!element) return source

  const previous = elements[index - 1]
  const next = elements[index + 1]
  const elementEnd = element.offset + element.length
  const commaAfter = tokenOffset(
    source,
    elementEnd,
    next?.offset ?? array.offset + array.length - 1,
    SyntaxKind.CommaToken,
  )
  const commaBefore = previous
    ? tokenOffset(
        source,
        previous.offset + previous.length,
        element.offset,
        SyntaxKind.CommaToken,
      )
    : undefined
  const structuralEnd = typeof commaAfter === 'number' ? commaAfter + 1 : elementEnd
  const start = lineStart(source, element.offset)
  const end = lineEnd(source, structuralEnd)
  const contentEnd = source.slice(start, end).replace(/\r?\n$/, '').length + start
  const commentAfter =
    typeof commaAfter === 'number' && containsComment(source, elementEnd, commaAfter)

  if (
    !commentAfter &&
    /^[\t ]*$/.test(source.slice(start, element.offset)) &&
    /^[\t ]*$/.test(source.slice(structuralEnd, contentEnd))
  ) {
    return applyEdits(source, [{ offset: start, length: end - start, content: '' }])
  }

  if (typeof commaAfter === 'number') {
    const edits: Edit[] = commentAfter
      ? [
          { offset: element.offset, length: element.length, content: '' },
          { offset: commaAfter, length: 1, content: '' },
        ]
      : [{ offset: element.offset, length: commaAfter + 1 - element.offset, content: '' }]
    return applyEdits(source, edits)
  }

  if (typeof commaBefore === 'number') {
    const commentBefore = containsComment(source, commaBefore + 1, element.offset)
    const edits: Edit[] = commentBefore
      ? [
          { offset: commaBefore, length: 1, content: '' },
          { offset: element.offset, length: element.length, content: '' },
        ]
      : [{ offset: commaBefore, length: elementEnd - commaBefore, content: '' }]
    return applyEdits(source, edits)
  }

  return applyEdits(source, [{ offset: element.offset, length: element.length, content: '' }])
}

function removeEmptyOwnedProperty(source: string) {
  const { excludeProperty, excludeArray } = parseTsconfigDocument(source)

  if (!excludeProperty || !excludeArray || (excludeArray.children?.length ?? 0) > 0) return source

  const start = lineStart(source, excludeProperty.offset)
  const end = lineEnd(source, excludeProperty.offset + excludeProperty.length)

  if (
    containsComment(source, excludeArray.offset + 1, excludeArray.offset + excludeArray.length - 1) ||
    containsComment(source, start, end)
  ) {
    return source
  }

  return editJsonc(source, ['exclude'], undefined)
}

export function addTsconfigExcludeValues(source: string, values: string[]) {
  const uniqueValues = [...new Set(values)]
  if (uniqueValues.length === 0) return source

  const document = parseTsconfigDocument(source)
  const current = new Set(
    document.excludeArray?.children?.map((element) => element.value as string) ?? [],
  )
  const missing = uniqueValues.filter((value) => !current.has(value))
  if (missing.length === 0) return source

  if (!document.excludeProperty) {
    assertPropertyInsertionSafe(source, document.root)
    return editJsonc(source, ['exclude'], missing)
  }

  const hadTrailingComma = Boolean(
    document.excludeArray && typeof trailingComma(source, document.excludeArray) === 'number',
  )
  let next = source

  for (const [index, value] of missing.entries()) {
    next = appendExclude(next, parseTsconfigDocument(next), value, !hadTrailingComma || index > 0)
  }

  parseTsconfigDocument(next)
  return next
}

export function restoreTsconfigJsonClaims(source: string, claims: PackageJsonOwnershipClaim[]) {
  const unsupported = claims.find(
    (claim) =>
      claim.path !== 'exclude' || claim.action !== 'array-value' || typeof claim.value !== 'string',
  )

  if (unsupported) throw new Error(`Cannot restore unsupported tsconfig.json claim: ${unsupported.path}`)

  const initial = parseTsconfigDocument(source)
  const owned = new Set(claims.map((claim) => claim.value as string))
  const last = initial.excludeArray?.children?.at(-1)
  const removeAddedTrailingComma = Boolean(
    initial.excludeArray &&
    last &&
    owned.has(last.value as string) &&
    typeof trailingComma(source, initial.excludeArray) !== 'number',
  )
  let next = source

  for (const value of owned) {
    const document = parseTsconfigDocument(next)
    const index = document.excludeArray?.children?.findIndex((element) => element.value === value) ?? -1

    if (document.excludeArray && index >= 0) {
      next = removeElement(next, document.excludeArray, index)
    }
  }

  if (removeAddedTrailingComma) {
    const { excludeArray } = parseTsconfigDocument(next)
    if (excludeArray) {
      const comma = trailingComma(next, excludeArray)
      if (typeof comma === 'number') {
        next = applyEdits(next, [{ offset: comma, length: 1, content: '' }])
      }
    }
  }

  if (claims.some((claim) => claim.previous.state === 'missing')) {
    next = removeEmptyOwnedProperty(next)
  }

  parseTsconfigDocument(next)
  return next
}
