import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const packages = [
  { name: 'create-frontron', root: join(repoRoot, 'create-frontron') },
  { name: 'frontron', root: join(repoRoot, 'frontron') },
]

function npmInvocation(args) {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
    }
  }

  return { command: 'npm', args }
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.quiet ? 'pipe' : 'inherit',
    shell: false,
  })

  if (result.error) throw result.error

  if (result.status !== 0 && !options.quiet) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`)
  }

  return result
}

function runNpm(args, cwd, options = {}) {
  const invocation = npmInvocation(args)
  return run(invocation.command, invocation.args, cwd, options)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readPackage(spec) {
  return readJson(join(spec.root, 'package.json'))
}

function log(message) {
  console.log(`[release] ${message}`)
}

function assertMetadata() {
  const createPackage = readPackage(packages[0])
  const frontronPackage = readPackage(packages[1])
  const version = createPackage.version

  if (!/^\d+\.\d+\.\d+$/.test(version) || frontronPackage.version !== version) {
    throw new Error(
      `Package versions must use the same plain x.y.z value (${version}, ${frontronPackage.version}).`,
    )
  }

  if (frontronPackage.dependencies?.['create-frontron'] !== version) {
    throw new Error(`frontron must depend on create-frontron@${version}.`)
  }

  for (const spec of packages) {
    const packageJson = readPackage(spec)
    const lock = readJson(join(spec.root, 'package-lock.json'))

    if (lock.version !== packageJson.version || lock.packages?.['']?.version !== packageJson.version) {
      throw new Error(`${spec.name} package-lock.json version does not match package.json.`)
    }
  }

  const frontronLock = readJson(join(packages[1].root, 'package-lock.json'))
  if (frontronLock.packages?.['']?.dependencies?.['create-frontron'] !== version) {
    throw new Error('frontron package-lock.json does not use the matching create-frontron version.')
  }

  log(`metadata is aligned at ${version}`)
  return version
}

function verifyPackage(spec) {
  log(`installing ${spec.name}`)
  runNpm(['ci', '--fund=false', '--audit=false'], spec.root)
  runNpm(['ls', '--all'], spec.root)
  runNpm(['audit', '--audit-level=moderate'], spec.root)
  runNpm(['run', 'check'], spec.root)
  runNpm(['run', 'typecheck'], spec.root)
  runNpm(['run', 'coverage'], spec.root)
  runNpm(['run', 'build'], spec.root)
  runNpm(['run', 'test:package-smoke'], spec.root)
}

function verifyRelease() {
  assertMetadata()

  for (const spec of packages) {
    verifyPackage(spec)
  }

  log('testing a packed generated starter')
  runNpm(['run', 'test:release-smoke'], packages[0].root)

  if (process.env.FRONTRON_TEST_PACKAGE_MANAGERS === '1') {
    log('testing pnpm, Yarn, and Bun consumers')
    run(process.execPath, [join(repoRoot, 'scripts', 'package-manager-smoke.mjs')], repoRoot)
  }
}

function main() {
  switch (process.argv[2]) {
    case 'check-metadata':
      assertMetadata()
      return
    case 'verify':
      verifyRelease()
      return
    case undefined:
      throw new Error('Missing release command. Use "check-metadata" or "verify".')
    default:
      throw new Error(`Unknown release command: ${process.argv[2]}`)
  }
}

try {
  main()
} catch (error) {
  console.error(`[release] ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
