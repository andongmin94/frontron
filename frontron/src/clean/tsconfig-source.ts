import type { PackageJsonOwnershipClaim } from '../init/manifest'
import { parseJsonc } from '../init/jsonc'

type JsoncToken = {
  type: 'string' | 'punctuation' | 'literal'
  value: string
  start: number
  end: number
}

type JsoncProperty = {
  key: JsoncToken
  valueStartIndex: number
  valueEndIndex: number
  commaBeforeIndex?: number
  commaAfterIndex?: number
}

type JsoncArrayElement = {
  tokenIndex: number
  commaBeforeIndex?: number
  commaAfterIndex?: number
}

type JsoncDocument = {
  tokens: JsoncToken[]
  rootOpenIndex: number
  rootCloseIndex: number
  properties: JsoncProperty[]
}

// tokenizeJsonc 함수는 주석과 공백을 건너뛰고 원문 위치를 보존한 JSONC 토큰을 만든다.
function tokenizeJsonc(source: string) {
  const tokens: JsoncToken[] = []

  for (let index = 0; index < source.length; ) {
    const current = source[index]
    const next = source[index + 1]

    if (/\s/.test(current)) {
      index += 1
      continue
    }

    if (current === '/' && next === '/') {
      index += 2

      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
        index += 1
      }

      continue
    }

    if (current === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index + 2)

      if (commentEnd === -1) {
        throw new Error('tsconfig.json contains an unterminated block comment.')
      }

      index = commentEnd + 2
      continue
    }

    if (current === '"') {
      const start = index
      let escaped = false
      index += 1

      while (index < source.length) {
        const character = source[index]

        if (escaped) {
          escaped = false
        } else if (character === '\\') {
          escaped = true
        } else if (character === '"') {
          index += 1
          break
        }

        index += 1
      }

      if (source[index - 1] !== '"') {
        throw new Error('tsconfig.json contains an unterminated string.')
      }

      const rawValue = source.slice(start, index)
      tokens.push({
        type: 'string',
        value: JSON.parse(rawValue) as string,
        start,
        end: index,
      })
      continue
    }

    if ('{}[]:,'.includes(current)) {
      tokens.push({
        type: 'punctuation',
        value: current,
        start: index,
        end: index + 1,
      })
      index += 1
      continue
    }

    const start = index

    while (
      index < source.length &&
      !/\s/.test(source[index]) &&
      !'{}[]:,'.includes(source[index]) &&
      !(source[index] === '/' && (source[index + 1] === '/' || source[index + 1] === '*'))
    ) {
      index += 1
    }

    tokens.push({
      type: 'literal',
      value: source.slice(start, index),
      start,
      end: index,
    })
  }

  return tokens
}

// findClosingTokenIndex 함수는 객체나 배열의 여는 토큰과 짝이 되는 닫는 토큰을 찾는다.
function findClosingTokenIndex(tokens: JsoncToken[], openIndex: number) {
  const opener = tokens[openIndex]?.value
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : null

  if (!closer) {
    return openIndex
  }

  let depth = 0

  for (let index = openIndex; index < tokens.length; index += 1) {
    const value = tokens[index].value

    if (value === opener) {
      depth += 1
    } else if (value === closer) {
      depth -= 1

      if (depth === 0) {
        return index
      }
    }
  }

  throw new Error('tsconfig.json contains an unterminated object or array.')
}

// readValueEndIndex 함수는 속성 값 하나가 끝나는 토큰 위치를 계산한다.
function readValueEndIndex(tokens: JsoncToken[], startIndex: number) {
  const value = tokens[startIndex]?.value

  return value === '{' || value === '[' ? findClosingTokenIndex(tokens, startIndex) : startIndex
}

