import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { assertProjectPathSafe, isInsideDirectory } from './project-paths'

export const TRANSACTION_JOURNAL_PATH = '.frontron-transaction-journal.json'
export const TRANSACTION_JOURNAL_PREPARING_PREFIX = '.frontron-transaction-journal.preparing-'
export const TRANSACTION_LOCK_PATH = '.frontron-transaction.lock'
export const TRANSACTION_LOCK_PREPARING_PREFIX = '.frontron-transaction.lock.preparing-'
export const TRANSACTION_RECOVERY_LOCK_PATH = '.frontron-transaction-recovery.lock'
export const TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX =
  '.frontron-transaction-recovery.lock.preparing-'

const TRANSACTION_LOCK_CLAIM_PATH = '.frontron-transaction.lock.releasing'
const TRANSACTION_RECOVERY_LOCK_CLAIM_PATH = '.frontron-transaction-recovery.lock.releasing'

type TransactionOperation = 'init' | 'clean'
type TransactionTargetKind = 'file' | 'directory'

export type TransactionTarget = {
  path: string
  safetyRoot: string
  kind?: TransactionTargetKind
  expectedHash?: string | null
}

type JournalPathReference = {
  path: string
  safetyRoot: string
}

type JournalSnapshot = JournalPathReference & {
  kind: TransactionTargetKind
  existed: boolean
  contentBase64: string | null
  contentSha256: string | null
  mode: number | null
}

type TransactionJournal = {
  schemaVersion: 2
  state: 'active'
  transactionId: string
  operation: TransactionOperation
  ownerPid: number
  createdAt: string
  snapshots: JournalSnapshot[]
}

type TransactionLock = {
  schemaVersion: 2
  kind: 'transaction' | 'recovery'
  transactionId: string
  ownerPid: number
  createdAt: string
  projectRoot: string
  lockRoots: string[]
}

type NormalizedTransactionLock = TransactionLock & {
  lockRoot: string
}

type FixedLockKind = TransactionLock['kind']

export type TransactionHandle = {
  projectRoot: string
  journalPath: string
  transactionId: string
  lockRoots: string[]
}

export type TransactionRecoveryResult = {
  recovered: boolean
  operation: TransactionOperation | null
  cleanedPreparingJournals: number
}

type ResolvedSnapshot = JournalSnapshot & {
  absolutePath: string
  absoluteSafetyRoot: string
}

const JOURNAL_SCHEMA_VERSION = 2
const LOCK_SCHEMA_VERSION = 2
const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml'
const YARN_RC_FILE = '.yarnrc.yml'
const caseSensitivityCache = new Map<
  string,
  { device: number; inode: number; caseSensitive: boolean }
>()

// toPortableRelativePath 함수는 절대 경로를 운영체제와 무관한 저널용 상대 경로로 바꾼다.
function toPortableRelativePath(projectRoot: string, absolutePath: string) {
  const relativePath = relative(projectRoot, absolutePath)

  return relativePath === '' ? '.' : relativePath.split(sep).join('/')
}

// fromPortableRelativePath 함수는 저널의 슬래시 경로를 현재 운영체제 경로로 바꾼다.
function fromPortableRelativePath(value: string) {
  return value.split('/').join(sep)
}

// isCanonicalRelativePath 함수는 우회 조각이 없는 정규 상대 경로인지 확인한다.
function isCanonicalRelativePath(projectRoot: string, value: string) {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    isAbsolute(value) ||
    (sep === '\\' && value.includes('\\'))
  ) {
    return false
  }

  const absolutePath = resolve(projectRoot, fromPortableRelativePath(value))

  return toPortableRelativePath(projectRoot, absolutePath) === value
}

// assertSupportedSafetyBoundary 함수는 프로젝트 내부 또는 지원하는 상위 workspace 설정 파일만 허용한다.
function assertSupportedSafetyBoundary(
  projectRoot: string,
  absolutePath: string,
  safetyRoot: string,
) {
  if (safetyRoot === projectRoot) {
    if (!isInsideDirectory(projectRoot, absolutePath)) {
      throw new Error('Transaction journal path points outside the project.')
    }

    return
  }

  const isAncestorWorkspaceFile =
    isInsideDirectory(safetyRoot, projectRoot) &&
    dirname(absolutePath) === safetyRoot &&
    [PNPM_WORKSPACE_FILE, YARN_RC_FILE].includes(basename(absolutePath))

  if (!isAncestorWorkspaceFile) {
    throw new Error(
      'Transaction journal may only reference project files or a supported ancestor workspace config.',
    )
  }
}

