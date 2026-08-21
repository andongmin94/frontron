import { lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { isAlias, isMap, isScalar, parseDocument, stringify } from 'yaml'

import { formatProjectPathBlocker, inspectProjectPath, isInsideDirectory } from '../project-paths'
import type { PackageJsonOwnershipClaim } from './manifest'
import { cloneJsonValue } from './package-json-path'

export const PNPM_WORKSPACE_YAML_PATH = 'pnpm-workspace.yaml'

const REQUIRED_ALLOW_BUILDS = ['electron', 'electron-winstaller'] as const
const YAML_REFERENCE_PATTERN = /[&*][A-Za-z_][\w-]*/u

type JsonScalar = string | number | boolean | null

type TargetValue = { exists: false; value?: never } | { exists: true; value: JsonScalar }

type EditableInspection = {
  safe: true
  root: Record<string, unknown>
  values: Map<string, TargetValue>
}

type Inspection =
  | EditableInspection
  | {
      safe: false
      blocker: string
    }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isJsonScalar(value: unknown): value is JsonScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
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

function formatYamlBlocker(reason: string) {
  return `Cannot safely edit ${PNPM_WORKSPACE_YAML_PATH}: ${reason}. The file was left unchanged.`
}

function inspectPnpmWorkspaceYaml(
  source: string,
  targetKeys: readonly string[] = REQUIRED_ALLOW_BUILDS,
): Inspection {
  const document = parseDocument(source, { uniqueKeys: true })
  const error = document.errors[0]

  if (error) return { safe: false, blocker: formatYamlBlocker(error.message) }
  if (YAML_REFERENCE_PATTERN.test(source)) {
    return {
      safe: false,
      blocker: formatYamlBlocker('YAML aliases are not supported safely'),
    }
  }
  if (source.includes('!!')) {
    return { safe: false, blocker: formatYamlBlocker('YAML tags are not supported safely') }
  }

  const rootValue = document.contents === null ? {} : document.toJS()
  if (!isRecord(rootValue)) {
    return {
      safe: false,
      blocker: formatYamlBlocker('the document root must be a mapping'),
    }
  }

  const sectionNode = document.get('allowBuilds', true)
  if (typeof sectionNode !== 'undefined') {
    if (isAlias(sectionNode)) {
      return {
        safe: false,
        blocker: formatYamlBlocker('YAML aliases are not supported safely'),
      }
    }
    if (!isMap(sectionNode)) {
      return {
        safe: false,
        blocker: formatYamlBlocker('allowBuilds must be a mapping'),
      }
    }
    if (sectionNode.flow) {
      return {
        safe: false,
        blocker: formatYamlBlocker('allowBuilds must use a block mapping'),
      }
    }
    if (sectionNode.anchor) {
      return {
        safe: false,
        blocker: formatYamlBlocker('YAML anchors are not supported safely'),
      }
    }
  }

  const values = new Map<string, TargetValue>()

  for (const key of new Set(targetKeys)) {
    const node = document.getIn(['allowBuilds', key], true)

    if (typeof node === 'undefined') {
      values.set(key, { exists: false })
      continue
    }

    if (isAlias(node)) {
      return {
        safe: false,
        blocker: formatYamlBlocker('YAML aliases are not supported safely'),
      }
    }
    if (!isScalar(node) || node.anchor || node.tag || !isJsonScalar(node.value)) {
      return {
        safe: false,
        blocker: formatYamlBlocker(`allowBuilds.${key} must be a simple scalar`),
      }
    }

    values.set(key, { exists: true, value: node.value })
  }

  return { safe: true, root: rootValue, values }
}

function renderYaml(root: Record<string, unknown>, source: string) {
  if (Object.keys(root).length === 0) return ''

  const rendered = stringify(root, { lineWidth: 0 })
  const withBom = source.startsWith('\uFEFF') ? `\uFEFF${rendered}` : rendered
  return source.includes('\r\n') ? withBom.replace(/\n/g, '\r\n') : withBom
}

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

function parseClaimPath(path: string) {
  const prefix = 'allowBuilds.'
  return path.startsWith(prefix) && path.length > prefix.length ? path.slice(prefix.length) : null
}

export function readPnpmWorkspaceYamlClaimValue(
  source: string,
  path: string,
): PnpmWorkspaceYamlClaimReadResult {
  const key = parseClaimPath(path)
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

  const current = inspection.values.get(key)
  return current?.exists
    ? { exists: true, value: current.value, safeToEdit: true }
    : { exists: false, value: undefined, safeToEdit: true }
}

export function restorePnpmWorkspaceYamlClaim(source: string, claim: PackageJsonOwnershipClaim) {
  const key = parseClaimPath(claim.path)
  if (!key) return source

  const inspection = inspectPnpmWorkspaceYaml(source, [key])
  if (!inspection.safe) return source

  const root = structuredClone(inspection.root)
  const allowBuilds = isRecord(root.allowBuilds) ? { ...root.allowBuilds } : {}

  if (claim.previous.state === 'missing') {
    delete allowBuilds[key]
  } else if (isJsonScalar(claim.previous.value)) {
    allowBuilds[key] = claim.previous.value
  } else {
    return source
  }

  if (Object.keys(allowBuilds).length === 0) {
    delete root.allowBuilds
  } else {
    root.allowBuilds = allowBuilds
  }

  return renderYaml(root, source)
}

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

  const root = structuredClone(inspection.root)
  const allowBuilds = isRecord(root.allowBuilds) ? { ...root.allowBuilds } : {}
  const changes: PnpmWorkspaceYamlPatchChange[] = []
  const ownershipClaims: PackageJsonOwnershipClaim[] = []

  for (const key of REQUIRED_ALLOW_BUILDS) {
    const current = inspection.values.get(key) ?? { exists: false as const }
    if (current.exists && current.value === true) continue

    const claimPath = `allowBuilds.${key}`
    changes.push({ action: 'set', path: claimPath, value: true })
    ownershipClaims.push({
      path: claimPath,
      action: 'set',
      value: true,
      previous: current.exists
        ? { state: 'value', value: cloneJsonValue(current.value) }
        : { state: 'missing' },
    })
    allowBuilds[key] = true
  }

  root.allowBuilds = allowBuilds

  return {
    path,
    source,
    nextSource: changes.length === 0 ? source : renderYaml(root, source),
    created: !exists,
    changes,
    ownershipClaims,
    warnings: [],
    blockers: [],
  } satisfies PnpmWorkspaceYamlPatchPlan
}
