import { lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { isAlias, isMap, isScalar, parseDocument, stringify } from 'yaml'

import { formatProjectPathBlocker, inspectProjectPath, isInsideDirectory } from '../project-paths'
import type { PackageJsonOwnershipClaim } from './manifest'
import {
  isMinimatchOverrideKey,
  PNPM_BUILDER_MINIMATCH_OVERRIDE_KEYS,
} from './npm-builder-override'
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
  value: JsonScalar
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

// Frontron이 편집할 수 있는 pnpm-workspace.yaml 최상위 섹션과 그 안의 키를 claim 경로로 표현한다.
const EDITABLE_SECTIONS = ['allowBuilds', 'overrides'] as const
type EditableSection = (typeof EDITABLE_SECTIONS)[number]

type ClaimTarget = { section: EditableSection; key: string }
type DesiredTarget = ClaimTarget & { value: JsonScalar }

function toClaimPath(target: ClaimTarget) {
  return `${target.section}.${target.key}`
}

function inspectSectionNode(document: ReturnType<typeof parseDocument>, section: EditableSection) {
  const sectionNode = document.get(section, true)
  if (typeof sectionNode === 'undefined') return null
  if (isAlias(sectionNode)) return formatYamlBlocker('YAML aliases are not supported safely')
  if (!isMap(sectionNode)) return formatYamlBlocker(`${section} must be a mapping`)
  if (sectionNode.flow) return formatYamlBlocker(`${section} must use a block mapping`)
  if (sectionNode.anchor) return formatYamlBlocker('YAML anchors are not supported safely')
  return null
}

function inspectPnpmWorkspaceYaml(source: string, targets: readonly ClaimTarget[]): Inspection {
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

  for (const section of new Set(targets.map((target) => target.section))) {
    const blocker = inspectSectionNode(document, section)
    if (blocker) return { safe: false, blocker }
  }

  const values = new Map<string, TargetValue>()

  for (const target of targets) {
    const claimPath = toClaimPath(target)
    if (values.has(claimPath)) continue
    const node = document.getIn([target.section, target.key], true)

    if (typeof node === 'undefined') {
      values.set(claimPath, { exists: false })
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
        blocker: formatYamlBlocker(`${claimPath} must be a simple scalar`),
      }
    }

    values.set(claimPath, { exists: true, value: node.value })
  }

  return { safe: true, root: rootValue, values }
}

