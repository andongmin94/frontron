import { lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { Document, isMap, isScalar, type Scalar } from 'yaml'

import { formatProjectPathBlocker, inspectProjectPath, isInsideDirectory } from '../project-paths'
import type { PackageJsonOwnershipClaim } from './manifest'
import { cloneJsonValue, valuesEqual } from './package-json-path'
import {
  applyYamlTextEdits,
  findPreferredEol,
  findYamlPairsByKey,
  getLastYamlLineText,
  getPreviousYamlLineRange,
  getYamlDocumentAppendOffset,
  getYamlLineNumber,
  getYamlLineRange,
  getYamlNodeSource,
  getYamlPairLineEnd,
  getYamlReferenceKind,
  hasFinalEol,
  isEmptyYamlPairValue,
  parseSimpleYamlScalar,
  parseYamlSource,
  type ParsedYamlDocument,
  type ParsedYamlMap,
  type ParsedYamlPair,
  removeFinalEol,
  type YamlReferenceKind,
  type YamlTextEdit,
} from './yaml-source'

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
  created: boolean
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

type AllowBuildsSection = {
  pair: ParsedYamlPair
  map: ParsedYamlMap | null
  start: number
  end: number
  indent: string
  totalEntries: number
}

type AllowBuildsEntry = {
  pair: ParsedYamlPair
  scalar: Scalar
  value: unknown
  valueSource: string
}

type EditableYamlInspection = {
  safe: true
  document: ParsedYamlDocument
  eol: string
  section: AllowBuildsSection | null
  entries: Map<string, AllowBuildsEntry>
}

type YamlInspection =
  | EditableYamlInspection
  | {
      safe: false
      blocker: string
    }

type AllowBuildsEntriesInspection =
  | {
      safe: true
      entries: Map<string, AllowBuildsEntry>
    }
  | {
      safe: false
      blocker: string
    }

type AllowBuildsWriteValue = {
  value: unknown
  preferredSource?: string
}

type CreatedSectionMetadata = {
  separatorLineAdded: boolean
  previousHadFinalEol: boolean
}

// pathEntryExists 함수는 깨진 symbolic link도 기존 workspace 경로로 취급한다.
function pathEntryExists(filePath: string) {
  try {
    lstatSync(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

// findPnpmWorkspaceYamlPath 함수는 현재 패키지에서 상위 workspace 루트까지 가장 가까운 설정을 찾는다.
export function findPnpmWorkspaceYamlPath(cwd: string) {
  let currentDir = resolve(cwd)

  while (true) {
    const candidate = join(currentDir, PNPM_WORKSPACE_YAML_PATH)

    if (pathEntryExists(candidate)) return candidate

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return join(resolve(cwd), PNPM_WORKSPACE_YAML_PATH)
}

// formatYamlBlocker 함수는 모든 pnpm YAML blocker에 원문 보존 사실을 명시한다.
function formatYamlBlocker(reason: string) {
  return `Cannot safely edit ${PNPM_WORKSPACE_YAML_PATH}: ${reason}. The file was left unchanged.`
}

// formatSourceReason 함수는 yaml range offset을 사용자가 찾을 수 있는 줄 번호로 바꾼다.
function formatSourceReason(source: string, offset: number, reason: string) {
  return `${reason} (line ${getYamlLineNumber(source, offset)})`
}

// formatReferenceReason 함수는 대상 노드에 붙은 참조 문법을 blocker 문구로 만든다.
function formatReferenceReason(reference: YamlReferenceKind) {
  return `YAML ${reference === 'alias' ? 'aliases' : `${reference}s`} are not supported safely`
}

// isImplicitEmptyDocument 함수는 실제 value CST가 없는 빈 YAML 문서만 새 root mapping으로 취급한다.
function isImplicitEmptyDocument(document: ParsedYamlDocument) {
  const contents = document.contents
  return (
    contents === null ||
    (isScalar(contents) && contents.value === null && typeof contents.srcToken === 'undefined')
  )
}

// isJsonScalar 함수는 manifest claim에 손실 없이 저장 가능한 YAML scalar 값인지 확인한다.
function isJsonScalar(value: unknown) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

// inferEmptySectionIndent 함수는 빈 allowBuilds의 기존 주석 들여쓰기를 우선 재사용한다.
function inferEmptySectionIndent(
  source: string,
  pair: ParsedYamlPair,
  sectionStart: number,
  sectionEnd: number,
) {
  const header = getYamlLineRange(source, sectionStart)
  const commentIndent = source.slice(header.end, sectionEnd).match(/(?:^|\r\n|\n|\r)( +)#/)?.[1]

  if (commentIndent) return commentIndent

  const keyOffset = pair.key.range?.[0] ?? sectionStart
  const keyIndent = source.slice(sectionStart, keyOffset).match(/^ */)?.[0] ?? ''
  return `${keyIndent}  `
}

// inspectAllowBuildsEntries 함수는 요청된 child key의 중복·참조·scalar range만 따로 검사한다.
function inspectAllowBuildsEntries(
  source: string,
  document: ParsedYamlDocument,
  sectionMap: ParsedYamlMap,
  targetKeys: readonly string[],
  sectionKeyOffset: number,
): AllowBuildsEntriesInspection {
  const entries = new Map<string, AllowBuildsEntry>()

  for (const key of new Set(targetKeys)) {
    const matches = findYamlPairsByKey(document, sectionMap, key)

    if (matches.length > 1) {
      const offset = matches[1].pair.key.range?.[0] ?? sectionKeyOffset
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatSourceReason(source, offset, `duplicate allowBuilds key "${key}"`),
        ),
      }
    }

    const match = matches[0]
    if (!match) continue

    const keyOffset = match.pair.key.range?.[0] ?? sectionKeyOffset

    if (match.keyReference) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatSourceReason(source, keyOffset, formatReferenceReason(match.keyReference)),
        ),
      }
    }

    const value = match.pair.value
    const valueOffset = value?.range?.[0] ?? keyOffset
    const reference = getYamlReferenceKind(value)

    if (reference) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatSourceReason(source, valueOffset, formatReferenceReason(reference)),
        ),
      }
    }

    const valueSource = value ? getYamlNodeSource(source, value) : null
    const parsedScalar = valueSource === null ? null : parseSimpleYamlScalar(valueSource)

    if (
      isEmptyYamlPairValue(match.pair) ||
      !isScalar(value) ||
      !value.range ||
      !parsedScalar?.ok ||
      !isJsonScalar(value.value)
    ) {
      return {
        safe: false,
        blocker: formatYamlBlocker(
          formatSourceReason(
            source,
            valueOffset,
            `allowBuilds.${key} must be one unreferenced, single-line scalar`,
          ),
        ),
      }
    }

    entries.set(key, {
      pair: match.pair,
      scalar: value,
      value: value.value,
      valueSource: valueSource!,
    })
  }

  return { safe: true, entries }
}

