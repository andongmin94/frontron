import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'

import { assertProjectPathSafe, isInsideDirectory } from '../project-paths'
import {
  assertSingleLinkFile,
  getFixedLockPath,
  getLockClaimPath,
  getLockPreparingPrefix,
  isTransactionOwnerActive,
  lstatPrecisely,
  pathIdentity,
  sameFileIdentity,
  syncDirectoryBestEffort,
} from './safety'
import { LOCK_SCHEMA_VERSION } from './types'
import type {
  FixedLockKind,
  NormalizedTransactionLock,
  TransactionHandle,
  TransactionLock,
} from './types'

// sortLockRoots 함수는 project root를 먼저 두고 공유 safety root를 항상 같은 순서로 정렬한다.
export function sortLockRoots(projectRootValue: string, lockRootValues: Iterable<string>) {
  const projectRoot = resolve(projectRootValue)
  const rootsByIdentity = new Map<string, string>()

  for (const lockRootValue of [projectRoot, ...lockRootValues]) {
    const lockRoot = resolve(lockRootValue)
    const stats = lstatSync(lockRoot)

    if (!stats.isDirectory()) {
      throw new Error(`Transaction safety root is not a directory: ${lockRoot}`)
    }

    if (lockRoot !== projectRoot && !isInsideDirectory(lockRoot, projectRoot)) {
      throw new Error(`Transaction lock root is not the project or an ancestor: ${lockRoot}`)
    }

    rootsByIdentity.set(pathIdentity(lockRoot, lockRoot), lockRoot)
  }

  return [...rootsByIdentity.values()].sort((left, right) => {
    if (left === projectRoot) return right === projectRoot ? 0 : -1
    if (right === projectRoot) return 1
    return left < right ? -1 : left > right ? 1 : 0
  })
}

// parseTransactionLock 함수는 고정 lock의 소유자, 원 프로젝트, 전체 lock set을 검증한다.
function parseTransactionLock(
  source: string,
  lockRootValue: string,
  expectedKind: FixedLockKind,
): NormalizedTransactionLock {
  let value: unknown

  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('Transaction lock is not valid JSON.')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Transaction lock has an invalid structure.')
  }

  const lockRoot = resolve(lockRootValue)
  const legacy = value as {
    schemaVersion?: unknown
    transactionId?: unknown
    ownerPid?: unknown
    createdAt?: unknown
  }

  if (
    legacy.schemaVersion === 1 &&
    expectedKind === 'transaction' &&
    typeof legacy.transactionId === 'string' &&
    legacy.transactionId.length > 0 &&
    Number.isSafeInteger(legacy.ownerPid) &&
    (legacy.ownerPid as number) > 0 &&
    typeof legacy.createdAt === 'string' &&
    Number.isFinite(Date.parse(legacy.createdAt))
  ) {
    return {
      schemaVersion: LOCK_SCHEMA_VERSION,
      kind: 'transaction',
      transactionId: legacy.transactionId,
      ownerPid: legacy.ownerPid as number,
      createdAt: legacy.createdAt,
      projectRoot: lockRoot,
      lockRoots: [lockRoot],
      lockRoot,
    }
  }

  const lock = value as Partial<TransactionLock>

  if (
    lock.schemaVersion !== LOCK_SCHEMA_VERSION ||
    lock.kind !== expectedKind ||
    typeof lock.transactionId !== 'string' ||
    lock.transactionId.length === 0 ||
    !Number.isSafeInteger(lock.ownerPid) ||
    (lock.ownerPid as number) <= 0 ||
    typeof lock.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(lock.createdAt)) ||
    typeof lock.projectRoot !== 'string' ||
    resolve(lock.projectRoot) !== lock.projectRoot ||
    !Array.isArray(lock.lockRoots) ||
    lock.lockRoots.length === 0 ||
    lock.lockRoots.some((root) => typeof root !== 'string' || resolve(root) !== root)
  ) {
    throw new Error('Transaction lock has an invalid structure.')
  }

  const projectRoot = lock.projectRoot
  const lockRoots = sortLockRoots(projectRoot, lock.lockRoots)

  if (!lockRoots.includes(lockRoot)) {
    throw new Error('Transaction lock does not include its own safety root.')
  }

  return { ...(lock as TransactionLock), projectRoot, lockRoots, lockRoot }
}