// readJsoncDocument 함수는 최상위 객체 속성을 원문 토큰 위치와 함께 읽는다.
function readJsoncDocument(source: string): JsoncDocument {
  const tokens = tokenizeJsonc(source)
  const rootOpenIndex = tokens.findIndex((token) => token.value === '{')

  if (rootOpenIndex === -1) {
    throw new Error('tsconfig.json must contain a top-level object.')
  }

  const rootCloseIndex = findClosingTokenIndex(tokens, rootOpenIndex)
  const properties: JsoncProperty[] = []
  let index = rootOpenIndex + 1
  let commaBeforeIndex: number | undefined

  while (index < rootCloseIndex) {
    const key = tokens[index]

    if (key.value === ',') {
      commaBeforeIndex = index
      index += 1
      continue
    }

    if (key.type !== 'string' || tokens[index + 1]?.value !== ':') {
      throw new Error('tsconfig.json contains an unsupported top-level property.')
    }

    const valueStartIndex = index + 2
    const valueEndIndex = readValueEndIndex(tokens, valueStartIndex)
    const commaAfterIndex = tokens[valueEndIndex + 1]?.value === ',' ? valueEndIndex + 1 : undefined

    properties.push({
      key,
      valueStartIndex,
      valueEndIndex,
      commaBeforeIndex,
      commaAfterIndex,
    })

    index = (commaAfterIndex ?? valueEndIndex) + 1
    commaBeforeIndex = commaAfterIndex
  }

  return { tokens, rootOpenIndex, rootCloseIndex, properties }
}

// readArrayElements 함수는 문자열 배열 원소와 앞뒤 쉼표 위치를 읽는다.
function readArrayElements(document: JsoncDocument, property: JsoncProperty) {
  const { tokens } = document
  const openIndex = property.valueStartIndex

  if (tokens[openIndex]?.value !== '[') {
    throw new Error('tsconfig.json exclude must remain an array of strings.')
  }

  const closeIndex = findClosingTokenIndex(tokens, openIndex)
  const elements: JsoncArrayElement[] = []
  let index = openIndex + 1
  let commaBeforeIndex: number | undefined

  while (index < closeIndex) {
    const token = tokens[index]

    if (token.value === ',') {
      commaBeforeIndex = index
      index += 1
      continue
    }

    if (token.type !== 'string') {
      throw new Error('tsconfig.json exclude must remain an array of strings.')
    }

    const commaAfterIndex = tokens[index + 1]?.value === ',' ? index + 1 : undefined
    elements.push({ tokenIndex: index, commaBeforeIndex, commaAfterIndex })
    index = (commaAfterIndex ?? index) + 1
    commaBeforeIndex = commaAfterIndex
  }

  return { openIndex, closeIndex, elements }
}

// lineIndentAt 함수는 토큰이 있는 줄의 들여쓰기를 반환한다.
function lineIndentAt(source: string, position: number) {
  const lineStart =
    Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1
  const indent = source.slice(lineStart, position)

  return /^[\t ]*$/.test(indent) ? indent : ''
}

// lineStartAt 함수는 위치가 속한 줄의 시작 오프셋을 반환한다.
function lineStartAt(source: string, position: number) {
  return (
    Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1
  )
}

// lineEndAt 함수는 줄바꿈 문자를 포함한 현재 줄의 끝 오프셋을 반환한다.
function lineEndAt(source: string, position: number) {
  const newlineIndex = source.indexOf('\n', position)

  return newlineIndex === -1 ? source.length : newlineIndex + 1
}

// detectLineEnding 함수는 원문에서 사용 중인 줄바꿈 형식을 유지한다.
function detectLineEnding(source: string) {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

// applyTextEdits 함수는 뒤쪽 편집부터 적용해 기존 토큰 위치가 흔들리지 않게 한다.
function applyTextEdits(
  source: string,
  edits: Array<{ start: number; end: number; text: string }>,
) {
  let nextSource = source

  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    nextSource = `${nextSource.slice(0, edit.start)}${edit.text}${nextSource.slice(edit.end)}`
  }

  return nextSource
}

// validateJsoncSource 함수는 국소 편집 결과가 여전히 유효한 JSONC인지 확인한다.
function validateJsoncSource(source: string) {
  parseJsonc(source)
  return source
}

