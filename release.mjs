import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const createPackageRoot = join(repoRoot, 'create-frontron')
const frontronPackageRoot = join(repoRoot, 'frontron')
const createPackagePath = join(createPackageRoot, 'package.json')
const frontronPackagePath = join(frontronPackageRoot, 'package.json')
const packageSpecs = [
  {
    name: 'create-frontron',
    root: createPackageRoot,
    packagePath: createPackagePath,
    lockPath: join(createPackageRoot, 'package-lock.json'),
  },
  {
    name: 'frontron',
    root: frontronPackageRoot,
    packagePath: frontronPackagePath,
    lockPath: join(frontronPackageRoot, 'package-lock.json'),
  },
]
const tempRoot = join(repoRoot, '.tmp')
const publishStagingTag = 'frontron-staged'
const latestTag = 'latest'

function getNpmInvocation(args) {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
    }
  }

  return {
    command: 'npm',
    args,
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function createScratchDir(prefix) {
  mkdirSync(tempRoot, { recursive: true })
  return mkdtempSync(join(tempRoot, prefix))
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)

  if (!match) {
    throw new Error(`Unsupported package version "${version}". Use a plain x.y.z version.`)
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10))
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)

  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart !== rightPart) {
      return leftPart - rightPart
    }
  }

  return 0
}

function getHighestVersion(versions) {
  return versions.reduce((highest, version) =>
    compareVersions(version, highest) > 0 ? version : highest,
  )
}

function writePackageVersion(spec, version) {
  const packageJson = readJson(spec.packagePath)

  if (packageJson.version !== version) {
    packageJson.version = version
    writeJson(spec.packagePath, packageJson)
    logStep(`synced ${spec.name} package.json to ${version}`)
  }

  if (!existsSync(spec.lockPath)) {
    return
  }

  const lockJson = readJson(spec.lockPath)

  if (lockJson.version !== version) {
    lockJson.version = version
  }

  if (lockJson.packages?.['']?.version !== version) {
    lockJson.packages[''].version = version
  }

  writeJson(spec.lockPath, lockJson)
}

function syncFrontronCreateDependency(version) {
  const dependencyRange = `^${version}`
  const packageJson = readJson(frontronPackagePath)
  packageJson.dependencies ??= {}

  if (packageJson.dependencies['create-frontron'] !== dependencyRange) {
    packageJson.dependencies['create-frontron'] = dependencyRange
    writeJson(frontronPackagePath, packageJson)
    logStep(`synced frontron dependency create-frontron to ${dependencyRange}`)
  }

  const lockPath = join(frontronPackageRoot, 'package-lock.json')

  if (!existsSync(lockPath)) {
    return
  }

  const lockJson = readJson(lockPath)
  lockJson.packages ??= {}
  lockJson.packages[''] ??= {}
  lockJson.packages[''].dependencies ??= {}

  if (lockJson.packages[''].dependencies['create-frontron'] !== dependencyRange) {
    lockJson.packages[''].dependencies['create-frontron'] = dependencyRange
    writeJson(lockPath, lockJson)
  }
}

function assertFrontronCreateDependencySynced() {
  const packageJson = readJson(frontronPackagePath)
  const expectedRange = `^${packageJson.version}`
  const actualRange = packageJson.dependencies?.['create-frontron']

  if (actualRange !== expectedRange) {
    throw new Error(
      `frontron must depend on create-frontron "${expectedRange}" before publish. Run "node release.mjs publish" so the release script can sync and stage both packages safely.`,
    )
  }
}