// resolvePathReference 함수는 저널 상대 경로를 절대 경로로 바꾸고 탈출과 링크를 다시 검사한다.
function resolvePathReference(projectRoot: string, reference: JournalPathReference, label: string) {
  if (
    !isCanonicalRelativePath(projectRoot, reference.path) ||
    !isCanonicalRelativePath(projectRoot, reference.safetyRoot)
  ) {
    throw new Error(`${label} contains a non-canonical path.`)
  }

  const absolutePath = resolve(projectRoot, fromPortableRelativePath(reference.path))
  const absoluteSafetyRoot = resolve(projectRoot, fromPortableRelativePath(reference.safetyRoot))

  assertSupportedSafetyBoundary(projectRoot, absolutePath, absoluteSafetyRoot)
  assertProjectPathSafe(absoluteSafetyRoot, absolutePath, label)

  return { absolutePath, absoluteSafetyRoot }
}

// createPathReference 함수는 검증된 절대 경로 두 개를 저널에 저장할 상대 경로로 만든다.
function createPathReference(
  projectRoot: string,
  absolutePath: string,
  absoluteSafetyRoot: string,
): JournalPathReference {
  assertSupportedSafetyBoundary(projectRoot, absolutePath, absoluteSafetyRoot)
  assertProjectPathSafe(absoluteSafetyRoot, absolutePath, 'Transaction target path')

  return {
    path: toPortableRelativePath(projectRoot, absolutePath),
    safetyRoot: toPortableRelativePath(projectRoot, absoluteSafetyRoot),
  }
}

// assertRegularProjectRoot 함수는 저널을 둘 프로젝트 루트가 실제 디렉터리인지 확인한다.
function assertRegularProjectRoot(projectRoot: string) {
  const stats = lstatSync(projectRoot)

  if (!stats.isDirectory()) {
    throw new Error(`Transaction project root is not a directory: ${projectRoot}`)
  }
}

// getJournalPath 함수는 프로젝트 루트의 active 저널 절대 경로를 만든다.
function getJournalPath(projectRoot: string) {
  return resolve(projectRoot, TRANSACTION_JOURNAL_PATH)
}

// getFixedLockPath 함수는 safety root에 둘 transaction 또는 recovery 고정 lock 경로를 만든다.
function getFixedLockPath(lockRoot: string, kind: FixedLockKind) {
  return resolve(
    lockRoot,
    kind === 'transaction' ? TRANSACTION_LOCK_PATH : TRANSACTION_RECOVERY_LOCK_PATH,
  )
}

// getLockPreparingPrefix 함수는 lock 종류별 원자 공개 준비 파일 접두사를 돌려준다.
function getLockPreparingPrefix(kind: FixedLockKind) {
  return kind === 'transaction'
    ? TRANSACTION_LOCK_PREPARING_PREFIX
    : TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX
}

// getLockClaimPath 함수는 lock 제거를 다른 획득 시도와 직렬화할 claim 경로를 만든다.
function getLockClaimPath(lockRoot: string, kind: FixedLockKind) {
  return resolve(
    lockRoot,
    kind === 'transaction' ? TRANSACTION_LOCK_CLAIM_PATH : TRANSACTION_RECOVERY_LOCK_CLAIM_PATH,
  )
}

// sameFileIdentity 함수는 두 경로 상태가 같은 파일시스템 inode를 가리키는지 확인한다.
function sameFileIdentity(
  left: NonNullable<ReturnType<typeof lstatSync>>,
  right: NonNullable<ReturnType<typeof lstatSync>>,
) {
  return left.dev === right.dev && left.ino === right.ino
}

