import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { formatProjectPathBlocker, inspectProjectPath, isInsideDirectory } from '../project-paths'

export const YARN_RC_YAML_PATH = '.yarnrc.yml'
export const REQUIRED_YARN_NODE_LINKER = 'node-modules'

export type YarnNodeLinker = 'pnp' | 'node-modules'

export type YarnRcOwnershipClaim = {
  file: string
  path: 'nodeLinker'
  value: typeof REQUIRED_YARN_NODE_LINKER
  created: boolean
  changed: boolean
  previous:
    | {
        state: 'missing'
        previousHadFinalEol: boolean
        previousSourceHash: string
      }
    | {
        state: 'value'
        value: YarnNodeLinker
        source: string
      }
}

export type YarnRcYamlPatchChange = {
  action: 'create' | 'add' | 'set'
  path: 'nodeLinker'
  value: typeof REQUIRED_YARN_NODE_LINKER
  previous: YarnNodeLinker | 'missing'
}

export type YarnRcYamlPatchPlan = {
  path: string
  source: string
  nextSource: string
  created: boolean
  changes: YarnRcYamlPatchChange[]
  ownershipClaims: YarnRcOwnershipClaim[]
  warnings: string[]
  blockers: string[]
}

export type YarnRcYamlClaimReadResult = {
  exists: boolean
  value: unknown
  safeToEdit: boolean
  blocker?: string
}

export type YarnRcClaimPathResolution =
  | {
      safe: true
      path: string
      safetyRoot: string
    }
  | {
      safe: false
      path: string
      blocker: string
    }

type YamlLine = {
  text: string
  ending: string
}

type ParsedMappingLine = {
  key: string
  valueSource: string
  valueStart: number
  valueEnd: number
}

type NodeLinkerEntry = ParsedMappingLine & {
  lineIndex: number
  value: YarnNodeLinker
}

type EditableYarnRcInspection = {
  safe: true
  lines: YamlLine[]
  eol: string
  nodeLinker: NodeLinkerEntry | null
}

type UnsafeYarnRcInspection = {
  safe: false
  blocker: string
}

type YarnRcInspection = EditableYarnRcInspection | UnsafeYarnRcInspection

type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

// formatYarnRcBlocker 함수는 안전하게 편집할 수 없는 Yarn 설정 사유를 일관된 문장으로 만든다.
function formatYarnRcBlocker(reason: string) {
  return `Cannot safely edit ${YARN_RC_YAML_PATH}: ${reason}. The file was left unchanged.`
}

// formatLineReason 함수는 YAML 문제 위치를 사람이 바로 찾을 수 있도록 줄 번호를 붙인다.
function formatLineReason(lineIndex: number, reason: string) {
  return `${reason} (line ${lineIndex + 1})`
}

// createSourceHash 함수는 추가한 줄을 지울 때 원래 EOF 상태를 안전하게 식별할 해시를 만든다.
function createSourceHash(source: string) {
  return createHash('sha256').update(source).digest('hex')
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
    lines.push({ text: source.slice(start, index), ending })
    index += ending.length - 1
    start = index + 1
  }

  if (start < source.length) {
    lines.push({ text: source.slice(start), ending: '' })
  }

  return lines
}

// joinYamlLines 함수는 보존한 줄바꿈과 함께 YAML 줄을 다시 합친다.
function joinYamlLines(lines: YamlLine[]) {
  return lines.map((line) => `${line.text}${line.ending}`).join('')
}

// findPreferredEol 함수는 새 줄에 사용할 기존 문서의 대표 줄바꿈을 찾는다.
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

// parseQuotedYamlString 함수는 한 줄에서 끝나는 단순 따옴표 문자열을 읽는다.
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
        : { ok: false, reason: 'quoted scalar has trailing YAML content' }
    }

    return { ok: false, reason: 'single-quoted scalar is not closed on the same line' }
  }

  if (source.startsWith('"')) {
    try {
      const value = JSON.parse(source) as unknown

      return typeof value === 'string'
        ? { ok: true, value }
        : { ok: false, reason: 'double-quoted scalar is not a string' }
    } catch {
      return {
        ok: false,
        reason: 'double-quoted scalar is not closed or uses unsupported escaping',
      }
    }
  }

  return { ok: false, reason: 'scalar is not quoted' }
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