// inspectPnpmWorkspaceYaml 함수는 allowBuilds와 요청된 child key의 CST/range만 국소 검사한다.
function inspectPnpmWorkspaceYaml(
  source: string,
  targetKeys: readonly string[] = REQUIRED_ALLOW_BUILDS,
): YamlInspection {
  const parsed = parseYamlSource(source)

  if (!parsed.ok) return { safe: false, blocker: formatYamlBlocker(parsed.reason) }

  const document = parsed.value
  const emptyInspection = {
    safe: true as const,
    document,
    eol: findPreferredEol(source),
    section: null,
    entries: new Map<string, AllowBuildsEntry>(),
  }

  if (isImplicitEmptyDocument(document)) return emptyInspection

  if (!isMap(document.contents) || document.contents.srcToken?.type !== 'block-map') {
    return {
      safe: false,
      blocker: formatYamlBlocker('the document root is not a top-level block mapping'),
    }
  }

  const root = document.contents as ParsedYamlMap
  const sectionMatches = findYamlPairsByKey(document, root, 'allowBuilds')

  if (sectionMatches.length > 1) {
    const offset = sectionMatches[1].pair.key.range?.[0] ?? 0
    return {
      safe: false,
      blocker: formatYamlBlocker(
        formatSourceReason(source, offset, 'duplicate top-level key "allowBuilds"'),
      ),
    }
  }

  const sectionMatch = sectionMatches[0]
  if (!sectionMatch) return emptyInspection

  const sectionPair = sectionMatch.pair
  const sectionKeyOffset = sectionPair.key.range?.[0] ?? 0

  if (sectionMatch.keyReference) {
    return {
      safe: false,
      blocker: formatYamlBlocker(
        formatSourceReason(
          source,
          sectionKeyOffset,
          formatReferenceReason(sectionMatch.keyReference),
        ),
      ),
    }
  }

  const emptySection = isEmptyYamlPairValue(sectionPair)
  const sectionValue = sectionPair.value
  const sectionReference = emptySection ? null : getYamlReferenceKind(sectionValue)

  if (sectionReference) {
    return {
      safe: false,
      blocker: formatYamlBlocker(
        formatSourceReason(
          source,
          sectionValue?.range?.[0] ?? sectionKeyOffset,
          formatReferenceReason(sectionReference),
        ),
      ),
    }
  }

  if (!emptySection && (!isMap(sectionValue) || sectionValue.srcToken?.type !== 'block-map')) {
    return {
      safe: false,
      blocker: formatYamlBlocker(
        formatSourceReason(
          source,
          sectionValue?.range?.[0] ?? sectionKeyOffset,
          'allowBuilds must be a block mapping; inline/flow, alias, anchor, and scalar forms are unsupported',
        ),
      ),
    }
  }

  const sectionMap = emptySection ? null : (sectionValue as ParsedYamlMap)
  const sectionIndex = (root.items as ParsedYamlPair[]).indexOf(sectionPair)
  const nextPair = (root.items as ParsedYamlPair[])[sectionIndex + 1]
  const sectionStart = getYamlLineRange(source, sectionKeyOffset).start
  const sectionEnd = nextPair?.key.range
    ? getYamlLineRange(source, nextPair.key.range[0]).start
    : getYamlDocumentAppendOffset(document, source)
  const indent = sectionMap
    ? ' '.repeat(sectionMap.srcToken?.type === 'block-map' ? sectionMap.srcToken.indent : 2)
    : inferEmptySectionIndent(source, sectionPair, sectionStart, sectionEnd)
  const section: AllowBuildsSection = {
    pair: sectionPair,
    map: sectionMap,
    start: sectionStart,
    end: sectionEnd,
    indent,
    totalEntries: sectionMap?.items.length ?? 0,
  }
  if (!sectionMap) {
    return {
      safe: true,
      document,
      eol: findPreferredEol(source),
      section,
      entries: new Map(),
    }
  }

  const entryInspection = inspectAllowBuildsEntries(
    source,
    document,
    sectionMap,
    targetKeys,
    sectionKeyOffset,
  )

  if (!entryInspection.safe) return entryInspection

  return {
    safe: true,
    document,
    eol: findPreferredEol(source),
    section,
    entries: entryInspection.entries,
  }
}

