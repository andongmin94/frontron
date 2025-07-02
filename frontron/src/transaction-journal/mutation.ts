import {
  closeSync,
  constants,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

import { assertProjectPathSafe } from '../project-paths'
import { readActiveJournal } from './journal-store'
import { assertTransactionLockSetOwnership } from './locks'
import {
  assertOpenRegularFileIdentity,
  assertSingleLinkFile,
  createPathReference,
  createTransactionSourceHash,
  fstatPrecisely,
  lstatPrecisely,
  openRegularFileNoFollow,
  pathIdentity,
  resolvePathReference,
  sameFileIdentity,
} from './safety'
import type { ResolvedSnapshot, TransactionHandle } from './types'

// resolveHandleSnapshot 함수는 현재 handle이 소유한 journal에서 호출 대상의 원본 snapshot을 찾는다.
function resolveHandleSnapshot(
  handle: TransactionHandle,
  targetPathValue: string,
  safetyRootValue: string,
) {
  assertTransactionLockSetOwnership(handle)
  const journal = readActiveJournal(handle.projectRoot)

  if (!journal || journal.transactionId !== handle.transactionId) {
    throw new Error('The active transaction journal does not belong to this transaction.')
  }

  const targetPath = resolve(targetPathValue)
  const safetyRoot = resolve(safetyRootValue)
  createPathReference(handle.projectRoot, targetPath, safetyRoot)
  const requestedPathIdentity = pathIdentity(targetPath, safetyRoot)
  const requestedRootIdentity = pathIdentity(safetyRoot, safetyRoot)

  for (const snapshot of journal.snapshots) {
    const resolvedSnapshot = {
      ...snapshot,
      ...resolvePathReference(handle.projectRoot, snapshot, 'Transaction mutation target'),
    }

    if (
      pathIdentity(resolvedSnapshot.absoluteSafetyRoot, resolvedSnapshot.absoluteSafetyRoot) ===
        requestedRootIdentity &&
      pathIdentity(resolvedSnapshot.absolutePath, resolvedSnapshot.absoluteSafetyRoot) ===
        requestedPathIdentity
    ) {
      return resolvedSnapshot
    }
  }

  throw new Error(`Transaction mutation target was not included in the plan: ${targetPath}`)
}

// assertDescriptorMatchesSnapshot 함수는 열린 파일이 snapshot 당시와 같은 inode와 내용인지 검증한다.
function assertDescriptorMatchesSnapshot(
  descriptor: number,
  snapshot: ResolvedSnapshot,
  label: string,
) {
  const changedMessage = `${label} changed after the transaction snapshot was created.`
  const initialStats = assertOpenRegularFileIdentity(
    descriptor,
    snapshot.absolutePath,
    null,
    label,
    changedMessage,
  )
  const content = readFileSync(descriptor)
  const finalStats = fstatPrecisely(descriptor)
  assertSingleLinkFile(finalStats, label)
  assertProjectPathSafe(snapshot.absoluteSafetyRoot, snapshot.absolutePath, label)
  const finalPathStats = lstatPrecisely(snapshot.absolutePath)
  assertSingleLinkFile(finalPathStats, label)

  if (
    !sameFileIdentity(initialStats, finalStats) ||
    !sameFileIdentity(finalStats, finalPathStats) ||
    initialStats.size !== finalStats.size ||
    initialStats.mtimeMs !== finalStats.mtimeMs ||
    initialStats.ctimeMs !== finalStats.ctimeMs ||
    (initialStats.mode & 0o7777n) !== (finalStats.mode & 0o7777n) ||
    Number(initialStats.mode & 0o7777n) !== snapshot.mode ||
    createTransactionSourceHash(content) !== snapshot.contentSha256
  ) {
    throw new Error(changedMessage)
  }

  return initialStats
}

// assertMissingSnapshotStillAbsent 함수는 계획 당시 없던 경로에 새 entry가 끼어들지 않았는지 확인한다.
function assertMissingSnapshotStillAbsent(snapshot: ResolvedSnapshot, label: string) {
  assertProjectPathSafe(snapshot.absoluteSafetyRoot, snapshot.absolutePath, label)

  try {
    lstatPrecisely(snapshot.absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  throw new Error(`${label} appeared after the transaction snapshot was created.`)
}

// openSnapshotFileForMutation 함수는 원본 snapshot을 재검증한 descriptor만 쓰기·삭제에 넘긴다.
function openSnapshotFileForMutation(snapshot: ResolvedSnapshot, flags: number, label: string) {
  if (!snapshot.existed) {
    throw new Error(`${label} did not exist when the transaction snapshot was created.`)
  }

  let descriptor: number | null = null

  try {
    descriptor = openRegularFileNoFollow(snapshot.absolutePath, flags)
    const identity = assertDescriptorMatchesSnapshot(descriptor, snapshot, label)
    return { descriptor, identity }
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor)
    throw error
  }
}

// writeAllAtStart 함수는 짧은 descriptor write도 빠짐없이 처리해 정확한 결과 바이트를 기록한다.
function writeAllAtStart(descriptor: number, content: Buffer) {
  let offset = 0

  while (offset < content.length) {
    offset += writeSync(descriptor, content, offset, content.length - offset, offset)
  }
}

// markTransactionTargetMutated 함수는 현재 프로세스가 복구 책임을 져야 할 파일만 handle에 기록한다.
function markTransactionTargetMutated(handle: TransactionHandle, snapshot: ResolvedSnapshot) {
  handle.mutatedTargets.add(pathIdentity(snapshot.absolutePath, snapshot.absoluteSafetyRoot))
}

// writeTransactionFile 함수는 snapshot 재검증과 실제 쓰기를 같은 descriptor에서 수행한다.
export function writeTransactionFile(
  handle: TransactionHandle,
  targetPathValue: string,
  content: string | Buffer,
  safetyRootValue: string,
) {
  handle.managedMutationMode = true
  const snapshot = resolveHandleSnapshot(handle, targetPathValue, safetyRootValue)
  const label = 'Transaction write target'

  if (snapshot.kind !== 'file') {
    throw new Error(`${label} is not a file: ${snapshot.path}`)
  }

  mkdirSync(dirname(snapshot.absolutePath), { recursive: true })
  assertProjectPathSafe(snapshot.absoluteSafetyRoot, snapshot.absolutePath, label)
  let descriptor: number | null = null
  let identity: ReturnType<typeof fstatPrecisely> | null = null

  try {
    if (snapshot.existed) {
      const opened = openSnapshotFileForMutation(snapshot, constants.O_RDWR, label)
      descriptor = opened.descriptor
      identity = opened.identity
    } else {
      assertMissingSnapshotStillAbsent(snapshot, label)
      descriptor = openRegularFileNoFollow(
        snapshot.absolutePath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o666,
      )
      markTransactionTargetMutated(handle, snapshot)
      identity = assertOpenRegularFileIdentity(
        descriptor,
        snapshot.absolutePath,
        null,
        label,
        `${label} changed while it was being created.`,
      )
    }

    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    markTransactionTargetMutated(handle, snapshot)
    ftruncateSync(descriptor, 0)
    writeAllAtStart(descriptor, bytes)
    fsyncSync(descriptor)
    assertProjectPathSafe(snapshot.absoluteSafetyRoot, snapshot.absolutePath, label)
    assertOpenRegularFileIdentity(
      descriptor,
      snapshot.absolutePath,
      identity,
      label,
      `${label} changed while it was being written.`,
    )
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
}

// removeTransactionFile 함수는 snapshot과 같은 파일만 경로에서 제거한다.
export function removeTransactionFile(
  handle: TransactionHandle,
  targetPathValue: string,
  safetyRootValue: string,
) {
  handle.managedMutationMode = true
  const snapshot = resolveHandleSnapshot(handle, targetPathValue, safetyRootValue)
  const label = 'Transaction delete target'

  if (snapshot.kind !== 'file') {
    throw new Error(`${label} is not a file: ${snapshot.path}`)
  }

  const opened = openSnapshotFileForMutation(snapshot, constants.O_RDONLY, label)

  try {
    assertProjectPathSafe(snapshot.absoluteSafetyRoot, snapshot.absolutePath, label)
    assertOpenRegularFileIdentity(
      opened.descriptor,
      snapshot.absolutePath,
      opened.identity,
      label,
      `${label} changed immediately before removal.`,
    )
    markTransactionTargetMutated(handle, snapshot)
    unlinkSync(snapshot.absolutePath)
  } finally {
    closeSync(opened.descriptor)
  }
}

// assertTransactionTargetUnchanged 함수는 건드리지 않을 대상도 계획 당시 상태 그대로인지 확인한다.
export function assertTransactionTargetUnchanged(
  handle: TransactionHandle,
  targetPathValue: string,
  safetyRootValue: string,
) {
  handle.managedMutationMode = true
  const snapshot = resolveHandleSnapshot(handle, targetPathValue, safetyRootValue)
  const label = 'Transaction guarded target'

  if (snapshot.kind !== 'file') {
    throw new Error(`${label} is not a file: ${snapshot.path}`)
  }

  if (!snapshot.existed) {
    assertMissingSnapshotStillAbsent(snapshot, label)
    return
  }

  const opened = openSnapshotFileForMutation(snapshot, constants.O_RDONLY, label)
  closeSync(opened.descriptor)
}