// findYamlReferenceToken 함수는 따옴표 밖의 anchor, alias, tag 토큰을 찾는다.
function findYamlReferenceToken(source: string) {
  let quote: 'single' | 'double' | null = null

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (quote === 'single') {
      if (character === "'" && source[index + 1] === "'") {
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

    if (!['&', '*', '!'].includes(character)) {
      continue
    }

    const previous = index === 0 ? '' : source[index - 1]

    if (index === 0 || /\s/.test(previous)) {
      return character === '&' ? 'anchor' : character === '*' ? 'alias' : 'tag'
    }
  }

  return null
}

// parseMappingKey 함수는 지원하는 plain 또는 quoted top-level key를 읽는다.
function parseMappingKey(source: string): ParseResult<string> {
  if (source.startsWith("'") || source.startsWith('"')) {
    return parseQuotedYamlString(source)
  }

  return /^[A-Za-z_][A-Za-z0-9_.+/@*-]*$/.test(source)
    ? { ok: true, value: source }
    : { ok: false, reason: 'top-level mapping key uses unsupported YAML syntax' }
}

// parseTopLevelMappingLine 함수는 top-level block mapping 한 줄의 key와 값 토큰 위치를 읽는다.
function parseTopLevelMappingLine(text: string): ParseResult<ParsedMappingLine> {
  let quote: 'single' | 'double' | null = null
  let colonIndex = -1

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
    } else if (character === '"') {
      quote = 'double'
    } else if (character === ':' && (index === text.length - 1 || /\s/.test(text[index + 1]))) {
      colonIndex = index
      break
    }
  }

  if (colonIndex === -1 || quote) {
    return { ok: false, reason: 'document root is not a supported block mapping' }
  }

  const keySource = text.slice(0, colonIndex).trimEnd()
  const parsedKey = parseMappingKey(keySource)

  if (!parsedKey.ok) {
    return parsedKey
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
      key: parsedKey.value,
      valueSource: text.slice(valueStart, valueEnd),
      valueStart,
      valueEnd,
    },
  }
}

