import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import { assertProjectPathSafe, isInsideDirectory } from './project-paths'

export const TRANSACTION_JOURNAL_PATH = '.frontron-transaction-journal.json'

// Doctor also reports stale artifacts left by older releases; current transactions use only the journal.
export const TRANSACTION_JOURNAL_PREPARING_PREFIX = '.frontron-transaction-journal.preparing-'
export const TRANSACTION_LOCK_PATH = '.frontron-transaction.lock'
export const TRANSACTION_LOCK_PREPARING_PREFIX = '.frontron-transaction.lock.preparing-'
export const TRANSACTION_RECOVERY_LOCK_PATH = '.frontron-transaction-recovery.lock'
export const TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX =
  '.frontron-transaction-recovery.lock.preparing-'

export type TransactionOperation = 'init' | 'clean'
export type TransactionTargetKind = 'file' | 'directory'

export type TransactionTarget = {
  path: string
  safetyRoot: string
  kind?: TransactionTargetKind
  expectedHash?: string | null
}

type TransactionSnapshot = {
  path: string
  safetyRoot: string
  kind: TransactionTargetKind
  existed: boolean
  contentBase64: string | null
  contentSha256: string | null
  mode: number | null
}

type TransactionJournal = {
  schemaVersion: 1
  transactionId: string
  operation: TransactionOperation
  snapshots: TransactionSnapshot[]
}

export type TransactionHandle = {
  projectRoot: string
  journalPath: string
  transactionId: string
  snapshots: Map<string, TransactionSnapshot>
  mutatedTargets: Set<string>
}

export type TransactionRecoveryResult = {
  recovered: boolean
  operation: TransactionOperation | null
}

