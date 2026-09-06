import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { runCli } from '../src/cli'
import {
  TRANSACTION_JOURNAL_PATH,
  beginTransaction,
  createTransactionSourceHash,
} from '../src/transaction-journal'
import * as fixtures from './helpers/frontron-cli-fixtures'

const deadProcessId = 2_147_483_647

test('Remix init preserves an existing runtime esbuild dependency without duplicating it', async () => {
  const projectRoot = fixtures.createTempProjectWithScripts(
    { dev: 'remix dev', build: 'remix build' },
    {
      dependencies: { '@remix-run/node': '^2.0.0', esbuild: '^0.27.0' },
      devDependencies: { '@remix-run/dev': '^2.0.0' },
      extraFiles: { 'remix.config.js': 'module.exports = {}\n' },
    },
  )
  fixtures.tempDirs.push(projectRoot)

  expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  expect(packageJson.dependencies.esbuild).toBe('^0.27.0')
  expect(packageJson.devDependencies.esbuild).toBeUndefined()
})

test('doctor gives the explicit authorized command needed for pending recovery', async () => {
  const projectRoot = fixtures.createTempProject()
  fixtures.tempDirs.push(projectRoot)
  const packageJsonPath = join(projectRoot, 'package.json')
  const transaction = beginTransaction(projectRoot, 'clean', [
    {
      path: packageJsonPath,
      safetyRoot: projectRoot,
      expectedHash: createTransactionSourceHash(readFileSync(packageJsonPath)),
    },
  ])
  const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)
  const lines = readFileSync(journalPath, 'utf8').split(/\r?\n/)
  const header = JSON.parse(lines[0] ?? '') as { processId: number }
  header.processId = deadProcessId
  lines[0] = JSON.stringify(header)
  writeFileSync(journalPath, lines.join('\n'), 'utf8')

  const output = fixtures.createOutput()
  expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(1)
  expect(output.info.mock.calls.flat().join('\n')).toContain('--yes (without --dry-run)')
  expect(existsSync(transaction.journalPath)).toBe(true)
})