function renderYaml(root: Record<string, unknown>, source: string) {
  if (Object.keys(root).length === 0) return ''

  const rendered = stringify(root, { lineWidth: 0 })
  const withBom = source.startsWith('﻿') ? `﻿${rendered}` : rendered
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

function parseClaimPath(path: string): ClaimTarget | null {
  for (const section of EDITABLE_SECTIONS) {
    const prefix = `${section}.`
    if (path.startsWith(prefix) && path.length > prefix.length) {
      return { section, key: path.slice(prefix.length) }
    }
  }
  return null
}

export function readPnpmWorkspaceYamlClaimValue(
  source: string,
  path: string,
): PnpmWorkspaceYamlClaimReadResult {
  const target = parseClaimPath(path)
  if (!target) return { exists: false, value: undefined, safeToEdit: true }

  const inspection = inspectPnpmWorkspaceYaml(source, [target])
  if (!inspection.safe) {
    return {
      exists: false,
      value: undefined,
      safeToEdit: false,
      blocker: inspection.blocker,
    }
  }

  const current = inspection.values.get(path)
  return current?.exists
    ? { exists: true, value: current.value, safeToEdit: true }
    : { exists: false, value: undefined, safeToEdit: true }
}

export function restorePnpmWorkspaceYamlClaim(source: string, claim: PackageJsonOwnershipClaim) {
  const target = parseClaimPath(claim.path)
  if (!target) return source

  const inspection = inspectPnpmWorkspaceYaml(source, [target])
  if (!inspection.safe) return source

  const root = structuredClone(inspection.root)
  const sectionValue = root[target.section]
  const section = isRecord(sectionValue) ? { ...sectionValue } : {}

  if (claim.previous.state === 'missing') {
    delete section[target.key]
  } else if (isJsonScalar(claim.previous.value)) {
    section[target.key] = claim.previous.value
  } else {
    return source
  }

  if (Object.keys(section).length === 0) {
    delete root[target.section]
  } else {
    root[target.section] = section
  }

  return renderYaml(root, source)
}

// allowBuilds는 항상 필요한 값으로 맞추고, minimatch override는 사용자가 어떤 형태로든
// minimatch를 직접 override했다면 추가하지 않는다.
function createDesiredTargets(root: Record<string, unknown>, minimatchOverride?: string) {
  const targets: DesiredTarget[] = REQUIRED_ALLOW_BUILDS.map((key) => ({
    section: 'allowBuilds',
    key,
    value: true,
  }))
  const overrides = isRecord(root.overrides) ? root.overrides : {}

  if (minimatchOverride && !Object.keys(overrides).some(isMinimatchOverrideKey)) {
    for (const key of PNPM_BUILDER_MINIMATCH_OVERRIDE_KEYS) {
      targets.push({ section: 'overrides', key, value: minimatchOverride })
    }
  }

  return targets
}

function inspectWorkspacePath(path: string, projectRoot: string) {
  const safetyRoot = isInsideDirectory(projectRoot, path) ? projectRoot : dirname(path)
  const pathInspection = inspectProjectPath(safetyRoot, path)

  if (!pathInspection.safe) {
    return formatProjectPathBlocker(safetyRoot, PNPM_WORKSPACE_YAML_PATH, pathInspection)
  }
  if (!pathEntryExists(path)) return null

  const stats = lstatSync(path)
  if (!stats.isFile()) return formatYamlBlocker('the target is not a regular file')
  if (stats.nlink !== 1) return formatYamlBlocker('the target must have exactly one hard link')
  return null
}

export function previewPnpmWorkspaceYamlPatch(
  cwd: string,
  packageManager: string,
  minimatchOverride?: string,
) {
  if (packageManager !== 'pnpm') return null

  const path = findPnpmWorkspaceYamlPath(cwd)
  const exists = pathEntryExists(path)
  const pathBlocker = inspectWorkspacePath(path, resolve(cwd))
  if (pathBlocker) return createBlockedPatchPlan(path, '', pathBlocker)

  const source = exists ? readFileSync(path, 'utf8') : ''
  const sectionInspection = inspectPnpmWorkspaceYaml(source, [])
  if (!sectionInspection.safe)
    return createBlockedPatchPlan(path, source, sectionInspection.blocker)

  const warnings: string[] = []
  let targets = createDesiredTargets(sectionInspection.root, minimatchOverride)
  let inspection = inspectPnpmWorkspaceYaml(source, targets)

  // 보안 override는 선택 사항이므로, 사용자 overrides 형식을 안전하게 편집할 수 없으면
  // init 전체를 막지 않고 해당 항목만 건너뛴 뒤 경고한다.
  if (!inspection.safe && targets.some((target) => target.section === 'overrides')) {
    const allowBuildsOnly = targets.filter((target) => target.section !== 'overrides')
    const fallback = inspectPnpmWorkspaceYaml(source, allowBuildsOnly)
    if (fallback.safe) {
      warnings.push(
        `${inspection.blocker} Add the electron-builder minimatch overrides manually: ${PNPM_BUILDER_MINIMATCH_OVERRIDE_KEYS.join(', ')}.`,
      )
      targets = allowBuildsOnly
      inspection = fallback
    }
  }
  if (!inspection.safe) return createBlockedPatchPlan(path, source, inspection.blocker)

  const root = structuredClone(inspection.root)
  const changes: PnpmWorkspaceYamlPatchChange[] = []
  const ownershipClaims: PackageJsonOwnershipClaim[] = []

  for (const target of targets) {
    const claimPath = toClaimPath(target)
    const current = inspection.values.get(claimPath) ?? { exists: false as const }
    if (current.exists && current.value === target.value) continue

    changes.push({ action: 'set', path: claimPath, value: target.value })
    ownershipClaims.push({
      path: claimPath,
      action: 'set',
      value: target.value,
      previous: current.exists
        ? { state: 'value', value: cloneJsonValue(current.value) }
        : { state: 'missing' },
    })
    const sectionValue = root[target.section]
    root[target.section] = {
      ...(isRecord(sectionValue) ? sectionValue : {}),
      [target.key]: target.value,
    }
  }

  return {
    path,
    source,
    nextSource: changes.length === 0 ? source : renderYaml(root, source),
    created: !exists,
    changes,
    ownershipClaims,
    warnings,
    blockers: [],
  } satisfies PnpmWorkspaceYamlPatchPlan
}
