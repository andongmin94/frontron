import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { isMap, isScalar, type Scalar } from 'yaml'

import { formatProjectPathBlocker, inspectProjectPath, isInsideDirectory } from '../project-paths'
import {
  applyYamlTextEdits,
  findPreferredEol,
  findYamlPairsByKey,
  getYamlDocumentAppendOffset,
  getYamlLineNumber,
  getYamlLineRange,
  getYamlNodeSource,
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
} from './yaml-source'

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

type NodeLinkerEntry = {
  pair: ParsedYamlPair
  scalar: Scalar
  value: YarnNodeLinker
  valueSource: string
}

type EditableYarnRcInspection = {
  safe: true
  document: ParsedYamlDocument
  eol: string
  nodeLinker: NodeLinkerEntry | null
}

type YarnRcInspection =
  | EditableYarnRcInspection
  | {
      safe: false
      blocker: string
    }

// formatYarnRcBlocker 함수는 안전하게 편집할 수 없는 Yarn 설정 사유를 일관된 문장으로 만든다.
function formatYarnRcBlocker(reason: string) {
  return `Cannot safely edit ${YARN_RC_YAML_PATH}: ${reason}. The file was left unchanged.`
}

// formatSourceReason 함수는 yaml range의 시작 위치를 사람이 찾기 쉬운 줄 번호로 표시한다.
function formatSourceReason(source: string, offset: number, reason: string) {
  return `${reason} (line ${getYamlLineNumber(source, offset)})`
}

// formatReferenceReason 함수는 대상 key/value의 참조 문법을 기존 blocker 용어로 바꾼다.
function formatReferenceReason(reference: YamlReferenceKind) {
  return `YAML ${reference === 'alias' ? 'aliases' : `${reference}s`} are not supported safely`
}

// createSourceHash 함수는 추가한 줄을 지울 때 원래 EOF 상태를 안전하게 식별할 해시를 만든다.
function createSourceHash(source: string) {
  return createHash('sha256').update(source).digest('hex')
}

// isImplicitEmptyDocument 함수는 CST value 토큰이 없는 빈 YAML 문서만 새 mapping 대상으로 허용한다.
function isImplicitEmptyDocument(document: ParsedYamlDocument) {
  const contents = document.contents
  return (
    contents === null ||
    (isScalar(contents) && contents.value === null && typeof contents.srcToken === 'undefined')
  )
}

// parseNodeLinkerScalar 함수는 yaml이 읽은 단일 scalar가 지원하는 두 값 중 하나인지 검증한다.
function parseNodeLinkerScalar(source: string) {
  const parsed = parseSimpleYamlScalar(source)

  if (!parsed.ok) {
    return {
      ok: false as const,
      reason: 'nodeLinker must be a simple pnp or node-modules scalar',
    }
  }

  return parsed.value.value === 'pnp' || parsed.value.value === 'node-modules'
    ? { ok: true as const, value: parsed.value.value as YarnNodeLinker }
    : {
        ok: false as const,
        reason:
          'nodeLinker uses an unsupported complex value; only pnp or node-modules scalars are editable',
      }
}

// inspectYarnRcYaml 함수는 문서 전체를 재작성하지 않고 nodeLinker의 CST와 scalar range만 수집한다.
function inspectYarnRcYaml(source: string): YarnRcInspection {
  const parsed = parseYamlSource(source)

  if (!parsed.ok) {
    return { safe: false, blocker: formatYarnRcBlocker(parsed.reason) }
  }

  const document = parsed.value

  if (isImplicitEmptyDocument(document)) {
    return {
      safe: true,
      document,
      eol: findPreferredEol(source),
      nodeLinker: null,
    }
  }

  if (!isMap(document.contents) || document.contents.srcToken?.type !== 'block-map') {
    return {
      safe: false,
      blocker: formatYarnRcBlocker('document root is not a top-level block mapping'),
    }
  }

  const root = document.contents as ParsedYamlMap
  const matches = findYamlPairsByKey(document, root, 'nodeLinker')

  if (matches.length > 1) {
    const offset = matches[1].pair.key.range?.[0] ?? 0
    return {
      safe: false,
      blocker: formatYarnRcBlocker(
        formatSourceReason(source, offset, 'duplicate top-level key "nodeLinker"'),
      ),
    }
  }

  const match = matches[0]

  if (!match) {
    return {
      safe: true,
      document,
      eol: findPreferredEol(source),
      nodeLinker: null,
    }
  }

  const keyOffset = match.pair.key.range?.[0] ?? 0

  if (match.keyReference) {
    return {
      safe: false,
      blocker: formatYarnRcBlocker(
        formatSourceReason(source, keyOffset, formatReferenceReason(match.keyReference)),
      ),
    }
  }

  if (isEmptyYamlPairValue(match.pair)) {
    return {
      safe: false,
      blocker: formatYarnRcBlocker(
        formatSourceReason(
          source,
          keyOffset,
          'nodeLinker must be a simple pnp or node-modules scalar',
        ),
      ),
    }
  }

  const value = match.pair.value
  const valueOffset = value?.range?.[0] ?? keyOffset
  const reference = getYamlReferenceKind(value)

  if (reference) {
    return {
      safe: false,
      blocker: formatYarnRcBlocker(
        formatSourceReason(source, valueOffset, formatReferenceReason(reference)),
      ),
    }
  }

  if (value?.srcToken?.type === 'flow-collection') {
    return {
      safe: false,
      blocker: formatYarnRcBlocker(
        formatSourceReason(source, valueOffset, 'flow collections are not supported safely'),
      ),
    }
  }

  const valueSource = value ? getYamlNodeSource(source, value) : null
  const scalar = valueSource === null ? null : parseNodeLinkerScalar(valueSource)

  if (!isScalar(value) || !scalar?.ok || !value.range) {
    return {
      safe: false,
      blocker: formatYarnRcBlocker(
        formatSourceReason(
          source,
          valueOffset,
          scalar?.reason ?? 'nodeLinker must be a simple pnp or node-modules scalar',
        ),
      ),
    }
  }

  return {
    safe: true,
    document,
    eol: findPreferredEol(source),
    nodeLinker: {
      pair: match.pair,
      scalar: value,
      value: scalar.value,
      valueSource: valueSource!,
    },
  }
}