// isSafetyRootCaseSensitive 함수는 safety root의 실제 대소문자 구분 동작을 probe하고 inode별로 캐시한다.
function isSafetyRootCaseSensitive(safetyRootValue: string) {
  const safetyRoot = resolve(safetyRootValue)
  const rootStats = lstatSync(safetyRoot)

  if (!rootStats.isDirectory()) {
    throw new Error(`Transaction safety root is not a directory: ${safetyRoot}`)
  }

  const cached = caseSensitivityCache.get(safetyRoot)

  if (cached && cached.device === rootStats.dev && cached.inode === rootStats.ino) {
    return cached.caseSensitive
  }

  const probeId = randomUUID().replace(/-/g, '')
  const probeName = `.frontron-case-probe-${probeId}-a`
  const alternateName = `.FRONTRON-CASE-PROBE-${probeId}-A`
  const probePath = resolve(safetyRoot, probeName)
  const alternatePath = resolve(safetyRoot, alternateName)
  let descriptor: number | null = null
  let caseSensitive = true

  assertProjectPathSafe(safetyRoot, probePath, 'Transaction case-sensitivity probe')
  assertProjectPathSafe(safetyRoot, alternatePath, 'Transaction case-sensitivity probe')

  try {
    descriptor = openSync(probePath, 'wx', 0o600)
    closeSync(descriptor)
    descriptor = null

    if (existsSync(alternatePath)) {
      caseSensitive = !sameFileIdentity(lstatSync(probePath), lstatSync(alternatePath))
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    rmSync(probePath, { force: true })
  }

  syncDirectoryBestEffort(safetyRoot)
  caseSensitivityCache.set(safetyRoot, {
    device: rootStats.dev,
    inode: rootStats.ino,
    caseSensitive,
  })
  return caseSensitive
}

// pathIdentity 함수는 safety root의 실제 규칙에 따라 경로 중복 비교용 값을 만든다.
function pathIdentity(value: string, safetyRoot: string) {
  const absolutePath = resolve(value)
  return isSafetyRootCaseSensitive(safetyRoot) ? absolutePath : absolutePath.toLowerCase()
}

// controlNameIdentity 함수는 예약 제어 파일 이름을 프로젝트 root의 실제 규칙으로 비교한다.
function controlNameIdentity(value: string, projectRoot: string) {
  return isSafetyRootCaseSensitive(projectRoot) ? value : value.toLowerCase()
}

// isJournalControlPath 함수는 일반 변경 대상이 저널 제어 파일을 덮어쓰지 못하게 막는다.
function isJournalControlPath(projectRoot: string, absolutePath: string) {
  const entryName = controlNameIdentity(basename(absolutePath), projectRoot)
  const controlNames = [
    TRANSACTION_JOURNAL_PATH,
    TRANSACTION_LOCK_PATH,
    TRANSACTION_RECOVERY_LOCK_PATH,
    TRANSACTION_LOCK_CLAIM_PATH,
    TRANSACTION_RECOVERY_LOCK_CLAIM_PATH,
  ].map((name) => controlNameIdentity(name, projectRoot))
  const preparingPrefixes = [
    TRANSACTION_JOURNAL_PREPARING_PREFIX,
    TRANSACTION_LOCK_PREPARING_PREFIX,
    TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX,
  ].map((name) => controlNameIdentity(name, projectRoot))

  return (
    pathIdentity(dirname(absolutePath), projectRoot) === pathIdentity(projectRoot, projectRoot) &&
    (controlNames.includes(entryName) ||
      preparingPrefixes.some((prefix) => entryName.startsWith(prefix)))
  )
}

// isProcessAlive 함수는 다른 CLI가 아직 저널을 사용 중인지 PID로 확인한다.
function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// readProcessStartTime 함수는 PID가 재사용됐는지 판별할 운영체제 프로세스 시작 시각을 읽는다.
function readProcessStartTime(pid: number) {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
          ],
          { encoding: 'utf8', timeout: 5_000, windowsHide: true },
        )
      : spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
          encoding: 'utf8',
          timeout: 5_000,
        })

  if (result.status !== 0 || !result.stdout.trim()) return null

  const startedAt = Date.parse(result.stdout.trim())
  return Number.isFinite(startedAt) ? startedAt : null
}

// isTransactionOwnerActive 함수는 PID와 시작 시각을 함께 비교해 재사용된 PID를 stale로 본다.
function isTransactionOwnerActive(pid: number, transactionCreatedAt: string | number) {
  if (!isProcessAlive(pid)) return false

  const processStartedAt = readProcessStartTime(pid)
  const transactionStartedAt =
    typeof transactionCreatedAt === 'number'
      ? transactionCreatedAt
      : Date.parse(transactionCreatedAt)

  if (processStartedAt === null || !Number.isFinite(transactionStartedAt)) return true

  return processStartedAt <= transactionStartedAt + 5_000
}

// isUnsupportedDirectorySyncError 함수는 Windows가 명시적으로 보고하는 디렉터리 fsync 미지원만 판별한다.
function isUnsupportedDirectorySyncError(error: unknown) {
  const nodeError = error as NodeJS.ErrnoException

  return (
    process.platform === 'win32' &&
    ['EPERM', 'EINVAL', 'ENOTSUP', 'ENOSYS'].includes(nodeError.code ?? '') &&
    (!nodeError.syscall || nodeError.syscall === 'fsync')
  )
}

// syncDirectoryBestEffort 함수는 미지원 Windows를 제외하고 디렉터리 동기화 오류를 그대로 전파한다.
function syncDirectoryBestEffort(directoryPath: string) {
  let descriptor: number | null = null

  try {
    descriptor = openSync(directoryPath, 'r')
    fsyncSync(descriptor)
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error)) throw error
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor)
    }
  }
}

