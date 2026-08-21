import fs from 'node:fs'
import path from 'node:path'

const renamedTemplateEntries: Record<string, string> = {
  _gitignore: '.gitignore',
}

const ignoredTemplateEntries = new Set(['.git', '.npmignore', 'dist', 'node_modules', 'output'])

function lstatIfExists(targetPath: string) {
  try {
    return fs.lstatSync(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function assertNoSymlinkAncestors(targetPath: string) {
  const absolutePath = path.resolve(targetPath)
  const parsed = path.parse(absolutePath)
  const segments = path.relative(parsed.root, absolutePath).split(path.sep)
  let currentPath = parsed.root

  for (const segment of segments) {
    if (!segment) continue
    currentPath = path.join(currentPath, segment)

    if (lstatIfExists(currentPath)?.isSymbolicLink()) {
      throw new Error(`Target path must not pass through a symbolic link: ${currentPath}`)
    }
  }
}

function canonicalizeMissingTarget(targetPath: string) {
  const missingSegments: string[] = []
  let existingPath = path.resolve(targetPath)

  while (!lstatIfExists(existingPath)) {
    const parentPath = path.dirname(existingPath)
    if (parentPath === existingPath) break
    missingSegments.unshift(path.basename(existingPath))
    existingPath = parentPath
  }

  const existingStats = lstatIfExists(existingPath)
  if (!existingStats?.isDirectory() || existingStats.isSymbolicLink()) {
    throw new Error(`Target parent must be a real directory: ${existingPath}`)
  }

  return path.resolve(fs.realpathSync.native(existingPath), ...missingSegments)
}

export function resolveTargetRoot(cwd: string, targetDir: string) {
  const canonicalCwd = fs.realpathSync.native(cwd)
  const requestedRoot = path.resolve(canonicalCwd, targetDir)

  if (requestedRoot === path.parse(requestedRoot).root) {
    throw new Error('The project target cannot be a filesystem root.')
  }

  assertNoSymlinkAncestors(requestedRoot)
  return canonicalizeMissingTarget(requestedRoot)
}

export function assertTargetAvailable(root: string) {
  if (lstatIfExists(root)) {
    throw new Error(`Target path already exists: ${root}. Choose a new directory.`)
  }
}

function copyTemplatePath(sourcePath: string, targetPath: string) {
  const sourceStats = fs.lstatSync(sourcePath)

  if (sourceStats.isSymbolicLink()) {
    throw new Error(`Template entries must not be symbolic links: ${sourcePath}`)
  }

  if (sourceStats.isDirectory()) {
    fs.mkdirSync(targetPath)

    for (const entryName of fs.readdirSync(sourcePath)) {
      copyTemplatePath(path.join(sourcePath, entryName), path.join(targetPath, entryName))
    }

    return
  }

  if (!sourceStats.isFile()) {
    throw new Error(`Template entry must be a regular file or directory: ${sourcePath}`)
  }

  fs.copyFileSync(sourcePath, targetPath)
}

function readTemplateEntries(templateDir: string) {
  const templateStats = lstatIfExists(templateDir)

  if (!templateStats?.isDirectory() || templateStats.isSymbolicLink()) {
    throw new Error(`Template directory not found: ${templateDir}`)
  }

  return fs
    .readdirSync(templateDir)
    .filter((entryName) => entryName !== 'package.json' && !ignoredTemplateEntries.has(entryName))
}

export function scaffoldProject(
  templateDir: string,
  root: string,
  packageJson: unknown,
  additionalFiles: ReadonlyMap<string, string> = new Map(),
) {
  const templateEntries = readTemplateEntries(templateDir)
  const parentPath = path.dirname(root)
  let rootCreated = false

  assertTargetAvailable(root)
  fs.mkdirSync(parentPath, { recursive: true })
  assertNoSymlinkAncestors(parentPath)

  try {
    fs.mkdirSync(root)
    rootCreated = true

    for (const entryName of templateEntries) {
      const targetName = renamedTemplateEntries[entryName] ?? entryName
      copyTemplatePath(path.join(templateDir, entryName), path.join(root, targetName))
    }

    fs.writeFileSync(
      path.join(root, 'package.json'),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      'utf8',
    )

    for (const [relativePath, content] of additionalFiles) {
      const targetPath = path.resolve(root, relativePath)
      const relativeTarget = path.relative(root, targetPath)

      if (
        relativeTarget === '..' ||
        relativeTarget.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeTarget)
      ) {
        throw new Error(`Additional scaffold file must stay inside the project: ${relativePath}`)
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, content, 'utf8')
    }
  } catch (error) {
    if (rootCreated) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }

    throw new Error(
      `Scaffolding failed: ${error instanceof Error ? error.message : String(error)}. No existing project was changed.`,
      { cause: error },
    )
  }
}
