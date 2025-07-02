import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertFixedLockOwnership,
  cleanupLockClaim,
  cleanupLockPreparations,
  createLockMetadata,
  publishFixedLock,
  readFixedLock,
  removeFixedLock,
  sortLockRoots,
} from './locks'
import { cleanupPreparingJournals, readActiveJournal, removeActiveJournal } from './journal-store'
import { getJournalPath, isTransactionOwnerActive, resolvePathReference } from './safety'
import { restoreJournalSnapshots, syncJournalResults } from './snapshots'
import type {
  NormalizedTransactionLock,
  TransactionJournal,
  TransactionRecoveryResult,
} from './types'

// collectJournalLockRoots 함수는 journal snapshot에서 복구 중 다시 보호할 모든 safety root를 구한다.
function collectJournalLockRoots(projectRoot: string, journal: TransactionJournal) {
  return sortLockRoots(
    projectRoot,
    journal.snapshots.map(
      (snapshot) =>
        resolvePathReference(projectRoot, snapshot, 'Transaction recovery lock target')
          .absoluteSafetyRoot,
    ),
  )
}

// inspectStaleTransactionLockSet 함수는 원 프로젝트 recovery에서만 stale 공유 lock 전체를 검증한다.
function inspectStaleTransactionLockSet(projectRoot: string, journal: TransactionJournal | null) {
  const projectLock = readFixedLock(projectRoot, 'transaction')
  const expectedTransactionId = journal?.transactionId ?? projectLock?.transactionId ?? null
  const lockRoots = sortLockRoots(projectRoot, [
    ...(journal ? collectJournalLockRoots(projectRoot, journal) : []),
    ...(projectLock?.lockRoots ?? []),
  ])
  const staleLocks = new Map<string, NormalizedTransactionLock>()

  for (const lockRoot of lockRoots) {
    cleanupLockClaim(lockRoot, 'transaction')
    cleanupLockPreparations(lockRoot, 'transaction')
    const lock = readFixedLock(lockRoot, 'transaction')

    if (!lock) continue

    if (lock.projectRoot !== projectRoot) {
      if (lockRoot !== projectRoot) {
        throw new Error(
          `A shared Frontron lock belongs to ${lock.projectRoot}. Recover that project before retrying.`,
        )
      }

      throw new Error('The project transaction lock belongs to a different project.')
    }

    if (expectedTransactionId && lock.transactionId !== expectedTransactionId) {
      throw new Error('The transaction lock does not match the pending journal.')
    }

    if (isTransactionOwnerActive(lock.ownerPid, lock.createdAt)) {
      const ownerLabel =
        lock.ownerPid === process.pid ? 'current process' : `process ${lock.ownerPid}`
      throw new Error(`Another Frontron transaction is active in ${ownerLabel}.`)
    }

    staleLocks.set(lockRoot, lock)
  }

  return { lockRoots, staleLocks }
}

// acquireRecoveryTransactionLockSet 함수는 누락 root만 채우고 기존 stale lock은 복구 완료까지 유지한다.
function acquireRecoveryTransactionLockSet(
  projectRoot: string,
  transactionId: string,
  lockRoots: string[],
  staleLocks: Map<string, NormalizedTransactionLock>,
) {
  const createdAt = new Date().toISOString()
  const metadata = createLockMetadata(
    'transaction',
    projectRoot,
    lockRoots,
    transactionId,
    createdAt,
  )
  const acquiredRoots: string[] = []
  const locks = new Map(staleLocks)

  try {
    for (const lockRoot of lockRoots) {
      if (locks.has(lockRoot)) continue

      publishFixedLock(lockRoot, metadata)
      acquiredRoots.push(lockRoot)
      const lock = readFixedLock(lockRoot, 'transaction')

      if (!lock) throw new Error('A recovery transaction lock disappeared after acquisition.')
      locks.set(lockRoot, lock)
    }
  } catch (error) {
    for (const lockRoot of acquiredRoots.reverse()) {
      try {
        removeFixedLock(lockRoot, 'transaction', transactionId, process.pid, projectRoot)
      } catch {
        // 원래 획득 오류를 유지하고 다음 원 프로젝트 recovery가 lock을 다시 검사하게 둔다.
      }
    }

    throw error
  }

  return { locks, acquiredRoots }
}

// assertRecoveryTransactionLockSetOwnership 함수는 stale lock을 포함한 복구 lock set이 그대로인지 확인한다.
function assertRecoveryTransactionLockSetOwnership(
  projectRoot: string,
  transactionId: string,
  lockRoots: string[],
  locks: Map<string, NormalizedTransactionLock>,
) {
  for (const lockRoot of lockRoots) {
    const expected = locks.get(lockRoot)
    const current = readFixedLock(lockRoot, 'transaction')

    if (
      !expected ||
      !current ||
      current.transactionId !== transactionId ||
      current.transactionId !== expected.transactionId ||
      current.ownerPid !== expected.ownerPid ||
      current.createdAt !== expected.createdAt ||
      current.projectRoot !== projectRoot
    ) {
      throw new Error('The recovery transaction lock set changed before journal removal.')
    }
  }
}

