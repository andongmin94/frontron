import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

function verifyPublishedPackages(version) {
  logStep(`verifying published npm packages at ${version}`)

  for (const spec of packageSpecs) {
    const publishedVersion = readRegistryValue([`${spec.name}@${version}`, 'version'], `${spec.name}@${version}`)

    if (publishedVersion !== version) {
      throw new Error(`npm registry returned "${publishedVersion}" for "${spec.name}@${version}".`)
    }

    const latestVersion = readRegistryValue([spec.name, 'dist-tags.latest'], `${spec.name} latest dist-tag`)

    if (latestVersion !== version) {
      throw new Error(
        `npm latest dist-tag for "${spec.name}" is "${latestVersion}", expected "${version}". Publish completed but latest does not point at the release.`,
      )
    }
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
    packageSpecs.find((spec) => spec.name === 'frontron'),
    packageSpecs.find((spec) => spec.name === 'create-frontron'),
  ].filter(Boolean)
  const published = []

  try {
    for (const spec of publishOrder) {
      logStep(`publishing ${spec.name}`)
      runNpm(['publish'], spec.root)
      published.push(spec.name)
    }
  } catch (error) {
    const registryState = packageSpecs.map((spec) => describeRegistryVersionState(spec, version))

    throw new Error(
      `Publish failed after ${published.length > 0 ? published.join(', ') : 'no packages'} published. Registry state: ${registryState.join('; ')}. Original error: ${
        error instanceof Error ? error.message : error
      }`,
    )
  }
}

function dryRunPublishPackages() {
  logStep('dry-running frontron publish')
  runNpm(['publish', '--dry-run'], frontronPackageRoot)

  logStep('dry-running create-frontron publish')
  runNpm(['publish', '--dry-run'], createPackageRoot)
}

function verifyPublishReadiness() {
  verifyRelease()
  runMatrixSmoke()
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
    case 'auth':
    case 'check-auth':
      assertNpmPublishAccess()
      return
    case 'publish-dry-run':
    case 'dry-run':
      {
        const version = syncVersions()
        assertVersionsNotPublished(version)
      }
      verifyRelease()
      runMatrixSmoke()
      dryRunPublishPackages()
      return
    case 'publish':
    case 'release':
      assertNpmPublishAccess()
      {
        const version = syncVersions()
        assertVersionsNotPublished(version)
        verifyPublishReadiness()
        publishPackages(version)
        verifyPublishedPackages(version)
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
