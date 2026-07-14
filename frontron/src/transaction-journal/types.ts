export const TRANSACTION_JOURNAL_PATH = '.frontron-transaction-journal.json'
export const TRANSACTION_JOURNAL_PREPARING_PREFIX = '.frontron-transaction-journal.preparing-'
export const TRANSACTION_LOCK_PATH = '.frontron-transaction.lock'
export const TRANSACTION_LOCK_PREPARING_PREFIX = '.frontron-transaction.lock.preparing-'
export const TRANSACTION_RECOVERY_LOCK_PATH = '.frontron-transaction-recovery.lock'
export const TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX =
  '.frontron-transaction-recovery.lock.preparing-'

export const TRANSACTION_LOCK_CLAIM_PATH = '.frontron-transaction.lock.releasing'
export const TRANSACTION_RECOVERY_LOCK_CLAIM_PATH = '.frontron-transaction-recovery.lock.releasing'

export type TransactionOperation = 'init' | 'clean'
export type TransactionTargetKind = 'file' | 'directory'

export type TransactionTarget = {
  path: string
  safetyRoot: string
  kind?: TransactionTargetKind
  expectedHash?: string | null
}

export type JournalPathReference = {
  path: string
  safetyRoot: string
}

export type JournalSnapshot = JournalPathReference & {
  kind: TransactionTargetKind
  existed: boolean
  contentBase64: string | null
  contentSha256: string | null
  mode: number | null
}

export type TransactionJournal = {
  schemaVersion: 2
  state: 'active'
  transactionId: string
  operation: TransactionOperation
  ownerPid: number
  createdAt: string
  snapshots: JournalSnapshot[]
}

export type TransactionLock = {
  schemaVersion: 2
  kind: 'transaction' | 'recovery'
  transactionId: string
  ownerPid: number
  createdAt: string
  projectRoot: string
  lockRoots: string[]
}

export type NormalizedTransactionLock = TransactionLock & {
  lockRoot: string
}

export type FixedLockKind = TransactionLock['kind']

export type TransactionHandle = {
  projectRoot: string
  journalPath: string
  transactionId: string
  lockRoots: string[]
  mutatedTargets: Set<string>
  managedMutationMode: boolean
}

export type TransactionRecoveryResult = {
  recovered: boolean
  operation: TransactionOperation | null
  cleanedPreparingJournals: number
}

export type ResolvedSnapshot = JournalSnapshot & {
  absolutePath: string
  absoluteSafetyRoot: string
}

export const JOURNAL_SCHEMA_VERSION = 2
export const LOCK_SCHEMA_VERSION = 2
