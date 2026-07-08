import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { PackageJsonOwnershipClaim } from './manifest'
import { cloneJsonValue, valuesEqual } from './package-json-path'

export const PNPM_WORKSPACE_YAML_PATH = 'pnpm-workspace.yaml'

const REQUIRED_ALLOW_BUILDS = ['electron', 'electron-winstaller'] as const

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

type AllowBuildsSection = {
  start: number
  end: number
  indent: string
}

type AllowBuildsEntry = {
  key: string
  value: unknown
  lineIndex: number
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

// normalizeYamlSource 함수는 YAML 원문이 항상 줄바꿈으로 끝나도록 정리한다.
function normalizeYamlSource(source: string) {
  return source.replace(/\r\n/g, '\n')
}

// splitYamlLines 함수는 YAML 원문을 줄 단위 배열로 나눈다.
function splitYamlLines(source: string) {
  const normalized = normalizeYamlSource(source)
  const lines = normalized.split('\n')

  if (lines.at(-1) === '') {
    lines.pop()
  }

  return lines
}

// isTopLevelContent 함수는 YAML 줄이 최상위 항목인지 확인한다.
function isTopLevelContent(line: string) {
  return (
    line.trim() !== '' &&
    !line.startsWith(' ') &&
    !line.startsWith('\t') &&
    !line.trim().startsWith('#')
  )
}

// findAllowBuildsSection 함수는 pnpm-workspace.yaml에서 allowBuilds 섹션 범위를 찾는다.
function findAllowBuildsSection(lines: string[]): AllowBuildsSection | null {
  const start = lines.findIndex((line) => /^allowBuilds\s*:\s*(?:#.*)?$/.test(line))

  if (start === -1) {
    return null
  }

  let end = lines.length

  for (let index = start + 1; index < lines.length; index += 1) {
    if (isTopLevelContent(lines[index])) {
      end = index
      break
    }
  }

  const entryLine = lines
    .slice(start + 1, end)
    .find((line) => parseAllowBuildsEntry(line, start + 1)?.key)
  const indent = entryLine?.match(/^(\s*)/)?.[1] || '  '

  return { start, end, indent }
}

// parseYamlScalar 함수는 YAML 스칼라 문자열을 JavaScript 값으로 파싱한다.
function parseYamlScalar(value: string) {
  const trimmed = value.trim()

  if (/^true$/i.test(trimmed)) {
    return true
  }

  if (/^false$/i.test(trimmed)) {
    return false
  }

  return trimmed.replace(/^(['"])(.*)\1$/, '$2')
}

// formatYamlScalar 함수는 JavaScript 값을 pnpm-workspace.yaml에 쓸 스칼라 값으로 포맷한다.
function formatYamlScalar(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return String(value)
}

// parseAllowBuildsEntry 함수는 allowBuilds 하위 한 줄을 key/value 항목으로 파싱한다.
function parseAllowBuildsEntry(line: string, lineIndex: number): AllowBuildsEntry | null {
  const match = line.match(/^(\s+)(['"]?)([^'":]+)\2:\s*(.*?)(?:\s+#.*)?$/)

  if (!match) {
    return null
  }

  return {
    key: match[3],
    value: parseYamlScalar(match[4]),
    lineIndex,
  }
}

// readAllowBuildsEntries 함수는 allowBuilds 섹션의 모든 key/value 항목을 읽는다.
function readAllowBuildsEntries(lines: string[], section: AllowBuildsSection | null) {
  const entries = new Map<string, AllowBuildsEntry>()

  if (!section) {
    return entries
  }

  for (let index = section.start + 1; index < section.end; index += 1) {
    const entry = parseAllowBuildsEntry(lines[index], index)

    if (entry) {
      entries.set(entry.key, entry)
    }
  }

  return entries
}

// readAllowBuildsValue 함수는 allowBuilds 섹션에서 특정 key의 현재 값을 읽는다.
function readAllowBuildsValue(source: string, key: string) {
  const lines = splitYamlLines(source)
  const section = findAllowBuildsSection(lines)
  const entry = readAllowBuildsEntries(lines, section).get(key)

  return entry ? { exists: true, value: entry.value } : { exists: false, value: undefined }
}

// setAllowBuildsValues 함수는 allowBuilds 섹션에 필요한 key/value들을 추가하거나 갱신한다.
function setAllowBuildsValues(source: string, values: Record<string, unknown>) {
  // This is intentionally not a full YAML parser. Frontron only owns the
  // top-level allowBuilds map used by pnpm's build-script approval feature.
  const lines = splitYamlLines(source)
  const section = findAllowBuildsSection(lines)
  const entries = readAllowBuildsEntries(lines, section)

  if (!section) {
    const prefix = lines.length > 0 ? `${lines.join('\n').replace(/\s+$/, '')}\n\n` : ''
    const body = Object.entries(values)
      .map(([key, value]) => `  ${key}: ${formatYamlScalar(value)}`)
      .join('\n')

    return `${prefix}allowBuilds:\n${body}\n`
  }

  const nextLines = [...lines]
  const missing: string[] = []

  for (const [key, value] of Object.entries(values)) {
    const entry = entries.get(key)

    if (entry) {
      nextLines[entry.lineIndex] = `${section.indent}${key}: ${formatYamlScalar(value)}`
    } else {
      missing.push(`${section.indent}${key}: ${formatYamlScalar(value)}`)
    }
  }

  if (missing.length > 0) {
    nextLines.splice(section.end, 0, ...missing)
  }

  return `${nextLines.join('\n')}\n`
}

// removeAllowBuildsKey 함수는 allowBuilds 섹션에서 특정 key를 제거한다.
function removeAllowBuildsKey(source: string, key: string) {
  const lines = splitYamlLines(source)
  const section = findAllowBuildsSection(lines)
  const entry = readAllowBuildsEntries(lines, section).get(key)

  if (!section || !entry) {
    return source
  }

  lines.splice(entry.lineIndex, 1)

  const nextSection = findAllowBuildsSection(lines)

  if (nextSection) {
    const hasEntries = [...readAllowBuildsEntries(lines, nextSection).values()].length > 0

    if (!hasEntries) {
      lines.splice(nextSection.start, nextSection.end - nextSection.start)
    }
  }

  const nextSource = lines.join('\n').trim() ? `${lines.join('\n').replace(/\s+$/, '')}\n` : ''

  return nextSource
}

// readPnpmWorkspaceYamlClaimValue 함수는 pnpm-workspace.yaml에서 소유권 claim 대상 값을 읽는다.
export function readPnpmWorkspaceYamlClaimValue(source: string, path: string) {
  const [section, key] = path.split('.')

  if (section !== 'allowBuilds' || !key) {
    return { exists: false, value: undefined }
  }

  return readAllowBuildsValue(source, key)
}

// restorePnpmWorkspaceYamlClaim 함수는 pnpm-workspace.yaml 값을 manifest claim 기준으로 복구한다.
export function restorePnpmWorkspaceYamlClaim(source: string, claim: PackageJsonOwnershipClaim) {
  const [section, key] = claim.path.split('.')

  if (section !== 'allowBuilds' || !key) {
    return source
  }

  if (claim.previous.state === 'missing') {
    return removeAllowBuildsKey(source, key)
  }

  return setAllowBuildsValues(source, {
    [key]: claim.previous.value,
  })
}

// previewPnpmWorkspaceYamlPatch 함수는 pnpm workspace에 필요한 allowBuilds 변경을 미리 계산한다.
export function previewPnpmWorkspaceYamlPatch(cwd: string, packageManager: string) {
  if (packageManager !== 'pnpm') {
    return null
  }

  const path = findPnpmWorkspaceYamlPath(cwd)
  const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const desiredValues = Object.fromEntries(REQUIRED_ALLOW_BUILDS.map((key) => [key, true]))
  const nextSource = setAllowBuildsValues(source, desiredValues)
  const changes: PnpmWorkspaceYamlPatchChange[] = []
  const ownershipClaims: PackageJsonOwnershipClaim[] = []

  for (const key of REQUIRED_ALLOW_BUILDS) {
    const claimPath = `allowBuilds.${key}`
    const current = readPnpmWorkspaceYamlClaimValue(source, claimPath)

    if (current.exists && valuesEqual(current.value, true)) {
      continue
    }

    changes.push({
      action: 'set',
      path: claimPath,
      value: true,
    })
    ownershipClaims.push({
      path: claimPath,
      action: 'set',
      value: true,
      previous: current.exists
        ? {
            state: 'value',
            value: cloneJsonValue(current.value),
          }
        : {
            state: 'missing',
          },
    })
  }

  return {
    path,
    source,
    nextSource,
    changes,
    ownershipClaims,
    warnings: [],
    blockers: [],
  } satisfies PnpmWorkspaceYamlPatchPlan
}