// releaseRecoveryTransactionLocks 함수는 복구 성공 여부에 따라 전체 또는 새로 채운 lock만 역순 제거한다.
function releaseRecoveryTransactionLocks(
  projectRoot: string,
  lockRoots: string[],
  locks: Map<string, NormalizedTransactionLock>,
  rootsToRelease: Iterable<string>,
) {
  const releaseRoots = new Set(rootsToRelease)

  for (const lockRoot of [...lockRoots].reverse()) {
    if (!releaseRoots.has(lockRoot)) continue

    const lock = locks.get(lockRoot)

    if (!lock) continue

    try {
      removeFixedLock(lockRoot, 'transaction', lock.transactionId, lock.ownerPid, projectRoot)
    } catch {
      // journal 제거 후 남은 lock은 다음 원 프로젝트 recovery가 metadata를 검증해 정리한다.
    }
  }
}

// acquireRecoveryMutex 함수는 완성된 metadata로 프로젝트별 복구 mutex를 원자 획득한다.
export function acquireRecoveryMutex(projectRootValue: string) {
  const projectRoot = resolve(projectRootValue)
  const transactionId = randomUUID()
  const createdAt = new Date().toISOString()
  const lockRoots = [projectRoot]

  cleanupLockClaim(projectRoot, 'recovery')
  cleanupLockPreparations(projectRoot, 'recovery')
  const existing = readFixedLock(projectRoot, 'recovery')

  if (existing) {
    if (existing.projectRoot !== projectRoot) {
      throw new Error('The recovery lock belongs to a different project.')
    }

    if (isTransactionOwnerActive(existing.ownerPid, existing.createdAt)) {
      throw new Error(`Another Frontron recovery is active in process ${existing.ownerPid}.`)
    }

    removeFixedLock(projectRoot, 'recovery', existing.transactionId, existing.ownerPid, projectRoot)
  }

  publishFixedLock(
    projectRoot,
    createLockMetadata('recovery', projectRoot, lockRoots, transactionId, createdAt),
  )

  return { projectRoot, transactionId }
}

// releaseRecoveryMutex 함수는 소유권을 재검증하며 현재 recovery mutex만 제거한다.
export function releaseRecoveryMutex(handle: { projectRoot: string; transactionId: string }) {
  removeFixedLock(
    handle.projectRoot,
    'recovery',
    handle.transactionId,
    process.pid,
    handle.projectRoot,
  )
}

// recoverPendingTransactionLocked 함수는 recovery mutex 안에서 stale lock 인수부터 journal 제거까지 수행한다.
export function recoverPendingTransactionLocked(
  projectRoot: string,
  recoveryHandle: { projectRoot: string; transactionId: string },
): TransactionRecoveryResult {
  const journal = readActiveJournal(projectRoot)

  if (journal && isTransactionOwnerActive(journal.ownerPid, journal.createdAt)) {
    const ownerLabel =
      journal.ownerPid === process.pid ? 'the current process' : `process ${journal.ownerPid}`
    throw new Error(`Another Frontron transaction is active in ${ownerLabel}.`)
  }

  const inspectedLocks = inspectStaleTransactionLockSet(projectRoot, journal)
  const cleanedPreparingJournals = cleanupPreparingJournals(projectRoot)

  if (!journal) {
    releaseRecoveryTransactionLocks(
      projectRoot,
      inspectedLocks.lockRoots,
      inspectedLocks.staleLocks,
      inspectedLocks.lockRoots,
    )

    return {
      recovered: false,
      operation: null,
      cleanedPreparingJournals,
    }
  }

  const recoveryLocks = acquireRecoveryTransactionLockSet(
    projectRoot,
    journal.transactionId,
    inspectedLocks.lockRoots,
    inspectedLocks.staleLocks,
  )
  let journalRemoved = false

  try {
    restoreJournalSnapshots(projectRoot, journal)
    syncJournalResults(projectRoot, journal)
    assertRecoveryTransactionLockSetOwnership(
      projectRoot,
      journal.transactionId,
      inspectedLocks.lockRoots,
      recoveryLocks.locks,
    )
    assertFixedLockOwnership(projectRoot, 'recovery', recoveryHandle.transactionId, projectRoot)
    removeActiveJournal(projectRoot, journal.transactionId)
    journalRemoved = true
  } finally {
    releaseRecoveryTransactionLocks(
      projectRoot,
      inspectedLocks.lockRoots,
      recoveryLocks.locks,
      journalRemoved || !existsSync(getJournalPath(projectRoot))
        ? inspectedLocks.lockRoots
        : recoveryLocks.acquiredRoots,
    )
  }

  return {
    recovered: true,
    operation: journal.operation,
    cleanedPreparingJournals,
  }
}