// normalizePublishedLockHardLink 함수는 공개 직후 남은 lock 준비 hard-link만 inode와 ID 확인 후 제거한다.
function normalizePublishedLockHardLink(
  lockRoot: string,
  kind: FixedLockKind,
  lockPath: string,
  lockStats: ReturnType<typeof lstatPrecisely>,
  lock: NormalizedTransactionLock,
) {
  if (lockStats.nlink === 1n) return

  if (lockStats.nlink !== 2n || !/^[0-9a-z-]+$/i.test(lock.transactionId)) {
    throw new Error('Transaction lock has an unexpected hard-link count.')
  }

  const preparingPath = resolve(
    lockRoot,
    `${getLockPreparingPrefix(kind)}${lock.ownerPid}-${lock.transactionId}.json`,
  )
  assertProjectPathSafe(lockRoot, preparingPath, 'Transaction preparing lock')

  if (!existsSync(preparingPath)) {
    throw new Error('Transaction lock has an unrecognized hard link.')
  }

  const preparingStats = lstatPrecisely(preparingPath)
  const preparingLock = parseTransactionLock(readFileSync(preparingPath, 'utf8'), lockRoot, kind)

  if (
    !preparingStats.isFile() ||
    !sameFileIdentity(lockStats, preparingStats) ||
    preparingLock.transactionId !== lock.transactionId ||
    preparingLock.ownerPid !== lock.ownerPid
  ) {
    throw new Error('Transaction preparing lock does not match the published lock.')
  }

  unlinkSync(preparingPath)
  syncDirectoryBestEffort(lockRoot)
  assertSingleLinkFile(lstatPrecisely(lockPath), 'Transaction lock')
}

// readFixedLock 함수는 lock의 구조를 읽고 정상적인 공개 중단 상태를 단일 link로 정리한다.
export function readFixedLock(lockRootValue: string, kind: FixedLockKind) {
  const lockRoot = resolve(lockRootValue)
  const lockPath = getFixedLockPath(lockRoot, kind)
  assertProjectPathSafe(lockRoot, lockPath, 'Transaction lock')

  if (!existsSync(lockPath)) return null

  const stats = lstatPrecisely(lockPath)

  if (!stats.isFile() || stats.nlink < 1n || stats.nlink > 2n) {
    throw new Error('Transaction lock is not a regular published file.')
  }

  const lock = parseTransactionLock(readFileSync(lockPath, 'utf8'), lockRoot, kind)
  normalizePublishedLockHardLink(lockRoot, kind, lockPath, stats, lock)
  return lock
}

// cleanupLockClaim 함수는 중단된 lock 제거 claim을 소유자 생존 여부 확인 뒤 정상화한다.
export function cleanupLockClaim(lockRootValue: string, kind: FixedLockKind) {
  const lockRoot = resolve(lockRootValue)
  const lockPath = getFixedLockPath(lockRoot, kind)
  const claimPath = getLockClaimPath(lockRoot, kind)

  assertProjectPathSafe(lockRoot, claimPath, 'Transaction lock release claim')

  if (!existsSync(claimPath)) return

  const claimStats = lstatPrecisely(claimPath)

  if (!claimStats.isFile()) {
    throw new Error('Transaction lock release claim is not a regular file.')
  }

  const claim = parseTransactionLock(readFileSync(claimPath, 'utf8'), lockRoot, kind)
  const claimIsFresh = Date.now() - Number(claimStats.ctimeMs) < 5_000

  if (claimIsFresh || isTransactionOwnerActive(claim.ownerPid, claim.createdAt)) {
    throw new Error(`A Frontron ${kind} lock is currently being released.`)
  }

  if (existsSync(lockPath) && !sameFileIdentity(claimStats, lstatPrecisely(lockPath))) {
    throw new Error('Transaction lock release claim does not match the fixed lock.')
  }

  unlinkSync(claimPath)
  syncDirectoryBestEffort(lockRoot)
}

