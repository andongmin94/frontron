import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const command = process.argv[2]
const extraArgs = process.argv.slice(3)
const lintPaths = [
  'src',
  '__tests__',
  'scripts',
  'template/src',
  'template/scripts',
  'template/vite.config.ts',
  'build.config.ts',
  'vitest.config.ts',
  'index.js',
]
const releaseScript = join(root, '..', 'release.mjs')
const formatPaths = [...lintPaths, 'package.json', 'template/package.json']

if (existsSync(releaseScript)) {
  lintPaths.push(releaseScript)
  formatPaths.push(releaseScript)
}

function run(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function resolveBin(name) {
  const packageName = name === 'tsc' ? 'typescript' : name
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

function runNode(args) {
  run(process.execPath, args)
}

function runBin(name, args = []) {
  runNode([resolveBin(name), ...args])
}

function assertReleasePublishGuard() {
  if (process.env.FRONTRON_RELEASE !== '1' || process.env.GITHUB_ACTIONS !== 'true') {
    console.error('[tasks] Direct npm publish is disabled. Use the GitHub Actions release workflow.')
    process.exit(1)
  }
}

switch (command) {
  case 'build':
    runBin('unbuild')
    break
  case 'test':
    runBin('unbuild')
    runBin('vitest', [
      'run',
      '--no-file-parallelism',
      '--exclude',
      '__tests__/package-smoke.spec.ts',
      '--exclude',
      '__tests__/release-rehearsal.spec.ts',
      ...extraArgs,
    ])
    break
  case 'coverage':
    runBin('unbuild')
    runBin('vitest', [
      'run',
      '--coverage',
      '--no-file-parallelism',
      '--exclude',
      '__tests__/package-smoke.spec.ts',
      '--exclude',
      '__tests__/release-rehearsal.spec.ts',
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
  case 'test:release-smoke':
    runBin('vitest', [
      'run',
      '--no-file-parallelism',
      '__tests__/release-rehearsal.spec.ts',
      ...extraArgs,
    ])
    break
  case 'typecheck':
    runBin('tsc', ['--noEmit', ...extraArgs])
    break
  case 'check':
    runBin('oxlint', lintPaths)
    break
  case 'lint':
    runBin('oxlint', ['--fix', ...lintPaths])
    runBin('oxfmt', formatPaths)
    break
  case 'prepublishOnly':
    assertReleasePublishGuard()
    runBin('unbuild')
    break
  default:
    console.error(`[tasks] Unknown command: ${command ?? '(missing)'}`)
    process.exit(1)
}