// appendExcludeValues 함수는 기존 exclude 배열의 서식과 trailing comma 스타일을 유지해 값을 추가한다.
function appendExcludeValues(
  source: string,
  document: JsoncDocument,
  property: JsoncProperty,
  values: string[],
) {
  const { tokens } = document
  const array = readArrayElements(document, property)
  const currentValues = new Set(array.elements.map((element) => tokens[element.tokenIndex].value))
  const missingValues = values.filter((value) => !currentValues.has(value))

  if (missingValues.length === 0) {
    return source
  }

  const closeToken = tokens[array.closeIndex]
  const openToken = tokens[array.openIndex]
  const lastElement = array.elements.at(-1)
  const hasTrailingComma = Boolean(lastElement?.commaAfterIndex)
  const isMultiline = /[\r\n]/.test(source.slice(openToken.end, closeToken.start))

  if (!isMultiline) {
    const renderedValues = missingValues.map((value) => JSON.stringify(value))
    const insertion = lastElement
      ? hasTrailingComma
        ? `${renderedValues.join(', ')},`
        : `, ${renderedValues.join(', ')}`
      : renderedValues.join(', ')

    return `${source.slice(0, closeToken.start)}${insertion}${source.slice(closeToken.start)}`
  }

  const eol = detectLineEnding(source)
  const closeLineStart = lineStartAt(source, closeToken.start)
  const closeIndent = source.slice(closeLineStart, closeToken.start)

  if (!/^[\t ]*$/.test(closeIndent)) {
    const renderedValues = missingValues.map((value) => JSON.stringify(value)).join(', ')
    return `${source.slice(0, closeToken.start)}, ${renderedValues}${source.slice(closeToken.start)}`
  }

  const propertyIndent = lineIndentAt(source, property.key.start)
  const itemIndent = lastElement
    ? lineIndentAt(source, tokens[lastElement.tokenIndex].start)
    : `${propertyIndent}${propertyIndent.includes('\t') ? '\t' : '  '}`
  const renderedLines = missingValues
    .map((value, index) => {
      const comma = hasTrailingComma || index < missingValues.length - 1 ? ',' : ''
      return `${itemIndent}${JSON.stringify(value)}${comma}${eol}`
    })
    .join('')
  const edits = [
    {
      start: closeLineStart,
      end: closeLineStart,
      text: renderedLines,
    },
  ]

  if (lastElement && !hasTrailingComma) {
    const lastToken = tokens[lastElement.tokenIndex]
    edits.push({ start: lastToken.end, end: lastToken.end, text: ',' })
  }

  return applyTextEdits(source, edits)
}

// addExcludeProperty 함수는 최상위 객체의 기존 들여쓰기와 trailing comma 스타일로 exclude를 추가한다.
function addExcludeProperty(source: string, document: JsoncDocument, values: string[]) {
  const { tokens, properties } = document
  const rootOpen = tokens[document.rootOpenIndex]
  const rootClose = tokens[document.rootCloseIndex]
  const lastProperty = properties.at(-1)
  const hasTrailingComma = Boolean(lastProperty?.commaAfterIndex)
  const renderedArray = `[${values.map((value) => JSON.stringify(value)).join(', ')}]`
  const isMultiline = /[\r\n]/.test(source.slice(rootOpen.end, rootClose.start))

  if (!isMultiline) {
    const prefix = lastProperty ? (hasTrailingComma ? '' : ', ') : ''
    const suffix = hasTrailingComma ? ',' : ''
    const propertySource = `${prefix}"exclude": ${renderedArray}${suffix}`

    return `${source.slice(0, rootClose.start)}${propertySource}${source.slice(rootClose.start)}`
  }

  const eol = detectLineEnding(source)
  const closeLineStart = lineStartAt(source, rootClose.start)
  const closeIndent = source.slice(closeLineStart, rootClose.start)

  if (!/^[\t ]*$/.test(closeIndent)) {
    throw new Error(
      'tsconfig.json closing brace must start on its own line to preserve formatting.',
    )
  }

  const propertyIndent = properties[0]
    ? lineIndentAt(source, properties[0].key.start)
    : `${closeIndent}${closeIndent.includes('\t') ? '\t' : '  '}`
  const edits = [
    {
      start: closeLineStart,
      end: closeLineStart,
      text: `${propertyIndent}"exclude": ${renderedArray}${hasTrailingComma ? ',' : ''}${eol}`,
    },
  ]

  if (lastProperty && !hasTrailingComma) {
    const lastValue = tokens[lastProperty.valueEndIndex]
    edits.push({ start: lastValue.end, end: lastValue.end, text: ',' })
  }

  return applyTextEdits(source, edits)
}

