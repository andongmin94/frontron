import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

const createPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const workspaceRoot = dirname(createPackageRoot)
const releaseScript = join(workspaceRoot, 'release.mjs')

function runNode(args: string[], cwd = workspaceRoot, env = process.env) {
  return spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: 'utf8',
  })
}

function localReleaseEnvironment() {
  const env = { ...process.env }

  for (const key of [
    'FRONTRON_TRUSTED_PUBLISHING',
    'FRONTRON_ALLOW_LOCAL_PUBLISH',
    'GITHUB_ACTIONS',
    'ACTIONS_ID_TOKEN_REQUEST_URL',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    'FRONTRON_RELEASE_PUBLISH_TOKEN',
    'FRONTRON_RELEASE_PUBLISH_TOKEN_FILE',
  ]) {
    delete env[key]
  }

  return env
}

test('release CLI rejects missing and unknown commands', () => {
  const missing = runNode([releaseScript])
  const unknown = runNode([releaseScript, 'release'])

  expect(missing.status).toBe(1)
  expect(`${missing.stdout}${missing.stderr}`).toContain('Missing release command')
  expect(unknown.status).toBe(1)
  expect(`${unknown.stdout}${unknown.stderr}`).toContain('Unknown release command: release')
})

test('release metadata check accepts the aligned package pair', () => {
  const result = runNode([releaseScript, 'check-metadata'])

  expect(result.status, result.stderr || result.stdout).toBe(0)
})

test('official publish refuses local execution before registry access', () => {
  const result = runNode([releaseScript, 'publish'], workspaceRoot, localReleaseEnvironment())

  expect(result.status).toBe(1)
  expect(`${result.stdout}${result.stderr}`).toContain(
    'Official releases must run through .github/workflows/frontron-release.yml',
  )
})

test('package prepublish hooks reject direct npm publish', () => {
  for (const packageRoot of [createPackageRoot, join(workspaceRoot, 'frontron')]) {
    const result = runNode(
      [join(packageRoot, 'scripts', 'tasks.mjs'), 'prepublishOnly'],
      packageRoot,
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Direct npm publish is disabled')
  }
})