const EXTERNAL_CONFIG_NAMES = new Set(['pnpm-workspace.yaml', '.yarnrc.yml'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertRegularDirectory(path: string, label: string) {
  const stats = lstatSync(path)

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${path}`)
  }
}

function assertSafetyRoot(projectRoot: string, safetyRootValue: string) {
  const safetyRoot = resolve(safetyRootValue)
  assertRegularDirectory(safetyRoot, 'Transaction safety root')

  if (!isInsideDirectory(safetyRoot, projectRoot)) {
    throw new Error(`Transaction safety root must contain the project: ${safetyRoot}`)
  }

  return safetyRoot
}

function assertTransactionPath(
  projectRoot: string,
  safetyRoot: string,
  pathValue: string,
  label: string,
) {
  const path = assertProjectPathSafe(safetyRoot, resolve(pathValue), label)

  if (
    !isInsideDirectory(projectRoot, path) &&
    (dirname(path) !== safetyRoot || !EXTERNAL_CONFIG_NAMES.has(basename(path)))
  ) {
    throw new Error(`${label} is outside the managed project surface: ${path}`)
  }

  return path
}

export function createTransactionSourceHash(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

function snapshotTarget(projectRoot: string, target: TransactionTarget): TransactionSnapshot {
  const safetyRoot = assertSafetyRoot(projectRoot, target.safetyRoot)
  const path = assertTransactionPath(projectRoot, safetyRoot, target.path, 'Transaction target')
  const kind = target.kind ?? 'file'

  if (path === resolve(projectRoot, TRANSACTION_JOURNAL_PATH)) {
    throw new Error('The transaction journal cannot be a mutation target.')
  }

  const existed = existsSync(path)
  let contentBase64: string | null = null
  let contentSha256: string | null = null
  let mode: number | null = null

  if (existed) {
    const stats = lstatSync(path)

    if (stats.isSymbolicLink()) {
      throw new Error(`Transaction target must not be a symbolic link: ${path}`)
    }

    if (kind === 'file') {
      if (!stats.isFile()) {
        throw new Error(`Transaction target is not a regular file: ${path}`)
      }

      if (stats.nlink !== 1) {
        throw new Error(`Transaction target must have exactly one hard link: ${path}`)
      }

      const content = readFileSync(path)
      contentBase64 = content.toString('base64')
      contentSha256 = createTransactionSourceHash(content)
      mode = stats.mode & 0o7777
    } else if (!stats.isDirectory()) {
      throw new Error(`Transaction target is not a directory: ${path}`)
    }
  }

  if (target.expectedHash === null && existed) {
    throw new Error(`Transaction target appeared after planning: ${path}`)
  }

  if (typeof target.expectedHash === 'string' && contentSha256 !== target.expectedHash) {
    throw new Error(`Transaction target changed after planning: ${path}`)
  }

  return {
    path,
    safetyRoot,
    kind,
    existed,
    contentBase64,
    contentSha256,
    mode,
  }
}

function validateSnapshot(projectRoot: string, value: unknown): TransactionSnapshot {
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    typeof value.safetyRoot !== 'string' ||
    (value.kind !== 'file' && value.kind !== 'directory') ||
    typeof value.existed !== 'boolean' ||
    (value.contentBase64 !== null && typeof value.contentBase64 !== 'string') ||
    (value.contentSha256 !== null && typeof value.contentSha256 !== 'string') ||
    (value.mode !== null && (!Number.isInteger(value.mode) || Number(value.mode) < 0))
  ) {
    throw new Error('The transaction journal contains an invalid snapshot.')
  }

  const safetyRoot = assertSafetyRoot(projectRoot, value.safetyRoot)
  const path = assertTransactionPath(
    projectRoot,
    safetyRoot,
    value.path,
    'Transaction journal target',
  )
  const mode = value.mode === null ? null : Number(value.mode)

  if (value.existed && value.kind === 'file') {
    if (value.contentBase64 === null || value.contentSha256 === null || mode === null) {
      throw new Error('The transaction journal is missing file snapshot data.')
    }

    const content = Buffer.from(value.contentBase64, 'base64')
    if (createTransactionSourceHash(content) !== value.contentSha256) {
      throw new Error('The transaction journal file snapshot is corrupted.')
    }
  } else if (value.contentBase64 !== null || value.contentSha256 !== null || mode !== null) {
    throw new Error('The transaction journal contains unexpected snapshot data.')
  }

  return {
    path,
    safetyRoot,
    kind: value.kind,
    existed: value.existed,
    contentBase64: value.contentBase64,
    contentSha256: value.contentSha256,
    mode,
  }
}

function readJournal(projectRoot: string): TransactionJournal | null {
  const journalPath = resolve(projectRoot, TRANSACTION_JOURNAL_PATH)
  if (!existsSync(journalPath)) return null
  assertProjectPathSafe(projectRoot, journalPath, 'Transaction journal')

  const value = JSON.parse(readFileSync(journalPath, 'utf8')) as unknown

  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.transactionId !== 'string' ||
    (value.operation !== 'init' && value.operation !== 'clean') ||
    !Array.isArray(value.snapshots)
  ) {
    throw new Error('The transaction journal is invalid.')
  }

  const snapshots = value.snapshots.map((snapshot) => validateSnapshot(projectRoot, snapshot))
  const paths = new Set(snapshots.map((snapshot) => snapshot.path))

  if (paths.size !== snapshots.length) {
    throw new Error('The transaction journal contains duplicate targets.')
  }

  return {
    schemaVersion: 1,
    transactionId: value.transactionId,
    operation: value.operation,
    snapshots,
  }
}

function getHandleSnapshot(
  handle: TransactionHandle,
  targetPathValue: string,
  safetyRootValue: string,
) {
  const path = resolve(targetPathValue)
  const safetyRoot = resolve(safetyRootValue)
  const snapshot = handle.snapshots.get(path)

  if (!snapshot || snapshot.safetyRoot !== safetyRoot) {
    throw new Error(`Transaction mutation target was not included in the plan: ${path}`)
  }

  return snapshot
}

function assertCurrentMatchesSnapshot(snapshot: TransactionSnapshot, label: string) {
  assertProjectPathSafe(snapshot.safetyRoot, snapshot.path, label)
  const exists = existsSync(snapshot.path)

  if (!snapshot.existed) {
    if (exists) throw new Error(`${label} appeared after the transaction started.`)
    return
  }

  if (!exists) {
    throw new Error(`${label} disappeared after the transaction started.`)
  }

  const stats = lstatSync(snapshot.path)

  if (stats.isSymbolicLink()) {
    throw new Error(`${label} became a symbolic link.`)
  }

  if (snapshot.kind === 'directory') {
    if (!stats.isDirectory()) throw new Error(`${label} is no longer a directory.`)
    return
  }

  if (!stats.isFile() || stats.nlink !== 1) {
    throw new Error(`${label} is no longer a single-link regular file.`)
  }

  const hash = createTransactionSourceHash(readFileSync(snapshot.path))
  if (hash !== snapshot.contentSha256 || (stats.mode & 0o7777) !== snapshot.mode) {
    throw new Error(`${label} changed after the transaction started.`)
  }
}

function restoreFileSnapshot(projectRoot: string, snapshot: TransactionSnapshot) {
  assertTransactionPath(
    projectRoot,
    snapshot.safetyRoot,
    snapshot.path,
    'Transaction recovery target',
  )

  if (!snapshot.existed) {
    if (!existsSync(snapshot.path)) return

    const stats = lstatSync(snapshot.path)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Cannot remove unexpected recovery target: ${snapshot.path}`)
    }

    unlinkSync(snapshot.path)
    return
  }

  const content = Buffer.from(snapshot.contentBase64 ?? '', 'base64')
  mkdirSync(dirname(snapshot.path), { recursive: true })
  assertTransactionPath(
    projectRoot,
    snapshot.safetyRoot,
    snapshot.path,
    'Transaction recovery target',
  )

  if (existsSync(snapshot.path)) {
    const stats = lstatSync(snapshot.path)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Cannot restore over a non-file recovery target: ${snapshot.path}`)
    }
  }

  writeFileSync(snapshot.path, content)
  if (snapshot.mode !== null) chmodSync(snapshot.path, snapshot.mode)
}

function restoreDirectorySnapshot(projectRoot: string, snapshot: TransactionSnapshot) {
  assertTransactionPath(
    projectRoot,
    snapshot.safetyRoot,
    snapshot.path,
    'Transaction recovery directory',
  )

  if (snapshot.existed) {
    if (existsSync(snapshot.path)) {
      const stats = lstatSync(snapshot.path)
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`Cannot restore over a non-directory target: ${snapshot.path}`)
      }
      return
    }

    mkdirSync(snapshot.path, { recursive: true })
    return
  }

  if (!existsSync(snapshot.path)) return
  const stats = lstatSync(snapshot.path)

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Cannot remove unexpected recovery directory: ${snapshot.path}`)
  }

  rmdirSync(snapshot.path)
}