// addTsconfigExcludeValues 함수는 init 소유 exclude 값만 원문에 국소적으로 추가한다.
export function addTsconfigExcludeValues(source: string, values: string[]) {
  const uniqueValues = [...new Set(values)]

  if (uniqueValues.length === 0) {
    return source
  }

  const document = readJsoncDocument(source)
  const excludeProperty = document.properties.find((property) => property.key.value === 'exclude')
  const nextSource = excludeProperty
    ? appendExcludeValues(source, document, excludeProperty, uniqueValues)
    : addExcludeProperty(source, document, uniqueValues)

  return validateJsoncSource(nextSource)
}

// removeOneExcludeValue 함수는 쉼표 구조를 유지하면서 소유 배열 값 하나만 제거한다.
function removeOneExcludeValue(source: string, value: string) {
  const document = readJsoncDocument(source)
  const property = document.properties.find((entry) => entry.key.value === 'exclude')

  if (!property) {
    return source
  }

  const array = readArrayElements(document, property)
  const element = array.elements.find((entry) => document.tokens[entry.tokenIndex].value === value)

  if (!element) {
    return source
  }

  const token = document.tokens[element.tokenIndex]
  const commaAfter =
    typeof element.commaAfterIndex === 'number' ? document.tokens[element.commaAfterIndex] : null
  const structuralEnd = commaAfter?.end ?? token.end
  const lineStart = lineStartAt(source, token.start)
  const lineEnd = lineEndAt(source, structuralEnd)
  const lineContentEnd = source[lineEnd - 1] === '\n' ? lineEnd - 1 : lineEnd
  const lineContentWithoutCr =
    source[lineContentEnd - 1] === '\r' ? lineContentEnd - 1 : lineContentEnd

  if (
    /^[\t ]*$/.test(source.slice(lineStart, token.start)) &&
    /^[\t ]*$/.test(source.slice(structuralEnd, lineContentWithoutCr))
  ) {
    return applyTextEdits(source, [{ start: lineStart, end: lineEnd, text: '' }])
  }

  if (typeof element.commaAfterIndex === 'number') {
    return applyTextEdits(source, [
      {
        start: token.start,
        end: document.tokens[element.commaAfterIndex].end,
        text: '',
      },
    ])
  }

  if (typeof element.commaBeforeIndex === 'number') {
    return applyTextEdits(source, [
      {
        start: document.tokens[element.commaBeforeIndex].start,
        end: token.end,
        text: '',
      },
    ])
  }

  return applyTextEdits(source, [{ start: token.start, end: token.end, text: '' }])
}

// removeExcludeTrailingComma 함수는 init이 구분자로 추가했던 마지막 쉼표를 제거한다.
function removeExcludeTrailingComma(source: string) {
  const document = readJsoncDocument(source)
  const property = document.properties.find((entry) => entry.key.value === 'exclude')

  if (!property) {
    return source
  }

  const array = readArrayElements(document, property)
  const lastElement = array.elements.at(-1)

  if (typeof lastElement?.commaAfterIndex !== 'number') {
    return source
  }

  const comma = document.tokens[lastElement.commaAfterIndex]
  return applyTextEdits(source, [{ start: comma.start, end: comma.end, text: '' }])
}

