import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import {
  TRANSACTION_JOURNAL_PATH,
  beginTransaction,
  commitTransaction,
  createTransactionSourceHash,
  recoverPendingTransaction,
  removeTransactionFile,
  rollbackTransaction,
  writeTransactionFile,
} from '../src/transaction-journal'

const tempDirs: string[] = []
const deadProcessId = 2_147_483_647

function createProject(label: string) {
  const root = mkdtempSync(join(tmpdir(), `frontron-transaction-${label}-`))
  tempDirs.push(root)
  return root
}

function markJournalOwnerDead(root: string) {
  const journalPath = join(root, TRANSACTION_JOURNAL_PATH)
  const lines = readFileSync(journalPath, 'utf8').split(/\r?\n/)
  const header = JSON.parse(lines[0] ?? '') as { processId: number }
  header.processId = deadProcessId
  lines[0] = JSON.stringify(header)
  writeFileSync(journalPath, lines.join('\n'), 'utf8')
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('rollback restores existing files and removes new files', () => {
  const root = createProject('rollback')
  const existingPath = join(root, 'package.json')
  const newPath = join(root, 'electron', 'main.ts')
  writeFileSync(existingPath, 'before\n')

  const transaction = beginTransaction(root, 'init', [
    {
      path: existingPath,
      safetyRoot: root,
      expectedHash: createTransactionSourceHash('before\n'),
    },
    { path: newPath, safetyRoot: root, expectedHash: null },
  ])

  writeTransactionFile(transaction, existingPath, 'after\n', root)
  writeTransactionFile(transaction, newPath, 'generated\n', root)
  rollbackTransaction(transaction)

  expect(readFileSync(existingPath, 'utf8')).toBe('before\n')
  expect(existsSync(newPath)).toBe(false)
  expect(existsSync(join(root, TRANSACTION_JOURNAL_PATH))).toBe(false)
})

test('commit keeps applied changes and removes the journal', () => {
  const root = createProject('commit')
  const filePath = join(root, 'package.json')
  writeFileSync(filePath, 'before\n')

  const transaction = beginTransaction(root, 'init', [
    {
      path: filePath,
      safetyRoot: root,
      expectedHash: createTransactionSourceHash('before\n'),
    },
  ])

  writeTransactionFile(transaction, filePath, 'after\n', root)
  commitTransaction(transaction)

  expect(readFileSync(filePath, 'utf8')).toBe('after\n')
  expect(existsSync(join(root, TRANSACTION_JOURNAL_PATH))).toBe(false)
})

test('a later command restores only files mutated by an interrupted transaction', () => {
  const root = createProject('recovery')
  const changedPath = join(root, 'package.json')
  const untouchedPath = join(root, 'tsconfig.json')
  writeFileSync(changedPath, 'before\n')
  writeFileSync(untouchedPath, 'planned\n')

  const transaction = beginTransaction(root, 'clean', [
    {
      path: changedPath,
      safetyRoot: root,
      expectedHash: createTransactionSourceHash('before\n'),
    },
    {
      path: untouchedPath,
      safetyRoot: root,
      expectedHash: createTransactionSourceHash('planned\n'),
    },
  ])
  writeTransactionFile(transaction, changedPath, 'partial\n', root)
  writeFileSync(untouchedPath, 'user edit after crash\n')
  markJournalOwnerDead(root)

  const result = recoverPendingTransaction(root)

  expect(result).toEqual({ recovered: true, operation: 'clean' })
  expect(readFileSync(changedPath, 'utf8')).toBe('before\n')
  expect(readFileSync(untouchedPath, 'utf8')).toBe('user edit after crash\n')
  expect(existsSync(join(root, TRANSACTION_JOURNAL_PATH))).toBe(false)
})

test('recovery refuses to interfere with a transaction owned by a live process', () => {
  const root = createProject('active')
  const filePath = join(root, 'package.json')
  writeFileSync(filePath, 'before\n')

  const transaction = beginTransaction(root, 'clean', [
    {
      path: filePath,
      safetyRoot: root,
      expectedHash: createTransactionSourceHash('before\n'),
    },
  ])
  writeTransactionFile(transaction, filePath, 'partial\n', root)

  expect(() => recoverPendingTransaction(root)).toThrow('still active')
  expect(readFileSync(filePath, 'utf8')).toBe('partial\n')
  rollbackTransaction(transaction)
})

test('begin rejects a source that changed after planning', () => {
  const root = createProject('expected-hash')
  const filePath = join(root, 'package.json')
  writeFileSync(filePath, 'current\n')

  expect(() =>
    beginTransaction(root, 'init', [
      {
        path: filePath,
        safetyRoot: root,
        expectedHash: createTransactionSourceHash('planned\n'),
      },
    ]),
  ).toThrow('changed after planning')

  expect(existsSync(join(root, TRANSACTION_JOURNAL_PATH))).toBe(false)
})

test('mutation rejects an external edit and rollback preserves the unmutated edit', () => {
  const root = createProject('external-edit')
  const filePath = join(root, 'package.json')
  writeFileSync(filePath, 'before\n')

  const transaction = beginTransaction(root, 'init', [
    {
      path: filePath,
      safetyRoot: root,
      expectedHash: createTransactionSourceHash('before\n'),
    },
  ])

  writeFileSync(filePath, 'external\n')
  expect(() => writeTransactionFile(transaction, filePath, 'after\n', root)).toThrow(
    'changed after the transaction started',
  )

  rollbackTransaction(transaction)
  expect(readFileSync(filePath, 'utf8')).toBe('external\n')
})

test('rollback recreates an empty directory removed by clean', () => {
  const root = createProject('directory')
  const directoryPath = join(root, 'electron')
  const filePath = join(directoryPath, 'main.ts')
  mkdirSync(directoryPath)
  writeFileSync(filePath, 'source\n')

  const transaction = beginTransaction(root, 'clean', [
    {
      path: filePath,
      safetyRoot: root,
      expectedHash: createTransactionSourceHash('source\n'),
    },
    { path: directoryPath, safetyRoot: root, kind: 'directory' },
  ])

  removeTransactionFile(transaction, filePath, root)
  rmdirSync(directoryPath)
  rollbackTransaction(transaction)

  expect(readFileSync(filePath, 'utf8')).toBe('source\n')
  expect(existsSync(directoryPath)).toBe(true)
})
