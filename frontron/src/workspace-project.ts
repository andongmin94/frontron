import { existsSync, globSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { MANIFEST_PATH } from './init/manifest'
import type { PackageJson } from './init/shared'
import { assertProjectPathSafe } from './project-paths'

export type WorkspaceAwareCommand = 'init' | 'doctor' | 'clean' | 'update'

export type WorkspaceProjectResolution = {
  invocationRoot: string
  projectRoot: string
  source: 'cwd' | 'option' | 'config' | 'workspace'
}

const frontendDependencies = new Set([
  'vite',
  'vitepress',
  'next',
  'nuxt',
  '@remix-run/dev',
  '@remix-run/node',
  '@sveltejs/kit',
])

const frontendConfigNames = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.mts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'nuxt.config.js',
  'nuxt.config.ts',
  'remix.config.js',
  'remix.config.mjs',
  'svelte.config.js',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readPackageJson(packageJsonPath: string) {
  const value = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as unknown

  if (!isRecord(value)) {
    throw new Error(`package.json must contain an object: ${packageJsonPath}`)
  }

  return value as PackageJson
}

function normalizeProjectPath(value: string, label: string) {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/g, '')

  if (!normalized || normalized.includes('\0')) {
    throw new Error(`${label} must be a non-empty relative path.`)
  }

  if (isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`${label} must stay inside the workspace root.`)
  }

  return normalized
}

function assertProjectDirectory(invocationRoot: string, projectPath: string, label: string) {
  const normalized = normalizeProjectPath(projectPath, label)
  const projectRoot = resolve(invocationRoot, normalized)
  assertProjectPathSafe(invocationRoot, projectRoot, label)

  const projectStats = lstatSync(projectRoot)

  if (!projectStats.isDirectory() || projectStats.isSymbolicLink()) {
    throw new Error(`${label} must point to a real directory: ${normalized}`)
  }

  const packageJsonPath = join(projectRoot, 'package.json')
  assertProjectPathSafe(invocationRoot, packageJsonPath, `${label} package.json`)

  const packageStats = lstatSync(packageJsonPath)

  if (!packageStats.isFile() || packageStats.isSymbolicLink() || packageStats.nlink !== 1) {
    throw new Error(`${label} must contain a regular package.json with one hard link: ${normalized}`)
  }

  return projectRoot
}

function readConfiguredProject(rootPackageJson: PackageJson | null) {
  const config = rootPackageJson?.frontron

  if (typeof config === 'undefined') return null
  if (!isRecord(config)) {
    throw new Error('package.json frontron configuration must be an object.')
  }

  const project = config.project

  if (typeof project === 'undefined') return null
  if (typeof project !== 'string') {
    throw new Error('package.json frontron.project must be a relative path string.')
  }

  return project
}

function readWorkspacePatterns(invocationRoot: string, rootPackageJson: PackageJson | null) {
  const patterns: string[] = []
  const workspaces = rootPackageJson?.workspaces

  if (Array.isArray(workspaces)) {
    patterns.push(...workspaces.filter((entry): entry is string => typeof entry === 'string'))
  } else if (isRecord(workspaces) && Array.isArray(workspaces.packages)) {
    patterns.push(
      ...workspaces.packages.filter((entry): entry is string => typeof entry === 'string'),
    )
  }

  const pnpmWorkspacePath = join(invocationRoot, 'pnpm-workspace.yaml')

  if (existsSync(pnpmWorkspacePath)) {
    const value = parseYaml(readFileSync(pnpmWorkspacePath, 'utf8')) as unknown

    if (!isRecord(value) || !Array.isArray(value.packages)) {
      throw new Error('pnpm-workspace.yaml must contain a packages array for workspace discovery.')
    }

    patterns.push(
      ...value.packages.filter((entry): entry is string => typeof entry === 'string'),
    )
  }

  return [...new Set(patterns.map((entry) => entry.trim()).filter(Boolean))]
}

function toPackageJsonPattern(pattern: string) {
  const normalized = pattern
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/g, '')
  return normalized.endsWith('package.json') ? normalized : `${normalized}/package.json`
}

function findWorkspacePackageJsonPaths(invocationRoot: string, patterns: string[]) {
  const positivePatterns = patterns.filter((pattern) => !pattern.startsWith('!'))
  const negativePatterns = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => toPackageJsonPattern(pattern.slice(1)))

  if (positivePatterns.length === 0) return []

  return [
    ...new Set(
      globSync(positivePatterns.map(toPackageJsonPattern), {
        cwd: invocationRoot,
        exclude: ['**/node_modules/**', '**/.git/**', ...negativePatterns],
      }),
    ),
  ].sort()
}