// removeEmptyExcludeProperty 함수는 init이 새로 만든 빈 exclude 속성만 제거한다.
function removeEmptyExcludeProperty(source: string) {
  const document = readJsoncDocument(source)
  const property = document.properties.find((entry) => entry.key.value === 'exclude')

  if (!property) {
    return source
  }

  const array = readArrayElements(document, property)

  if (array.elements.length > 0) {
    return source
  }

  const arrayInnerSource = source.slice(
    document.tokens[array.openIndex].end,
    document.tokens[array.closeIndex].start,
  )

  // 사용자가 빈 배열 안에 남긴 주석은 소유 데이터가 아니므로 속성과 함께 지우지 않는다.
  if (/\/\//.test(arrayInnerSource) || /\/\*/.test(arrayInnerSource)) {
    return source
  }

  const propertyStart = property.key.start
  const propertyEnd = document.tokens[property.valueEndIndex].end
  const propertyCommaAfter =
    typeof property.commaAfterIndex === 'number' ? document.tokens[property.commaAfterIndex] : null
  const structuralEnd = propertyCommaAfter?.end ?? propertyEnd
  const lineStart = lineStartAt(source, propertyStart)
  const lineEnd = lineEndAt(source, structuralEnd)
  const lineContentEnd = source[lineEnd - 1] === '\n' ? lineEnd - 1 : lineEnd
  const lineContentWithoutCr =
    source[lineContentEnd - 1] === '\r' ? lineContentEnd - 1 : lineContentEnd

  if (
    /^[\t ]*$/.test(source.slice(lineStart, propertyStart)) &&
    /^[\t ]*$/.test(source.slice(structuralEnd, lineContentWithoutCr))
  ) {
    const edits = [{ start: lineStart, end: lineEnd, text: '' }]

    if (!propertyCommaAfter && typeof property.commaBeforeIndex === 'number') {
      const commaBefore = document.tokens[property.commaBeforeIndex]
      edits.push({ start: commaBefore.start, end: commaBefore.end, text: '' })
    }

    return applyTextEdits(source, edits)
  }

  if (typeof property.commaAfterIndex === 'number') {
    return applyTextEdits(source, [
      {
        start: propertyStart,
        end: document.tokens[property.commaAfterIndex].end,
        text: '',
      },
    ])
  }

  if (typeof property.commaBeforeIndex === 'number') {
    return applyTextEdits(source, [
      {
        start: document.tokens[property.commaBeforeIndex].start,
        end: propertyEnd,
        text: '',
      },
    ])
  }

  return applyTextEdits(source, [{ start: propertyStart, end: propertyEnd, text: '' }])
}

// restoreTsconfigJsonClaims 함수는 clean claim을 원문 보존 방식으로 복구한다.
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

  const initialDocument = readJsoncDocument(source)
  const initialProperty = initialDocument.properties.find((entry) => entry.key.value === 'exclude')
  const ownedValues = new Set(claims.map((claim) => claim.value as string))
  let removeAddedTrailingComma = false

  if (initialProperty) {
    const initialArray = readArrayElements(initialDocument, initialProperty)
    const lastElement = initialArray.elements.at(-1)

    removeAddedTrailingComma = Boolean(
      lastElement &&
      ownedValues.has(initialDocument.tokens[lastElement.tokenIndex].value) &&
      typeof lastElement.commaAfterIndex !== 'number',
    )
  }

  let nextSource = source

  for (const value of ownedValues) {
    nextSource = removeOneExcludeValue(nextSource, value)
  }

  if (removeAddedTrailingComma) {
    nextSource = removeExcludeTrailingComma(nextSource)
  }

  if (claims.some((claim) => claim.previous.state === 'missing')) {
    nextSource = removeEmptyExcludeProperty(nextSource)
  }

  return validateJsoncSource(nextSource)
}
