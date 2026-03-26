import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(docsDir)

const checkedFiles = [
  ...collectMarkdownFiles(join(repoRoot, 'docs')),
  join(repoRoot, 'README.md'),
  join(repoRoot, 'LICENSE.md'),
  join(repoRoot, 'SECURITY.md'),
  join(repoRoot, 'CONTRIBUTING.md'),
  join(repoRoot, 'CHANGELOG.md'),
  join(repoRoot, 'packages', 'frontron', 'README.md'),
  join(repoRoot, 'packages', 'create-frontron', 'README.md'),
].filter((filePath) => existsSync(filePath))

const failures = []

for (const filePath of checkedFiles) {
  const source = readFileSync(filePath, 'utf8')
  const relativePath = filePath.replace(`${repoRoot}\\`, '').replace(/\\/g, '/')

  for (const pattern of [/specs\/[A-Za-z0-9._/-]+/g, /\bPLANS\.md\b/g, /\bRELEASE\.md\b/g]) {
    const matches = source.match(pattern)

    if (matches?.length) {
      failures.push(
        `${relativePath}: stale reference(s) found -> ${[...new Set(matches)].join(', ')}`,
      )
    }
  }

  for (const target of readMarkdownTargets(source)) {
    const resolvedTarget = resolveLocalMarkdownTarget(filePath, target)

    if (!resolvedTarget) {
      continue
    }

    if (!existsSync(resolvedTarget)) {
      failures.push(
        `${relativePath}: dead local link -> ${target}`,
      )
    }
  }
}

if (failures.length > 0) {
  console.error('[docs] stale reference check failed:')

  for (const failure of failures) {
    console.error(`- ${failure}`)
  }

  process.exitCode = 1
} else {
  console.log('[docs] stale reference check passed.')
}

function collectMarkdownFiles(rootDir) {
  const markdownFiles = []
  const pendingDirs = [rootDir]

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop()

    if (!currentDir) {
      continue
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.vitepress' && entry.name !== '.vitepress-dist') {
          pendingDirs.push(absolutePath)
        }

        continue
      }

      if (entry.isFile() && extname(entry.name) === '.md') {
        markdownFiles.push(absolutePath)
      }
    }
  }

  return markdownFiles
}

function readMarkdownTargets(source) {
  const targets = []
  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g

  for (const match of source.matchAll(markdownLinkPattern)) {
    const target = match[1]?.trim()

    if (!target || /^https?:/i.test(target) || /^mailto:/i.test(target) || target.startsWith('#')) {
      continue
    }

    targets.push(target.replace(/^<|>$/g, ''))
  }

  return targets
}

function resolveLocalMarkdownTarget(fromFile, rawTarget) {
  const cleanTarget = rawTarget.split('#')[0]?.split('?')[0]

  if (!cleanTarget) {
    return null
  }

  const basePath = cleanTarget.startsWith('/')
    ? resolve(repoRoot, 'docs', cleanTarget.slice(1))
    : resolve(dirname(fromFile), cleanTarget)

  const candidates = [
    basePath,
    `${basePath}.md`,
    join(basePath, 'index.md'),
  ]

  return candidates.find((candidatePath) => existsSync(candidatePath)) ?? candidates[0]
}
