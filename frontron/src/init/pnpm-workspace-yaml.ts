import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { PackageJsonOwnershipClaim } from './manifest'
import { cloneJsonValue, valuesEqual } from './package-json-path'

export const PNPM_WORKSPACE_YAML_PATH = 'pnpm-workspace.yaml'

const REQUIRED_ALLOW_BUILDS = ['electron', 'electron-winstaller'] as const
const PRESERVED_SCALAR_FIELD = 'pnpmWorkspaceYamlScalar'
const CREATED_SECTION_FIELD = 'pnpmWorkspaceYamlCreatedSection'

export type PnpmWorkspaceYamlPatchChange = {
  action: 'set'
  path: string
  value: true
}

export type PnpmWorkspaceYamlPatchPlan = {
  path: string
  source: string
  nextSource: string
  changes: PnpmWorkspaceYamlPatchChange[]
  ownershipClaims: PackageJsonOwnershipClaim[]
  warnings: string[]
  blockers: string[]
}

export type PnpmWorkspaceYamlClaimReadResult = {
  exists: boolean
  value: unknown
  safeToEdit: boolean
  blocker?: string
}

type YamlLine = {
  text: string
  ending: string
}

type ParsedMappingLine = {
  indent: string
  key: string
  valueSource: string
  valueStart: number
  valueEnd: number
}

type AllowBuildsSection = {
  start: number
  end: number
  indent: string
}

type AllowBuildsEntry = {
  key: string
  value: unknown
  valueSource: string
  valueStart: number
  valueEnd: number
  lineIndex: number
}

type EditableYamlInspection = {
  safe: true
  lines: YamlLine[]
  eol: string
  section: AllowBuildsSection | null
  entries: Map<string, AllowBuildsEntry>
}

type UnsafeYamlInspection = {
  safe: false
  blocker: string
}

type YamlInspection = EditableYamlInspection | UnsafeYamlInspection

type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

type AllowBuildsWriteValue = {
  value: unknown
  preferredSource?: string
}

type CreatedSectionMetadata = {
  separatorLineAdded: boolean
  previousHadFinalEol: boolean
}

// findPnpmWorkspaceYamlPath 함수는 현재 패키지에서 상위 workspace 루트까지 pnpm-workspace.yaml을 찾는다.
export function findPnpmWorkspaceYamlPath(cwd: string) {
  let currentDir = resolve(cwd)

  while (true) {
    const candidate = join(currentDir, PNPM_WORKSPACE_YAML_PATH)

    if (existsSync(candidate)) {
      return candidate
    }

    const parentDir = dirname(currentDir)

    if (parentDir === currentDir) {
      break
    }

    currentDir = parentDir
  }

  return join(cwd, PNPM_WORKSPACE_YAML_PATH)
}

// splitYamlLines 함수는 각 줄의 원래 줄바꿈 문자를 보존한 채 YAML 원문을 나눈다.
function splitYamlLines(source: string) {
  const lines: YamlLine[] = []
  let start = 0

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (character !== '\n' && character !== '\r') {
      continue
    }

    const ending = character === '\r' && source[index + 1] === '\n' ? '\r\n' : character
    lines.push({
      text: source.slice(start, index),
      ending,
    })
    index += ending.length - 1
    start = index + 1
  }

  if (start < source.length) {
    lines.push({ text: source.slice(start), ending: '' })
  }

  return lines
}

// joinYamlLines 함수는 보존해 둔 줄바꿈과 함께 YAML 줄을 다시 합친다.
function joinYamlLines(lines: YamlLine[]) {
  return lines.map((line) => `${line.text}${line.ending}`).join('')
}

// findPreferredEol 함수는 새 줄에 사용할 기존 YAML의 대표 줄바꿈을 찾는다.
function findPreferredEol(lines: YamlLine[]) {
  return lines.find((line) => line.ending)?.ending || '\n'
}

// getYamlLineText 함수는 첫 줄의 UTF-8 BOM만 파싱 대상에서 제외한다.
function getYamlLineText(line: YamlLine, lineIndex: number) {
  return lineIndex === 0 && line.text.startsWith('\uFEFF') ? line.text.slice(1) : line.text
}

