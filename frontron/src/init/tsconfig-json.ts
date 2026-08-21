import { parse, parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PackageJsonOwnershipClaim } from './manifest'
import { cloneJsonValue, readPackageJsonPath } from './package-json-path'

export type TsconfigJson = {
  exclude?: unknown
  [key: string]: unknown
}

export type TsconfigJsonPatchChange = {
  action: 'add'
  path: string
  value: string
}

export type TsconfigJsonPatchPlan = {
  path: string
  source: string
  tsconfigJson: TsconfigJson
  changes: TsconfigJsonPatchChange[]
  ownershipClaims: PackageJsonOwnershipClaim[]
  warnings: string[]
  blockers: string[]
}

export type TsconfigDocument = {
  value: TsconfigJson
  root: Node
  excludeProperty?: Node
  excludeArray?: Node
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatParseError(errors: ParseError[]) {
  const first = errors[0]
  return first
    ? `${printParseErrorCode(first.error)} at offset ${first.offset}`
    : 'invalid document'
}

export function parseTsconfigDocument(source: string): TsconfigDocument {
  const valueErrors: ParseError[] = []
  const treeErrors: ParseError[] = []
  const options = { allowTrailingComma: true, disallowComments: false }
  const value = parse(source, valueErrors, options) as unknown
  const root = parseTree(source, treeErrors, options)

  if (valueErrors.length > 0 || treeErrors.length > 0 || !root) {
    throw new Error(
      `tsconfig.json could not be parsed as JSON or JSONC: ${formatParseError(
        valueErrors.length > 0 ? valueErrors : treeErrors,
      )}.`,
    )
  }

  if (!isRecord(value) || root.type !== 'object') {
    throw new Error('tsconfig.json must contain a top-level object.')
  }

  const excludeProperties = (root.children ?? []).filter(
    (property) => property.children?.[0]?.value === 'exclude',
  )

  if (excludeProperties.length > 1) {
    throw new Error('tsconfig.json contains duplicate "exclude" properties.')
  }

  const excludeProperty = excludeProperties[0]
  const excludeArray = excludeProperty?.children?.[1]

  if (
    excludeProperty &&
    (excludeArray?.type !== 'array' ||
      (excludeArray.children ?? []).some((element) => element.type !== 'string'))
  ) {
    throw new Error('tsconfig.json exclude must be an array of strings.')
  }

  return {
    value: value as TsconfigJson,
    root,
    excludeProperty,
    excludeArray,
  }
}

export function readTsconfigJson(path: string) {
  return parseTsconfigDocument(readFileSync(path, 'utf8')).value
}

export function previewTsconfigJsonPatch(cwd: string, desktopDir: string) {
  const path = join(cwd, 'tsconfig.json')
  if (!existsSync(path)) return null

  const source = readFileSync(path, 'utf8')
  let original: TsconfigJson

  try {
    original = parseTsconfigDocument(source).value
  } catch (error) {
    return {
      path,
      source,
      tsconfigJson: {},
      changes: [],
      ownershipClaims: [],
      warnings: [],
      blockers: [(error as Error).message],
    } satisfies TsconfigJsonPatchPlan
  }

  const exclude = Array.isArray(original.exclude) ? [...original.exclude] : []
  const changes: TsconfigJsonPatchChange[] = []
  const ownershipClaims: PackageJsonOwnershipClaim[] = []
  const previous = readPackageJsonPath(original, 'exclude')

  for (const value of [desktopDir, 'dist-electron', '.frontron']) {
    if (exclude.includes(value)) continue

    exclude.push(value)
    changes.push({ action: 'add', path: 'exclude', value })
    ownershipClaims.push({
      path: 'exclude',
      action: 'array-value',
      value,
      previous: previous.exists
        ? { state: 'value', value: cloneJsonValue(previous.value) }
        : { state: 'missing' },
    })
  }

  return {
    path,
    source,
    tsconfigJson: { ...original, exclude },
    changes,
    ownershipClaims,
    warnings: [],
    blockers: [],
  } satisfies TsconfigJsonPatchPlan
}