function restoreSnapshots(projectRoot: string, snapshots: TransactionSnapshot[]) {
  for (const snapshot of snapshots.filter((entry) => entry.kind === 'file')) {
    restoreFileSnapshot(projectRoot, snapshot)
  }

  const directories = snapshots
    .filter((entry) => entry.kind === 'directory')
    .sort((left, right) => right.path.length - left.path.length)

  for (const snapshot of directories) {
    restoreDirectorySnapshot(projectRoot, snapshot)
  }
}

function removeJournal(projectRoot: string, transactionId: string) {
  const journal = readJournal(projectRoot)

  if (!journal || journal.transactionId !== transactionId) {
    throw new Error('The active transaction journal changed unexpectedly.')
  }

  unlinkSync(resolve(projectRoot, TRANSACTION_JOURNAL_PATH))
}

export function beginTransaction(
  projectRootValue: string,
  operation: TransactionOperation,
  targets: TransactionTarget[],
): TransactionHandle {
  const projectRoot = resolve(projectRootValue)
  assertRegularDirectory(projectRoot, 'Project root')

  const recovery = recoverPendingTransaction(projectRoot)
  if (recovery.recovered) {
    throw new Error(
      `Recovered an interrupted ${recovery.operation} transaction. Run the command again.`,
    )
  }

  const snapshots = new Map<string, TransactionSnapshot>()

  for (const target of targets) {
    const snapshot = snapshotTarget(projectRoot, target)
    const existing = snapshots.get(snapshot.path)

    if (existing) {
      if (existing.safetyRoot !== snapshot.safetyRoot || existing.kind !== snapshot.kind) {
        throw new Error(`Transaction target was planned inconsistently: ${snapshot.path}`)
      }
      continue
    }

    snapshots.set(snapshot.path, snapshot)
  }

  const transactionId = randomUUID()
  const journalPath = resolve(projectRoot, TRANSACTION_JOURNAL_PATH)
  assertProjectPathSafe(projectRoot, journalPath, 'Transaction journal')
  const journal: TransactionJournal = {
    schemaVersion: 1,
    transactionId,
    operation,
    snapshots: [...snapshots.values()],
  }

  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })

  return {
    projectRoot,
    journalPath,
    transactionId,
    snapshots,
    mutatedTargets: new Set<string>(),
  }
}