// parseAllowBuildsScalarSource 함수는 복원용 scalar가 JSON claim 값과 비교 가능한지 확인한다.
function parseAllowBuildsScalarSource(source: string) {
  const parsed = parseSimpleYamlScalar(source)
  return parsed.ok && isJsonScalar(parsed.value.value)
    ? { ok: true as const, value: parsed.value.value }
    : { ok: false as const }
}

// formatYamlScalar 함수는 yaml Document로 값을 만든 뒤 한 줄 scalar인지 다시 검증한다.
function formatYamlScalar(value: unknown) {
  if (!isJsonScalar(value)) return null

  let source = new Document(value).toString().trimEnd()

  if (!parseAllowBuildsScalarSource(source).ok && typeof value === 'string') {
    source = JSON.stringify(value)
  }

  const parsed = parseAllowBuildsScalarSource(source)
  return parsed.ok && valuesEqual(parsed.value, value) ? source : null
}

// resolveYamlScalarSource 함수는 검증된 원래 scalar 철자를 우선 사용해 claim 복원을 정확히 한다.
function resolveYamlScalarSource(writeValue: AllowBuildsWriteValue) {
  if (writeValue.preferredSource) {
    const parsed = parseAllowBuildsScalarSource(writeValue.preferredSource)

    if (parsed.ok && valuesEqual(parsed.value, writeValue.value)) {
      return writeValue.preferredSource
    }
  }

  return formatYamlScalar(writeValue.value)
}

