import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import {
  cleanupPreparingJournals,
  publishJournal,
  readActiveJournal,
  removeActiveJournal,
} from './transaction-journal/journal-store'
import {
  acquireTransactionLockSet,
  assertTransactionLockSetOwnership,
  releaseTransactionLockSet,
} from './transaction-journal/locks'
import {
  acquireRecoveryMutex,
  recoverPendingTransactionLocked,
  releaseRecoveryMutex,
} from './transaction-journal/recovery'
import { assertRegularProjectRoot, getJournalPath } from './transaction-journal/safety'
import {
  collectTargetLockRoots,
  createJournal,
  normalizeTransactionTargets,
  restoreJournalSnapshots,
  syncJournalResults,
} from './transaction-journal/snapshots'
import type {
  TransactionHandle,
  TransactionOperation,
  TransactionRecoveryResult,
  TransactionTarget,
} from './transaction-journal/types'

export {
  TRANSACTION_JOURNAL_PATH,
  TRANSACTION_JOURNAL_PREPARING_PREFIX,
  TRANSACTION_LOCK_PATH,
  TRANSACTION_LOCK_PREPARING_PREFIX,
  TRANSACTION_RECOVERY_LOCK_PATH,
  TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX,
} from './transaction-journal/types'
export type {
  TransactionHandle,
  TransactionRecoveryResult,
  TransactionTarget,
} from './transaction-journal/types'
export { createTransactionSourceHash } from './transaction-journal/safety'
export {
  assertTransactionTargetUnchanged,
  removeTransactionFile,
  writeTransactionFile,
} from './transaction-journal/mutation'

// beginTransaction 함수는 lock set 뒤 계획 원문을 재검증하고 active journal 공개 후에만 제어를 돌려준다.
export function beginTransaction(
  projectRootValue: string,
  operation: TransactionOperation,
  targets: TransactionTarget[],
): TransactionHandle {
  const projectRoot = resolve(projectRootValue)
  assertRegularProjectRoot(projectRoot)

  const recovery = recoverPendingTransaction(projectRoot)

  if (recovery.recovered) {
    throw new Error(
      `Recovered an interrupted ${recovery.operation} transaction. Run the command again.`,
    )
  }

  const normalizedTargets = normalizeTransactionTargets(projectRoot, targets)
  const requestedLockRoots = collectTargetLockRoots(projectRoot, normalizedTargets.values())
  const transactionId = randomUUID()
  const createdAt = new Date().toISOString()
  const lockRoots = acquireTransactionLockSet(
    projectRoot,
    requestedLockRoots,
    transactionId,
    createdAt,
  )
  const handle: TransactionHandle = {
    projectRoot,
    journalPath: getJournalPath(projectRoot),
    transactionId,
    lockRoots,
    mutatedTargets: new Set<string>(),
    managedMutationMode: false,
  }

  try {
    const journal = createJournal(
      projectRoot,
      operation,
      normalizedTargets.values(),
      transactionId,
      createdAt,
    )
    publishJournal(projectRoot, journal)
  } catch (error) {
    releaseTransactionLockSet(handle, true)
    throw error
  }

  return handle
}

// commitTransaction 함수는 결과와 부모를 동기화하고 lock set 재검증 직후 active journal을 제거한다.
export function commitTransaction(handle: TransactionHandle) {
  assertTransactionLockSetOwnership(handle)
  cleanupPreparingJournals(handle.projectRoot)
  const journal = readActiveJournal(handle.projectRoot)

  if (!journal || journal.transactionId !== handle.transactionId) {
    throw new Error('The active transaction journal changed before commit.')
  }

  syncJournalResults(handle.projectRoot, journal)
  assertTransactionLockSetOwnership(handle)
  removeActiveJournal(handle.projectRoot, handle.transactionId)
  releaseTransactionLockSet(handle, true)
}

// rollbackTransaction 함수는 snapshot을 반복 안전하게 복구하고 lock set 재검증 직후 journal을 제거한다.
export function rollbackTransaction(handle: TransactionHandle) {
  assertTransactionLockSetOwnership(handle)
  cleanupPreparingJournals(handle.projectRoot)
  const journal = readActiveJournal(handle.projectRoot)

  if (!journal) {
    throw new Error('The active transaction journal disappeared before rollback.')
  }

  if (journal.transactionId !== handle.transactionId) {
    throw new Error('The active transaction journal belongs to a different transaction.')
  }

  restoreJournalSnapshots(
    handle.projectRoot,
    journal,
    handle.managedMutationMode ? handle.mutatedTargets : undefined,
  )
  syncJournalResults(handle.projectRoot, journal)
  assertTransactionLockSetOwnership(handle)
  removeActiveJournal(handle.projectRoot, handle.transactionId)
  releaseTransactionLockSet(handle, true)
}

// recoverPendingTransaction 함수는 전체 복구 검증과 mutation을 별도 원자 recovery mutex 아래 실행한다.
export function recoverPendingTransaction(projectRootValue: string): TransactionRecoveryResult {
  const projectRoot = resolve(projectRootValue)
  assertRegularProjectRoot(projectRoot)
  const recoveryHandle = acquireRecoveryMutex(projectRoot)

  try {
    return recoverPendingTransactionLocked(projectRoot, recoveryHandle)
  } finally {
    releaseRecoveryMutex(recoveryHandle)
  }
}
