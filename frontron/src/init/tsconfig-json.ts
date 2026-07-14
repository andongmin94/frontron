import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { findUniqueJsoncProperty, parseJsonc, parseJsoncTree } from './jsonc'
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

// cloneTsconfigJson 함수는 tsconfig JSON 객체를 안전하게 수정하기 위해 깊은 복사한다.
function cloneTsconfigJson(value: TsconfigJson): TsconfigJson {
  return JSON.parse(JSON.stringify(value)) as TsconfigJson
}

// parseTsconfigJson 함수는 최상위 객체와 단일 exclude 키를 확인한 JSONC만 객체로 변환한다.
function parseTsconfigJson(source: string) {
  const root = parseJsoncTree(source)

  if (root.type !== 'object') {
    throw new Error('tsconfig.json must contain a top-level object.')
  }

  findUniqueJsoncProperty(root, 'exclude', 'tsconfig.json')
  return parseJsonc<TsconfigJson>(source)
}

// readTsconfigJson 함수는 JSONC를 허용해 tsconfig 파일을 읽는다.
export function readTsconfigJson(path: string) {
  return parseTsconfigJson(readFileSync(path, 'utf8'))
}

// addArrayValueOwnershipClaim 함수는 tsconfig 배열 필드에 추가할 값의 소유권 기록을 만든다.
function addArrayValueOwnershipClaim(
  claims: PackageJsonOwnershipClaim[],
  before: TsconfigJson,
  after: TsconfigJson,
  path: string,
  value: string,
) {
  const beforeValue = readPackageJsonPath(before, path)
  const afterValue = readPackageJsonPath(after, path)
  const beforeValues = Array.isArray(beforeValue.value) ? beforeValue.value : []
  const afterValues = Array.isArray(afterValue.value) ? afterValue.value : []

  if (!afterValues.includes(value) || beforeValues.includes(value)) {
    return
  }

  claims.push({
    path,
    action: 'array-value',
    value,
    previous: beforeValue.exists
      ? {
          state: 'value',
          value: cloneJsonValue(beforeValue.value),
        }
      : {
          state: 'missing',
        },
  })
}

// normalizeExcludeValue 함수는 tsconfig exclude 값이 문자열 배열인지 확인하고 복사한다.
function normalizeExcludeValue(value: unknown, label: string) {
  if (typeof value === 'undefined') {
    return []
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings to preserve existing TypeScript rules.`)
  }

  return [...value]
}

// previewTsconfigJsonPatch 함수는 tsconfig.json에 추가할 exclude 변경을 미리 계산한다.
export function previewTsconfigJsonPatch(cwd: string, desktopDir: string) {
  const tsconfigPath = join(cwd, 'tsconfig.json')

  if (!existsSync(tsconfigPath)) {
    return null
  }

  const blockers: string[] = []
  const warnings: string[] = []
  const source = readFileSync(tsconfigPath, 'utf8')
  let original: TsconfigJson

  try {
    original = parseTsconfigJson(source)
  } catch (error) {
    const parseBlocker =
      error instanceof Error && error.message.includes('duplicate "exclude" properties')
        ? error.message
        : 'tsconfig.json could not be parsed as JSON or JSONC.'

    return {
      path: tsconfigPath,
      source,
      tsconfigJson: {},
      changes: [],
      ownershipClaims: [],
      warnings,
      blockers: [parseBlocker],
    }
  }

  const next = cloneTsconfigJson(original)
  const changes: TsconfigJsonPatchChange[] = []

  try {
    const exclude = normalizeExcludeValue(next.exclude, 'tsconfig.json exclude')

    for (const value of [desktopDir, 'dist-electron', '.frontron']) {
      if (!exclude.includes(value)) {
        exclude.push(value)
        changes.push({ action: 'add', path: 'exclude', value })
      }
    }

    next.exclude = exclude
  } catch (error) {
    blockers.push((error as Error).message)
  }

  const ownershipClaims: PackageJsonOwnershipClaim[] = []

  if (blockers.length === 0) {
    for (const change of changes) {
      addArrayValueOwnershipClaim(ownershipClaims, original, next, change.path, change.value)
    }
  }

  return {
    path: tsconfigPath,
    source,
    tsconfigJson: blockers.length > 0 ? original : next,
    changes,
    ownershipClaims,
    warnings,
    blockers,
  }
}