// sectionNeedsSeparator 함수는 새 allowBuilds 앞에 추가할 구분 빈 줄이 실제로 필요한지 계산한다.
function sectionNeedsSeparator(source: string, document: ParsedYamlDocument) {
  const offset = getYamlDocumentAppendOffset(document, source)
  const prefix = source.slice(0, offset)
  return Boolean(prefix && getLastYamlLineText(prefix).trim() !== '')
}

// appendAllowBuildsSection 함수는 문서 끝 marker 앞에 새 block mapping만 삽입한다.
function appendAllowBuildsSection(
  source: string,
  inspection: EditableYamlInspection,
  values: Map<string, AllowBuildsWriteValue>,
) {
  const body = [...values].map(([key, writeValue]) => {
    const scalarSource = resolveYamlScalarSource(writeValue)
    return scalarSource === null ? null : `  ${key}: ${scalarSource}`
  })

  if (body.some((line) => line === null)) return null

  const offset = getYamlDocumentAppendOffset(inspection.document, source)
  const prefix = source.slice(0, offset)
  const suffix = source.slice(offset)
  const leadingEol = prefix && !hasFinalEol(prefix) ? inspection.eol : ''
  const separator = sectionNeedsSeparator(source, inspection.document) ? inspection.eol : ''
  const section = `allowBuilds:${inspection.eol}${body
    .map((line) => `${line}${inspection.eol}`)
    .join('')}`

  return `${prefix}${leadingEol}${separator}${section}${suffix}`
}

// createLineInsertion 함수는 기존 section에 새 pair 줄을 넣되 EOF 줄바꿈 상태를 유지한다.
function createLineInsertion(source: string, offset: number, lines: string[], eol: string) {
  if (lines.length === 0) return ''

  const previous = source[offset - 1]
  const leading = offset > 0 && previous !== '\n' && previous !== '\r' ? eol : ''
  const trailing = offset < source.length || hasFinalEol(source) ? eol : ''
  return `${leading}${lines.join(eol)}${trailing}`
}

// setAllowBuildsValues 함수는 scalar range 치환과 새 pair 삽입만 수행해 나머지 원문을 보존한다.
function setAllowBuildsValues(
  source: string,
  values: Map<string, AllowBuildsWriteValue>,
  inspection = inspectPnpmWorkspaceYaml(source, [...values.keys()]),
) {
  if (!inspection.safe) return { source, blocker: inspection.blocker }

  if (!inspection.section) {
    const nextSource = appendAllowBuildsSection(source, inspection, values)
    return nextSource === null
      ? {
          source,
          blocker: formatYamlBlocker('a requested allowBuilds value cannot be represented safely'),
        }
      : { source: nextSource }
  }

  const edits: YamlTextEdit[] = []
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
    } else if (!valuesEqual(entry.value, writeValue.value) && entry.scalar.range) {
      edits.push({
        start: entry.scalar.range[0],
        end: entry.scalar.range[1],
        text: scalarSource,
      })
    }
  }

  if (missing.length > 0) {
    const lastPair = inspection.section.map?.items.at(-1) as ParsedYamlPair | undefined
    const insertionOffset = lastPair
      ? Math.min(getYamlPairLineEnd(source, lastPair), inspection.section.end)
      : inspection.section.end

    edits.push({
      start: insertionOffset,
      end: insertionOffset,
      text: createLineInsertion(source, insertionOffset, missing, inspection.eol),
    })
  }

  return { source: applyYamlTextEdits(source, edits) }
}