// renderNodeLinkerScalar 함수는 현재 scalar의 CST quote style만 재사용해 새 토큰을 만든다.
function renderNodeLinkerScalar(value: YarnNodeLinker, scalar: Scalar) {
  if (scalar.srcToken?.type === 'single-quoted-scalar') return `'${value}'`
  if (scalar.srcToken?.type === 'double-quoted-scalar') return JSON.stringify(value)
  return value
}

// replaceNodeLinkerScalar 함수는 scalar range 하나만 치환해 주석, 공백, 줄바꿈을 건드리지 않는다.
function replaceNodeLinkerScalar(
  source: string,
  entry: NodeLinkerEntry,
  value: YarnNodeLinker,
  preferredSource?: string,
) {
  const range = entry.scalar.range

  if (!range) return null

  return applyYamlTextEdits(source, [
    {
      start: range[0],
      end: range[1],
      text: preferredSource ?? renderNodeLinkerScalar(value, entry.scalar),
    },
  ])
}

// appendNodeLinkerScalar 함수는 명시적 문서 끝 앞에 한 줄만 넣고 기존 EOF 상태를 유지한다.
function appendNodeLinkerScalar(source: string, inspection: EditableYarnRcInspection) {
  const line = `nodeLinker: ${REQUIRED_YARN_NODE_LINKER}`

  if (!source) return `${line}${inspection.eol}`

  const offset = getYamlDocumentAppendOffset(inspection.document, source)
  const prefix = source.slice(0, offset)
  const suffix = source.slice(offset)
  const leading = prefix && !hasFinalEol(prefix) ? inspection.eol : ''
  const trailing = suffix || hasFinalEol(source) ? inspection.eol : ''

  return `${prefix}${leading}${line}${trailing}${suffix}`
}

// removeNodeLinkerScalar 함수는 추가했던 top-level 한 줄만 지우고 해시가 맞을 때 연결 EOL도 복원한다.
function removeNodeLinkerScalar(
  source: string,
  inspection: EditableYarnRcInspection,
  previousHadFinalEol: boolean,
  previousSourceHash: string,
) {
  const entry = inspection.nodeLinker
  const keyOffset = entry?.pair.key.range?.[0]

  if (!entry || typeof keyOffset !== 'number') return null

  const line = getYamlLineRange(source, keyOffset)
  const nextSource = applyYamlTextEdits(source, [{ start: line.start, end: line.end, text: '' }])

  if (createSourceHash(nextSource) === previousSourceHash) return nextSource

  if (!previousHadFinalEol) {
    const withoutFinalEol = removeFinalEol(nextSource)
    if (createSourceHash(withoutFinalEol) === previousSourceHash) return withoutFinalEol
  }

  return nextSource
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

// findYarnRcYamlPath 함수는 프로젝트부터 파일시스템 루트까지 가장 가까운 .yarnrc.yml을 찾는다.
export function findYarnRcYamlPath(cwd: string) {
  let currentDir = resolve(cwd)

  while (true) {
    const candidate = join(currentDir, YARN_RC_YAML_PATH)

    if (pathEntryExists(candidate)) return candidate

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) break
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

// previewYarnRcYamlPatch 함수는 경로 안전성과 nodeLinker 국소 변경을 실제 쓰기 전에 계산한다.
export function previewYarnRcYamlPatch(cwd: string, packageManager: string) {
  if (packageManager !== 'yarn') return null

  const path = findYarnRcYamlPath(cwd)
  const created = !pathEntryExists(path)
  const resolution = resolveYarnRcClaimPath(cwd, toPortableClaimFile(cwd, path))

  if (!resolution.safe) return createBlockedPatchPlan(path, '', created, resolution.blocker)

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

  if (!inspection.safe) return createBlockedPatchPlan(path, source, created, inspection.blocker)

  const previous = inspection.nodeLinker
    ? {
        state: 'value' as const,
        value: inspection.nodeLinker.value,
        source: inspection.nodeLinker.valueSource,
      }
    : {
        state: 'missing' as const,
        previousHadFinalEol: hasFinalEol(source),
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
    nextSource =
      replaceNodeLinkerScalar(source, inspection.nodeLinker, REQUIRED_YARN_NODE_LINKER) ?? source
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

// readYarnRcYamlClaimValue 함수는 doctor와 clean에 현재 nodeLinker와 국소 편집 가능 여부를 제공한다.
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
    ? { exists: true, value: inspection.nodeLinker.value, safeToEdit: true }
    : { exists: false, value: undefined, safeToEdit: true }
}

// restoreYarnRcYamlClaim 함수는 저장된 scalar 토큰 또는 missing 상태만 국소적으로 복원한다.
export function restoreYarnRcYamlClaim(source: string, claim: YarnRcOwnershipClaim) {
  const inspection = inspectYarnRcYaml(source)

  if (!inspection.safe) return { source, blocker: inspection.blocker }

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
          source,
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
      replaceNodeLinkerScalar(
        source,
        inspection.nodeLinker,
        claim.previous.value,
        claim.previous.source,
      ) ?? source,
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

    if (!existing || (!existing.changed && claim.changed)) claims.set(key, claim)
  }

  return [...claims.values()]
}