// isYamlTrivia 함수는 빈 줄과 주석 전용 줄을 구분한다.
function isYamlTrivia(text: string) {
  const trimmed = text.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

// formatLineReason 함수는 안전하지 않은 YAML 위치를 사람이 찾기 쉬운 문장으로 만든다.
function formatLineReason(lineIndex: number, reason: string) {
  return `${reason} (line ${lineIndex + 1})`
}

// formatYamlBlocker 함수는 모든 YAML blocker에 원문 보존 사실을 명시한다.
function formatYamlBlocker(reason: string) {
  return `Cannot safely edit pnpm-workspace.yaml: ${reason}. The file was left unchanged.`
}

// parseQuotedYamlString 함수는 안전하게 지원하는 한 줄짜리 따옴표 문자열을 해석한다.
function parseQuotedYamlString(source: string): ParseResult<string> {
  if (source.startsWith("'")) {
    let value = ''

    for (let index = 1; index < source.length; index += 1) {
      if (source[index] !== "'") {
        value += source[index]
        continue
      }

      if (source[index + 1] === "'") {
        value += "'"
        index += 1
        continue
      }

      return index === source.length - 1
        ? { ok: true, value }
        : { ok: false, reason: 'quoted value has trailing YAML content' }
    }

    return { ok: false, reason: 'single-quoted value is not closed on the same line' }
  }

  if (source.startsWith('"')) {
    try {
      const value = JSON.parse(source) as unknown

      return typeof value === 'string'
        ? { ok: true, value }
        : { ok: false, reason: 'double-quoted value is not a string' }
    } catch {
      return { ok: false, reason: 'double-quoted value uses unsupported escaping or is not closed' }
    }
  }

  return { ok: false, reason: 'value is not quoted' }
}

// findInlineCommentStart 함수는 따옴표 안의 #을 제외하고 inline comment 시작점을 찾는다.
function findInlineCommentStart(text: string, start: number) {
  let quote: 'single' | 'double' | null = null

  for (let index = start; index < text.length; index += 1) {
    const character = text[index]

    if (quote === 'single') {
      if (character === "'" && text[index + 1] === "'") {
        index += 1
      } else if (character === "'") {
        quote = null
      }
      continue
    }

    if (quote === 'double') {
      if (character === '\\') {
        index += 1
      } else if (character === '"') {
        quote = null
      }
      continue
    }

    if (character === "'") {
      quote = 'single'
    } else if (character === '"') {
      quote = 'double'
    } else if (character === '#' && (index === start || /\s/.test(text[index - 1]))) {
      return index
    }
  }

  return -1
}

// parseMappingLine 함수는 안전한 단순 key/value 매핑 한 줄의 위치와 값을 읽는다.
function parseMappingLine(text: string): ParseResult<ParsedMappingLine> {
  const indent = text.match(/^[ \t]*/)?.[0] ?? ''

  if (indent.includes('\t')) {
    return { ok: false, reason: 'tab indentation is not supported' }
  }

  let quote: 'single' | 'double' | null = null
  let colonIndex = -1

  for (let index = indent.length; index < text.length; index += 1) {
    const character = text[index]

    if (quote === 'single') {
      if (character === "'" && text[index + 1] === "'") {
        index += 1
      } else if (character === "'") {
        quote = null
      }
      continue
    }

    if (quote === 'double') {
      if (character === '\\') {
        index += 1
      } else if (character === '"') {
        quote = null
      }
      continue
    }

    if (character === "'") {
      quote = 'single'
      continue
    }

    if (character === '"') {
      quote = 'double'
      continue
    }

    if (character === ':' && (index === text.length - 1 || /\s/.test(text[index + 1]))) {
      colonIndex = index
      break
    }
  }

  if (colonIndex === -1 || quote) {
    return { ok: false, reason: 'line is not a supported block mapping entry' }
  }

  const keySource = text.slice(indent.length, colonIndex).trimEnd()

  if (!keySource) {
    return { ok: false, reason: 'mapping key is empty' }
  }

  let key: string

  if (keySource.startsWith("'") || keySource.startsWith('"')) {
    const parsedKey = parseQuotedYamlString(keySource)

    if (!parsedKey.ok) {
      return { ok: false, reason: `mapping key ${parsedKey.reason}` }
    }

    key = parsedKey.value
  } else {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.+/@*~-]*$/.test(keySource)) {
      return { ok: false, reason: 'plain mapping key uses unsupported YAML syntax' }
    }

    key = keySource
  }

  const commentStart = findInlineCommentStart(text, colonIndex + 1)
  const valueBoundary = commentStart === -1 ? text.length : commentStart
  let valueStart = colonIndex + 1
  let valueEnd = valueBoundary

  while (valueStart < valueBoundary && text[valueStart] === ' ') {
    valueStart += 1
  }

  while (valueEnd > valueStart && text[valueEnd - 1] === ' ') {
    valueEnd -= 1
  }

  if (text.slice(colonIndex + 1, valueStart).includes('\t')) {
    return { ok: false, reason: 'tab separation is not supported' }
  }

  return {
    ok: true,
    value: {
      indent,
      key,
      valueSource: text.slice(valueStart, valueEnd),
      valueStart,
      valueEnd,
    },
  }
}

