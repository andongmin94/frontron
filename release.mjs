import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const packages = [
  { name: 'create-frontron', root: join(repoRoot, 'create-frontron') },
  { name: 'frontron', root: join(repoRoot, 'frontron') },
]
const releaseEnvironment = 'FRONTRON_RELEASE'

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

function assertTrustedPublishing() {
  if (
    process.env.FRONTRON_TRUSTED_PUBLISHING !== '1' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error(
      'Publishing requires the GitHub Actions release workflow with npm trusted publishing and id-token: write.',
    )
  }
}

function assertCleanWorktree() {
  const result = run(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    repoRoot,
    { quiet: true },
  )

  if (result.status !== 0) {
    throw new Error('Unable to inspect the Git worktree.')
  }

  if (result.stdout.trim()) {
    throw new Error(`Refusing to publish from a dirty Git worktree:\n${result.stdout.trim()}`)
  }
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

  log('testing pnpm, Yarn, and Bun consumers')
  run(process.execPath, [join(repoRoot, 'scripts', 'package-manager-smoke.mjs')], repoRoot)
}

function publishedVersion(spec, version) {
  const result = runNpm(['view', `${spec.name}@${version}`, 'version'], repoRoot, { quiet: true })
  return result.status === 0 ? result.stdout.trim() : null
}

function publishPackage(spec, version) {
  if (publishedVersion(spec, version) === version) {
    log(`${spec.name}@${version} is already published; continuing the release`)
    return
  }

  log(`publishing ${spec.name}@${version}`)
  runNpm(['publish', '--provenance', '--access', 'public'], spec.root, {
    env: {
      ...process.env,
      [releaseEnvironment]: '1',
    },
  })

  if (publishedVersion(spec, version) !== version) {
    throw new Error(`npm did not expose ${spec.name}@${version} after publish.`)
  }
}

function verifyRegistryInstall(version) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'frontron-registry-'))

  try {
    writeFileSync(
      join(projectRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'frontron-registry-smoke',
          version: '0.0.0',
          private: true,
          type: 'module',
          scripts: { dev: 'node -e ""', build: 'node -e ""' },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    runNpm(
      [
        'install',
        '--ignore-scripts',
        '--fund=false',
        '--audit=false',
        `create-frontron@${version}`,
        `frontron@${version}`,
      ],
      projectRoot,
    )
    runNpm(
      [
        'exec',
        '--',
        'frontron',
        'init',
        '--yes',
        '--adapter',
        'generic-static',
        '--out-dir',
        'dist',
      ],
      projectRoot,
    )
    runNpm(['exec', '--', 'frontron', 'doctor'], projectRoot)
    runNpm(['exec', '--', 'frontron', 'clean', '--yes'], projectRoot)
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
  }
}

function publishRelease() {
  assertTrustedPublishing()
  assertCleanWorktree()
  const version = assertMetadata()
  verifyRelease()
  assertCleanWorktree()

  for (const spec of packages) {
    publishPackage(spec, version)
  }

  log(`testing registry installs for ${version}`)
  verifyRegistryInstall(version)
}

function main() {
  switch (process.argv[2]) {
    case 'check-metadata':
      assertMetadata()
      return
    case 'verify':
      verifyRelease()
      return
    case 'publish':
      publishRelease()
      return
    case undefined:
      throw new Error('Missing release command. Use "check-metadata", "verify", or "publish".')
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
