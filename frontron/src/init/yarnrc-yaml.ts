import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { isAlias, isMap, isScalar, isSeq, parseDocument, stringify } from 'yaml'

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

type EditableInspection = {
  safe: true
  root: Record<string, unknown>
  nodeLinker: YarnNodeLinker | null
}

type Inspection =
  | EditableInspection
  | {
      safe: false
      blocker: string
    }

const YAML_REFERENCE_PATTERN = /[&*][A-Za-z_][\w-]*/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createSourceHash(source: string) {
  return createHash('sha256').update(source).digest('hex')
}

function formatYarnRcBlocker(reason: string) {
  return `Cannot safely edit ${YARN_RC_YAML_PATH}: ${reason}. The file was left unchanged.`
}

function inspectYarnRcYaml(source: string): Inspection {
  const document = parseDocument(source, { uniqueKeys: true })
  const error = document.errors[0]

  if (error) return { safe: false, blocker: formatYarnRcBlocker(error.message) }
  if (YAML_REFERENCE_PATTERN.test(source)) {
    return {
      safe: false,
      blocker: formatYarnRcBlocker('YAML aliases are not supported safely'),
    }
  }
  if (source.includes('!!')) {
    return { safe: false, blocker: formatYarnRcBlocker('YAML tags are not supported safely') }
  }

  const rootValue = document.contents === null ? {} : document.toJS()
  if (!isRecord(rootValue)) {
    return {
      safe: false,
      blocker: formatYarnRcBlocker('the document root must be a mapping'),
    }
  }

  const node = document.get('nodeLinker', true)
  if (typeof node === 'undefined') return { safe: true, root: rootValue, nodeLinker: null }
  if (isAlias(node)) {
    return {
      safe: false,
      blocker: formatYarnRcBlocker('YAML aliases are not supported safely'),
    }
  }
  if (!isScalar(node)) {
    const reason =
      (isMap(node) || isSeq(node)) && node.flow
        ? 'flow collections are not supported safely'
        : 'nodeLinker must be a simple pnp or node-modules scalar'
    return { safe: false, blocker: formatYarnRcBlocker(reason) }
  }
  if (node.anchor) {
    return {
      safe: false,
      blocker: formatYarnRcBlocker('YAML anchors are not supported safely'),
    }
  }
  if (node.tag) {
    return { safe: false, blocker: formatYarnRcBlocker('YAML tags are not supported safely') }
  }
  if (node.value !== 'pnp' && node.value !== REQUIRED_YARN_NODE_LINKER) {
    return {
      safe: false,
      blocker: formatYarnRcBlocker('nodeLinker must be a simple pnp or node-modules scalar'),
    }
  }

  return { safe: true, root: rootValue, nodeLinker: node.value }
}

function renderYaml(root: Record<string, unknown>, source: string) {
  if (Object.keys(root).length === 0) return ''

  const rendered = stringify(root, { lineWidth: 0 })
  const withBom = source.startsWith('\uFEFF') ? `\uFEFF${rendered}` : rendered
  return source.includes('\r\n') ? withBom.replace(/\n/g, '\r\n') : withBom
}

function pathEntryExists(filePath: string) {
  try {
    lstatSync(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function toPortableClaimFile(cwd: string, filePath: string) {
  const relativePath = relative(resolve(cwd), resolve(filePath))
  return (relativePath || YARN_RC_YAML_PATH).split(sep).join('/')
}

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
        formatYarnRcBlocker('the target is not a regular file'),
      )
    }
    if (stats.nlink !== 1) {
      return createBlockedPatchPlan(
        path,
        '',
        created,
        formatYarnRcBlocker('the target must have exactly one hard link'),
      )
    }
  }

  const source = created ? '' : readFileSync(path, 'utf8')
  const inspection = inspectYarnRcYaml(source)
  if (!inspection.safe) return createBlockedPatchPlan(path, source, created, inspection.blocker)

  const previous = inspection.nodeLinker
    ? {
        state: 'value' as const,
        value: inspection.nodeLinker,
        source: inspection.nodeLinker,
      }
    : {
        state: 'missing' as const,
        previousHadFinalEol: /(?:\r\n|\n|\r)$/u.test(source),
        previousSourceHash: createSourceHash(source),
      }
  const changes: YarnRcYamlPatchChange[] = []
  const root = structuredClone(inspection.root)

  if (inspection.nodeLinker === null) {
    changes.push({
      action: created ? 'create' : 'add',
      path: 'nodeLinker',
      value: REQUIRED_YARN_NODE_LINKER,
      previous: 'missing',
    })
    root.nodeLinker = REQUIRED_YARN_NODE_LINKER
  } else if (inspection.nodeLinker !== REQUIRED_YARN_NODE_LINKER) {
    changes.push({
      action: 'set',
      path: 'nodeLinker',
      value: REQUIRED_YARN_NODE_LINKER,
      previous: inspection.nodeLinker,
    })
    root.nodeLinker = REQUIRED_YARN_NODE_LINKER
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
    nextSource: changes.length === 0 ? source : renderYaml(root, source),
    created,
    changes,
    ownershipClaims: [ownershipClaim],
    warnings: [],
    blockers: [],
  } satisfies YarnRcYamlPatchPlan
}

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

  return inspection.nodeLinker === null
    ? { exists: false, value: undefined, safeToEdit: true }
    : { exists: true, value: inspection.nodeLinker, safeToEdit: true }
}

export function restoreYarnRcYamlClaim(source: string, claim: YarnRcOwnershipClaim) {
  const inspection = inspectYarnRcYaml(source)
  if (!inspection.safe) return { source, blocker: inspection.blocker }

  if (inspection.nodeLinker === null) {
    return {
      source,
      blocker: formatYarnRcBlocker('manifest-owned nodeLinker is missing during clean'),
    }
  }

  const root = structuredClone(inspection.root)

  if (claim.previous.state === 'missing') {
    delete root.nodeLinker
  } else {
    root.nodeLinker = claim.previous.value
  }

  return { source: renderYaml(root, source) }
}

export function mergeYarnRcClaims(
  existingClaims: YarnRcOwnershipClaim[] = [],
  nextClaims: YarnRcOwnershipClaim[] = [],
) {
  const claims = new Map<string, YarnRcOwnershipClaim>()

  for (const claim of existingClaims) claims.set(`${claim.file}:${claim.path}`, claim)

  for (const claim of nextClaims) {
    const key = `${claim.file}:${claim.path}`
    const existing = claims.get(key)
    if (!existing || (!existing.changed && claim.changed)) claims.set(key, claim)
  }

  return [...claims.values()]
}