function logStep(message) {
  console.log(`[release] ${message}`)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }

  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`)
  }
}

function runQuiet(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

function runNpm(args, cwd) {
  const invocation = getNpmInvocation(args)
  run(invocation.command, invocation.args, cwd)
}

function runNpmQuiet(args, cwd) {
  const invocation = getNpmInvocation(args)
  return runQuiet(invocation.command, invocation.args, cwd)
}

function runNode(args, cwd) {
  run(process.execPath, args, cwd)
}

function getPackageVersions() {
  const packageVersions = packageSpecs.map((spec) => readJson(spec.packagePath).version)
  const nextVersion = getHighestVersion(packageVersions)

  return { packageVersions, nextVersion }
}

function assertNpmPublishAccess() {
  logStep('checking npm publish authentication')
  const whoamiResult = runNpmQuiet(['whoami'], repoRoot)

  if (whoamiResult.status !== 0) {
    throw new Error(
      'npm is not authenticated. Run "npm login" with an account that can publish "frontron" and "create-frontron", then retry "node release.mjs publish".',
    )
  }

  const username = whoamiResult.stdout.trim()

  if (!username) {
    throw new Error('npm did not return a username. Run "npm login", then retry "node release.mjs publish".')
  }

  for (const spec of packageSpecs) {
    const ownerResult = runNpmQuiet(['owner', 'ls', spec.name], repoRoot)

    if (ownerResult.status !== 0) {
      throw new Error(`Unable to verify npm owners for "${spec.name}". Check npm access, then retry.`)
    }

    const ownerLines = ownerResult.stdout.split(/\r?\n/).map((line) => line.trim())
    const hasPublishAccess = ownerLines.some((line) => line === username || line.startsWith(`${username} `))

    if (!hasPublishAccess) {
      throw new Error(
        `npm user "${username}" is not listed as an owner of "${spec.name}". Publish with an owner account or add the user before retrying.`,
      )
    }
  }

  logStep(`npm user "${username}" can publish both packages`)
}

function versionExistsOnRegistry(spec, version) {
  const result = runNpmQuiet(['view', `${spec.name}@${version}`, 'version'], repoRoot)

  if (result.status === 0) {
    return true
  }

  const output = `${result.stdout}\n${result.stderr}`

  if (output.includes('E404') || output.includes('No match found for version')) {
    return false
  }

  throw new Error(`Unable to check npm registry version for "${spec.name}@${version}".`)
}

function assertVersionsNotPublished(version) {
  logStep(`checking npm registry for unpublished version ${version}`)

  const alreadyPublished = packageSpecs
    .filter((spec) => versionExistsOnRegistry(spec, version))
    .map((spec) => `${spec.name}@${version}`)

  if (alreadyPublished.length > 0) {
    throw new Error(
      `Refusing to publish an existing npm version: ${alreadyPublished.join(', ')}. Bump both package versions before retrying.`,
    )
  }
}

function readRegistryValue(args, description) {
  const result = runNpmQuiet(['view', ...args], repoRoot)

  if (result.status !== 0) {
    throw new Error(`Unable to verify ${description} on npm registry.`)
  }

  return result.stdout.trim()
}

function verifyPublishedPackages(version, tag = latestTag) {
  logStep(`verifying published npm packages at ${version} with dist-tag "${tag}"`)

  for (const spec of packageSpecs) {
    const publishedVersion = readRegistryValue([`${spec.name}@${version}`, 'version'], `${spec.name}@${version}`)

    if (publishedVersion !== version) {
      throw new Error(`npm registry returned "${publishedVersion}" for "${spec.name}@${version}".`)
    }

    const taggedVersion = readRegistryValue([spec.name, `dist-tags.${tag}`], `${spec.name} ${tag} dist-tag`)

    if (taggedVersion !== version) {
      throw new Error(
        `npm ${tag} dist-tag for "${spec.name}" is "${taggedVersion}", expected "${version}". Publish completed but ${tag} does not point at the release.`,
      )
    }
  }
}

function installNpm(args, cwd) {
  runNpm(['install', '--fund=false', '--audit=false', '--loglevel=error', ...args], cwd)
}

function verifyRegistryInstall(version) {
  logStep(`running registry install smoke for ${version}`)

  const scratchRoot = createScratchDir('registry-smoke-')

  try {
    const starterRoot = join(scratchRoot, 'starter')
    const retrofitRoot = join(scratchRoot, 'retrofit')

    mkdirSync(starterRoot, { recursive: true })
    runNpm(['init', '-y'], starterRoot)
    runNpm(
      [
        'exec',
        '--yes',
        '--package',
        `create-frontron@${version}`,
        '--',
        'create-frontron',
        'registry-starter',
        '--overwrite',
        'yes',
      ],
      starterRoot,
    )

    const generatedStarterRoot = join(starterRoot, 'registry-starter')

    installNpm([], generatedStarterRoot)
    runNpm(['run', 'typecheck'], generatedStarterRoot)

    mkdirSync(join(retrofitRoot, 'scripts'), { recursive: true })
    writeJson(join(retrofitRoot, 'package.json'), {
      name: 'registry-retrofit-app',
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'node scripts/dev-server.mjs',
        build: 'node scripts/build.mjs',
      },
    })
    writeFileSync(
      join(retrofitRoot, 'scripts', 'dev-server.mjs'),
      `import { createServer } from 'node:http'

createServer((_request, response) => response.end('ok')).listen(5173, '127.0.0.1')
`,
    )
    writeFileSync(
      join(retrofitRoot, 'scripts', 'build.mjs'),
      `import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
