import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  InitTemplateDependencies,
  InitTemplateInfo,
  InitTemplateResolvedFrom,
} from '../shared'

const REQUIRED_TEMPLATE_FILES = [
  'package.json',
  'src/electron/main.ts',
  'src/electron/window.ts',
  'src/electron/preload.ts',
  'src/electron/ipc.ts',
  'src/electron/dev.ts',
  'src/electron/static-server.ts',
  'src/types/electron.d.ts',
]

type TemplateCandidate = {
  templateDir: string
  packageJsonPath: string
  resolvedFrom: InitTemplateResolvedFrom
}

type ResolvedTemplate = TemplateCandidate & {
  packageVersion: string
}

export type CreateFrontronTemplateSnapshot = {
  info: InitTemplateInfo
  dependencies: InitTemplateDependencies
  electronFiles: ReadonlyMap<string, string>
  electronTypeSource: string
}

function readJson(pathValue: string) {
  return JSON.parse(readFileSync(pathValue, 'utf8')) as Record<string, unknown>
}

function assertRegularFile(pathValue: string, label: string) {
  const stats = lstatSync(pathValue)

  if (stats.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link: ${pathValue}`)
  }
  if (!stats.isFile()) {
    throw new Error(`${label} must be a regular file: ${pathValue}`)
  }
}

function assertRealDirectory(pathValue: string, label: string) {
  const stats = lstatSync(pathValue)

  if (stats.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link: ${pathValue}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${pathValue}`)
  }
}

function resolveTemplatePath(templateDir: string, relativePath: string) {
  const root = path.resolve(templateDir)
  const resolvedPath = path.resolve(root, relativePath)
  const relativePathFromRoot = path.relative(root, resolvedPath)

  if (
    relativePathFromRoot === '..' ||
    relativePathFromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePathFromRoot)
  ) {
    throw new Error(`Template path must stay inside create-frontron: ${relativePath}`)
  }

  return resolvedPath
}

function assertTemplateFile(templateDir: string, relativePath: string) {
  const root = path.resolve(templateDir)
  assertRealDirectory(root, 'create-frontron template')

  let currentPath = root
  for (const segment of relativePath.split('/').slice(0, -1)) {
    currentPath = path.join(currentPath, segment)
    assertRealDirectory(currentPath, `create-frontron template directory ${segment}`)
  }

  const filePath = resolveTemplatePath(root, relativePath)
  assertRegularFile(filePath, `create-frontron template file ${relativePath}`)
  return filePath
}

function listTypeScriptFiles(rootDir: string, currentDir = rootDir): string[] {
  assertRealDirectory(currentDir, 'create-frontron Electron source directory')
  const files: string[] = []

  for (const entryName of readdirSync(currentDir)) {
    const entryPath = path.join(currentDir, entryName)
    const stats = lstatSync(entryPath)

    if (stats.isSymbolicLink()) {
      throw new Error(`create-frontron template must not contain symbolic links: ${entryPath}`)
    }
    if (stats.isDirectory()) {
      files.push(...listTypeScriptFiles(rootDir, entryPath))
      continue
    }
    if (!stats.isFile()) {
      throw new Error(`create-frontron template contains an unsupported entry: ${entryPath}`)
    }
    if (entryName.endsWith('.ts')) {
      files.push(path.relative(rootDir, entryPath).split(path.sep).join('/'))
    }
  }

  return files.sort()
}

function readPackageVersion(packageJsonPath: string, expectedName: string) {
  assertRegularFile(packageJsonPath, `${expectedName} package.json`)
  const packageJson = readJson(packageJsonPath)

  if (packageJson.name !== expectedName || typeof packageJson.version !== 'string') {
    throw new Error(`Invalid ${expectedName} package metadata at ${packageJsonPath}.`)
  }

  return packageJson.version
}

function resolveFrontronPackageVersion() {
  const require = createRequire(import.meta.url)
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates: string[] = []

  try {
    candidates.push(require.resolve('frontron/package.json'))
  } catch {
    // Source checkouts can resolve through the relative package paths below.
  }

  candidates.push(
    path.resolve(moduleDir, '../../../package.json'),
    path.resolve(moduleDir, '../package.json'),
  )

  for (const packageJsonPath of [...new Set(candidates)]) {
    try {
      return readPackageVersion(packageJsonPath, 'frontron')
    } catch {
      continue
    }
  }

  throw new Error(`Unable to locate frontron package metadata. Searched: ${candidates.join('; ')}`)
}

function dependencyCandidate(): TemplateCandidate | null {
  try {
    const require = createRequire(import.meta.url)
    const packageJsonPath = require.resolve('create-frontron/package.json')

    return {
      packageJsonPath,
      templateDir: path.join(path.dirname(packageJsonPath), 'template'),
      resolvedFrom: 'dependency',
    }
  } catch {
    return null
  }
}