// sectionHasTrivia 함수는 생성 section 안에 사용자가 남긴 빈 줄이나 주석이 있는지 확인한다.
function sectionHasTrivia(
  source: string,
  section: AllowBuildsSection,
  entryLine: ReturnType<typeof getYamlLineRange>,
) {
  const header = getYamlLineRange(source, section.start)
  let offset = header.end

  while (offset < section.end) {
    const line = getYamlLineRange(source, offset)
    const end = Math.min(line.end, section.end)

    if (line.start !== entryLine.start) {
      const text = source.slice(line.start, Math.min(line.contentEnd, section.end)).trim()
      if (text === '' || text.startsWith('#')) return true
    }

    if (end <= offset) break
    offset = end
  }

  return false
}

// removeAllowBuildsKey 함수는 claim pair 한 줄과 비게 된 생성 section 범위만 제거한다.
function removeAllowBuildsKey(
  source: string,
  key: string,
  createdSection?: CreatedSectionMetadata,
) {
  const inspection = inspectPnpmWorkspaceYaml(source, [key])
  const entry = inspection.safe ? inspection.entries.get(key) : undefined

  if (!inspection.safe || !inspection.section || !entry || !entry.pair.key.range) return source

  const entryLine = getYamlLineRange(source, entry.pair.key.range[0])

  if (inspection.section.totalEntries > 1) {
    return applyYamlTextEdits(source, [{ start: entryLine.start, end: entryLine.end, text: '' }])
  }

  const headerLine = getYamlLineRange(source, inspection.section.start)
  const hasTrivia = sectionHasTrivia(source, inspection.section, entryLine)
  const edits: YamlTextEdit[] = [
    { start: headerLine.start, end: headerLine.end, text: '' },
    { start: entryLine.start, end: entryLine.end, text: '' },
  ]

  if (createdSection?.separatorLineAdded && !hasTrivia) {
    const separator = getPreviousYamlLineRange(source, headerLine.start)

    if (separator && source.slice(separator.start, separator.contentEnd).trim() === '') {
      edits.push({ start: separator.start, end: separator.end, text: '' })
    }
  }

  let nextSource = applyYamlTextEdits(source, edits)

  if (
    createdSection &&
    !hasTrivia &&
    !createdSection.previousHadFinalEol &&
    inspection.section.end === source.length
  ) {
    nextSource = removeFinalEol(nextSource)
  }

  return nextSource
}

// parseAllowBuildsClaimPath 함수는 allowBuilds claim의 package key를 손실 없이 분리한다.
function parseAllowBuildsClaimPath(path: string) {
  const prefix = 'allowBuilds.'
  return path.startsWith(prefix) && path.length > prefix.length ? path.slice(prefix.length) : null
}

// getPreservedScalarSource 함수는 init 당시 기록한 원래 scalar 표기를 안전하게 꺼낸다.
function getPreservedScalarSource(claim: PackageJsonOwnershipClaim) {
  if (claim.previous.state !== 'value') return undefined

  const previous = claim.previous as PackageJsonOwnershipClaim['previous'] & {
    [PRESERVED_SCALAR_FIELD]?: unknown
  }

  return typeof previous[PRESERVED_SCALAR_FIELD] === 'string'
    ? previous[PRESERVED_SCALAR_FIELD]
    : undefined
}

// createCreatedSectionMetadata 함수는 새 section의 구분 줄과 기존 EOF 상태를 claim에 기록한다.
function createCreatedSectionMetadata(
  source: string,
  document: ParsedYamlDocument,
): CreatedSectionMetadata {
  return {
    separatorLineAdded: sectionNeedsSeparator(source, document),
    previousHadFinalEol: hasFinalEol(source),
  }
}

// getCreatedSectionMetadata 함수는 manifest의 생성 section 복구 메타데이터를 검증한다.
function getCreatedSectionMetadata(claim: PackageJsonOwnershipClaim) {
  const previous = claim.previous as PackageJsonOwnershipClaim['previous'] & {
    [CREATED_SECTION_FIELD]?: unknown
  }
  const metadata = previous[CREATED_SECTION_FIELD]

  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined

  const candidate = metadata as Partial<CreatedSectionMetadata>

  return typeof candidate.separatorLineAdded === 'boolean' &&
    typeof candidate.previousHadFinalEol === 'boolean'
    ? {
        separatorLineAdded: candidate.separatorLineAdded,
        previousHadFinalEol: candidate.previousHadFinalEol,
      }
    : undefined
}