// validateTopLevelValue 함수는 문서 경계를 흐리는 top-level flow와 참조 문법을 차단한다.
function validateTopLevelValue(source: string) {
  if (!source) {
    return null
  }

  const referenceToken = findYamlReferenceToken(source)

  if (referenceToken) {
    const referenceLabel = referenceToken === 'alias' ? 'aliases' : `${referenceToken}s`
    return `YAML ${referenceLabel} are not supported safely`
  }

  if (/^[\[{]/.test(source)) {
    return 'flow collections are not supported safely'
  }

  if (/^[|>]/.test(source)) {
    return 'block scalar values are not supported safely'
  }

  return null
}

// parseNodeLinkerScalar 함수는 자동 편집 가능한 pnp 또는 node-modules scalar만 허용한다.
function parseNodeLinkerScalar(source: string): ParseResult<YarnNodeLinker> {
  if (!source) {
    return { ok: false, reason: 'nodeLinker must be a simple pnp or node-modules scalar' }
  }

  const parsed =
    source.startsWith("'") || source.startsWith('"')
      ? parseQuotedYamlString(source)
      : { ok: true as const, value: source }

  if (!parsed.ok) {
    return parsed
  }

  return parsed.value === 'pnp' || parsed.value === 'node-modules'
    ? { ok: true, value: parsed.value }
    : {
        ok: false,
        reason:
          'nodeLinker uses an unsupported complex value; only pnp or node-modules scalars are editable',
      }
}

// inspectYarnRcYaml 함수는 원문 보존 편집이 가능한 top-level nodeLinker 구조인지 검사한다.
function inspectYarnRcYaml(source: string): YarnRcInspection {
  const lines = splitYamlLines(source)
  const topLevelKeys = new Map<string, number>()
  let nodeLinker: NodeLinkerEntry | null = null
  let sawTopLevelEntry = false
  let topLevelAllowsChildren = false

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const text = getYamlLineText(lines[lineIndex], lineIndex)

    if (isYamlTrivia(text)) {
      continue
    }

    const indent = text.match(/^[ \t]*/)?.[0] ?? ''

    if (indent.includes('\t')) {
      return {
        safe: false,
        blocker: formatYarnRcBlocker(
          formatLineReason(lineIndex, 'tab indentation is not supported'),
        ),
      }
    }

    if (indent.length > 0) {
      if (!sawTopLevelEntry) {
        return {
          safe: false,
          blocker: formatYarnRcBlocker(
            formatLineReason(lineIndex, 'document root is not a top-level block mapping'),
          ),
        }
      }

      if (!topLevelAllowsChildren) {
        return {
          safe: false,
          blocker: formatYarnRcBlocker(
            formatLineReason(lineIndex, 'nested content follows a top-level scalar'),
          ),
        }
      }

      continue
    }

    if (text === '---' || text === '...' || text.startsWith('%')) {
      return {
        safe: false,
        blocker: formatYarnRcBlocker(
          formatLineReason(lineIndex, 'directives and multi-document markers are not supported'),
        ),
      }
    }

    const parsedMapping = parseTopLevelMappingLine(text)

    if (!parsedMapping.ok) {
      return {
        safe: false,
        blocker: formatYarnRcBlocker(formatLineReason(lineIndex, parsedMapping.reason)),
      }
    }

    const previousLine = topLevelKeys.get(parsedMapping.value.key)

    if (typeof previousLine === 'number') {
      return {
        safe: false,
        blocker: formatYarnRcBlocker(
          formatLineReason(
            lineIndex,
            `duplicate top-level key "${parsedMapping.value.key}" also appears on line ${previousLine + 1}`,
          ),
        ),
      }
    }

    const valueReason = validateTopLevelValue(parsedMapping.value.valueSource)

    if (valueReason) {
      return {
        safe: false,
        blocker: formatYarnRcBlocker(formatLineReason(lineIndex, valueReason)),
      }
    }

    topLevelKeys.set(parsedMapping.value.key, lineIndex)
    sawTopLevelEntry = true
    topLevelAllowsChildren = parsedMapping.value.valueSource === ''

    if (parsedMapping.value.key !== 'nodeLinker') {
      continue
    }

    const parsedValue = parseNodeLinkerScalar(parsedMapping.value.valueSource)

    if (!parsedValue.ok) {
      return {
        safe: false,
        blocker: formatYarnRcBlocker(formatLineReason(lineIndex, parsedValue.reason)),
      }
    }

    const bomOffset = lineIndex === 0 && lines[lineIndex].text.startsWith('\uFEFF') ? 1 : 0
    nodeLinker = {
      ...parsedMapping.value,
      valueStart: parsedMapping.value.valueStart + bomOffset,
      valueEnd: parsedMapping.value.valueEnd + bomOffset,
      lineIndex,
      value: parsedValue.value,
    }
  }

  return {
    safe: true,
    lines,
    eol: findPreferredEol(lines),
    nodeLinker,
  }
}

// renderNodeLinkerScalar 함수는 기존 plain 또는 quote 스타일을 유지해 nodeLinker 값을 만든다.
function renderNodeLinkerScalar(value: YarnNodeLinker, preferredSource?: string) {
  if (preferredSource?.startsWith("'")) {
    return `'${value}'`
  }

  if (preferredSource?.startsWith('"')) {
    return JSON.stringify(value)
  }

  return value
}

// replaceNodeLinkerScalar 함수는 검사된 nodeLinker 줄에서 값 토큰만 교체한다.
function replaceNodeLinkerScalar(
  inspection: EditableYarnRcInspection,
  value: YarnNodeLinker,
  preferredSource?: string,
) {
  const entry = inspection.nodeLinker

  if (!entry) {
    return null
  }

  const lines = inspection.lines.map((line) => ({ ...line }))
  const line = lines[entry.lineIndex]
  const scalarSource = renderNodeLinkerScalar(value, preferredSource ?? entry.valueSource)
  line.text = `${line.text.slice(0, entry.valueStart)}${scalarSource}${line.text.slice(entry.valueEnd)}`
  return joinYamlLines(lines)
}

// appendNodeLinkerScalar 함수는 기존 EOF 줄바꿈 유무를 유지하며 nodeLinker 줄을 추가한다.
function appendNodeLinkerScalar(source: string, inspection: EditableYarnRcInspection) {
  if (inspection.lines.length === 0) {
    return `nodeLinker: ${REQUIRED_YARN_NODE_LINKER}${inspection.eol}`
  }

  const lines = inspection.lines.map((line) => ({ ...line }))
  const previousHadFinalEol = /(?:\r\n|\n|\r)$/.test(source)

  if (lines.at(-1)?.ending === '') {
    lines[lines.length - 1].ending = inspection.eol
  }

  lines.push({
    text: `nodeLinker: ${REQUIRED_YARN_NODE_LINKER}`,
    ending: previousHadFinalEol ? inspection.eol : '',
  })

  return joinYamlLines(lines)
}

// removeNodeLinkerScalar 함수는 init이 추가한 nodeLinker 줄과 필요했던 EOF 줄바꿈만 되돌린다.
function removeNodeLinkerScalar(
  inspection: EditableYarnRcInspection,
  previousHadFinalEol: boolean,
  previousSourceHash: string,
) {
  const entry = inspection.nodeLinker

  if (!entry) {
    return null
  }

  const lines = inspection.lines.map((line) => ({ ...line }))
  const wasLastLine = entry.lineIndex === lines.length - 1
  lines.splice(entry.lineIndex, 1)

  if (wasLastLine && !previousHadFinalEol && lines.length > 0) {
    const restoredEolLines = lines.map((line) => ({ ...line }))
    restoredEolLines[restoredEolLines.length - 1].ending = ''
    const restoredEolSource = joinYamlLines(restoredEolLines)

    if (createSourceHash(restoredEolSource) === previousSourceHash) {
      return restoredEolSource
    }
  }

  return joinYamlLines(lines)
}

// toPortableClaimFile 함수는 Yarn 설정 경로를 manifest용 슬래시 상대 경로로 바꾼다.
function toPortableClaimFile(cwd: string, filePath: string) {
  const relativePath = relative(resolve(cwd), resolve(filePath))
  return (relativePath || YARN_RC_YAML_PATH).split(sep).join('/')
}

// pathEntryExists 함수는 깨진 symbolic link도 기존 경로로 취급해 새 파일로 덮어쓰지 않게 한다.
function pathEntryExists(filePath: string) {
  try {
    lstatSync(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }

    throw error
  }
}

// findYarnRcYamlPath 함수는 프로젝트부터 파일시스템 루트까지 가장 가까운 .yarnrc.yml을 찾는다.
export function findYarnRcYamlPath(cwd: string) {
  let currentDir = resolve(cwd)

  while (true) {
    const candidate = join(currentDir, YARN_RC_YAML_PATH)

    if (pathEntryExists(candidate)) {
      return candidate
    }

    const parentDir = dirname(currentDir)

    if (parentDir === currentDir) {
      break
    }

    currentDir = parentDir
  }

  return join(resolve(cwd), YARN_RC_YAML_PATH)
}

// resolveYarnRcClaimPath 함수는 manifest의 Yarn 설정 경로가 프로젝트 또는 실제 상위 디렉터리인지 검증한다.
export function resolveYarnRcClaimPath(cwd: string, file: string): YarnRcClaimPathResolution {
  const projectRoot = resolve(cwd)

  if (isAbsolute(file) || file.includes('\0')) {
    return {
      safe: false,
      path: resolve(projectRoot, file),
      blocker: `Manifest Yarn config path must be a relative ${YARN_RC_YAML_PATH} path: ${file}`,
    }
  }

  const path = resolve(projectRoot, file)
  const expectedFile = toPortableClaimFile(projectRoot, path)
  const configRoot = dirname(path)

  if (
    file !== expectedFile ||
    basename(path) !== YARN_RC_YAML_PATH ||
    !isInsideDirectory(configRoot, projectRoot)
  ) {
    return {
      safe: false,
      path,
      blocker: `Manifest Yarn config path must point to the project or an ancestor ${YARN_RC_YAML_PATH}: ${file}`,
    }
  }

  const safetyRoot = isInsideDirectory(projectRoot, path) ? projectRoot : configRoot
  const inspection = inspectProjectPath(safetyRoot, path)

  if (!inspection.safe) {
    return {
      safe: false,
      path,
      blocker: formatProjectPathBlocker(safetyRoot, YARN_RC_YAML_PATH, inspection),
    }
  }

  return { safe: true, path, safetyRoot }
}

// createBlockedPatchPlan 함수는 원문을 유지한 Yarn init blocker 계획을 만든다.
function createBlockedPatchPlan(path: string, source: string, created: boolean, blocker: string) {
  return {
    path,
    source,
    nextSource: source,
    created,
    changes: [],
    ownershipClaims: [],
    warnings: [],
    blockers: [blocker],
  } satisfies YarnRcYamlPatchPlan
}

// previewYarnRcYamlPatch 함수는 Yarn 프로젝트의 nodeLinker 변경을 원문 쓰기 전에 계산한다.
export function previewYarnRcYamlPatch(cwd: string, packageManager: string) {
  if (packageManager !== 'yarn') {
    return null
  }

  const path = findYarnRcYamlPath(cwd)
  const created = !pathEntryExists(path)
  const resolution = resolveYarnRcClaimPath(cwd, toPortableClaimFile(cwd, path))

  if (!resolution.safe) {
    return createBlockedPatchPlan(path, '', created, resolution.blocker)
  }

  if (!created) {
    const stats = lstatSync(path)

    if (!stats.isFile()) {
      return createBlockedPatchPlan(
        path,
        '',
        created,
        `Cannot safely edit ${YARN_RC_YAML_PATH}: the target is not a regular file.`,
      )
    }

    if (stats.nlink !== 1) {
      return createBlockedPatchPlan(
        path,
        '',
        created,
        `Cannot safely edit ${YARN_RC_YAML_PATH}: the target must have exactly one hard link.`,
      )
    }
  }

  const source = created ? '' : readFileSync(path, 'utf8')
  const inspection = inspectYarnRcYaml(source)

  if (!inspection.safe) {
    return createBlockedPatchPlan(path, source, created, inspection.blocker)
  }

  const previous = inspection.nodeLinker
    ? {
        state: 'value' as const,
        value: inspection.nodeLinker.value,
        source: inspection.nodeLinker.valueSource,
      }
    : {
        state: 'missing' as const,
        previousHadFinalEol: /(?:\r\n|\n|\r)$/.test(source),
        previousSourceHash: createSourceHash(source),
      }
  const changes: YarnRcYamlPatchChange[] = []
  let nextSource = source

  if (!inspection.nodeLinker) {
    changes.push({
      action: created ? 'create' : 'add',
      path: 'nodeLinker',
      value: REQUIRED_YARN_NODE_LINKER,
      previous: 'missing',
    })
    nextSource = appendNodeLinkerScalar(source, inspection)
  } else if (inspection.nodeLinker.value !== REQUIRED_YARN_NODE_LINKER) {
    changes.push({
      action: 'set',
      path: 'nodeLinker',
      value: REQUIRED_YARN_NODE_LINKER,
      previous: inspection.nodeLinker.value,
    })
    nextSource = replaceNodeLinkerScalar(inspection, REQUIRED_YARN_NODE_LINKER) ?? source
  }

  const ownershipClaim: YarnRcOwnershipClaim = {
    file: toPortableClaimFile(cwd, path),
    path: 'nodeLinker',
    value: REQUIRED_YARN_NODE_LINKER,
    created,
    changed: changes.length > 0,
    previous,
  }

  return {
    path,
    source,
    nextSource,
    created,
    changes,
    ownershipClaims: [ownershipClaim],
    warnings: [],
    blockers: [],
  } satisfies YarnRcYamlPatchPlan
}

// readYarnRcYamlClaimValue 함수는 doctor와 clean이 현재 nodeLinker claim 값을 안전하게 읽게 한다.
export function readYarnRcYamlClaimValue(source: string): YarnRcYamlClaimReadResult {
  const inspection = inspectYarnRcYaml(source)

  if (!inspection.safe) {
    return {
      exists: false,
      value: undefined,
      safeToEdit: false,
      blocker: inspection.blocker,
    }
  }

  return inspection.nodeLinker
    ? {
        exists: true,
        value: inspection.nodeLinker.value,
        safeToEdit: true,
      }
    : {
        exists: false,
        value: undefined,
        safeToEdit: true,
      }
}

// restoreYarnRcYamlClaim 함수는 manifest에 기록한 이전 nodeLinker 상태를 원문 보존 방식으로 복구한다.
export function restoreYarnRcYamlClaim(source: string, claim: YarnRcOwnershipClaim) {
  const inspection = inspectYarnRcYaml(source)

  if (!inspection.safe) {
    return { source, blocker: inspection.blocker }
  }

  if (!inspection.nodeLinker) {
    return {
      source,
      blocker: formatYarnRcBlocker('manifest-owned nodeLinker is missing during clean'),
    }
  }

  if (claim.previous.state === 'missing') {
    return {
      source:
        removeNodeLinkerScalar(
          inspection,
          claim.previous.previousHadFinalEol,
          claim.previous.previousSourceHash,
        ) ?? source,
    }
  }

  const parsedPrevious = parseNodeLinkerScalar(claim.previous.source)

  if (!parsedPrevious.ok || parsedPrevious.value !== claim.previous.value) {
    return {
      source,
      blocker: formatYarnRcBlocker('manifest contains an invalid previous nodeLinker scalar'),
    }
  }

  return {
    source:
      replaceNodeLinkerScalar(inspection, claim.previous.value, claim.previous.source) ?? source,
  }
}

// mergeYarnRcClaims 함수는 update 중 같은 파일의 최초 변경 전 상태를 잃지 않도록 claim을 병합한다.
export function mergeYarnRcClaims(
  existingClaims: YarnRcOwnershipClaim[] = [],
  nextClaims: YarnRcOwnershipClaim[] = [],
) {
  const claims = new Map<string, YarnRcOwnershipClaim>()

  for (const claim of existingClaims) {
    claims.set(`${claim.file}:${claim.path}`, claim)
  }

  for (const claim of nextClaims) {
    const key = `${claim.file}:${claim.path}`
    const existing = claims.get(key)

    if (!existing || (!existing.changed && claim.changed)) {
      claims.set(key, claim)
    }
  }

  return [...claims.values()]
}
