import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {
    ...actual,
    fsyncSync: vi.fn(actual.fsyncSync),
    readFileSync: vi.fn(actual.readFileSync),
  }
})

import { applyCleanPlan } from '../src/clean/apply'
import { createCleanPlan } from '../src/clean/plan'
import { runCli } from '../src/cli'
import { applyInitChanges } from '../src/init/apply'
import { MANIFEST_PATH } from '../src/init/manifest'
import type { InitPlan } from '../src/init/plan'
import type { PackageJson } from '../src/init/shared'
import {
  beginTransaction,
  commitTransaction,
  createTransactionSourceHash,
  recoverPendingTransaction,
  rollbackTransaction,
  TRANSACTION_JOURNAL_PATH,
  TRANSACTION_JOURNAL_PREPARING_PREFIX,
  TRANSACTION_LOCK_PREPARING_PREFIX,
  TRANSACTION_LOCK_PATH,
  TRANSACTION_RECOVERY_LOCK_PATH,
  TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX,
} from '../src/transaction-journal'
import * as fixtures from './helpers/frontron-cli-fixtures'

const DEAD_PROCESS_ID = 2_147_483_647
const RECOVERY_WORKER_TEST_NAME = '__frontron_recovery_worker__'
const TRANSACTION_LOCK_RELEASE_CLAIM_PATH = '.frontron-transaction.lock.releasing'

// markJournalAsAbandoned 함수는 테스트 저널을 종료된 이전 CLI가 남긴 상태로 바꾼다.
function markJournalAsAbandoned(projectRoot: string) {
  const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)
  const lockPath = join(projectRoot, TRANSACTION_LOCK_PATH)
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    ownerPid: number
  }

  journal.ownerPid = DEAD_PROCESS_ID
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)

  if (existsSync(lockPath)) {
    const projectLock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      ownerPid: number
      lockRoots?: string[]
    }

    for (const lockRoot of projectLock.lockRoots ?? [projectRoot]) {
      const transactionLockPath = join(lockRoot, TRANSACTION_LOCK_PATH)

      if (!existsSync(transactionLockPath)) continue

      const lock = JSON.parse(readFileSync(transactionLockPath, 'utf8')) as { ownerPid: number }
      lock.ownerPid = DEAD_PROCESS_ID
      writeFileSync(transactionLockPath, `${JSON.stringify(lock, null, 2)}\n`)
    }
  }
}

// runRecoveryWorker 함수는 별도 Vitest 프로세스에서 같은 프로젝트 복구를 한 번 시도한다.
function runRecoveryWorker(projectRoot: string, resultPath: string) {
  return new Promise<{ code: number | null; output: string }>((resolveWorker, rejectWorker) => {
    const child = spawn(
      process.execPath,
      [
        join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '__tests__/transaction-recovery.spec.ts',
        '-t',
        RECOVERY_WORKER_TEST_NAME,
        '--reporter=dot',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          FRONTRON_RECOVERY_WORKER_ROOT: projectRoot,
          FRONTRON_RECOVERY_WORKER_RESULT: resultPath,
        },
        windowsHide: true,
      },
    )
    let output = ''

    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.on('error', rejectWorker)
    child.on('close', (code) => resolveWorker({ code, output }))
  })
}

// createIoError 함수는 fsync 오류 전파 회귀 테스트에 쓸 Node 형식 EIO를 만든다.
function createIoError() {
  return Object.assign(new Error('injected directory fsync failure'), {
    code: 'EIO',
    syscall: 'fsync',
  })
}

test.runIf(Boolean(process.env.FRONTRON_RECOVERY_WORKER_ROOT))(RECOVERY_WORKER_TEST_NAME, () => {
  const projectRoot = process.env.FRONTRON_RECOVERY_WORKER_ROOT
  const resultPath = process.env.FRONTRON_RECOVERY_WORKER_RESULT

  if (!projectRoot || !resultPath) throw new Error('Recovery worker environment is incomplete.')

  try {
    writeFileSync(resultPath, JSON.stringify({ result: recoverPendingTransaction(projectRoot) }))
  } catch (error) {
    writeFileSync(resultPath, JSON.stringify({ error: (error as Error).message }))
  }
})

