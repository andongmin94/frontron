import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const command = process.argv[2]
const extraArgs = process.argv.slice(3)
const lintPaths = ['src', '__tests__', 'scripts', 'build.config.ts', 'vitest.config.ts', 'index.js']
const packageJsonPaths = ['package.json']
const publishGuardTokenEnvironment = 'FRONTRON_RELEASE_PUBLISH_TOKEN'
const publishGuardFileEnvironment = 'FRONTRON_RELEASE_PUBLISH_TOKEN_FILE'

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const binPackages = {
  tsc: 'typescript',
}

function resolveBin(name) {
  const packageName = binPackages[name] ?? name
  const packageJsonPath = join(root, 'node_modules', packageName, 'package.json')

  if (!existsSync(packageJsonPath)) {
    console.error(`[tasks] Missing dependency for "${name}". Run npm install first.`)
    process.exit(1)
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const bin =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : (packageJson.bin?.[name] ?? packageJson.bin?.[packageName])

  if (!bin) {
    console.error(`[tasks] Package "${packageName}" does not expose a "${name}" binary.`)
    process.exit(1)
  }

  return join(root, 'node_modules', packageName, bin)
}

function runBin(name, args = []) {
  runNode([resolveBin(name), ...args])
}

function runNode(args = []) {
  run(process.execPath, args)
}

function runBuild() {
  runBin('unbuild')
}

function assertReleasePublishGuard() {
  const token = process.env[publishGuardTokenEnvironment]
  const tokenPath = process.env[publishGuardFileEnvironment]
  let expectedToken = null

  if (tokenPath) {
    try {
      expectedToken = readFileSync(tokenPath, 'utf8')
    } catch {
      expectedToken = null
    }
  }

  if (!token || !/^[a-f0-9]{64}$/.test(token) || token !== expectedToken) {
    console.error(
      '[tasks] Direct npm publish is disabled. Run "node release.mjs publish" from the repository root.',
    )
    process.exit(1)
  }
}

function alignObjectSection(lines, sectionName) {
  const start = lines.findIndex((line) => line === `  "${sectionName}": {`)

  if (start === -1) {
    return
  }

  let end = start + 1

  while (end < lines.length && !/^  }[,]?$/.test(lines[end])) {
    end += 1
  }

  const entryIndexes = []
  let longestKey = 0

  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(/^    ("(?:\\.|[^"])+"):\s(.*)$/)

    if (!match) {
      continue
    }

    entryIndexes.push({ index, key: match[1], value: match[2] })
    longestKey = Math.max(longestKey, match[1].length)
  }

  for (const entry of entryIndexes) {
    lines[entry.index] = `    ${entry.key.padEnd(longestKey)} : ${entry.value}`
  }
}

function getFormattedPackageJson(relativePath) {
  const packageJsonPath = join(root, relativePath)
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const lines = JSON.stringify(packageJson, null, 2).split('\n')

  for (const sectionName of ['scripts', 'dependencies', 'devDependencies']) {
    alignObjectSection(lines, sectionName)
  }

  return `${lines.join('\n')}\n`
}

function formatPackageJson(relativePath = 'package.json') {
  writeFileSync(join(root, relativePath), getFormattedPackageJson(relativePath), 'utf8')
}

function checkPackageJson(relativePath) {
  const packageJsonPath = join(root, relativePath)
  const actual = readFileSync(packageJsonPath, 'utf8')
  const expected = getFormattedPackageJson(relativePath)

  if (actual !== expected) {
    console.error(
      `[tasks] ${relativePath} does not match the repository package.json layout. Run "npm run lint".`,
    )
    process.exit(1)
  }
}

function runCheck() {
  runBin('oxlint', lintPaths)
  runBin('oxfmt', ['--check', ...lintPaths])

  for (const packageJsonPath of packageJsonPaths) {
    checkPackageJson(packageJsonPath)
  }
}

function runLint() {
  runBin('oxlint', ['--fix', ...lintPaths])
  runBin('oxfmt', [...lintPaths, ...packageJsonPaths])

  for (const packageJsonPath of packageJsonPaths) {
    formatPackageJson(packageJsonPath)
  }
}

switch (command) {
  case 'build':
    runBuild()
    break
  case 'test':
    runBin('vitest', [
      'run',
      '--no-file-parallelism',
      '--exclude',
      '__tests__/package-smoke.spec.ts',
      ...extraArgs,
    ])
    break
  case 'coverage':
    runBin('vitest', [
      'run',
      '--coverage',
      '--no-file-parallelism',
      '--exclude',
      '__tests__/package-smoke.spec.ts',
      ...extraArgs,
    ])
    break
  case 'test:package-smoke':
    runBin('vitest', [
      'run',
      '--no-file-parallelism',
      '__tests__/package-smoke.spec.ts',
      ...extraArgs,
    ])
    break
  case 'typecheck':
    runBin('tsc', ['--noEmit', ...extraArgs])
    break
  case 'check':
    runCheck()
    break
  case 'prepublishOnly':
    assertReleasePublishGuard()
    runBuild()
    runNode(['../release.mjs', 'check-metadata', ...extraArgs])
    break
  case 'lint':
    runLint()
    break
  case 'format-package-json':
    formatPackageJson()
    break
  default:
    console.error(`[tasks] Unknown command: ${command ?? '(missing)'}`)
    process.exit(1)
}
