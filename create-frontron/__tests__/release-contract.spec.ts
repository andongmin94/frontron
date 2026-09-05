import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const createPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = dirname(createPackageRoot)
const releaseScript = join(repositoryRoot, 'release.mjs')

function runNode(args: string[], cwd = repositoryRoot, env = process.env) {
  return spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 60_000 })
}

function localEnvironment() {
  const env = { ...process.env }
  for (const key of [
    'FRONTRON_TRUSTED_PUBLISHING', 'FRONTRON_RELEASE', 'GITHUB_ACTIONS',
    'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  ]) delete env[key]
  return env
}

test('release CLI exposes only verification commands and never publishes', () => {
  const missing = runNode([releaseScript])
  expect(missing.status).toBe(1)
  expect(`${missing.stdout}${missing.stderr}`).toContain('Missing release command')
  for (const command of ['matrix-smoke', 'publish']) {
    const result = runNode([releaseScript, command])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain(`Unknown release command: ${command}`)
  }
})

test('release metadata check accepts the aligned package pair', () => {
  const result = runNode([releaseScript, 'check-metadata'])
  expect(result.status, result.stderr || result.stdout).toBe(0)
})

test('prepublish hooks build locally without requiring a removed Actions workflow', { timeout: 130_000 }, () => {
  for (const packageRoot of [createPackageRoot, join(repositoryRoot, 'frontron')]) {
    const result = runNode([join(packageRoot, 'scripts', 'tasks.mjs'), 'prepublishOnly'], packageRoot, localEnvironment())
    expect(result.status, result.stderr || result.stdout).toBe(0)
  }
})