writeFileSync('dist/index.html', '<!doctype html><title>registry retrofit</title>')
`,
    )

    installNpm(['--save-dev', `frontron@${version}`], retrofitRoot)
    runNpm(['exec', '--', 'frontron', 'init', '--yes', '--preset', 'starter-like', '--out-dir', 'dist'], retrofitRoot)
    runNpm(['exec', '--', 'frontron', 'doctor'], retrofitRoot)
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

function describeRegistryVersionState(spec, version) {
  try {
    return `${spec.name}@${version}: ${versionExistsOnRegistry(spec, version) ? 'published' : 'not published'}`
  } catch (error) {
    return `${spec.name}@${version}: unable to verify (${error instanceof Error ? error.message : error})`
  }
}

function syncVersions() {
  const { packageVersions, nextVersion } = getPackageVersions()
  const alreadyAligned = packageVersions.every((version) => version === nextVersion)

  if (alreadyAligned) {
    logStep(`versions already aligned at ${nextVersion}`)
    return nextVersion
  }

  for (const spec of packageSpecs) {
    writePackageVersion(spec, nextVersion)
  }

  return nextVersion
}

function verifyRelease() {
  logStep('auditing frontron dependencies')
  runNpm(['audit', '--audit-level=moderate'], frontronPackageRoot)

  logStep('auditing create-frontron dependencies')
  runNpm(['audit', '--audit-level=moderate'], createPackageRoot)

  logStep('typechecking frontron')
  runNpm(['run', 'typecheck'], frontronPackageRoot)

  logStep('testing frontron')
  runNpm(['test'], frontronPackageRoot)

  logStep('running frontron package smoke')
  runNpm(['run', 'test:package-smoke'], frontronPackageRoot)

  logStep('typechecking create-frontron')
  runNpm(['run', 'typecheck'], createPackageRoot)

  logStep('testing create-frontron')
  runNpm(['test'], createPackageRoot)

  logStep('running create-frontron package smoke')
  runNpm(['run', 'test:package-smoke'], createPackageRoot)

  logStep('running create-frontron release smoke')
  runNpm(['run', 'test:release-smoke'], createPackageRoot)
}

function runMatrixSmoke(args = []) {
  logStep('running release matrix smoke')
  runNode([join(createPackageRoot, 'scripts', 'release-matrix-smoke.mjs'), ...args], repoRoot)
}

function publishPackages(version) {
  const publishOrder = [
    packageSpecs.find((spec) => spec.name === 'create-frontron'),
    packageSpecs.find((spec) => spec.name === 'frontron'),
  ].filter(Boolean)
  const published = []
  const skipped = []

  try {
    for (const spec of publishOrder) {
      if (versionExistsOnRegistry(spec, version)) {
        logStep(`${spec.name}@${version} is already published; skipping package publish`)
        skipped.push(spec.name)
        continue
      }

      logStep(`publishing ${spec.name} with dist-tag "${publishStagingTag}"`)
      runNpm(['publish', '--tag', publishStagingTag], spec.root)
      published.push(spec.name)
    }
  } catch (error) {
    const registryState = packageSpecs.map((spec) => describeRegistryVersionState(spec, version))

    throw new Error(
      `Publish failed after ${published.length > 0 ? published.join(', ') : 'no packages'} published and ${
        skipped.length > 0 ? skipped.join(', ') : 'no packages'
      } skipped. Registry state: ${registryState.join('; ')}. Original error: ${
        error instanceof Error ? error.message : error
      }`,
    )
  }
}

function setDistTagForPackages(version, tag, specs = packageSpecs) {
  for (const spec of specs) {
    logStep(`setting ${spec.name}@${version} dist-tag "${tag}"`)
    runNpm(['dist-tag', 'add', `${spec.name}@${version}`, tag], repoRoot)
  }
}

function promotePackagesToLatest(version) {
  const promoteOrder = [
    packageSpecs.find((spec) => spec.name === 'frontron'),
    packageSpecs.find((spec) => spec.name === 'create-frontron'),
  ].filter(Boolean)

  setDistTagForPackages(version, latestTag, promoteOrder)
}

function dryRunPublishPackages() {
  logStep('dry-running create-frontron publish')
  runNpm(['publish', '--dry-run', '--tag', publishStagingTag], createPackageRoot)

  logStep('dry-running frontron publish')
  runNpm(['publish', '--dry-run', '--tag', publishStagingTag], frontronPackageRoot)
}

function verifyPublishReadiness() {
  verifyRelease()
  runMatrixSmoke()
  {
    const { nextVersion } = getPackageVersions()
    syncFrontronCreateDependency(nextVersion)
  }
  dryRunPublishPackages()
}

function main() {
  const command = process.argv[2] ?? 'publish'
  const args = process.argv.slice(3)

  switch (command) {
    case 'sync-version':
      syncVersions()
      return
    case 'verify':
      verifyRelease()
      return
    case 'matrix-smoke':
      runMatrixSmoke(args)
      return
    case 'registry-smoke':
      verifyRegistryInstall(args[0] ?? readRegistryValue(['create-frontron', 'dist-tags.latest'], 'create-frontron latest dist-tag'))
      return
    case 'auth':
    case 'check-auth':
      assertNpmPublishAccess()
      return
    case 'check-frontron-publish-dependency':
      assertFrontronCreateDependencySynced()
      return
    case 'publish-dry-run':
    case 'dry-run':
      {
        const version = syncVersions()
        assertVersionsNotPublished(version)
      }
      verifyPublishReadiness()
      return
    case 'publish':
    case 'release':
      assertNpmPublishAccess()
      {
        const version = syncVersions()
        verifyPublishReadiness()
        publishPackages(version)
        setDistTagForPackages(version, publishStagingTag)
        verifyPublishedPackages(version, publishStagingTag)
        verifyRegistryInstall(version)
        promotePackagesToLatest(version)
        verifyPublishedPackages(version)
        verifyRegistryInstall(version)
      }
      return
    default:
      throw new Error(`Unknown release command: ${command}`)
  }
}

try {
  main()
} catch (error) {
  console.error(`[release] ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