// createBlockedPatchPlan 함수는 원문과 빈 변경 목록을 가진 pnpm blocker 계획을 만든다.
function createBlockedPatchPlan(path: string, source: string, blocker: string) {
  return {
    path,
    source,
    nextSource: source,
    created: false,
    changes: [],
    ownershipClaims: [],
    warnings: [],
    blockers: [blocker],
  } satisfies PnpmWorkspaceYamlPatchPlan
}

// readPnpmWorkspaceYamlClaimValue 함수는 요청된 claim key만 검사해 doctor와 clean에 반환한다.
export function readPnpmWorkspaceYamlClaimValue(
  source: string,
  path: string,
): PnpmWorkspaceYamlClaimReadResult {
  const key = parseAllowBuildsClaimPath(path)
  if (!key) return { exists: false, value: undefined, safeToEdit: true }

  const inspection = inspectPnpmWorkspaceYaml(source, [key])

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

// restorePnpmWorkspaceYamlClaim 함수는 claim의 scalar 또는 missing pair만 원문 range로 복원한다.
export function restorePnpmWorkspaceYamlClaim(source: string, claim: PackageJsonOwnershipClaim) {
  const key = parseAllowBuildsClaimPath(claim.path)
  if (!key) return source

  const inspection = inspectPnpmWorkspaceYaml(source, [key])
  if (!inspection.safe) return source

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

// previewPnpmWorkspaceYamlPatch 함수는 경로 안전성과 필요한 allowBuilds range 편집을 미리 계산한다.
export function previewPnpmWorkspaceYamlPatch(cwd: string, packageManager: string) {
  if (packageManager !== 'pnpm') return null

  const path = findPnpmWorkspaceYamlPath(cwd)
  const exists = pathEntryExists(path)
  const projectRoot = resolve(cwd)
  const safetyRoot = isInsideDirectory(projectRoot, path) ? projectRoot : dirname(path)
  const pathInspection = inspectProjectPath(safetyRoot, path)

  if (!pathInspection.safe) {
    return createBlockedPatchPlan(
      path,
      '',
      formatProjectPathBlocker(safetyRoot, PNPM_WORKSPACE_YAML_PATH, pathInspection),
    )
  }

  if (exists) {
    const stats = lstatSync(path)

    if (!stats.isFile()) {
      return createBlockedPatchPlan(path, '', formatYamlBlocker('the target is not a regular file'))
    }

    if (stats.nlink !== 1) {
      return createBlockedPatchPlan(
        path,
        '',
        formatYamlBlocker('the target must have exactly one hard link'),
      )
    }
  }

  const source = exists ? readFileSync(path, 'utf8') : ''
  const inspection = inspectPnpmWorkspaceYaml(source)

  if (!inspection.safe) return createBlockedPatchPlan(path, source, inspection.blocker)

  const desiredValues = new Map<string, AllowBuildsWriteValue>(
    REQUIRED_ALLOW_BUILDS.map((key) => [key, { value: true }]),
  )
  const edit = setAllowBuildsValues(source, desiredValues, inspection)

  if (edit.blocker) return createBlockedPatchPlan(path, source, edit.blocker)

  const changes: PnpmWorkspaceYamlPatchChange[] = []
  const ownershipClaims: PackageJsonOwnershipClaim[] = []
  const createdSectionMetadata = inspection.section
    ? undefined
    : createCreatedSectionMetadata(source, inspection.document)

  for (const key of REQUIRED_ALLOW_BUILDS) {
    const claimPath = `allowBuilds.${key}`
    const currentEntry = inspection.entries.get(key)

    if (currentEntry && valuesEqual(currentEntry.value, true)) continue

    changes.push({ action: 'set', path: claimPath, value: true })

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
    created: !exists,
    changes,
    ownershipClaims,
    warnings: [],
    blockers: [],
  } satisfies PnpmWorkspaceYamlPatchPlan
}
