import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const createPackageRoot = join(repoRoot, 'create-frontron')
const frontronPackageRoot = join(repoRoot, 'frontron')
const createPackagePath = join(createPackageRoot, 'package.json')
const frontronPackagePath = join(frontronPackageRoot, 'package.json')

function getNpmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
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
  const createPackage = readJson(createPackagePath)
  const frontronPackage = readJson(frontronPackagePath)
  const nextVersion = createPackage.version

  if (frontronPackage.version === nextVersion) {
    logStep(`versions already aligned at ${nextVersion}`)
    return nextVersion
  }

  frontronPackage.version = nextVersion
  writeJson(frontronPackagePath, frontronPackage)
  logStep(`synced frontron version to ${nextVersion}`)
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
      verifyRelease()
      publishPackages()
      return
    default:
      throw new Error(`Unknown release command: ${command}`)
  }
}

main()
