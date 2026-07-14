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

import { assertProjectPathSafe } from '../project-paths'
import {
  assertSingleLinkFile,
  createTransactionSourceHash,
  getJournalPath,
  isTransactionOwnerActive,
  lstatPrecisely,
  pathIdentity,
  resolvePathReference,
  sameFileIdentity,
  syncDirectoryBestEffort,
} from './safety'
import { JOURNAL_SCHEMA_VERSION, TRANSACTION_JOURNAL_PREPARING_PREFIX } from './types'
import type { JournalSnapshot, TransactionJournal } from './types'

// cleanupPreparingJournals 함수는 active로 공개되지 못한 이전 준비 파일만 안전하게 제거한다.
export function cleanupPreparingJournals(projectRoot: string) {
  let removedCount = 0
  const preparingPattern = new RegExp(
    `^${TRANSACTION_JOURNAL_PREPARING_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)-[0-9a-f-]+\\.json$`,
    'i',
  )

  // active/preparing이 같은 inode인 공개 완료 상태는 먼저 active 하나로 정상화한다.
  readActiveJournal(projectRoot)

  for (const entry of readdirSync(projectRoot)) {
    const match = preparingPattern.exec(entry)

    if (!match) {
      continue
    }

    const preparingPath = resolve(projectRoot, entry)
    const ownerPid = Number(match[1])
    assertProjectPathSafe(projectRoot, preparingPath, 'Transaction preparing journal')

    const stats = lstatSync(preparingPath)

    if (!stats.isFile() || stats.nlink !== 1) {
      throw new Error(`Transaction preparing journal is not a regular file: ${entry}`)
    }

    if (ownerPid !== process.pid && isTransactionOwnerActive(ownerPid, stats.mtimeMs)) {
      throw new Error(`Another Frontron transaction is preparing in process ${ownerPid}.`)
    }

    rmSync(preparingPath, { force: true })
    removedCount += 1
  }

  if (removedCount > 0) {
    syncDirectoryBestEffort(projectRoot)
  }

  return removedCount
}

// isCanonicalBase64 함수는 손상된 저널 바이트 문자열을 복구 전에 찾아낸다.
function isCanonicalBase64(value: string) {
  return (
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value) &&
    Buffer.from(value, 'base64').toString('base64') === value
  )
}

// parseSnapshot 함수는 JSON 한 항목이 복구 가능한 스냅샷 구조인지 검사한다.
function parseSnapshot(value: unknown): JournalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Transaction journal contains an invalid snapshot.')
  }

  const snapshot = value as Partial<JournalSnapshot>
  const validBaseFields =
    typeof snapshot.path === 'string' &&
    typeof snapshot.safetyRoot === 'string' &&
    (snapshot.kind === 'file' || snapshot.kind === 'directory') &&
    typeof snapshot.existed === 'boolean'

  if (!validBaseFields) {
    throw new Error('Transaction journal contains an invalid snapshot.')
  }

  if (!snapshot.existed) {
    if (
      snapshot.contentBase64 !== null ||
      snapshot.contentSha256 !== null ||
      snapshot.mode !== null
    ) {
      throw new Error('A missing transaction target must not contain bytes or a mode.')
    }
  } else {
    if (
      !Number.isInteger(snapshot.mode) ||
      (snapshot.mode as number) < 0 ||
      (snapshot.mode as number) > 0o7777
    ) {
      throw new Error('Transaction journal contains an invalid file mode.')
    }

    if (
      (snapshot.kind === 'file' &&
        (typeof snapshot.contentBase64 !== 'string' ||
          !isCanonicalBase64(snapshot.contentBase64) ||
          typeof snapshot.contentSha256 !== 'string' ||
          !/^[0-9a-f]{64}$/.test(snapshot.contentSha256) ||
          createTransactionSourceHash(Buffer.from(snapshot.contentBase64, 'base64')) !==
            snapshot.contentSha256)) ||
      (snapshot.kind === 'directory' &&
        (snapshot.contentBase64 !== null || snapshot.contentSha256 !== null))
    ) {
      throw new Error('Transaction journal contains invalid snapshot bytes.')
    }
  }

  return snapshot as JournalSnapshot
}

// parseJournal 함수는 active JSON 전체 구조와 모든 저장 경로를 mutation 전에 검증한다.
function parseJournal(projectRoot: string, source: string): TransactionJournal {
  let value: unknown

  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('Transaction journal is not valid JSON.')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Transaction journal has an invalid structure.')
  }

  const journal = value as Partial<TransactionJournal>

  if (
    journal.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
    journal.state !== 'active' ||
    typeof journal.transactionId !== 'string' ||
    journal.transactionId.length === 0 ||
    (journal.operation !== 'init' && journal.operation !== 'clean') ||
    !Number.isSafeInteger(journal.ownerPid) ||
    (journal.ownerPid as number) <= 0 ||
    typeof journal.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(journal.createdAt)) ||
    !Array.isArray(journal.snapshots)
  ) {
    throw new Error('Transaction journal has an invalid structure.')
  }

  const snapshots = journal.snapshots.map(parseSnapshot)
  const seenPaths = new Set<string>()

  for (const snapshot of snapshots) {
    const resolved = resolvePathReference(projectRoot, snapshot, 'Transaction recovery target')
    const snapshotKey = pathIdentity(resolved.absolutePath, resolved.absoluteSafetyRoot)

    if (seenPaths.has(snapshotKey)) {
      throw new Error(`Transaction journal contains a duplicate path: ${snapshot.path}`)
    }

    seenPaths.add(snapshotKey)
  }

  return { ...(journal as TransactionJournal), snapshots }
}