// findYamlReferenceToken 함수는 손실 없이 편집하기 어려운 anchor, alias, tag 토큰을 찾는다.
function findYamlReferenceToken(text: string) {
  let quote: 'single' | 'double' | null = null

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (quote === 'single') {
      if (character === "'" && text[index + 1] === "'") {
        index += 1
      } else if (character === "'") {
        quote = null
      }
      continue
    }

    if (quote === 'double') {
      if (character === '\\') {
        index += 1
      } else if (character === '"') {
        quote = null
      }
      continue
    }

    if (character === "'") {
      quote = 'single'
      continue
    }

    if (character === '"') {
      quote = 'double'
      continue
    }

    if (character === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      break
    }

    if (!['&', '*', '!'].includes(character)) {
      continue
    }

    const previous = index === 0 ? '' : text[index - 1]

    if (index > 0 && !/[\s:[{,?-]/.test(previous)) {
      continue
    }

    return character === '&' ? 'anchor' : character === '*' ? 'alias' : 'tag'
  }

  return null
}

// parseAllowBuildsScalar 함수는 한 줄에서 완결되는 안전한 allowBuilds scalar를 읽는다.
function parseAllowBuildsScalar(source: string): ParseResult<unknown> {
  if (!source) {
    return { ok: false, reason: 'value is empty or starts a nested mapping' }
  }

  if (source.startsWith("'") || source.startsWith('"')) {
    return parseQuotedYamlString(source)
  }

  if (/^[\-?:,\[\]{}#&*!|>'"%@`]/.test(source)) {
    return { ok: false, reason: 'value starts with unsupported YAML syntax' }
  }

  if (/[\[\]{}]/.test(source) || /:\s/.test(source)) {
    return { ok: false, reason: 'flow collections and nested mappings are not supported' }
  }

  if (findYamlReferenceToken(source)) {
    return { ok: false, reason: 'anchors, aliases, and tags are not supported' }
  }

  if (/^true$/i.test(source)) {
    return { ok: true, value: true }
  }

  if (/^false$/i.test(source)) {
    return { ok: true, value: false }
  }

  return { ok: true, value: source }
}

// stripYamlInlineComment 함수는 sequence scalar 검사 전에 안전한 inline comment만 제외한다.
function stripYamlInlineComment(source: string) {
  const commentStart = findInlineCommentStart(source, 0)
  return (commentStart === -1 ? source : source.slice(0, commentStart)).trimEnd()
}

// validateGeneralYamlValue 함수는 다른 workspace 설정의 한 줄짜리 값이 경계를 흐리지 않는지 검사한다.
function validateGeneralYamlValue(source: string) {
  if (!source) {
    return null
  }

  if (source.startsWith("'") || source.startsWith('"')) {
    const parsedQuoted = parseQuotedYamlString(source)
    return parsedQuoted.ok ? null : parsedQuoted.reason
  }

  if (/^[|>]/.test(source)) {
    return 'block scalar values are outside the safely editable YAML subset'
  }

  if (source.startsWith('{')) {
    return 'flow mappings are outside the safely editable YAML subset'
  }

  if (source.startsWith('[')) {
    if (source.includes('{')) {
      return 'nested flow mappings are outside the safely editable YAML subset'
    }

    try {
      JSON.parse(source)
      return null
    } catch {
      return 'flow sequence is not a supported single-line JSON-style sequence'
    }
  }

  if (/[\[\]{}]/.test(source)) {
    return 'flow collection delimiters are not balanced on one supported line'
  }

  if (/^[%@`]/.test(source) || /:\s/.test(source)) {
    return 'plain scalar uses unsupported or ambiguous YAML syntax'
  }

  return null
}

// registerYamlMappingKey 함수는 같은 block mapping 문맥의 중복 key를 검출한다.
function registerYamlMappingKey(
  keysByContext: Map<number, Map<string, number>>,
  contextId: number,
  key: string,
  lineIndex: number,
) {
  const keys = keysByContext.get(contextId) ?? new Map<string, number>()
  const previousLine = keys.get(key)

  if (typeof previousLine === 'number') {
    return `duplicate key "${key}" also appears on line ${previousLine + 1}`
  }

  keys.set(key, lineIndex)
  keysByContext.set(contextId, keys)
  return null
}

// validateYamlBlockStructure 함수는 전체 문서의 block 구조와 중복 key를 보수적으로 검사한다.
function validateYamlBlockStructure(lines: YamlLine[]) {
  const keysByContext = new Map<number, Map<string, number>>()
  const contexts: Array<{ indent: number; id: number }> = []
  let nextContextId = 1
  let previousContent: { indent: number; allowsChildren: boolean; lineIndex: number } | null = null

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const text = getYamlLineText(lines[lineIndex], lineIndex)

    if (isYamlTrivia(text)) {
      continue
    }

    const indentSource = text.match(/^[ \t]*/)?.[0] ?? ''

    if (indentSource.includes('\t')) {
      return formatYamlBlocker(formatLineReason(lineIndex, 'tab indentation is not supported'))
    }

    const indent = indentSource.length
    const content = text.slice(indent)
    const referenceToken = findYamlReferenceToken(text)

    if (referenceToken) {
      return formatYamlBlocker(
        formatLineReason(lineIndex, `YAML ${referenceToken}s are not supported safely`),
      )
    }

    if (indent === 0 && (content === '---' || content === '...' || content.startsWith('%'))) {
      return formatYamlBlocker(
        formatLineReason(lineIndex, 'YAML directives and multi-document markers are not supported'),
      )
    }

    if (previousContent && indent > previousContent.indent && !previousContent.allowsChildren) {
      return formatYamlBlocker(
        formatLineReason(
          lineIndex,
          `nested content follows a scalar on line ${previousContent.lineIndex + 1}`,
        ),
      )
    }

    while (contexts.at(-1) && contexts.at(-1)!.indent >= indent) {
      contexts.pop()
    }

    const parentContextId = contexts.at(-1)?.id ?? 0
    let allowsChildren = false

    if (indent > 0 && (content === '-' || content.startsWith('- '))) {
      const itemContextId = nextContextId
      nextContextId += 1
      const rawItemSource = content === '-' ? '' : content.slice(2)
      const itemSource = stripYamlInlineComment(rawItemSource)

      if (!rawItemSource) {
        allowsChildren = true
        contexts.push({ indent, id: itemContextId })
      } else if (!itemSource) {
        allowsChildren = false
      } else {
        const inlineMapping = parseMappingLine(itemSource)

        if (inlineMapping.ok) {
          const duplicateReason = registerYamlMappingKey(
            keysByContext,
            itemContextId,
            inlineMapping.value.key,
            lineIndex,
          )

          if (duplicateReason) {
            return formatYamlBlocker(formatLineReason(lineIndex, duplicateReason))
          }

          const valueReason = validateGeneralYamlValue(inlineMapping.value.valueSource)

          if (valueReason) {
            return formatYamlBlocker(formatLineReason(lineIndex, valueReason))
          }

          allowsChildren = inlineMapping.value.valueSource === ''

          if (allowsChildren) {
            contexts.push({ indent, id: itemContextId })
          }
        } else {
          const valueReason = validateGeneralYamlValue(itemSource)

          if (valueReason) {
            return formatYamlBlocker(formatLineReason(lineIndex, valueReason))
          }
        }
      }
    } else {
      const mapping = parseMappingLine(text)

      if (!mapping.ok) {
        return formatYamlBlocker(formatLineReason(lineIndex, mapping.reason))
      }

      const duplicateReason = registerYamlMappingKey(
        keysByContext,
        parentContextId,
        mapping.value.key,
        lineIndex,
      )

      if (duplicateReason) {
        return formatYamlBlocker(formatLineReason(lineIndex, duplicateReason))
      }

      const valueReason = validateGeneralYamlValue(mapping.value.valueSource)

      if (valueReason) {
        return formatYamlBlocker(formatLineReason(lineIndex, valueReason))
      }

      allowsChildren = mapping.value.valueSource === ''

      if (allowsChildren) {
        contexts.push({ indent, id: nextContextId })
        nextContextId += 1
      }
    }

    previousContent = { indent, allowsChildren, lineIndex }
  }

  return null
}

// inspectPnpmWorkspaceYaml 함수는 원문을 보존하며 편집 가능한 YAML 부분집합인지 검사한다.
function inspectPnpmWorkspaceYaml(source: string): YamlInspection {
  const lines = splitYamlLines(source)
  const structureBlocker = validateYamlBlockStructure(lines)

  if (structureBlocker) {
    return { safe: false, blocker: structureBlocker }
  }

  const topLevelEntries: Array<{ key: string; lineIndex: number; mapping: ParsedMappingLine }> = []
  const topLevelKeys = new Map<string, number>()
  let sawTopLevelEntry = false

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const text = getYamlLineText(lines[lineIndex], lineIndex)

    if (isYamlTrivia(text)) {
      continue
    }

    const indent = text.match(/^[ \t]*/)?.[0] ?? ''

    if (indent.includes('\t')) {
      return {
        safe: false,
        blocker: formatYamlBlocker(formatLineReason(lineIndex, 'tab indentation is not supported')),
      }
    }

    const referenceToken = findYamlReferenceToken(text)

    if (referenceToken) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatLineReason(lineIndex, `YAML ${referenceToken}s are not supported safely`),
        ),
      }
    }

    if (indent.length > 0) {
      if (!sawTopLevelEntry) {
        return {
          safe: false,
          blocker: formatYamlBlocker(
            formatLineReason(lineIndex, 'the document root is not a top-level block mapping'),
          ),
        }
      }

      continue
    }

    if (text === '---' || text === '...' || text.startsWith('%')) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatLineReason(
            lineIndex,
            'YAML directives and multi-document markers are not supported',
          ),
        ),
      }
    }

    const parsedMapping = parseMappingLine(text)

    if (!parsedMapping.ok) {
      return {
        safe: false,
        blocker: formatYamlBlocker(formatLineReason(lineIndex, parsedMapping.reason)),
      }
    }

    const previousLine = topLevelKeys.get(parsedMapping.value.key)

    if (typeof previousLine === 'number') {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatLineReason(
            lineIndex,
            `duplicate top-level key "${parsedMapping.value.key}" also appears on line ${previousLine + 1}`,
          ),
        ),
      }
    }

    topLevelKeys.set(parsedMapping.value.key, lineIndex)
    topLevelEntries.push({
      key: parsedMapping.value.key,
      lineIndex,
      mapping: parsedMapping.value,
    })
    sawTopLevelEntry = true
  }

  const allowBuildsTopLevel = topLevelEntries.find((entry) => entry.key === 'allowBuilds')

  if (!allowBuildsTopLevel) {
    return {
      safe: true,
      lines,
      eol: findPreferredEol(lines),
      section: null,
      entries: new Map(),
    }
  }

  if (allowBuildsTopLevel.mapping.valueSource) {
    return {
      safe: false,
      blocker: formatYamlBlocker(
        formatLineReason(
          allowBuildsTopLevel.lineIndex,
          'allowBuilds must be a block mapping; inline/flow, alias, anchor, and scalar forms are unsupported',
        ),
      ),
    }
  }

  const followingTopLevel = topLevelEntries.find(
    (entry) => entry.lineIndex > allowBuildsTopLevel.lineIndex,
  )
  const end = followingTopLevel?.lineIndex ?? lines.length
  const entries = new Map<string, AllowBuildsEntry>()
  let entryIndent = ''

  for (let lineIndex = allowBuildsTopLevel.lineIndex + 1; lineIndex < end; lineIndex += 1) {
    const text = getYamlLineText(lines[lineIndex], lineIndex)

    if (isYamlTrivia(text)) {
      continue
    }

    const parsedMapping = parseMappingLine(text)

    if (!parsedMapping.ok) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatLineReason(lineIndex, `allowBuilds entry ${parsedMapping.reason}`),
        ),
      }
    }

    if (!parsedMapping.value.indent) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatLineReason(lineIndex, 'allowBuilds contains an unindented complex entry'),
        ),
      }
    }

    if (!entryIndent) {
      entryIndent = parsedMapping.value.indent
    } else if (parsedMapping.value.indent !== entryIndent) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatLineReason(
            lineIndex,
            'allowBuilds entries do not use one consistent indentation level',
          ),
        ),
      }
    }

    const parsedScalar = parseAllowBuildsScalar(parsedMapping.value.valueSource)

    if (!parsedScalar.ok) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatLineReason(
            lineIndex,
            `allowBuilds.${parsedMapping.value.key} ${parsedScalar.reason}`,
          ),
        ),
      }
    }

    const previousEntry = entries.get(parsedMapping.value.key)

    if (previousEntry) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatLineReason(
            lineIndex,
            `duplicate allowBuilds key "${parsedMapping.value.key}" also appears on line ${previousEntry.lineIndex + 1}`,
          ),
        ),
      }
    }

    entries.set(parsedMapping.value.key, {
      key: parsedMapping.value.key,
      value: parsedScalar.value,
      valueSource: parsedMapping.value.valueSource,
      valueStart: parsedMapping.value.valueStart,
      valueEnd: parsedMapping.value.valueEnd,
      lineIndex,
    })
  }

  if (!entryIndent) {
    const indentedComment = lines
      .slice(allowBuildsTopLevel.lineIndex + 1, end)
      .map((line) => line.text.match(/^( +)#/)?.[1])
      .find(Boolean)
    entryIndent = indentedComment || '  '
  }

  return {
    safe: true,
    lines,
    eol: findPreferredEol(lines),
    section: {
      start: allowBuildsTopLevel.lineIndex,
      end,
      indent: entryIndent,
    },
    entries,
  }
}

// formatYamlScalar 함수는 복구할 값을 의미가 유지되는 한 줄짜리 YAML scalar로 만든다.
function formatYamlScalar(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (typeof value === 'string') {
    if (
      value.trim() === value &&
      value !== '' &&
      !/^[\-?:,\[\]{}#&*!|>'"%@`]/.test(value) &&
      !/[\[\]{}\r\n]/.test(value) &&
      !/:\s|\s#/.test(value) &&
      !findYamlReferenceToken(value)
    ) {
      return value
    }

    return JSON.stringify(value)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (value === null) {
    return 'null'
  }

  return null
}

// resolveYamlScalarSource 함수는 검증된 원래 scalar 표기를 우선 사용한다.
function resolveYamlScalarSource(writeValue: AllowBuildsWriteValue) {
  if (writeValue.preferredSource) {
    const parsedPreferred = parseAllowBuildsScalar(writeValue.preferredSource)

    if (parsedPreferred.ok && valuesEqual(parsedPreferred.value, writeValue.value)) {
      return writeValue.preferredSource
    }
  }

  return formatYamlScalar(writeValue.value)
}

// appendAllowBuildsSection 함수는 안전한 문서 끝에 기본 block mapping을 추가한다.
function appendAllowBuildsSection(
  source: string,
  lines: YamlLine[],
  eol: string,
  values: Map<string, AllowBuildsWriteValue>,
) {
  const body = [...values]
    .map(([key, writeValue]) => {
      const scalarSource = resolveYamlScalarSource(writeValue)
      return scalarSource ? `  ${key}: ${scalarSource}` : null
    })
    .filter((line): line is string => Boolean(line))
  let prefix = source

  if (prefix) {
    const lastLine = lines.at(-1)

    if (lastLine?.ending === '') {
      prefix += eol
    }

    if (lastLine && lastLine.text.trim() !== '') {
      prefix += eol
    }
  }

  return `${prefix}allowBuilds:${eol}${body.map((line) => `${line}${eol}`).join('')}`
}

// insertYamlLines 함수는 기존 EOF 줄바꿈 유무를 유지하며 새 매핑 줄을 삽입한다.
function insertYamlLines(
  lines: YamlLine[],
  index: number,
  texts: string[],
  eol: string,
  hadFinalEol: boolean,
) {
  if (texts.length === 0) {
    return
  }

  if (index < lines.length) {
    lines.splice(index, 0, ...texts.map((text) => ({ text, ending: eol })))
    return
  }

  if (lines.at(-1)?.ending === '') {
    lines[lines.length - 1].ending = eol
  }

  lines.push(
    ...texts.map((text, textIndex) => ({
      text,
      ending: textIndex === texts.length - 1 && !hadFinalEol ? '' : eol,
    })),
  )
}

// setAllowBuildsValues 함수는 검사된 block mapping의 값 토큰만 바꾸거나 항목을 추가한다.
function setAllowBuildsValues(
  source: string,
  values: Map<string, AllowBuildsWriteValue>,
  inspection = inspectPnpmWorkspaceYaml(source),
) {
  if (!inspection.safe) {
    return { source, blocker: inspection.blocker }
  }

  if (!inspection.section) {
    const unsupportedValue = [...values.values()].find(
      (writeValue) => resolveYamlScalarSource(writeValue) === null,
    )

    return unsupportedValue
      ? {
          source,
          blocker: formatYamlBlocker('a requested allowBuilds value cannot be represented safely'),
        }
      : {
          source: appendAllowBuildsSection(source, inspection.lines, inspection.eol, values),
        }
  }

  const nextLines = inspection.lines.map((line) => ({ ...line }))
  const missing: string[] = []

  for (const [key, writeValue] of values) {
    const scalarSource = resolveYamlScalarSource(writeValue)

    if (scalarSource === null) {
      return {
        source,
        blocker: formatYamlBlocker(`allowBuilds.${key} cannot be represented as a safe scalar`),
      }
    }

    const entry = inspection.entries.get(key)

    if (!entry) {
      missing.push(`${inspection.section.indent}${key}: ${scalarSource}`)
      continue
    }

    if (valuesEqual(entry.value, writeValue.value)) {
      continue
    }

    const line = nextLines[entry.lineIndex]
    line.text = `${line.text.slice(0, entry.valueStart)}${scalarSource}${line.text.slice(entry.valueEnd)}`
  }

  const insertionIndex =
    inspection.entries.size > 0
      ? Math.max(...[...inspection.entries.values()].map((entry) => entry.lineIndex)) + 1
      : inspection.section.end

  insertYamlLines(
    nextLines,
    insertionIndex,
    missing,
    inspection.eol,
    /(?:\r\n|\n|\r)$/.test(source),
  )

  return { source: joinYamlLines(nextLines) }
}

// removeAllowBuildsKey 함수는 안전한 block mapping에서 해당 key 한 줄만 제거한다.
function removeAllowBuildsKey(
  source: string,
  key: string,
  createdSection?: CreatedSectionMetadata,
) {
  const inspection = inspectPnpmWorkspaceYaml(source)

  if (!inspection.safe || !inspection.section) {
    return source
  }

  const entry = inspection.entries.get(key)

  if (!entry) {
    return source
  }

  const lines = inspection.lines.map((line) => ({ ...line }))
  const sectionHasTrivia = inspection.lines
    .slice(inspection.section.start + 1, inspection.section.end)
    .some((line, index) =>
      isYamlTrivia(getYamlLineText(line, inspection.section!.start + 1 + index)),
    )
  lines.splice(entry.lineIndex, 1)

  if (inspection.entries.size === 1) {
    lines.splice(inspection.section.start, 1)

    if (createdSection && !sectionHasTrivia) {
      const separatorIndex = inspection.section.start - 1

      if (createdSection.separatorLineAdded && lines[separatorIndex]?.text.trim() === '') {
        lines.splice(separatorIndex, 1)
      }

      if (!createdSection.previousHadFinalEol && lines.length > 0) {
        lines[lines.length - 1].ending = ''
      }
    }
  }

  return joinYamlLines(lines)
}

// parseAllowBuildsClaimPath 함수는 allowBuilds claim의 package key를 손실 없이 분리한다.
function parseAllowBuildsClaimPath(path: string) {
  const prefix = 'allowBuilds.'
  return path.startsWith(prefix) && path.length > prefix.length ? path.slice(prefix.length) : null
}

// getPreservedScalarSource 함수는 init 당시 기록한 원래 scalar 표기를 안전하게 꺼낸다.
function getPreservedScalarSource(claim: PackageJsonOwnershipClaim) {
  if (claim.previous.state !== 'value') {
    return undefined
  }

  const previous = claim.previous as PackageJsonOwnershipClaim['previous'] & {
    [PRESERVED_SCALAR_FIELD]?: unknown
  }

  return typeof previous[PRESERVED_SCALAR_FIELD] === 'string'
    ? previous[PRESERVED_SCALAR_FIELD]
    : undefined
}

// createCreatedSectionMetadata 함수는 새 섹션 앞에 추가한 구분 줄과 기존 EOF 상태를 기록한다.
function createCreatedSectionMetadata(source: string, lines: YamlLine[]): CreatedSectionMetadata {
  return {
    separatorLineAdded: Boolean(source && lines.at(-1)?.text.trim() !== ''),
    previousHadFinalEol: /(?:\r\n|\n|\r)$/.test(source),
  }
}

// getCreatedSectionMetadata 함수는 manifest claim의 새 섹션 복구 메타데이터를 검증해 읽는다.
function getCreatedSectionMetadata(claim: PackageJsonOwnershipClaim) {
  const previous = claim.previous as PackageJsonOwnershipClaim['previous'] & {
    [CREATED_SECTION_FIELD]?: unknown
  }
  const metadata = previous[CREATED_SECTION_FIELD]

  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined
  }

  const candidate = metadata as Partial<CreatedSectionMetadata>

  return typeof candidate.separatorLineAdded === 'boolean' &&
    typeof candidate.previousHadFinalEol === 'boolean'
    ? {
        separatorLineAdded: candidate.separatorLineAdded,
        previousHadFinalEol: candidate.previousHadFinalEol,
      }
    : undefined
}

// readPnpmWorkspaceYamlClaimValue 함수는 안전하지 않은 YAML에서 예외 대신 blocker 정보를 반환한다.
export function readPnpmWorkspaceYamlClaimValue(
  source: string,
  path: string,
): PnpmWorkspaceYamlClaimReadResult {
  const key = parseAllowBuildsClaimPath(path)

  if (!key) {
    return { exists: false, value: undefined, safeToEdit: true }
  }

  const inspection = inspectPnpmWorkspaceYaml(source)

  if (!inspection.safe) {
    return {
      exists: false,
      value: undefined,
      safeToEdit: false,
      blocker: inspection.blocker,
    }
  }

  const entry = inspection.entries.get(key)

  return entry
    ? { exists: true, value: entry.value, safeToEdit: true }
    : { exists: false, value: undefined, safeToEdit: true }
}

// restorePnpmWorkspaceYamlClaim 함수는 안전하지 않은 YAML을 절대 수정하지 않고 원문 그대로 반환한다.
export function restorePnpmWorkspaceYamlClaim(source: string, claim: PackageJsonOwnershipClaim) {
  const key = parseAllowBuildsClaimPath(claim.path)

  if (!key) {
    return source
  }

  const inspection = inspectPnpmWorkspaceYaml(source)

  if (!inspection.safe) {
    return source
  }

  if (claim.previous.state === 'missing') {
    return removeAllowBuildsKey(source, key, getCreatedSectionMetadata(claim))
  }

  return setAllowBuildsValues(
    source,
    new Map([
      [
        key,
        {
          value: claim.previous.value,
          preferredSource: getPreservedScalarSource(claim),
        },
      ],
    ]),
    inspection,
  ).source
}

// previewPnpmWorkspaceYamlPatch 함수는 pnpm workspace의 안전한 allowBuilds 변경만 미리 계산한다.
export function previewPnpmWorkspaceYamlPatch(cwd: string, packageManager: string) {
  if (packageManager !== 'pnpm') {
    return null
  }

  const path = findPnpmWorkspaceYamlPath(cwd)
  const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const inspection = inspectPnpmWorkspaceYaml(source)

  if (!inspection.safe) {
    return {
      path,
      source,
      nextSource: source,
      changes: [],
      ownershipClaims: [],
      warnings: [],
      blockers: [inspection.blocker],
    } satisfies PnpmWorkspaceYamlPatchPlan
  }

  const desiredValues = new Map<string, AllowBuildsWriteValue>(
    REQUIRED_ALLOW_BUILDS.map((key) => [key, { value: true }]),
  )
  const edit = setAllowBuildsValues(source, desiredValues, inspection)

  if (edit.blocker) {
    return {
      path,
      source,
      nextSource: source,
      changes: [],
      ownershipClaims: [],
      warnings: [],
      blockers: [edit.blocker],
    } satisfies PnpmWorkspaceYamlPatchPlan
  }

  const changes: PnpmWorkspaceYamlPatchChange[] = []
  const ownershipClaims: PackageJsonOwnershipClaim[] = []
  const createdSectionMetadata = inspection.section
    ? undefined
    : createCreatedSectionMetadata(source, inspection.lines)

  for (const key of REQUIRED_ALLOW_BUILDS) {
    const claimPath = `allowBuilds.${key}`
    const currentEntry = inspection.entries.get(key)

    if (currentEntry && valuesEqual(currentEntry.value, true)) {
      continue
    }

    changes.push({
      action: 'set',
      path: claimPath,
      value: true,
    })

    const previous = currentEntry
      ? {
          state: 'value' as const,
          value: cloneJsonValue(currentEntry.value),
          [PRESERVED_SCALAR_FIELD]: currentEntry.valueSource,
        }
      : {
          state: 'missing' as const,
          ...(createdSectionMetadata
            ? { [CREATED_SECTION_FIELD]: createdSectionMetadata }
            : undefined),
        }

    ownershipClaims.push({
      path: claimPath,
      action: 'set',
      value: true,
      previous,
    })
  }

  return {
    path,
    source,
    nextSource: edit.source,
    changes,
    ownershipClaims,
    warnings: [],
    blockers: [],
  } satisfies PnpmWorkspaceYamlPatchPlan
}