// syncRegularFile 함수는 read-only 파일도 write-only descriptor에서 최종 mode와 바이트를 동기화한다.
function syncRegularFile(filePath: string) {
  const stats = lstatSync(filePath)
  const originalMode = stats.mode & 0o7777
  let descriptor: number | null = null
  let finalModeApplied = false

  assertSingleLinkFile(stats, 'Transaction result')

  if ((originalMode & 0o200) === 0) {
    chmodSync(filePath, originalMode | 0o200)
  }

  try {
    descriptor = openSync(filePath, constants.O_WRONLY)
    const descriptorStats = fstatSync(descriptor)
    assertSingleLinkFile(descriptorStats, 'Transaction result')

    if (!sameFileIdentity(stats, descriptorStats)) {
      throw new Error('Transaction result changed before it could be synchronized.')
    }

    fchmodSync(descriptor, originalMode)
    finalModeApplied = true
    fsyncSync(descriptor)
  } finally {
    if (descriptor !== null) closeSync(descriptor)

    if (!finalModeApplied && existsSync(filePath)) {
      chmodSync(filePath, originalMode)
    }
  }
}

// createTransactionSourceHash 함수는 계획 원문과 저널 바이트를 비교할 SHA-256 값을 만든다.
export function createTransactionSourceHash(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

// assertSingleLinkFile 함수는 프로젝트 밖 inode를 함께 바꿀 수 있는 hard link 파일을 거부한다.
function assertSingleLinkFile(stats: NonNullable<ReturnType<typeof lstatSync>>, label: string) {
  if (!stats.isFile() || stats.nlink !== 1) {
    throw new Error(`${label} must be a regular file with exactly one hard link.`)
  }
}

// sortLockRoots 함수는 project root를 먼저 두고 공유 safety root를 항상 같은 순서로 정렬한다.
function sortLockRoots(projectRootValue: string, lockRootValues: Iterable<string>) {
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
  lockStats: NonNullable<ReturnType<typeof lstatSync>>,
  lock: NormalizedTransactionLock,
) {
  if (lockStats.nlink === 1) return

  if (lockStats.nlink !== 2 || !/^[0-9a-z-]+$/i.test(lock.transactionId)) {
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

  const preparingStats = lstatSync(preparingPath)
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
  assertSingleLinkFile(lstatSync(lockPath), 'Transaction lock')
}

// readFixedLock 함수는 lock의 구조를 읽고 정상적인 공개 중단 상태를 단일 link로 정리한다.
function readFixedLock(lockRootValue: string, kind: FixedLockKind) {
  const lockRoot = resolve(lockRootValue)
  const lockPath = getFixedLockPath(lockRoot, kind)
  assertProjectPathSafe(lockRoot, lockPath, 'Transaction lock')

  if (!existsSync(lockPath)) return null

  const stats = lstatSync(lockPath)

  if (!stats.isFile() || stats.nlink < 1 || stats.nlink > 2) {
    throw new Error('Transaction lock is not a regular published file.')
  }

  const lock = parseTransactionLock(readFileSync(lockPath, 'utf8'), lockRoot, kind)
  normalizePublishedLockHardLink(lockRoot, kind, lockPath, stats, lock)
  return lock
}

// cleanupLockClaim 함수는 중단된 lock 제거 claim을 소유자 생존 여부 확인 뒤 정상화한다.
function cleanupLockClaim(lockRootValue: string, kind: FixedLockKind) {
  const lockRoot = resolve(lockRootValue)
  const lockPath = getFixedLockPath(lockRoot, kind)
  const claimPath = getLockClaimPath(lockRoot, kind)

  assertProjectPathSafe(lockRoot, claimPath, 'Transaction lock release claim')

  if (!existsSync(claimPath)) return

  const claimStats = lstatSync(claimPath)

  if (!claimStats.isFile()) {
    throw new Error('Transaction lock release claim is not a regular file.')
  }

  const claim = parseTransactionLock(readFileSync(claimPath, 'utf8'), lockRoot, kind)
  const claimIsFresh = Date.now() - claimStats.ctimeMs < 5_000

  if (claimIsFresh || isTransactionOwnerActive(claim.ownerPid, claim.createdAt)) {
    throw new Error(`A Frontron ${kind} lock is currently being released.`)
  }

  if (existsSync(lockPath) && !sameFileIdentity(claimStats, lstatSync(lockPath))) {
    throw new Error('Transaction lock release claim does not match the fixed lock.')
  }

  unlinkSync(claimPath)
  syncDirectoryBestEffort(lockRoot)
}

// cleanupLockPreparations 함수는 공개되지 않은 stale lock 준비 파일만 안전하게 제거한다.
function cleanupLockPreparations(lockRootValue: string, kind: FixedLockKind) {
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
    const stats = lstatSync(preparingPath)

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

    unlinkSync(preparingPath)
    removed = true
  }

  if (removed) syncDirectoryBestEffort(lockRoot)
}

// createLockMetadata 함수는 모든 root에 동일하게 공개할 완성된 lock metadata를 만든다.
function createLockMetadata(
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
function publishFixedLock(lockRootValue: string, metadata: TransactionLock) {
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
function assertFixedLockOwnership(
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
function removeFixedLock(
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
    const fixedStats = lstatSync(lockPath)
    const claimStats = lstatSync(claimPath)
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
function acquireTransactionLockSet(
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
function assertTransactionLockSetOwnership(handle: TransactionHandle) {
  for (const lockRoot of handle.lockRoots) {
    assertFixedLockOwnership(lockRoot, 'transaction', handle.transactionId, handle.projectRoot)
  }
}

// releaseTransactionLockSet 함수는 획득 반대 순서로 현재 transaction 소유 lock만 제거한다.
function releaseTransactionLockSet(handle: TransactionHandle, bestEffort = false) {
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

// cleanupPreparingJournals 함수는 active로 공개되지 못한 이전 준비 파일만 안전하게 제거한다.
function cleanupPreparingJournals(projectRoot: string) {
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

// normalizeTarget 함수는 호출자가 준 변경 대상을 절대 경로와 명시적 종류로 정리한다.
function normalizeTarget(projectRoot: string, target: TransactionTarget) {
  const absolutePath = resolve(target.path)
  const absoluteSafetyRoot = resolve(target.safetyRoot)
  const kind = target.kind ?? 'file'
  const expectedHash = target.expectedHash

  if (
    expectedHash !== undefined &&
    (kind !== 'file' || (expectedHash !== null && !/^[0-9a-f]{64}$/.test(expectedHash)))
  ) {
    throw new Error(`Transaction target has an invalid expected hash: ${absolutePath}`)
  }

  if (isJournalControlPath(projectRoot, absolutePath)) {
    throw new Error('A transaction target must not overwrite its own journal or lock.')
  }

  createPathReference(projectRoot, absolutePath, absoluteSafetyRoot)

  return { absolutePath, absoluteSafetyRoot, kind, expectedHash }
}

// addUniqueTarget 함수는 같은 경로를 한 번만 기록하고 상충하는 종류나 경계는 거부한다.
function addUniqueTarget(
  targets: Map<string, ReturnType<typeof normalizeTarget>>,
  target: ReturnType<typeof normalizeTarget>,
) {
  const targetKey = pathIdentity(target.absolutePath, target.absoluteSafetyRoot)
  const existing = targets.get(targetKey)

  if (!existing) {
    targets.set(targetKey, target)
    return
  }

  if (
    pathIdentity(existing.absoluteSafetyRoot, existing.absoluteSafetyRoot) !==
      pathIdentity(target.absoluteSafetyRoot, target.absoluteSafetyRoot) ||
    existing.kind !== target.kind ||
    existing.expectedHash !== target.expectedHash
  ) {
    throw new Error(`Transaction target has conflicting definitions: ${target.absolutePath}`)
  }
}

// normalizeTransactionTargets 함수는 중복과 생성될 부모를 포함한 최종 snapshot 대상 집합을 만든다.
function normalizeTransactionTargets(projectRoot: string, requestedTargets: TransactionTarget[]) {
  const targets = new Map<string, ReturnType<typeof normalizeTarget>>()

  for (const requestedTarget of requestedTargets) {
    const target = normalizeTarget(projectRoot, requestedTarget)
    addUniqueTarget(targets, target)
    addMissingParentTargets(projectRoot, targets, target)
  }

  return targets
}

// collectTargetLockRoots 함수는 정규화된 대상의 모든 safety root를 배타 lock 집합으로 모은다.
function collectTargetLockRoots(
  projectRoot: string,
  targets: Iterable<ReturnType<typeof normalizeTarget>>,
) {
  return sortLockRoots(
    projectRoot,
    [...targets].map((target) => target.absoluteSafetyRoot),
  )
}

// assertExpectedTargetHashes 함수는 lock 획득 후 계획 시점 원문이 그대로인지 snapshot 전에 확인한다.
function assertExpectedTargetHashes(targets: Iterable<ReturnType<typeof normalizeTarget>>) {
  for (const target of targets) {
    if (target.expectedHash === undefined) continue

    const exists = existsSync(target.absolutePath)
    let currentHash: string | null = null

    if (exists) {
      const stats = lstatSync(target.absolutePath)
      assertSingleLinkFile(stats, 'Transaction expected-hash target')
      currentHash = createTransactionSourceHash(readFileSync(target.absolutePath))
    }

    if (currentHash !== target.expectedHash) {
      throw new Error(`${target.absolutePath} changed after the transaction plan was created.`)
    }
  }
}

// addMissingParentTargets 함수는 작업 중 새로 생길 수 있는 부모 디렉터리도 복구 대상으로 넣는다.
function addMissingParentTargets(
  projectRoot: string,
  targets: Map<string, ReturnType<typeof normalizeTarget>>,
  target: ReturnType<typeof normalizeTarget>,
) {
  let currentDirectory = dirname(target.absolutePath)

  while (
    currentDirectory !== target.absoluteSafetyRoot &&
    isInsideDirectory(target.absoluteSafetyRoot, currentDirectory)
  ) {
    assertProjectPathSafe(
      target.absoluteSafetyRoot,
      currentDirectory,
      'Transaction parent directory',
    )

    if (existsSync(currentDirectory)) {
      if (!lstatSync(currentDirectory).isDirectory()) {
        throw new Error(`Transaction parent is not a directory: ${currentDirectory}`)
      }

      break
    }

    addUniqueTarget(
      targets,
      normalizeTarget(projectRoot, {
        path: currentDirectory,
        safetyRoot: target.absoluteSafetyRoot,
        kind: 'directory',
      }),
    )
    currentDirectory = dirname(currentDirectory)
  }
}

// takeSnapshot 함수는 변경 전 파일 바이트 또는 디렉터리 상태와 모드를 메모리에 담는다.
function takeSnapshot(
  projectRoot: string,
  target: ReturnType<typeof normalizeTarget>,
): JournalSnapshot {
  const reference = createPathReference(projectRoot, target.absolutePath, target.absoluteSafetyRoot)

  if (!existsSync(target.absolutePath)) {
    return {
      ...reference,
      kind: target.kind,
      existed: false,
      contentBase64: null,
      contentSha256: null,
      mode: null,
    }
  }

  assertProjectPathSafe(
    target.absoluteSafetyRoot,
    target.absolutePath,
    'Transaction snapshot target',
  )
  const stats = lstatSync(target.absolutePath)
  const kindMatches = target.kind === 'file' ? stats.isFile() : stats.isDirectory()

  if (!kindMatches) {
    throw new Error(`Transaction target is not a regular ${target.kind}: ${target.absolutePath}`)
  }

  if (target.kind === 'file') {
    assertSingleLinkFile(stats, 'Transaction snapshot target')
  }

  const content = target.kind === 'file' ? readFileSync(target.absolutePath) : null

  return {
    ...reference,
    kind: target.kind,
    existed: true,
    contentBase64: content?.toString('base64') ?? null,
    contentSha256: content ? createTransactionSourceHash(content) : null,
    mode: stats.mode & 0o7777,
  }
}

// createJournal 함수는 모든 대상을 먼저 스냅샷한 뒤 active 저널 객체를 완성한다.
function createJournal(
  projectRoot: string,
  operation: TransactionOperation,
  targets: Iterable<ReturnType<typeof normalizeTarget>>,
  transactionId: string,
  createdAt: string,
): TransactionJournal {
  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    state: 'active',
    transactionId,
    operation,
    ownerPid: process.pid,
    createdAt,
    snapshots: [...targets].map((target) => takeSnapshot(projectRoot, target)),
  }
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
  journalStats: NonNullable<ReturnType<typeof lstatSync>>,
  journal: TransactionJournal,
) {
  if (journalStats.nlink === 1) return

  if (journalStats.nlink !== 2) {
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
  const preparingStats = lstatSync(preparingPath)
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
  assertSingleLinkFile(lstatSync(journalPath), 'Transaction journal')
}

// readActiveJournal 함수는 active 저널을 읽고 정상적인 nlink=2 공개 중단 상태를 자동 정상화한다.
function readActiveJournal(projectRoot: string) {
  const journalPath = getJournalPath(projectRoot)
  assertProjectPathSafe(projectRoot, journalPath, 'Transaction journal')

  if (!existsSync(journalPath)) {
    return null
  }

  const stats = lstatSync(journalPath)

  if (!stats.isFile() || stats.nlink < 1 || stats.nlink > 2) {
    throw new Error('Transaction journal is not a regular file.')
  }

  const journal = parseJournal(projectRoot, readFileSync(journalPath, 'utf8'))
  normalizePublishedJournalHardLink(projectRoot, journalPath, stats, journal)
  return journal
}

// publishJournal 함수는 fsync한 준비 파일을 hard link로 한 번에 active 상태로 공개한다.
function publishJournal(projectRoot: string, journal: TransactionJournal) {
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

// resolveSnapshotsForRecovery 함수는 모든 경로와 현재 파일 종류를 먼저 검사해 부분 복구를 줄인다.
function resolveSnapshotsForRecovery(projectRoot: string, journal: TransactionJournal) {
  return journal.snapshots.map((snapshot) => {
    const resolved = resolvePathReference(projectRoot, snapshot, 'Transaction recovery target')

    if (existsSync(resolved.absolutePath)) {
      const stats = lstatSync(resolved.absolutePath)

      if (stats.isSymbolicLink()) {
        throw new Error(
          `Transaction recovery target became a symbolic link or junction: ${snapshot.path}`,
        )
      }

      if (snapshot.kind === 'file' && stats.isFile()) {
        assertSingleLinkFile(stats, 'Transaction recovery target')
      }
    }

    return { ...snapshot, ...resolved }
  })
}

// restoreExistingDirectory 함수는 clean 중 지워졌던 기존 빈 디렉터리와 모드를 복원한다.
function restoreExistingDirectory(snapshot: ResolvedSnapshot) {
  assertProjectPathSafe(
    snapshot.absoluteSafetyRoot,
    snapshot.absolutePath,
    'Transaction recovery directory',
  )

  if (existsSync(snapshot.absolutePath) && !lstatSync(snapshot.absolutePath).isDirectory()) {
    throw new Error(`Cannot restore a directory over another entry: ${snapshot.path}`)
  }

  mkdirSync(snapshot.absolutePath, { recursive: true })
  assertProjectPathSafe(
    snapshot.absoluteSafetyRoot,
    snapshot.absolutePath,
    'Transaction recovery directory',
  )
  chmodSync(snapshot.absolutePath, snapshot.mode ?? 0o755)
}

// restoreExistingFile 함수는 기존 파일의 원문 바이트와 권한 모드를 그대로 되돌린다.
function restoreExistingFile(snapshot: ResolvedSnapshot) {
  assertProjectPathSafe(
    snapshot.absoluteSafetyRoot,
    snapshot.absolutePath,
    'Transaction recovery file',
  )

  mkdirSync(dirname(snapshot.absolutePath), { recursive: true })
  assertProjectPathSafe(
    snapshot.absoluteSafetyRoot,
    snapshot.absolutePath,
    'Transaction recovery file',
  )
  const existedBeforeOpen = existsSync(snapshot.absolutePath)
  const beforeStats = existedBeforeOpen ? lstatSync(snapshot.absolutePath) : null
  const finalMode = snapshot.mode ?? 0o644
  let descriptor: number | null = null
  let finalModeApplied = false

  if (beforeStats) {
    assertSingleLinkFile(beforeStats, 'Transaction recovery file')

    if ((beforeStats.mode & 0o200) === 0) {
      chmodSync(snapshot.absolutePath, (beforeStats.mode & 0o7777) | 0o200)
    }
  }

  try {
    descriptor = openSync(
      snapshot.absolutePath,
      existedBeforeOpen
        ? constants.O_WRONLY
        : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    )
    const descriptorStats = fstatSync(descriptor)
    assertSingleLinkFile(descriptorStats, 'Transaction recovery file')

    if (beforeStats && !sameFileIdentity(beforeStats, descriptorStats)) {
      throw new Error('Transaction recovery file changed before restoration.')
    }

    ftruncateSync(descriptor, 0)
    writeFileSync(descriptor, Buffer.from(snapshot.contentBase64 ?? '', 'base64'))
    fchmodSync(descriptor, finalMode)
    finalModeApplied = true
    fsyncSync(descriptor)
  } finally {
    if (descriptor !== null) closeSync(descriptor)

    if (!finalModeApplied && existsSync(snapshot.absolutePath)) {
      chmodSync(snapshot.absolutePath, finalMode)
    }
  }
}

// removeOriginallyMissingFile 함수는 transaction 전에는 없던 파일만 안전하게 제거한다.
function removeOriginallyMissingFile(snapshot: ResolvedSnapshot) {
  if (!existsSync(snapshot.absolutePath)) {
    return
  }

  if (!lstatSync(snapshot.absolutePath).isFile()) {
    throw new Error(`Cannot remove a non-file recovery target: ${snapshot.path}`)
  }

  assertProjectPathSafe(
    snapshot.absoluteSafetyRoot,
    snapshot.absolutePath,
    'Transaction recovery file',
  )
  rmSync(snapshot.absolutePath, { force: true })
}

// removeOriginallyMissingDirectory 함수는 transaction이 만든 디렉터리가 지금도 비어 있을 때만 지운다.
function removeOriginallyMissingDirectory(snapshot: ResolvedSnapshot) {
  if (!existsSync(snapshot.absolutePath)) {
    return
  }

  if (!lstatSync(snapshot.absolutePath).isDirectory()) {
    throw new Error(`Cannot remove a non-directory recovery target: ${snapshot.path}`)
  }

  assertProjectPathSafe(
    snapshot.absoluteSafetyRoot,
    snapshot.absolutePath,
    'Transaction recovery directory',
  )

  if (readdirSync(snapshot.absolutePath).length === 0) {
    rmdirSync(snapshot.absolutePath)
  }
}

// restoreJournalSnapshots 함수는 디렉터리, 파일, 신규 경로 순으로 원래 상태를 반복 안전하게 복구한다.
function restoreJournalSnapshots(projectRoot: string, journal: TransactionJournal) {
  const snapshots = resolveSnapshotsForRecovery(projectRoot, journal)
  const existingDirectories = snapshots
    .filter((snapshot) => snapshot.kind === 'directory' && snapshot.existed)
    .sort((left, right) => left.absolutePath.length - right.absolutePath.length)
  const existingFiles = snapshots.filter((snapshot) => snapshot.kind === 'file' && snapshot.existed)
  const missingFiles = snapshots.filter((snapshot) => snapshot.kind === 'file' && !snapshot.existed)
  const missingDirectories = snapshots
    .filter((snapshot) => snapshot.kind === 'directory' && !snapshot.existed)
    .sort((left, right) => right.absolutePath.length - left.absolutePath.length)

  for (const snapshot of existingDirectories) {
    restoreExistingDirectory(snapshot)
  }

  for (const snapshot of existingFiles) {
    restoreExistingFile(snapshot)
  }

  for (const snapshot of missingFiles) {
    removeOriginallyMissingFile(snapshot)
  }

  for (const snapshot of missingDirectories) {
    removeOriginallyMissingDirectory(snapshot)
  }
}

// addExistingDirectoryChain 함수는 변경 경로부터 safety root까지 존재하는 모든 부모를 모은다.
function addExistingDirectoryChain(
  directories: Set<string>,
  startPathValue: string,
  safetyRootValue: string,
) {
  const safetyRoot = resolve(safetyRootValue)
  let currentPath = resolve(startPathValue)

  while (currentPath === safetyRoot || isInsideDirectory(safetyRoot, currentPath)) {
    if (existsSync(currentPath) && lstatSync(currentPath).isDirectory()) {
      directories.add(currentPath)
    }

    if (currentPath === safetyRoot) break
    currentPath = dirname(currentPath)
  }
}

// syncJournalResults 함수는 파일과 생성·삭제된 모든 부모를 active 저널보다 먼저 동기화한다.
function syncJournalResults(projectRoot: string, journal: TransactionJournal) {
  const snapshots = resolveSnapshotsForRecovery(projectRoot, journal)
  const directories = new Set<string>([projectRoot])

  for (const snapshot of snapshots) {
    if (existsSync(snapshot.absolutePath)) {
      const stats = lstatSync(snapshot.absolutePath)

      if (stats.isFile()) {
        syncRegularFile(snapshot.absolutePath)
        addExistingDirectoryChain(
          directories,
          dirname(snapshot.absolutePath),
          snapshot.absoluteSafetyRoot,
        )
      } else if (stats.isDirectory()) {
        addExistingDirectoryChain(directories, snapshot.absolutePath, snapshot.absoluteSafetyRoot)
      }
    } else {
      addExistingDirectoryChain(
        directories,
        dirname(snapshot.absolutePath),
        snapshot.absoluteSafetyRoot,
      )
    }

    directories.add(snapshot.absoluteSafetyRoot)
  }

  for (const directoryPath of [...directories].sort((left, right) => right.length - left.length)) {
    if (existsSync(directoryPath) && lstatSync(directoryPath).isDirectory()) {
      syncDirectoryBestEffort(directoryPath)
    }
  }
}

// removeActiveJournal 함수는 복구 또는 commit이 끝난 뒤 일치하는 active 저널만 제거한다.
function removeActiveJournal(projectRoot: string, transactionId: string) {
  const activeJournal = readActiveJournal(projectRoot)

  if (!activeJournal) {
    throw new Error('The active transaction journal disappeared before completion.')
  }

  if (activeJournal.transactionId !== transactionId) {
    throw new Error('The active transaction journal belongs to a different transaction.')
  }

  const journalPath = getJournalPath(projectRoot)
  assertProjectPathSafe(projectRoot, journalPath, 'Transaction journal')
  const beforeStats = lstatSync(journalPath)
  const finalJournal = parseJournal(projectRoot, readFileSync(journalPath, 'utf8'))

  if (
    finalJournal.transactionId !== transactionId ||
    !sameFileIdentity(beforeStats, lstatSync(journalPath))
  ) {
    throw new Error('The active transaction journal changed immediately before removal.')
  }

  unlinkSync(journalPath)
  syncDirectoryBestEffort(projectRoot)
}

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
function acquireRecoveryMutex(projectRootValue: string) {
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
function releaseRecoveryMutex(handle: { projectRoot: string; transactionId: string }) {
  removeFixedLock(
    handle.projectRoot,
    'recovery',
    handle.transactionId,
    process.pid,
    handle.projectRoot,
  )
}

// recoverPendingTransactionLocked 함수는 recovery mutex 안에서 stale lock 인수부터 journal 제거까지 수행한다.
function recoverPendingTransactionLocked(
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
  }

  try {
    assertExpectedTargetHashes(normalizedTargets.values())
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

  restoreJournalSnapshots(handle.projectRoot, journal)
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
