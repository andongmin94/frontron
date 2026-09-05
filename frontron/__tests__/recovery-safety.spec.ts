import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { runCli } from '../src/cli'
import { beginTransaction, writeTransactionFile, TRANSACTION_JOURNAL_PATH } from '../src/transaction-journal'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createPendingProject() {
  const root = mkdtempSync(join(tmpdir(), 'frontron-read-only-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'test-app', private: true, version: '1.0.0' }))
  const target = join(root, 'target.txt')
  writeFileSync(target, 'before')
  const tx = beginTransaction(root, 'init', [{ path: target, safetyRoot: root }])
  writeTransactionFile(tx, target, 'after', root)
  const journalPath = join(root, TRANSACTION_JOURNAL_PATH)
  const lines = readFileSync(journalPath, 'utf8').split('\n')
  const header = JSON.parse(lines[0])
  header.processId = 2_147_483_647
  lines[0] = JSON.stringify(header)
  writeFileSync(journalPath, lines.join('\n'))
  return { root, target, journalPath }
}

test('real filesystem and child-process recovery regression suite', { timeout: 90_000 }, () => {
  const result = spawnSync(process.execPath, [join(packageRoot, 'scripts/recovery-smoke.mjs')], {
    encoding: 'utf8', timeout: 80_000,
  })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout).toContain('Recovery safety checks: 20 passed')
})

for (const args of [
  ['init', '--dry-run'], ['clean', '--dry-run'], ['update', '--dry-run'],
  ['init', '--yes', '--dry-run'], ['clean', '--yes', '--dry-run'], ['update', '--yes', '--dry-run'],
  ['doctor'], ['init'], ['clean'], ['update'],
]) {
  test(`${args.join(' ')} does not recover or alter a pending transaction`, async () => {
    const { root, target, journalPath } = createPendingProject()
    const before = readFileSync(journalPath)
    const messages: string[] = []
    const status = await runCli(args, { info: (s) => messages.push(s), error: (s) => messages.push(s) }, { cwd: root })
    expect(status).toBe(1)
    expect(messages.join('\n')).toContain('No files were changed')
    expect(readFileSync(target, 'utf8')).toBe('after')
    expect(readFileSync(journalPath)).toEqual(before)
  })
}

test('help remains read-only even when a journal exists', async () => {
  const { root, target, journalPath } = createPendingProject()
  const before = readFileSync(journalPath)
  expect(await runCli(['clean', '--help'], { info() {}, error() {} }, { cwd: root })).toBe(0)
  expect(readFileSync(target, 'utf8')).toBe('after')
  expect(readFileSync(journalPath)).toEqual(before)
})

test('authorized recovery stops before executing the requested clean', async () => {
  const { root, target, journalPath } = createPendingProject()
  const messages: string[] = []
  const status = await runCli(['clean', '--yes'], { info: (s) => messages.push(s), error: (s) => messages.push(s) }, { cwd: root })
  expect(status).toBe(1)
  expect(readFileSync(target, 'utf8')).toBe('before')
  expect(existsSync(journalPath)).toBe(false)
  expect(messages.join('\n')).toContain('requested command was not applied')
})

test('workspace dry-run does not recover its selected child', async () => {
  const { root, target, journalPath } = createPendingProject()
  const workspace = mkdtempSync(join(tmpdir(), 'frontron-workspace-read-only-'))
  roots.push(workspace)
  // Use a real nested copy, not a symlink; ownership remains project-local.
  const child = join(workspace, 'apps', 'web')
  mkdirSync(child, { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'] }))
  writeFileSync(join(child, 'package.json'), readFileSync(join(root, 'package.json')))
  writeFileSync(join(child, 'target.txt'), readFileSync(target))
  const source = readFileSync(journalPath, 'utf8').split(root).join(child)
  writeFileSync(join(child, TRANSACTION_JOURNAL_PATH), source)
  const messages: string[] = []
  expect(await runCli(['clean', '--project', 'apps/web', '--dry-run'], { info: (s) => messages.push(s), error: (s) => messages.push(s) }, { cwd: workspace })).toBe(1)
  expect(readFileSync(join(child, 'target.txt'), 'utf8')).toBe('after')
  expect(readFileSync(join(child, TRANSACTION_JOURNAL_PATH), 'utf8')).toBe(source)
})

test('selecting another project does not recover the invocation root', async () => {
  const { root, target, journalPath } = createPendingProject()
  const before = readFileSync(journalPath)
  await runCli(['clean', '--project', 'missing', '--yes'], { info() {}, error() {} }, { cwd: root })
  expect(readFileSync(target, 'utf8')).toBe('after')
  expect(readFileSync(journalPath)).toEqual(before)
})