function repoCandidate(): TemplateCandidate | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const sourceLayout =
    path.basename(moduleDir) === 'runtime' &&
    path.basename(path.dirname(moduleDir)) === 'init' &&
    path.basename(path.dirname(path.dirname(moduleDir))) === 'src'

  if (!sourceLayout) return null

  return {
    packageJsonPath: path.resolve(moduleDir, '../../../../create-frontron/package.json'),
    templateDir: path.resolve(moduleDir, '../../../../create-frontron/template'),
    resolvedFrom: 'repo',
  }
}

function explicitCandidate(): TemplateCandidate | null {
  const templateDir = process.env.FRONTRON_CREATE_TEMPLATE_DIR?.trim()
  if (!templateDir) return null

  return {
    templateDir: path.resolve(templateDir),
    packageJsonPath: path.resolve(templateDir, '..', 'package.json'),
    resolvedFrom: 'env',
  }
}

function validateCandidate(candidate: TemplateCandidate, frontronVersion: string): ResolvedTemplate {
  assertRealDirectory(candidate.templateDir, 'create-frontron template')
  const packageVersion = readPackageVersion(candidate.packageJsonPath, 'create-frontron')

  if (packageVersion !== frontronVersion) {
    throw new Error(
      `create-frontron@${packageVersion} does not match frontron@${frontronVersion}.`,
    )
  }

  for (const relativePath of REQUIRED_TEMPLATE_FILES) {
    assertTemplateFile(candidate.templateDir, relativePath)
  }
  listTypeScriptFiles(path.join(candidate.templateDir, 'src', 'electron'))

  return { ...candidate, packageVersion }
}

function validateNamedCandidate(
  candidate: TemplateCandidate,
  frontronVersion: string,
  label: string,
) {
  try {
    return validateCandidate(candidate, frontronVersion)
  } catch (error) {
    throw new Error(`${label} must provide create-frontron@${frontronVersion}: ${(error as Error).message}`, {
      cause: error,
    })
  }
}

function resolveTemplate(): ResolvedTemplate {
  const frontronVersion = resolveFrontronPackageVersion()
  const explicit = explicitCandidate()

  if (explicit) {
    return validateNamedCandidate(explicit, frontronVersion, 'FRONTRON_CREATE_TEMPLATE_DIR')
  }

  const repository = repoCandidate()
  if (repository) {
    return validateNamedCandidate(repository, frontronVersion, 'The repository template')
  }

  const dependency = dependencyCandidate()
  if (!dependency) {
    throw new Error(
      `Unable to locate create-frontron@${frontronVersion}. Reinstall frontron and its exact dependency.`,
    )
  }

  return validateNamedCandidate(dependency, frontronVersion, 'The installed dependency')
}

function readTemplateDependencies(templateDir: string): InitTemplateDependencies {
  const packageJsonPath = assertTemplateFile(templateDir, 'package.json')
  const packageJson = readJson(packageJsonPath)
  const dependencies = {
    ...(packageJson.dependencies as Record<string, unknown> | undefined),
    ...(packageJson.devDependencies as Record<string, unknown> | undefined),
  }

  function version(packageName: string) {
    const value = dependencies[packageName]
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`create-frontron template is missing ${packageName}.`)
    }
    return value
  }

  return {
    electron: version('electron'),
    electronBuilder: version('electron-builder'),
    typescript: version('typescript'),
    nodeTypes: version('@types/node'),
  }
}

function info(template: ResolvedTemplate): InitTemplateInfo {
  return {
    source: 'create-frontron',
    packageName: 'create-frontron',
    packageVersion: template.packageVersion,
    resolvedFrom: template.resolvedFrom,
  }
}

function adaptElectronSource(source: string) {
  return source.split('../../public/').join('../public/')
}

export function getInitTemplateInfo(): InitTemplateInfo {
  return info(resolveTemplate())
}

export function readCreateFrontronTemplateFile(relativePath: string) {
  const template = resolveTemplate()
  return readFileSync(assertTemplateFile(template.templateDir, relativePath), 'utf8')
}

export function listCreateFrontronElectronFiles() {
  const template = resolveTemplate()
  return listTypeScriptFiles(path.join(template.templateDir, 'src', 'electron')).filter(
    (relativePath) => relativePath !== 'serve.ts',
  )
}

export function loadCreateFrontronTemplate(): CreateFrontronTemplateSnapshot {
  const template = resolveTemplate()
  const electronDir = path.join(template.templateDir, 'src', 'electron')
  const electronFiles = new Map<string, string>()

  for (const relativePath of listTypeScriptFiles(electronDir)) {
    if (relativePath === 'serve.ts') continue

    electronFiles.set(
      relativePath,
      adaptElectronSource(readFileSync(assertTemplateFile(electronDir, relativePath), 'utf8')),
    )
  }

  return {
    info: info(template),
    dependencies: readTemplateDependencies(template.templateDir),
    electronFiles,
    electronTypeSource: readFileSync(
      assertTemplateFile(template.templateDir, 'src/types/electron.d.ts'),
      'utf8',
    ),
  }
}

export function renderCreateFrontronElectronFile(relativePath: string) {
  return adaptElectronSource(readCreateFrontronTemplateFile(`src/electron/${relativePath}`))
}