// isMissingPathError 함수는 다른 프로세스가 경합 중 먼저 정리한 경로의 ENOENT만 구분한다.
function isMissingPathError(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

// cleanupLockPreparations 함수는 공개되지 않은 stale lock 준비 파일만 안전하게 제거한다.
export function cleanupLockPreparations(lockRootValue: string, kind: FixedLockKind) {
  const lockRoot = resolve(lockRootValue)
  const prefix = getLockPreparingPrefix(kind)
  const pattern = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)-[0-9a-z-]+\\.json$`,
    'i',
  )
  let removed = false

  for (const entry of readdirSync(lockRoot)) {
    const match = pattern.exec(entry)

    if (!match) continue

    const preparingPath = resolve(lockRoot, entry)
    const ownerPid = Number(match[1])
    assertProjectPathSafe(lockRoot, preparingPath, 'Transaction preparing lock')
    let stats: ReturnType<typeof lstatSync>

    try {
      stats = lstatSync(preparingPath)
    } catch (error) {
      // readdir 이후 다른 획득 시도가 자기 준비 파일을 공개·정리할 수 있다.
      if (isMissingPathError(error)) continue
      throw error
    }

    if (!stats.isFile() || (stats.nlink !== 1 && stats.nlink !== 2)) {
      throw new Error(`Transaction preparing lock is not a regular file: ${entry}`)
    }

    if (stats.nlink === 2) {
      const fixedLock = readFixedLock(lockRoot, kind)

      if (!fixedLock || existsSync(preparingPath)) {
        throw new Error('Transaction preparing lock does not match the fixed lock.')
      }

      removed = true
      continue
    }

    if (ownerPid !== process.pid && isTransactionOwnerActive(ownerPid, stats.mtimeMs)) {
      throw new Error(`Another Frontron ${kind} lock is preparing in process ${ownerPid}.`)
    }

    try {
      unlinkSync(preparingPath)
      removed = true
    } catch (error) {
      // stale 준비 파일 정리도 여러 복구 프로세스가 동시에 시도할 수 있다.
      if (!isMissingPathError(error)) throw error
    }
  }

  if (removed) syncDirectoryBestEffort(lockRoot)
}

// createLockMetadata 함수는 모든 root에 동일하게 공개할 완성된 lock metadata를 만든다.
export function createLockMetadata(
  kind: FixedLockKind,
  projectRoot: string,
  lockRoots: string[],
  transactionId: string,
  createdAt: string,
): TransactionLock {
  return {
    schemaVersion: LOCK_SCHEMA_VERSION,
    kind,
    transactionId,
    ownerPid: process.pid,
    createdAt,
    projectRoot,
    lockRoots,
  }
}

// publishFixedLock 함수는 fsync한 완성 metadata inode만 hard-link로 고정 lock에 원자 공개한다.
export function publishFixedLock(lockRootValue: string, metadata: TransactionLock) {
  const lockRoot = resolve(lockRootValue)
  const lockPath = getFixedLockPath(lockRoot, metadata.kind)
  const preparingPath = resolve(
    lockRoot,
    `${getLockPreparingPrefix(metadata.kind)}${process.pid}-${metadata.transactionId}.json`,
  )
  let descriptor: number | null = null
  let published = false

  assertProjectPathSafe(lockRoot, lockPath, 'Transaction lock')
  assertProjectPathSafe(lockRoot, preparingPath, 'Transaction preparing lock')
  cleanupLockClaim(lockRoot, metadata.kind)
  cleanupLockPreparations(lockRoot, metadata.kind)

  try {
    descriptor = openSync(preparingPath, 'wx', 0o600)
    writeFileSync(descriptor, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    linkSync(preparingPath, lockPath)
    published = true
    unlinkSync(preparingPath)
    syncDirectoryBestEffort(lockRoot)
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {
        // 원래 lock 획득 오류를 유지한다.
      }
      descriptor = null
    }

    rmSync(preparingPath, { force: true })

    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const existingLock = readFixedLock(lockRoot, metadata.kind)
      const owner = existingLock ? ` in process ${existingLock.ownerPid}` : ''
      throw new Error(`Another Frontron ${metadata.kind} is active${owner}.`)
    }

    if (published) {
      try {
        removeFixedLock(
          lockRoot,
          metadata.kind,
          metadata.transactionId,
          process.pid,
          metadata.projectRoot,
        )
      } catch {
        // 공개 후 durability 오류가 나면 다음 recovery가 완성된 lock을 정리하게 둔다.
      }
    }

    throw error
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
}

// assertFixedLockOwnership 함수는 한 고정 lock이 기대 transaction과 현재 프로세스 소유인지 확인한다.
export function assertFixedLockOwnership(
  lockRoot: string,
  kind: FixedLockKind,
  transactionId: string,
  projectRoot: string,
) {
  const lock = readFixedLock(lockRoot, kind)

  if (
    !lock ||
    lock.transactionId !== transactionId ||
    lock.ownerPid !== process.pid ||
    lock.projectRoot !== projectRoot
  ) {
    throw new Error(`The ${kind} lock changed before completion.`)
  }

  return lock
}

// removeFixedLock 함수는 hard-link claim에서 소유권과 inode를 재검증한 직후 고정 lock만 제거한다.
export function removeFixedLock(
  lockRootValue: string,
  kind: FixedLockKind,
  transactionId: string,
  ownerPid: number,
  projectRootValue: string,
) {
  const lockRoot = resolve(lockRootValue)
  const projectRoot = resolve(projectRootValue)
  const lockPath = getFixedLockPath(lockRoot, kind)
  const claimPath = getLockClaimPath(lockRoot, kind)
  cleanupLockClaim(lockRoot, kind)
  const lock = readFixedLock(lockRoot, kind)

  if (!lock) return

  if (
    lock.transactionId !== transactionId ||
    lock.ownerPid !== ownerPid ||
    lock.projectRoot !== projectRoot
  ) {
    throw new Error(`The ${kind} lock belongs to a different transaction.`)
  }

  linkSync(lockPath, claimPath)

  try {
    const fixedStats = lstatPrecisely(lockPath)
    const claimStats = lstatPrecisely(claimPath)
    const claimedLock = parseTransactionLock(readFileSync(claimPath, 'utf8'), lockRoot, kind)

    if (
      !sameFileIdentity(fixedStats, claimStats) ||
      claimedLock.transactionId !== transactionId ||
      claimedLock.ownerPid !== ownerPid ||
      claimedLock.projectRoot !== projectRoot
    ) {
      throw new Error(`The ${kind} lock changed immediately before removal.`)
    }

    unlinkSync(lockPath)
    syncDirectoryBestEffort(lockRoot)
  } finally {
    rmSync(claimPath, { force: true })
    syncDirectoryBestEffort(lockRoot)
  }
}

// acquireTransactionLockSet 함수는 project와 공유 safety root lock을 정렬 순서로 모두 획득한다.
export function acquireTransactionLockSet(
  projectRootValue: string,
  lockRootValues: Iterable<string>,
  transactionId: string,
  createdAt: string,
) {
  const projectRoot = resolve(projectRootValue)
  const lockRoots = sortLockRoots(projectRoot, lockRootValues)
  const metadata = createLockMetadata(
    'transaction',
    projectRoot,
    lockRoots,
    transactionId,
    createdAt,
  )
  const acquiredRoots: string[] = []

  try {
    for (const lockRoot of lockRoots) {
      publishFixedLock(lockRoot, metadata)
      acquiredRoots.push(lockRoot)
    }
  } catch (error) {
    for (const lockRoot of acquiredRoots.reverse()) {
      try {
        removeFixedLock(lockRoot, 'transaction', transactionId, process.pid, projectRoot)
      } catch {
        // 원래 lock 획득 실패를 유지하고 stale project lock은 다음 recovery가 정리하게 둔다.
      }
    }

    const failedRoot = lockRoots[acquiredRoots.length]
    const existingLock = failedRoot ? readFixedLock(failedRoot, 'transaction') : null

    if (
      failedRoot &&
      failedRoot !== projectRoot &&
      existingLock &&
      !isTransactionOwnerActive(existingLock.ownerPid, existingLock.createdAt) &&
      existingLock.projectRoot !== projectRoot
    ) {
      throw new Error(
        `A stale shared Frontron lock belongs to ${existingLock.projectRoot}. Recover that project before retrying.`,
      )
    }

    throw error
  }

  return lockRoots
}

// assertTransactionLockSetOwnership 함수는 journal 제거 직전까지 모든 lock 소유권이 유지됐는지 검사한다.
export function assertTransactionLockSetOwnership(handle: TransactionHandle) {
  for (const lockRoot of handle.lockRoots) {
    assertFixedLockOwnership(lockRoot, 'transaction', handle.transactionId, handle.projectRoot)
  }
}

// releaseTransactionLockSet 함수는 획득 반대 순서로 현재 transaction 소유 lock만 제거한다.
export function releaseTransactionLockSet(handle: TransactionHandle, bestEffort = false) {
  for (const lockRoot of [...handle.lockRoots].reverse()) {
    try {
      removeFixedLock(
        lockRoot,
        'transaction',
        handle.transactionId,
        process.pid,
        handle.projectRoot,
      )
    } catch (error) {
      if (!bestEffort) throw error
    }
  }
}