// normalizePublishedJournalHardLink 함수는 linkSync 직후 남은 준비 journal을 inode와 ID 확인 후 제거한다.
function normalizePublishedJournalHardLink(
  projectRoot: string,
  journalPath: string,
  journalStats: ReturnType<typeof lstatPrecisely>,
  journal: TransactionJournal,
) {
  if (journalStats.nlink === 1n) return

  if (journalStats.nlink !== 2n) {
    throw new Error('Transaction journal has an unexpected hard-link count.')
  }

  const preparingPattern = new RegExp(
    `^${TRANSACTION_JOURNAL_PREPARING_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+-${journal.transactionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.json$`,
    'i',
  )
  const candidates = readdirSync(projectRoot).filter((entry) => preparingPattern.test(entry))

  if (candidates.length !== 1) {
    throw new Error('Transaction journal has an unrecognized hard link.')
  }

  const preparingPath = resolve(projectRoot, candidates[0])
  assertProjectPathSafe(projectRoot, preparingPath, 'Transaction preparing journal')
  const preparingStats = lstatPrecisely(preparingPath)
  const preparingJournal = parseJournal(projectRoot, readFileSync(preparingPath, 'utf8'))

  if (
    !preparingStats.isFile() ||
    !sameFileIdentity(journalStats, preparingStats) ||
    preparingJournal.transactionId !== journal.transactionId
  ) {
    throw new Error('Transaction preparing journal does not match the active journal.')
  }

  unlinkSync(preparingPath)
  syncDirectoryBestEffort(projectRoot)
  assertSingleLinkFile(lstatPrecisely(journalPath), 'Transaction journal')
}

// readActiveJournal 함수는 active 저널을 읽고 정상적인 nlink=2 공개 중단 상태를 자동 정상화한다.
export function readActiveJournal(projectRoot: string) {
  const journalPath = getJournalPath(projectRoot)
  assertProjectPathSafe(projectRoot, journalPath, 'Transaction journal')

  if (!existsSync(journalPath)) {
    return null
  }

  const stats = lstatPrecisely(journalPath)

  if (!stats.isFile() || stats.nlink < 1n || stats.nlink > 2n) {
    throw new Error('Transaction journal is not a regular file.')
  }

  const journal = parseJournal(projectRoot, readFileSync(journalPath, 'utf8'))
  normalizePublishedJournalHardLink(projectRoot, journalPath, stats, journal)
  return journal
}

// publishJournal 함수는 fsync한 준비 파일을 hard link로 한 번에 active 상태로 공개한다.
export function publishJournal(projectRoot: string, journal: TransactionJournal) {
  const journalPath = getJournalPath(projectRoot)
  const preparingName = `${TRANSACTION_JOURNAL_PREPARING_PREFIX}${process.pid}-${journal.transactionId}.json`
  const preparingPath = resolve(projectRoot, preparingName)
  let descriptor: number | null = null

  assertProjectPathSafe(projectRoot, journalPath, 'Transaction journal')
  assertProjectPathSafe(projectRoot, preparingPath, 'Transaction preparing journal')

  try {
    descriptor = openSync(preparingPath, 'wx', 0o600)
    writeFileSync(descriptor, `${JSON.stringify(journal, null, 2)}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null

    // linkSync는 이미 active 저널이 있으면 덮어쓰지 않고 실패하며, 완성된 inode만 공개한다.
    linkSync(preparingPath, journalPath)

    try {
      unlinkSync(preparingPath)
    } catch {
      // active 공개는 이미 끝났으므로 준비 파일 정리는 commit 또는 다음 실행에서 재시도한다.
    }

    syncDirectoryBestEffort(projectRoot)
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {
        // 원래 준비 실패 원인을 유지하고, 운영체제가 프로세스 종료 때 descriptor를 닫게 둔다.
      }
    }

    try {
      rmSync(preparingPath, { force: true })
    } catch {
      // active가 생기기 전 실패이므로 다음 CLI의 preparing 정리가 이 파일을 다시 처리한다.
    }

    throw error
  }
}

// removeActiveJournal 함수는 복구 또는 commit이 끝난 뒤 일치하는 active 저널만 제거한다.
export function removeActiveJournal(projectRoot: string, transactionId: string) {
  const activeJournal = readActiveJournal(projectRoot)

  if (!activeJournal) {
    throw new Error('The active transaction journal disappeared before completion.')
  }

  if (activeJournal.transactionId !== transactionId) {
    throw new Error('The active transaction journal belongs to a different transaction.')
  }

  const journalPath = getJournalPath(projectRoot)
  assertProjectPathSafe(projectRoot, journalPath, 'Transaction journal')
  const beforeStats = lstatPrecisely(journalPath)
  const finalJournal = parseJournal(projectRoot, readFileSync(journalPath, 'utf8'))

  if (
    finalJournal.transactionId !== transactionId ||
    !sameFileIdentity(beforeStats, lstatPrecisely(journalPath))
  ) {
    throw new Error('The active transaction journal changed immediately before removal.')
  }

  unlinkSync(journalPath)
  syncDirectoryBestEffort(projectRoot)
}
