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

function getNpmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseVersion(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10))
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
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
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

function runNpm(args, cwd) {
  run(getNpmExecutable(), args, cwd)
}

function runNode(args, cwd) {
  run(process.execPath, args, cwd)
}

function syncVersions() {
  const packageVersions = packageSpecs.map((spec) => readJson(spec.packagePath).version)
  const nextVersion = getHighestVersion(packageVersions)
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
  logStep('running frontron package smoke')
  runNpm(['run', 'test:package-smoke'], frontronPackageRoot)

  logStep('running create-frontron release smoke')
  runNpm(['run', 'test:release-smoke'], createPackageRoot)
}

function runMatrixSmoke(args = []) {
  logStep('running release matrix smoke')
  runNode([join(createPackageRoot, 'scripts', 'release-matrix-smoke.mjs'), ...args], repoRoot)
}

function publishPackages() {
  logStep('publishing frontron')
  runNpm(['publish'], frontronPackageRoot)

  logStep('publishing create-frontron')
  runNpm(['publish'], createPackageRoot)
}

function verifyPublishReadiness() {
  verifyRelease()
  runMatrixSmoke()
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
    case 'publish':
    case 'release':
      syncVersions()
      verifyPublishReadiness()
      publishPackages()
      return
    default:
      throw new Error(`Unknown release command: ${command}`)
  }
}

main()
