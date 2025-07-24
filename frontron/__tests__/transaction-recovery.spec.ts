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

function createProject(label: string) {
  const root = mkdtempSync(join(tmpdir(), `frontron-transaction-${label}-`))
  tempDirs.push(root)
  return root
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

test('a later command restores an interrupted transaction', () => {
  const root = createProject('recovery')
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

  const result = recoverPendingTransaction(root)

  expect(result).toEqual({ recovered: true, operation: 'clean' })
  expect(readFileSync(filePath, 'utf8')).toBe('before\n')
  expect(existsSync(join(root, TRANSACTION_JOURNAL_PATH))).toBe(false)
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

test('mutation rejects an external edit and rollback restores the snapshot', () => {
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
  expect(readFileSync(filePath, 'utf8')).toBe('before\n')
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