describe('persistent transaction recovery', () => {
  test('the next CLI run restores bytes and mode, removes new files, and is repeat-safe', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const originalBytes = Buffer.from([0, 1, 2, 3, 255, 10])
    const existingPath = join(projectRoot, 'binary.dat')
    const createdPath = join(projectRoot, 'generated', 'deep', 'new.txt')

    writeFileSync(existingPath, originalBytes)
    chmodSync(existingPath, 0o640)
    beginTransaction(projectRoot, 'init', [
      { path: existingPath, safetyRoot: projectRoot },
      { path: createdPath, safetyRoot: projectRoot },
    ])

    writeFileSync(existingPath, 'changed\n')
    chmodSync(existingPath, 0o600)
    mkdirSync(join(projectRoot, 'generated', 'deep'), { recursive: true })
    writeFileSync(createdPath, 'new\n')
    markJournalAsAbandoned(projectRoot)

    const firstOutput = fixtures.createOutput()
    expect(await runCli(['--help'], firstOutput, { cwd: projectRoot })).toBe(0)
    expect(readFileSync(existingPath)).toEqual(originalBytes)
    expect(existsSync(createdPath)).toBe(false)
    expect(existsSync(join(projectRoot, 'generated'))).toBe(false)
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(false)
    expect(firstOutput.info.mock.calls.flat().join('\n')).toContain(
      'Recovered an interrupted init transaction',
    )

    if (process.platform !== 'win32') {
      expect(lstatSync(existingPath).mode & 0o777).toBe(0o640)
    }

    const secondOutput = fixtures.createOutput()
    expect(await runCli(['--help'], secondOutput, { cwd: projectRoot })).toBe(0)
    expect(secondOutput.info.mock.calls.flat().join('\n')).not.toContain('Recovered an interrupted')
    expect(readFileSync(packageJsonPath, 'utf8')).toContain('sample-web-app')
  })

  test('init failure injection rolls back through the persistent journal', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonBefore = readFileSync(packageJsonPath)
    const generatedPath = join(projectRoot, 'electron', 'main.ts')
    const manifestPath = join(projectRoot, MANIFEST_PATH)
    const plan = {
      config: { cwd: projectRoot },
      files: [
        {
          path: generatedPath,
          action: 'create',
          reason: 'failure injection file',
          content: 'generated\n',
        },
        {
          path: manifestPath,
          action: 'create',
          reason: 'failure injection manifest',
          content: '{"createdFiles":[],"scripts":[]}\n',
        },
      ],
      warnings: [],
      blockers: [],
    } as unknown as InitPlan
    const packageJson = { name: 'sample-web-app' } as PackageJson

    Object.defineProperty(packageJson, 'injectedFailure', {
      enumerable: true,
      get() {
        throw new Error('injected JSON serialization failure')
      },
    })

    expect(() => applyInitChanges(packageJsonPath, packageJson, plan)).toThrow(
      'Written files were rolled back',
    )
    expect(readFileSync(packageJsonPath)).toEqual(packageJsonBefore)
    expect(existsSync(generatedPath)).toBe(false)
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
    expect(existsSync(manifestPath)).toBe(false)
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(false)
  })

  test('init failure rollback refuses a replacement hard link without overwriting its outside inode', () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const generatedPath = join(projectRoot, 'electron-main.ts')
    const outsidePath = join(outsideRoot, 'keep.txt')
    const originalGeneratedSource = 'original generated source\n'
    const outsideSource = 'outside remains untouched\n'

    writeFileSync(generatedPath, originalGeneratedSource)
    writeFileSync(outsidePath, outsideSource)
    const plan = {
      config: { cwd: projectRoot },
      files: [
        {
          path: generatedPath,
          action: 'overwrite',
          reason: 'hard-link swap failure injection',
          content: 'changed generated source\n',
        },
      ],
      warnings: [],
      blockers: [],
    } as unknown as InitPlan
    const packageJson = { name: 'sample-web-app' } as PackageJson

    Object.defineProperty(packageJson, 'injectedFailure', {
      enumerable: true,
      get() {
        unlinkSync(generatedPath)
        linkSync(outsidePath, generatedPath)
        throw new Error('injected hard-link swap failure')
      },
    })

    expect(() => applyInitChanges(packageJsonPath, packageJson, plan)).toThrow(
      'persistent journal: Transaction recovery target must be a regular file with exactly one hard link',
    )
    expect(readFileSync(outsidePath, 'utf8')).toBe(outsideSource)
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(true)

    unlinkSync(generatedPath)
    writeFileSync(generatedPath, 'ordinary changed file\n')
    markJournalAsAbandoned(projectRoot)
    expect(recoverPendingTransaction(projectRoot).recovered).toBe(true)
    expect(readFileSync(generatedPath, 'utf8')).toBe(originalGeneratedSource)
  })

  test('recovery recreates an existing directory and file removed by clean', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const existingDirectory = join(projectRoot, 'electron')
    const existingFile = join(existingDirectory, 'main.ts')

    mkdirSync(existingDirectory)
    writeFileSync(existingFile, 'original main\n')
    chmodSync(existingDirectory, 0o750)
    beginTransaction(projectRoot, 'clean', [
      { path: existingFile, safetyRoot: projectRoot },
      { path: existingDirectory, safetyRoot: projectRoot, kind: 'directory' },
    ])

    unlinkSync(existingFile)
    // 실제 clean처럼 파일을 먼저 지운 뒤 비어진 소유 디렉터리를 제거한다.
    rmdirSync(existingDirectory)
    markJournalAsAbandoned(projectRoot)

    expect(await runCli(['--help'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(existingFile, 'utf8')).toBe('original main\n')

    if (process.platform !== 'win32') {
      expect(lstatSync(existingDirectory).mode & 0o777).toBe(0o750)
    }
  })

  test('clean failure injection restores its immediate pre-clean state and removes the journal', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const tsconfigPath = join(projectRoot, 'tsconfig.json')

    writeFileSync(tsconfigPath, '{\n  "compilerOptions": {},\n}\n')
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonBefore = readFileSync(packageJsonPath)
    const packageJson = JSON.parse(packageJsonBefore.toString('utf8')) as PackageJson
    const plan = createCleanPlan(projectRoot, packageJson, { yes: true, force: false })
    const malformedTsconfig = '{\n  // changed after planning\n'

    writeFileSync(tsconfigPath, malformedTsconfig)

    expect(() => applyCleanPlan(projectRoot, packageJsonPath, packageJson, plan)).toThrow(
      'Project files were rolled back from the persistent journal',
    )
    expect(readFileSync(packageJsonPath)).toEqual(packageJsonBefore)
    expect(readFileSync(tsconfigPath, 'utf8')).toBe(malformedTsconfig)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(false)
  })

  test('clean failure rollback refuses a replacement hard link without overwriting its outside inode', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    const tsconfigPath = join(projectRoot, 'tsconfig.json')
    const packageJsonPath = join(projectRoot, 'package.json')
    const outsidePath = join(outsideRoot, 'keep.txt')
    const outsideSource = 'outside remains untouched\n'

    writeFileSync(tsconfigPath, '{\n  "compilerOptions": {},\n}\n')
    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonBefore = readFileSync(packageJsonPath)
    const packageJson = JSON.parse(packageJsonBefore.toString('utf8')) as PackageJson
    const plan = createCleanPlan(projectRoot, packageJson, { yes: true, force: false })
    const deleteFile = plan.files.find((file) => file.action === 'delete')

    expect(deleteFile).toBeDefined()
    writeFileSync(outsidePath, outsideSource)
    const expectedHash = deleteFile?.expectedHash
    let expectedHashReads = 0

    Object.defineProperty(deleteFile!, 'expectedHash', {
      configurable: true,
      get() {
        expectedHashReads += 1

        if (expectedHashReads === 2) {
          unlinkSync(packageJsonPath)
          linkSync(outsidePath, packageJsonPath)
          throw new Error('injected hard-link swap failure')
        }

        return expectedHash
      },
    })

    expect(() => applyCleanPlan(projectRoot, packageJsonPath, packageJson, plan)).toThrow(
      'persistent journal: Transaction recovery target must be a regular file with exactly one hard link',
    )
    expect(expectedHashReads).toBe(2)
    expect(readFileSync(outsidePath, 'utf8')).toBe(outsideSource)
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(true)

    unlinkSync(packageJsonPath)
    writeFileSync(packageJsonPath, '{"name":"ordinary-changed-file"}\n')
    markJournalAsAbandoned(projectRoot)
    expect(recoverPendingTransaction(projectRoot).recovered).toBe(true)
    expect(readFileSync(packageJsonPath)).toEqual(packageJsonBefore)
  })

  test('a crash during journal preparation is cleaned without touching project files', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonBefore = readFileSync(packageJsonPath)
    const preparingPath = join(
      projectRoot,
      `${TRANSACTION_JOURNAL_PREPARING_PREFIX}${DEAD_PROCESS_ID}-00000000-0000-4000-8000-000000000000.json`,
    )

    writeFileSync(preparingPath, '{"partiallyWritten":')

    expect(await runCli(['--help'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(existsSync(preparingPath)).toBe(false)
    expect(readFileSync(packageJsonPath)).toEqual(packageJsonBefore)
  })

  test('recovery normalizes published lock preparation and removes an orphaned preparation', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonBefore = readFileSync(packageJsonPath)
    const recoveryTransactionId = '00000000-0000-4000-8000-000000000001'
    const orphanTransactionPreparingPath = join(
      projectRoot,
      `${TRANSACTION_LOCK_PREPARING_PREFIX}${DEAD_PROCESS_ID}-00000000-0000-4000-8000-000000000002.json`,
    )
    const recoveryLockPath = join(projectRoot, TRANSACTION_RECOVERY_LOCK_PATH)
    const recoveryPreparingPath = join(
      projectRoot,
      `${TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX}${DEAD_PROCESS_ID}-${recoveryTransactionId}.json`,
    )
    const staleRecoveryLock = {
      schemaVersion: 2,
      kind: 'recovery',
      transactionId: recoveryTransactionId,
      ownerPid: DEAD_PROCESS_ID,
      createdAt: '2000-01-01T00:00:00.000Z',
      projectRoot,
      lockRoots: [projectRoot],
    }

    writeFileSync(orphanTransactionPreparingPath, '{"partiallyWritten":')
    writeFileSync(recoveryLockPath, `${JSON.stringify(staleRecoveryLock, null, 2)}\n`)
    linkSync(recoveryLockPath, recoveryPreparingPath)

    expect(lstatSync(recoveryLockPath).nlink).toBe(2)
    expect(recoverPendingTransaction(projectRoot)).toEqual({
      recovered: false,
      operation: null,
      cleanedPreparingJournals: 0,
    })
    expect(existsSync(orphanTransactionPreparingPath)).toBe(false)
    expect(existsSync(recoveryPreparingPath)).toBe(false)
    expect(existsSync(recoveryLockPath)).toBe(false)
    expect(readFileSync(packageJsonPath)).toEqual(packageJsonBefore)
  })

  test('recovery resumes after a crash leaves only a transaction lock release claim', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const targetPath = join(projectRoot, 'state.txt')
    const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)
    const lockPath = join(projectRoot, TRANSACTION_LOCK_PATH)
    const claimPath = join(projectRoot, TRANSACTION_LOCK_RELEASE_CLAIM_PATH)

    writeFileSync(targetPath, 'original\n')
    beginTransaction(projectRoot, 'clean', [{ path: targetPath, safetyRoot: projectRoot }])
    writeFileSync(targetPath, 'changed\n')
    markJournalAsAbandoned(projectRoot)

    // Simulate interruption after the fixed lock was unlinked but before its claim was removed.
    linkSync(lockPath, claimPath)
    unlinkSync(lockPath)
    const claimCreatedAt = lstatSync(claimPath).ctimeMs
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(claimCreatedAt + 4_999)

    try {
      expect(() => recoverPendingTransaction(projectRoot)).toThrow(
        'transaction lock is currently being released',
      )
      expect(readFileSync(targetPath, 'utf8')).toBe('changed\n')
      expect(existsSync(journalPath)).toBe(true)
      expect(existsSync(claimPath)).toBe(true)

      nowSpy.mockReturnValue(claimCreatedAt + 5_001)
      expect(recoverPendingTransaction(projectRoot)).toEqual({
        recovered: true,
        operation: 'clean',
        cleanedPreparingJournals: 0,
      })
    } finally {
      nowSpy.mockRestore()
    }

    expect(readFileSync(targetPath, 'utf8')).toBe('original\n')
    expect(existsSync(journalPath)).toBe(false)
    expect(existsSync(lockPath)).toBe(false)
    expect(existsSync(claimPath)).toBe(false)
  })

  test('beginning new work recovers an abandoned transaction and requires a retry', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const targetPath = join(projectRoot, 'state.txt')
    const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)
    const lockPath = join(projectRoot, TRANSACTION_LOCK_PATH)

    writeFileSync(targetPath, 'original\n')
    beginTransaction(projectRoot, 'clean', [{ path: targetPath, safetyRoot: projectRoot }])
    writeFileSync(targetPath, 'interrupted\n')
    markJournalAsAbandoned(projectRoot)

    expect(() =>
      beginTransaction(projectRoot, 'init', [{ path: targetPath, safetyRoot: projectRoot }]),
    ).toThrow('Recovered an interrupted clean transaction. Run the command again.')
    expect(readFileSync(targetPath, 'utf8')).toBe('original\n')
    expect(existsSync(journalPath)).toBe(false)
    expect(existsSync(lockPath)).toBe(false)

    const retryHandle = beginTransaction(projectRoot, 'init', [
      { path: targetPath, safetyRoot: projectRoot },
    ])
    rollbackTransaction(retryHandle)
  })

  test('recovery safely restores the ancestor pnpm workspace file of a nested app', async () => {
    const workspaceRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(workspaceRoot)
    const appRoot = join(workspaceRoot, 'apps', 'web')
    const pnpmWorkspacePath = join(workspaceRoot, 'pnpm-workspace.yaml')
    const originalSource = 'packages:\n  - apps/*\n'

    mkdirSync(appRoot, { recursive: true })
    writeFileSync(pnpmWorkspacePath, originalSource)
    beginTransaction(appRoot, 'init', [{ path: pnpmWorkspacePath, safetyRoot: workspaceRoot }])
    writeFileSync(pnpmWorkspacePath, 'changed: true\n')
    markJournalAsAbandoned(appRoot)

    expect(await runCli(['--help'], fixtures.createOutput(), { cwd: appRoot })).toBe(0)
    expect(readFileSync(pnpmWorkspacePath, 'utf8')).toBe(originalSource)
    expect(existsSync(join(appRoot, TRANSACTION_JOURNAL_PATH))).toBe(false)
  })

  test('recovery rejects a journal path that escapes the project', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const outsidePath = join(outsideRoot, 'outside.txt')
    const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)

    writeFileSync(outsidePath, 'outside remains unchanged\n')
    beginTransaction(projectRoot, 'clean', [{ path: packageJsonPath, safetyRoot: projectRoot }])
    writeFileSync(packageJsonPath, 'changed\n')
    markJournalAsAbandoned(projectRoot)

    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      snapshots: Array<{ path: string }>
    }
    journal.snapshots[0].path = '../outside.txt'
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)

    const output = fixtures.createOutput()
    expect(await runCli(['--help'], output, { cwd: projectRoot })).toBe(1)
    expect(readFileSync(outsidePath, 'utf8')).toBe('outside remains unchanged\n')
    expect(existsSync(journalPath)).toBe(true)
    expect(output.error.mock.calls.flat().join('\n')).toContain('points outside the project')
  })

  test('recovery refuses snapshot bytes whose integrity hash no longer matches', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)

    beginTransaction(projectRoot, 'clean', [{ path: packageJsonPath, safetyRoot: projectRoot }])
    writeFileSync(packageJsonPath, 'changed but preserved until safe recovery\n')
    markJournalAsAbandoned(projectRoot)

    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      snapshots: Array<{ contentBase64: string }>
    }
    journal.snapshots[0].contentBase64 = Buffer.from('corrupted snapshot\n').toString('base64')
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)

    const output = fixtures.createOutput()
    expect(await runCli(['--help'], output, { cwd: projectRoot })).toBe(1)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(
      'changed but preserved until safe recovery\n',
    )
    expect(existsSync(journalPath)).toBe(true)
    expect(output.error.mock.calls.flat().join('\n')).toContain('invalid snapshot bytes')
  })

  test('an exclusive lock exists before mutation and blocks a second transaction', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')

    const handle = beginTransaction(projectRoot, 'init', [
      { path: packageJsonPath, safetyRoot: projectRoot },
    ])

    expect(existsSync(join(projectRoot, TRANSACTION_LOCK_PATH))).toBe(true)
    expect(() =>
      beginTransaction(projectRoot, 'clean', [{ path: packageJsonPath, safetyRoot: projectRoot }]),
    ).toThrow('transaction is active')

    rollbackTransaction(handle)
    expect(existsSync(join(projectRoot, TRANSACTION_LOCK_PATH))).toBe(false)
  })

  test('a pre-commit cleanup error leaves the journal available for rollback', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const originalSource = readFileSync(packageJsonPath, 'utf8')
    const handle = beginTransaction(projectRoot, 'init', [
      { path: packageJsonPath, safetyRoot: projectRoot },
    ])
    const invalidPreparingPath = join(
      projectRoot,
      `${TRANSACTION_JOURNAL_PREPARING_PREFIX}${process.pid}-00000000-0000-4000-8000-000000000000.json`,
    )

    writeFileSync(packageJsonPath, 'committed only after cleanup succeeds\n')
    mkdirSync(invalidPreparingPath)

    expect(() => commitTransaction(handle)).toThrow('not a regular file')
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(true)

    rmdirSync(invalidPreparingPath)
    rollbackTransaction(handle)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(originalSource)
  })

  test('rollback rejects a replacement hard link without changing its outside inode', () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    const targetPath = join(projectRoot, 'state.txt')
    const outsidePath = join(outsideRoot, 'keep.txt')

    writeFileSync(targetPath, 'original project state\n')
    writeFileSync(outsidePath, 'outside remains untouched\n')
    const handle = beginTransaction(projectRoot, 'clean', [
      { path: targetPath, safetyRoot: projectRoot },
    ])

    unlinkSync(targetPath)
    linkSync(outsidePath, targetPath)

    expect(() => rollbackTransaction(handle)).toThrow('exactly one hard link')
    expect(readFileSync(outsidePath, 'utf8')).toBe('outside remains untouched\n')

    unlinkSync(targetPath)
    writeFileSync(targetPath, 'ordinary changed file\n')
    rollbackTransaction(handle)
    expect(readFileSync(targetPath, 'utf8')).toBe('original project state\n')
  })

  test('expected hash validation and snapshot reject a deterministic in-place mutation race', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const targetPath = join(projectRoot, 'state.txt')
    const originalSource = 'original source\n'
    const mutatedSource = 'mutated while descriptor read was returning\n'

    writeFileSync(targetPath, originalSource)
    const expectedHash = createTransactionSourceHash(originalSource)
    const targetIdentity = lstatSync(targetPath)
    const readFileMock = vi.mocked(readFileSync)
    const originalImplementation = readFileMock.getMockImplementation()
    let mutated = false

    expect(originalImplementation).toBeTypeOf('function')
    readFileMock.mockImplementation(((
      ...args: Parameters<typeof readFileSync>
    ): ReturnType<typeof readFileSync> => {
      const pathOrDescriptor = args[0]
      let readsTarget = pathOrDescriptor === targetPath

      if (typeof pathOrDescriptor === 'number') {
        const descriptorStats = fstatSync(pathOrDescriptor)
        readsTarget =
          descriptorStats.dev === targetIdentity.dev && descriptorStats.ino === targetIdentity.ino
      }

      const result = Reflect.apply(originalImplementation!, undefined, args) as ReturnType<
        typeof readFileSync
      >

      if (readsTarget && !mutated) {
        mutated = true
        writeFileSync(targetPath, mutatedSource)
      }

      return result
    }) as typeof readFileSync)

    try {
      expect(() =>
        beginTransaction(projectRoot, 'init', [
          { path: targetPath, safetyRoot: projectRoot, expectedHash },
        ]),
      ).toThrow('Transaction snapshot target changed while it was being read')
    } finally {
      readFileMock.mockImplementation(originalImplementation!)
    }

    expect(mutated).toBe(true)
    expect(readFileSync(targetPath, 'utf8')).toBe(mutatedSource)
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(false)
    expect(existsSync(join(projectRoot, TRANSACTION_LOCK_PATH))).toBe(false)
  })

  test.runIf(process.platform === 'win32' || process.platform === 'darwin')(
    'case-insensitive filesystem aliases cannot collide with reserved transaction files',
    () => {
      const projectRoot = fixtures.createTempProject()
      fixtures.tempDirs.push(projectRoot)

      expect(() =>
        beginTransaction(projectRoot, 'init', [
          {
            path: join(projectRoot, TRANSACTION_JOURNAL_PATH.toUpperCase()),
            safetyRoot: projectRoot,
            kind: 'directory',
          },
        ]),
      ).toThrow('must not overwrite its own journal')
    },
  )

  test('a reused current PID with a newer process start no longer blocks recovery', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const originalSource = readFileSync(packageJsonPath, 'utf8')
    const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)
    const lockPath = join(projectRoot, TRANSACTION_LOCK_PATH)

    beginTransaction(projectRoot, 'clean', [{ path: packageJsonPath, safetyRoot: projectRoot }])
    writeFileSync(packageJsonPath, 'changed by an old process\n')

    for (const statePath of [journalPath, lockPath]) {
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
        ownerPid: number
        createdAt: string
      }
      state.ownerPid = process.pid
      state.createdAt = '2000-01-01T00:00:00.000Z'
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
    }

    expect(await runCli(['--help'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(originalSource)
    expect(existsSync(journalPath)).toBe(false)
    expect(existsSync(lockPath)).toBe(false)
  })

  test('recovery rechecks a parent junction before restoring bytes', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    const nestedDirectory = join(projectRoot, 'nested')
    const targetPath = join(nestedDirectory, 'state.txt')
    const movedDirectory = join(outsideRoot, 'moved-nested')

    mkdirSync(nestedDirectory)
    writeFileSync(targetPath, 'original\n')
    beginTransaction(projectRoot, 'clean', [{ path: targetPath, safetyRoot: projectRoot }])
    writeFileSync(targetPath, 'outside must not be overwritten\n')
    renameSync(nestedDirectory, movedDirectory)
    symlinkSync(movedDirectory, nestedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
    markJournalAsAbandoned(projectRoot)

    const output = fixtures.createOutput()
    expect(await runCli(['--help'], output, { cwd: projectRoot })).toBe(1)
    expect(readFileSync(join(movedDirectory, 'state.txt'), 'utf8')).toBe(
      'outside must not be overwritten\n',
    )
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(true)
    expect(output.error.mock.calls.flat().join('\n')).toContain('symbolic link or junction')

    unlinkSync(nestedDirectory)
    renameSync(movedDirectory, nestedDirectory)

    expect(await runCli(['--help'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(targetPath, 'utf8')).toBe('original\n')
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(false)
  })

  test('two processes cannot restore the same pending journal concurrently', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const targetPath = join(projectRoot, 'large-state.bin')
    const originalBytes = Buffer.alloc(512 * 1024, 0x41)
    const resultPaths = [
      join(projectRoot, 'recovery-worker-1.json'),
      join(projectRoot, 'recovery-worker-2.json'),
    ]

    writeFileSync(targetPath, originalBytes)
    beginTransaction(projectRoot, 'clean', [{ path: targetPath, safetyRoot: projectRoot }])
    writeFileSync(targetPath, Buffer.alloc(originalBytes.length, 0x42))
    markJournalAsAbandoned(projectRoot)

    const workers = await Promise.all(
      resultPaths.map((resultPath) => runRecoveryWorker(projectRoot, resultPath)),
    )

    expect(workers.map((worker) => worker.code)).toEqual([0, 0])
    const workerResults = resultPaths.map(
      (resultPath) =>
        JSON.parse(readFileSync(resultPath, 'utf8')) as {
          result?: { recovered: boolean }
          error?: string
        },
    )
    expect(workerResults.filter((result) => result.result?.recovered).length).toBe(1)
    expect(
      workerResults.filter(
        (result) =>
          result.result?.recovered !== true &&
          result.result?.recovered !== false &&
          !/Another Frontron recovery(?: is active| lock is preparing)/.test(result.error ?? ''),
      ),
    ).toEqual([])
    expect(readFileSync(targetPath)).toEqual(originalBytes)
    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(false)
  }, 60_000)

  test('recovery normalizes journal and lock hard links left immediately after publication', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const targetPath = join(projectRoot, 'state.txt')
    const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)
    const lockPath = join(projectRoot, TRANSACTION_LOCK_PATH)

    writeFileSync(targetPath, 'original\n')
    beginTransaction(projectRoot, 'clean', [{ path: targetPath, safetyRoot: projectRoot }])
    writeFileSync(targetPath, 'changed\n')
    markJournalAsAbandoned(projectRoot)

    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      ownerPid: number
      transactionId: string
    }
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      ownerPid: number
      transactionId: string
    }
    const journalPreparingPath = join(
      projectRoot,
      `${TRANSACTION_JOURNAL_PREPARING_PREFIX}${journal.ownerPid}-${journal.transactionId}.json`,
    )
    const lockPreparingPath = join(
      projectRoot,
      `${TRANSACTION_LOCK_PREPARING_PREFIX}${lock.ownerPid}-${lock.transactionId}.json`,
    )

    linkSync(journalPath, journalPreparingPath)
    linkSync(lockPath, lockPreparingPath)
    expect(lstatSync(journalPath).nlink).toBe(2)
    expect(lstatSync(lockPath).nlink).toBe(2)

    expect(await runCli(['--help'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(targetPath, 'utf8')).toBe('original\n')
    expect(existsSync(journalPreparingPath)).toBe(false)
    expect(existsSync(lockPreparingPath)).toBe(false)
  })

  test('rollback and recovery repeatedly restore a mode 0444 file through writable descriptors', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const targetPath = join(projectRoot, 'read-only.txt')

    writeFileSync(targetPath, 'original read-only source\n')
    chmodSync(targetPath, 0o444)
    const rollbackHandle = beginTransaction(projectRoot, 'clean', [
      { path: targetPath, safetyRoot: projectRoot },
    ])
    chmodSync(targetPath, 0o644)
    writeFileSync(targetPath, 'changed before rollback\n')
    chmodSync(targetPath, 0o444)

    rollbackTransaction(rollbackHandle)
    expect(readFileSync(targetPath, 'utf8')).toBe('original read-only source\n')

    beginTransaction(projectRoot, 'clean', [{ path: targetPath, safetyRoot: projectRoot }])
    chmodSync(targetPath, 0o644)
    writeFileSync(targetPath, 'changed before recovery\n')
    chmodSync(targetPath, 0o444)
    markJournalAsAbandoned(projectRoot)

    expect(await runCli(['--help'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(readFileSync(targetPath, 'utf8')).toBe('original read-only source\n')

    if (process.platform !== 'win32') {
      expect(lstatSync(targetPath).mode & 0o777).toBe(0o444)
    }
  })

  test('directory fsync EIO is propagated and leaves the journal retryable', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const targetPath = join(projectRoot, 'durable-state.txt')

    writeFileSync(targetPath, 'original\n')
    const handle = beginTransaction(projectRoot, 'clean', [
      { path: targetPath, safetyRoot: projectRoot },
    ])
    writeFileSync(targetPath, 'changed\n')

    const fsyncMock = vi.mocked(fsyncSync)
    const originalImplementation = fsyncMock.getMockImplementation()

    expect(originalImplementation).toBeTypeOf('function')
    fsyncMock.mockImplementation((descriptor) => {
      if (fstatSync(descriptor).isDirectory()) throw createIoError()
      return originalImplementation?.(descriptor)
    })

    try {
      expect(() => rollbackTransaction(handle)).toThrow('injected directory fsync failure')
    } finally {
      fsyncMock.mockImplementation(originalImplementation!)
    }

    expect(existsSync(join(projectRoot, TRANSACTION_JOURNAL_PATH))).toBe(true)
    rollbackTransaction(handle)
    expect(readFileSync(targetPath, 'utf8')).toBe('original\n')
  })

  test('a case-sensitive safety root snapshots Foo and foo independently', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const upperPath = join(projectRoot, 'Foo.txt')
    const lowerPath = join(projectRoot, 'foo.txt')

    writeFileSync(upperPath, 'upper original\n')

    if (existsSync(lowerPath)) return

    writeFileSync(lowerPath, 'lower original\n')
    const handle = beginTransaction(projectRoot, 'clean', [
      { path: upperPath, safetyRoot: projectRoot },
      { path: lowerPath, safetyRoot: projectRoot },
    ])

    writeFileSync(upperPath, 'upper changed\n')
    writeFileSync(lowerPath, 'lower changed\n')
    rollbackTransaction(handle)

    expect(readFileSync(upperPath, 'utf8')).toBe('upper original\n')
    expect(readFileSync(lowerPath, 'utf8')).toBe('lower original\n')
  })

  test('sibling projects serialize a shared workspace and reject stale external locks and plans', () => {
    const workspaceRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(workspaceRoot)
    const appARoot = join(workspaceRoot, 'apps', 'a')
    const appBRoot = join(workspaceRoot, 'apps', 'b')
    const packageAPath = join(appARoot, 'package.json')
    const packageBPath = join(appBRoot, 'package.json')
    const workspacePath = join(workspaceRoot, 'pnpm-workspace.yaml')
    const originalSource = 'packages:\n  - apps/*\n'
    const firstCommittedSource = `${originalSource}allowBuilds:\n  electron: true\n`

    mkdirSync(appARoot, { recursive: true })
    mkdirSync(appBRoot, { recursive: true })
    writeFileSync(packageAPath, '{"name":"app-a"}\n')
    writeFileSync(packageBPath, '{"name":"app-b"}\n')
    writeFileSync(workspacePath, originalSource)

    const firstHandle = beginTransaction(appARoot, 'init', [
      {
        path: workspacePath,
        safetyRoot: workspaceRoot,
        expectedHash: createTransactionSourceHash(originalSource),
      },
    ])

    expect(() =>
      beginTransaction(appBRoot, 'init', [
        {
          path: workspacePath,
          safetyRoot: workspaceRoot,
          expectedHash: createTransactionSourceHash(originalSource),
        },
      ]),
    ).toThrow('transaction is active')

    writeFileSync(workspacePath, firstCommittedSource)
    commitTransaction(firstHandle)

    const stalePlan = {
      config: { cwd: appBRoot },
      files: [],
      warnings: [],
      blockers: [],
    } as unknown as InitPlan
    const staleWorkspacePlan = {
      path: workspacePath,
      source: originalSource,
      nextSource: `${originalSource}allowBuilds:\n  electron-winstaller: true\n`,
      changes: [
        {
          action: 'set' as const,
          path: 'allowBuilds.electron-winstaller',
          value: true as const,
        },
      ],
      ownershipClaims: [],
      warnings: [],
      blockers: [],
    }

    expect(() =>
      applyInitChanges(packageBPath, { name: 'app-b' }, stalePlan, null, staleWorkspacePlan),
    ).toThrow('changed after the transaction plan was created')
    expect(readFileSync(workspacePath, 'utf8')).toBe(firstCommittedSource)

    beginTransaction(appARoot, 'clean', [
      {
        path: workspacePath,
        safetyRoot: workspaceRoot,
        expectedHash: createTransactionSourceHash(firstCommittedSource),
      },
    ])
    writeFileSync(workspacePath, 'interrupted sibling change\n')
    markJournalAsAbandoned(appARoot)

    expect(() =>
      beginTransaction(appBRoot, 'clean', [
        {
          path: workspacePath,
          safetyRoot: workspaceRoot,
          expectedHash: createTransactionSourceHash(firstCommittedSource),
        },
      ]),
    ).toThrow('Recover that project before retrying')
    expect(existsSync(join(workspaceRoot, TRANSACTION_LOCK_PATH))).toBe(true)

    expect(recoverPendingTransaction(appARoot).recovered).toBe(true)
    expect(readFileSync(workspacePath, 'utf8')).toBe(firstCommittedSource)
    expect(existsSync(join(workspaceRoot, TRANSACTION_LOCK_PATH))).toBe(false)
  })
})