function hasStringScript(packageJson: PackageJson, name: string) {
  return (
    typeof packageJson.scripts?.[name] === 'string' &&
    packageJson.scripts[name].trim().length > 0
  )
}

function isFrontendWorkspaceProject(projectRoot: string, packageJson: PackageJson) {
  if (!hasStringScript(packageJson, 'dev') || !hasStringScript(packageJson, 'build')) return false

  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  }

  if (Object.keys(dependencies).some((name) => frontendDependencies.has(name))) return true
  return frontendConfigNames.some((name) => existsSync(join(projectRoot, name)))
}

function formatCandidates(invocationRoot: string, projectRoots: string[]) {
  return projectRoots
    .map((projectRoot) => relative(invocationRoot, projectRoot).replace(/\\/g, '/'))
    .join(', ')
}

function chooseUniqueProject(
  invocationRoot: string,
  projectRoots: string[],
  label: string,
): string | null {
  const unique = [...new Set(projectRoots)]

  if (unique.length === 0) return null
  if (unique.length === 1) return unique[0]

  throw new Error(
    `Multiple ${label} workspace projects matched: ${formatCandidates(invocationRoot, unique)}. Pass --project <path> or set package.json frontron.project.`,
  )
}

export function resolveWorkspaceProject(
  cwd: string,
  command: WorkspaceAwareCommand,
  requestedProject?: string,
): WorkspaceProjectResolution {
  const invocationRoot = realpathSync.native(resolve(cwd))
  const rootPackageJsonPath = join(invocationRoot, 'package.json')
  const rootPackageJson = existsSync(rootPackageJsonPath)
    ? readPackageJson(rootPackageJsonPath)
    : null
  const configuredProject = requestedProject ?? readConfiguredProject(rootPackageJson)

  if (configuredProject) {
    return {
      invocationRoot,
      projectRoot: assertProjectDirectory(
        invocationRoot,
        configuredProject,
        requestedProject ? '--project' : 'package.json frontron.project',
      ),
      source: requestedProject ? 'option' : 'config',
    }
  }

  if (existsSync(join(invocationRoot, MANIFEST_PATH))) {
    return { invocationRoot, projectRoot: invocationRoot, source: 'cwd' }
  }

  if (rootPackageJson && isFrontendWorkspaceProject(invocationRoot, rootPackageJson)) {
    return { invocationRoot, projectRoot: invocationRoot, source: 'cwd' }
  }

  const workspacePatterns = readWorkspacePatterns(invocationRoot, rootPackageJson)

  if (workspacePatterns.length === 0) {
    return { invocationRoot, projectRoot: invocationRoot, source: 'cwd' }
  }

  const candidates = findWorkspacePackageJsonPaths(invocationRoot, workspacePatterns).map(
    (packageJsonPath) => {
      const relativeProject = packageJsonPath
        .replace(/\\/g, '/')
        .replace(/\/package\.json$/, '')
      const projectRoot = assertProjectDirectory(
        invocationRoot,
        relativeProject,
        'Workspace project',
      )
      const packageJson = readPackageJson(join(projectRoot, 'package.json'))

      return {
        projectRoot,
        initialized: existsSync(join(projectRoot, MANIFEST_PATH)),
        frontend: isFrontendWorkspaceProject(projectRoot, packageJson),
      }
    },
  )

  if (command !== 'init') {
    const initializedProject = chooseUniqueProject(
      invocationRoot,
      candidates
        .filter((candidate) => candidate.initialized)
        .map((candidate) => candidate.projectRoot),
      'initialized',
    )

    if (initializedProject) {
      return { invocationRoot, projectRoot: initializedProject, source: 'workspace' }
    }
  }

  const frontendProject = chooseUniqueProject(
    invocationRoot,
    candidates.filter((candidate) => candidate.frontend).map((candidate) => candidate.projectRoot),
    'frontend',
  )

  if (frontendProject) {
    return { invocationRoot, projectRoot: frontendProject, source: 'workspace' }
  }

  throw new Error(
    'No compatible frontend workspace project was found. Pass --project <path> or set package.json frontron.project.',
  )
}
