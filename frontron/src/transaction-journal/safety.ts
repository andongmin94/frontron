import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  rmSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { assertProjectPathSafe, isInsideDirectory } from '../project-paths'
import {
  TRANSACTION_JOURNAL_PATH,
  TRANSACTION_JOURNAL_PREPARING_PREFIX,
  TRANSACTION_LOCK_CLAIM_PATH,
  TRANSACTION_LOCK_PATH,
  TRANSACTION_LOCK_PREPARING_PREFIX,
  TRANSACTION_RECOVERY_LOCK_CLAIM_PATH,
  TRANSACTION_RECOVERY_LOCK_PATH,
  TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX,
} from './types'
import type { FixedLockKind, JournalPathReference, ResolvedSnapshot } from './types'

const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml'
const YARN_RC_FILE = '.yarnrc.yml'
const caseSensitivityCache = new Map<
  string,
  { device: bigint; inode: bigint; caseSensitive: boolean }
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
export function resolvePathReference(
  projectRoot: string,
  reference: JournalPathReference,
  label: string,
) {
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
export function createPathReference(
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
export function assertRegularProjectRoot(projectRoot: string) {
  const stats = lstatSync(projectRoot)

  if (!stats.isDirectory()) {
    throw new Error(`Transaction project root is not a directory: ${projectRoot}`)
  }
}

// getJournalPath 함수는 프로젝트 루트의 active 저널 절대 경로를 만든다.
export function getJournalPath(projectRoot: string) {
  return resolve(projectRoot, TRANSACTION_JOURNAL_PATH)
}

// getFixedLockPath 함수는 safety root에 둘 transaction 또는 recovery 고정 lock 경로를 만든다.
export function getFixedLockPath(lockRoot: string, kind: FixedLockKind) {
  return resolve(
    lockRoot,
    kind === 'transaction' ? TRANSACTION_LOCK_PATH : TRANSACTION_RECOVERY_LOCK_PATH,
  )
}

// getLockPreparingPrefix 함수는 lock 종류별 원자 공개 준비 파일 접두사를 돌려준다.
export function getLockPreparingPrefix(kind: FixedLockKind) {
  return kind === 'transaction'
    ? TRANSACTION_LOCK_PREPARING_PREFIX
    : TRANSACTION_RECOVERY_LOCK_PREPARING_PREFIX
}

// getLockClaimPath 함수는 lock 제거를 다른 획득 시도와 직렬화할 claim 경로를 만든다.
export function getLockClaimPath(lockRoot: string, kind: FixedLockKind) {
  return resolve(
    lockRoot,
    kind === 'transaction' ? TRANSACTION_LOCK_CLAIM_PATH : TRANSACTION_RECOVERY_LOCK_CLAIM_PATH,
  )
}

// lstatPrecisely 함수는 Windows의 큰 파일 ID가 number로 반올림되지 않도록 bigint 통계를 읽는다.
export function lstatPrecisely(targetPath: string) {
  return lstatSync(targetPath, { bigint: true })
}

// fstatPrecisely 함수는 열린 파일도 경로와 같은 정밀도의 identity로 비교할 수 있게 읽는다.
export function fstatPrecisely(descriptor: number) {
  return fstatSync(descriptor, { bigint: true })
}

// sameFileIdentity 함수는 같은 safety boundary에서 Node 22 Windows의 장치 ID 0까지 안전하게 비교한다.
export function sameFileIdentity(
  left: ReturnType<typeof lstatPrecisely>,
  right: ReturnType<typeof lstatPrecisely>,
) {
  const inodeMatches = left.ino !== 0n && left.ino === right.ino
  const deviceMatches = left.dev === 0n || right.dev === 0n || left.dev === right.dev

  return inodeMatches && deviceMatches
}

// isSafetyRootCaseSensitive 함수는 safety root의 실제 대소문자 구분 동작을 probe하고 inode별로 캐시한다.
function isSafetyRootCaseSensitive(safetyRootValue: string) {
  const safetyRoot = resolve(safetyRootValue)
  const rootIdentity = lstatPrecisely(safetyRoot)

  if (!rootIdentity.isDirectory()) {
    throw new Error(`Transaction safety root is not a directory: ${safetyRoot}`)
  }

  const cached = caseSensitivityCache.get(safetyRoot)

  if (cached && cached.device === rootIdentity.dev && cached.inode === rootIdentity.ino) {
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
      caseSensitive = !sameFileIdentity(lstatPrecisely(probePath), lstatPrecisely(alternatePath))
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    rmSync(probePath, { force: true })
  }

  syncDirectoryBestEffort(safetyRoot)
  caseSensitivityCache.set(safetyRoot, {
    device: rootIdentity.dev,
    inode: rootIdentity.ino,
    caseSensitive,
  })
  return caseSensitive
}

// pathIdentity 함수는 safety root의 실제 규칙에 따라 경로 중복 비교용 값을 만든다.
export function pathIdentity(value: string, safetyRoot: string) {
  const absolutePath = resolve(value)
  return isSafetyRootCaseSensitive(safetyRoot) ? absolutePath : absolutePath.toLowerCase()
}

// controlNameIdentity 함수는 예약 제어 파일 이름을 프로젝트 root의 실제 규칙으로 비교한다.
function controlNameIdentity(value: string, projectRoot: string) {
  return isSafetyRootCaseSensitive(projectRoot) ? value : value.toLowerCase()
}

// isJournalControlPath 함수는 일반 변경 대상이 저널 제어 파일을 덮어쓰지 못하게 막는다.
export function isJournalControlPath(projectRoot: string, absolutePath: string) {
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
export function isTransactionOwnerActive(pid: number, transactionCreatedAt: string | number) {
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
export function syncDirectoryBestEffort(directoryPath: string) {
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

// openRegularFileNoFollow 함수는 마지막 symlink 추적과 특수 파일 open 대기를 함께 막는다.
export function openRegularFileNoFollow(filePath: string, flags: number, mode?: number) {
  const safeOpenFlags = flags | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)

  return mode === undefined
    ? openSync(filePath, safeOpenFlags)
    : openSync(filePath, safeOpenFlags, mode)
}

// openRegularFileIdentity 함수는 read-only와 write-only 파일 모두 경로 chmod 없이 고정한다.
export function openRegularFileIdentity(filePath: string) {
  try {
    return openRegularFileNoFollow(filePath, constants.O_RDONLY)
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    return openRegularFileNoFollow(filePath, constants.O_WRONLY)
  }
}

// assertOpenRegularFileIdentity 함수는 열린 inode와 현재 경로가 여전히 같은 단일-link 파일인지 확인한다.
export function assertOpenRegularFileIdentity(
  descriptor: number,
  filePath: string,
  expectedIdentity: ReturnType<typeof fstatPrecisely> | null,
  label: string,
  changedMessage: string,
) {
  const descriptorStats = fstatPrecisely(descriptor)
  assertSingleLinkFile(descriptorStats, label)

  let pathStats: ReturnType<typeof lstatPrecisely>

  try {
    pathStats = lstatPrecisely(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(changedMessage)
    }

    throw error
  }

  assertSingleLinkFile(pathStats, label)

  if (
    (expectedIdentity && !sameFileIdentity(expectedIdentity, descriptorStats)) ||
    !sameFileIdentity(descriptorStats, pathStats)
  ) {
    throw new Error(changedMessage)
  }

  return descriptorStats
}

// syncRegularFile 함수는 read-only 결과도 경로 chmod 없이 같은 inode의 descriptor에서 동기화한다.
export function syncRegularFile(snapshot: ResolvedSnapshot) {
  const filePath = snapshot.absolutePath
  const changedMessage = 'Transaction result changed before it could be synchronized.'
  let identityDescriptor: number | null = null
  let writeDescriptor: number | null = null
  let originalMode: number | null = null
  let temporaryModeApplied = false

  assertProjectPathSafe(snapshot.absoluteSafetyRoot, filePath, 'Transaction result')

  try {
    identityDescriptor = openRegularFileIdentity(filePath)
    const identityStats = assertOpenRegularFileIdentity(
      identityDescriptor,
      filePath,
      null,
      'Transaction result',
      changedMessage,
    )
    assertProjectPathSafe(snapshot.absoluteSafetyRoot, filePath, 'Transaction result')
    originalMode = Number(identityStats.mode & 0o7777n)

    // 안전 불변식: 임시 쓰기 권한은 경로 이름이 아니라 먼저 고정한 inode에만 적용한다.
    // 경로가 교체되면 다음 identity 검증이 실패하고 finally도 같은 descriptor만 원복한다.
    if ((originalMode & 0o200) === 0) {
      fchmodSync(identityDescriptor, originalMode | 0o200)
      temporaryModeApplied = true
      assertProjectPathSafe(snapshot.absoluteSafetyRoot, filePath, 'Transaction result')
      assertOpenRegularFileIdentity(
        identityDescriptor,
        filePath,
        identityStats,
        'Transaction result',
        changedMessage,
      )
    }

    writeDescriptor = openRegularFileNoFollow(filePath, constants.O_WRONLY)
    assertProjectPathSafe(snapshot.absoluteSafetyRoot, filePath, 'Transaction result')
    assertOpenRegularFileIdentity(
      writeDescriptor,
      filePath,
      identityStats,
      'Transaction result',
      changedMessage,
    )

    fchmodSync(writeDescriptor, originalMode)
    temporaryModeApplied = false
    fsyncSync(writeDescriptor)

    assertProjectPathSafe(snapshot.absoluteSafetyRoot, filePath, 'Transaction result')
    assertOpenRegularFileIdentity(
      writeDescriptor,
      filePath,
      identityStats,
      'Transaction result',
      changedMessage,
    )
  } finally {
    try {
      if (temporaryModeApplied && identityDescriptor !== null && originalMode !== null) {
        fchmodSync(identityDescriptor, originalMode)
      }
    } finally {
      try {
        if (writeDescriptor !== null) closeSync(writeDescriptor)
      } finally {
        if (identityDescriptor !== null) closeSync(identityDescriptor)
      }
    }
  }
}

// createTransactionSourceHash 함수는 계획 원문과 저널 바이트를 비교할 SHA-256 값을 만든다.
export function createTransactionSourceHash(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

// assertSingleLinkFile 함수는 프로젝트 밖 inode를 함께 바꿀 수 있는 hard link 파일을 거부한다.
export function assertSingleLinkFile(
  stats: NonNullable<ReturnType<typeof lstatSync>> | ReturnType<typeof lstatPrecisely>,
  label: string,
) {
  if (!stats.isFile() || Number(stats.nlink) !== 1) {
    throw new Error(`${label} must be a regular file with exactly one hard link.`)
  }
}