export function writeTransactionFile(
  handle: TransactionHandle,
  targetPathValue: string,
  content: string | Buffer,
  safetyRootValue: string,
) {
  const snapshot = getHandleSnapshot(handle, targetPathValue, safetyRootValue)
  if (snapshot.kind !== 'file')
    throw new Error(`Transaction target is not a file: ${snapshot.path}`)

  if (!handle.mutatedTargets.has(snapshot.path)) {
    assertCurrentMatchesSnapshot(snapshot, 'Transaction write target')
  }

  mkdirSync(dirname(snapshot.path), { recursive: true })
  assertTransactionPath(
    handle.projectRoot,
    snapshot.safetyRoot,
    snapshot.path,
    'Transaction write target',
  )
  writeFileSync(
    snapshot.path,
    content,
    snapshot.mode === null ? undefined : { mode: snapshot.mode },
  )
  handle.mutatedTargets.add(snapshot.path)
}

export function removeTransactionFile(
  handle: TransactionHandle,
  targetPathValue: string,
  safetyRootValue: string,
) {
  const snapshot = getHandleSnapshot(handle, targetPathValue, safetyRootValue)
  if (snapshot.kind !== 'file')
    throw new Error(`Transaction target is not a file: ${snapshot.path}`)
  if (!snapshot.existed)
    throw new Error(`Transaction delete target did not exist: ${snapshot.path}`)

  if (!handle.mutatedTargets.has(snapshot.path)) {
    assertCurrentMatchesSnapshot(snapshot, 'Transaction delete target')
  }

  unlinkSync(snapshot.path)
  handle.mutatedTargets.add(snapshot.path)
}

export function assertTransactionTargetUnchanged(
  handle: TransactionHandle,
  targetPathValue: string,
  safetyRootValue: string,
) {
  const snapshot = getHandleSnapshot(handle, targetPathValue, safetyRootValue)

  if (handle.mutatedTargets.has(snapshot.path)) {
    throw new Error(`Transaction target was already modified: ${snapshot.path}`)
  }

  assertCurrentMatchesSnapshot(snapshot, 'Transaction guarded target')
}

export function commitTransaction(handle: TransactionHandle) {
  removeJournal(handle.projectRoot, handle.transactionId)
}

export function rollbackTransaction(handle: TransactionHandle) {
  const journal = readJournal(handle.projectRoot)

  if (!journal || journal.transactionId !== handle.transactionId) {
    throw new Error('The active transaction journal does not belong to this transaction.')
  }

  restoreSnapshots(handle.projectRoot, journal.snapshots)
  removeJournal(handle.projectRoot, handle.transactionId)
}

export function recoverPendingTransaction(projectRootValue: string): TransactionRecoveryResult {
  const projectRoot = resolve(projectRootValue)
  assertRegularDirectory(projectRoot, 'Project root')
  const journal = readJournal(projectRoot)

  if (!journal) {
    return { recovered: false, operation: null }
  }

  restoreSnapshots(projectRoot, journal.snapshots)
  removeJournal(projectRoot, journal.transactionId)

  return {
    recovered: true,
    operation: journal.operation,
  }
}
