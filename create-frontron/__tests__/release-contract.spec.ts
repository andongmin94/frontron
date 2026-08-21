import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

const createPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = dirname(createPackageRoot)
const releaseScript = join(repositoryRoot, 'release.mjs')

function runNode(args: string[], cwd = repositoryRoot, env = process.env) {
  return spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' })
}

function localEnvironment() {
  const env = { ...process.env }

  for (const key of [
    'FRONTRON_TRUSTED_PUBLISHING',
    'FRONTRON_RELEASE',
    'GITHUB_ACTIONS',
    'ACTIONS_ID_TOKEN_REQUEST_URL',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  ]) {
    delete env[key]
  }

  return env
}

test('release CLI exposes only the supported commands', () => {
  const missing = runNode([releaseScript])
  const unknown = runNode([releaseScript, 'matrix-smoke'])

  expect(missing.status).toBe(1)
  expect(`${missing.stdout}${missing.stderr}`).toContain('Missing release command')
  expect(unknown.status).toBe(1)
  expect(`${unknown.stdout}${unknown.stderr}`).toContain(
    'Unknown release command: matrix-smoke',
  )
})

test('release metadata check accepts the aligned package pair', () => {
  const result = runNode([releaseScript, 'check-metadata'])

  expect(result.status, result.stderr || result.stdout).toBe(0)
})

test('publish requires the trusted GitHub Actions OIDC environment', () => {
  const result = runNode([releaseScript, 'publish'], repositoryRoot, localEnvironment())

  expect(result.status).toBe(1)
  expect(`${result.stdout}${result.stderr}`).toContain(
    'requires the GitHub Actions release workflow with npm trusted publishing',
  )
})

test('package prepublish hooks reject direct npm publish', () => {
  for (const packageRoot of [createPackageRoot, join(repositoryRoot, 'frontron')]) {
    const result = runNode(
      [join(packageRoot, 'scripts', 'tasks.mjs'), 'prepublishOnly'],
      packageRoot,
      localEnvironment(),
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Direct npm publish is disabled')
  }
})
