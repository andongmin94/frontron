import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

import { assertProjectPathSafe, isInsideDirectory } from '../project-paths'
import { sortLockRoots } from './locks'
import {
  assertOpenRegularFileIdentity,
  assertSingleLinkFile,
  createPathReference,
  createTransactionSourceHash,
  fstatPrecisely,
  isJournalControlPath,
  lstatPrecisely,
  openRegularFileIdentity,
  openRegularFileNoFollow,
  pathIdentity,
  resolvePathReference,
  sameFileIdentity,
  syncDirectoryBestEffort,
  syncRegularFile,
} from './safety'
import { JOURNAL_SCHEMA_VERSION } from './types'
import type {
  JournalSnapshot,
  ResolvedSnapshot,
  TransactionJournal,
  TransactionOperation,
  TransactionTarget,
  TransactionTargetKind,
} from './types'

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
export function normalizeTransactionTargets(
  projectRoot: string,
  requestedTargets: TransactionTarget[],
) {
  const targets = new Map<string, ReturnType<typeof normalizeTarget>>()

  for (const requestedTarget of requestedTargets) {
    const target = normalizeTarget(projectRoot, requestedTarget)
    addUniqueTarget(targets, target)
    addMissingParentTargets(projectRoot, targets, target)
  }

  return targets
}

// collectTargetLockRoots 함수는 정규화된 대상의 모든 safety root를 배타 lock 집합으로 모은다.
export function collectTargetLockRoots(
  projectRoot: string,
  targets: Iterable<ReturnType<typeof normalizeTarget>>,
) {
  return sortLockRoots(
    projectRoot,
    [...targets].map((target) => target.absoluteSafetyRoot),
  )
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

// takeSnapshot 함수는 파일 하나의 안정된 descriptor에서 예상 해시 검증과 snapshot 생성을 함께 수행한다.
function takeSnapshot(
  projectRoot: string,
  target: ReturnType<typeof normalizeTarget>,
): JournalSnapshot {
  const reference = createPathReference(projectRoot, target.absolutePath, target.absoluteSafetyRoot)

  assertProjectPathSafe(
    target.absoluteSafetyRoot,
    target.absolutePath,
    'Transaction snapshot target',
  )

  if (target.kind === 'directory') {
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

    const stats = lstatSync(target.absolutePath)

    if (!stats.isDirectory()) {
      throw new Error(`Transaction target is not a regular directory: ${target.absolutePath}`)
    }

    return {
      ...reference,
      kind: target.kind,
      existed: true,
      contentBase64: null,
      contentSha256: null,
      mode: stats.mode & 0o7777,
    }
  }

  let descriptor: number | null = null

  try {
    try {
      descriptor = openSync(target.absolutePath, constants.O_RDONLY)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error

      assertProjectPathSafe(
        target.absoluteSafetyRoot,
        target.absolutePath,
        'Transaction snapshot target',
      )

      if (existsSync(target.absolutePath)) {
        throw new Error(`Transaction snapshot target changed while it was being opened.`)
      }

      if (target.expectedHash !== undefined && target.expectedHash !== null) {
        throw new Error(`${target.absolutePath} changed after the transaction plan was created.`)
      }

      return {
        ...reference,
        kind: target.kind,
        existed: false,
        contentBase64: null,
        contentSha256: null,
        mode: null,
      }
    }

    const initialDescriptorStats = fstatPrecisely(descriptor)
    assertSingleLinkFile(initialDescriptorStats, 'Transaction snapshot target')
    assertProjectPathSafe(
      target.absoluteSafetyRoot,
      target.absolutePath,
      'Transaction snapshot target',
    )
    const initialPathStats = lstatPrecisely(target.absolutePath)
    assertSingleLinkFile(initialPathStats, 'Transaction snapshot target')

    if (!sameFileIdentity(initialDescriptorStats, initialPathStats)) {
      throw new Error('Transaction snapshot target changed before it could be read.')
    }

    const content = readFileSync(descriptor)
    const finalDescriptorStats = fstatPrecisely(descriptor)
    assertSingleLinkFile(finalDescriptorStats, 'Transaction snapshot target')
    assertProjectPathSafe(
      target.absoluteSafetyRoot,
      target.absolutePath,
      'Transaction snapshot target',
    )
    const finalPathStats = lstatPrecisely(target.absolutePath)
    assertSingleLinkFile(finalPathStats, 'Transaction snapshot target')

    if (
      !sameFileIdentity(initialDescriptorStats, finalDescriptorStats) ||
      !sameFileIdentity(finalDescriptorStats, finalPathStats) ||
      initialDescriptorStats.size !== finalDescriptorStats.size ||
      initialDescriptorStats.mtimeMs !== finalDescriptorStats.mtimeMs ||
      initialDescriptorStats.ctimeMs !== finalDescriptorStats.ctimeMs ||
      (initialDescriptorStats.mode & 0o7777n) !== (finalDescriptorStats.mode & 0o7777n)
    ) {
      throw new Error('Transaction snapshot target changed while it was being read.')
    }

    const contentHash = createTransactionSourceHash(content)

    if (target.expectedHash !== undefined && contentHash !== target.expectedHash) {
      throw new Error(`${target.absolutePath} changed after the transaction plan was created.`)
    }

    return {
      ...reference,
      kind: target.kind,
      existed: true,
      contentBase64: content.toString('base64'),
      contentSha256: contentHash,
      mode: Number(initialDescriptorStats.mode & 0o7777n),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Transaction snapshot target changed while it was being read.')
    }

    throw error
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
}

// createJournal 함수는 모든 대상을 먼저 스냅샷한 뒤 active 저널 객체를 완성한다.
export function createJournal(
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

// inspectSnapshotTarget 함수는 현재 존재하는 entry가 저널에 기록된 종류와 정확히 일치하는지 검사한다.
function inspectSnapshotTarget(snapshot: ResolvedSnapshot) {
  assertProjectPathSafe(
    snapshot.absoluteSafetyRoot,
    snapshot.absolutePath,
    'Transaction recovery target',
  )

  let stats: ReturnType<typeof lstatPrecisely>

  try {
    stats = lstatPrecisely(snapshot.absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  if (stats.isSymbolicLink()) {
    throw new Error(
      `Transaction recovery target became a symbolic link or junction: ${snapshot.path}`,
    )
  }

  const actualKind: TransactionTargetKind | null = stats.isFile()
    ? 'file'
    : stats.isDirectory()
      ? 'directory'
      : null

  if (actualKind === null) {
    throw new Error(
      `Transaction recovery target is neither a regular file nor a directory: ${snapshot.path}`,
    )
  }

  if (actualKind !== snapshot.kind) {
    throw new Error(
      `Transaction recovery target kind does not match its snapshot (expected ${snapshot.kind}, found ${actualKind}): ${snapshot.path}`,
    )
  }

  if (actualKind === 'file') {
    assertSingleLinkFile(stats, 'Transaction recovery target')
  }

  return stats
}

// resolveSnapshotsForRecovery 함수는 mutation 전에 모든 종류를 선검증해 불일치로 인한 부분 복구를 막는다.
function resolveSnapshotsForRecovery(projectRoot: string, journal: TransactionJournal) {
  return journal.snapshots.map((snapshot) => {
    const resolved = resolvePathReference(projectRoot, snapshot, 'Transaction recovery target')
    const resolvedSnapshot = { ...snapshot, ...resolved }

    // 상태 전이 불변식: active 저널은 모든 현재 entry의 종류가 검증된 뒤에만 복원/commit 단계로 간다.
    // 하나라도 불일치하거나 특수 파일이면 아직 어떤 snapshot도 건드리지 않고 active 상태를 유지한다.
    inspectSnapshotTarget(resolvedSnapshot)
    return resolvedSnapshot
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

// restoreExistingFile 함수는 기존 파일의 원문 바이트와 권한 모드를 descriptor에 고정해 되돌린다.
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
  const finalMode = snapshot.mode ?? 0o644
  const changedMessage = 'Transaction recovery file changed before restoration.'
  let identityDescriptor: number | null = null
  let writeDescriptor: number | null = null
  let identityStats: ReturnType<typeof fstatPrecisely> | null = null
  let modeBeforeRestore: number | null = null
  let temporaryModeApplied = false

  try {
    try {
      identityDescriptor = openRegularFileIdentity(snapshot.absolutePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    if (identityDescriptor === null) {
      assertProjectPathSafe(
        snapshot.absoluteSafetyRoot,
        snapshot.absolutePath,
        'Transaction recovery file',
      )
      writeDescriptor = openRegularFileNoFollow(
        snapshot.absolutePath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      )
      assertProjectPathSafe(
        snapshot.absoluteSafetyRoot,
        snapshot.absolutePath,
        'Transaction recovery file',
      )
      identityStats = assertOpenRegularFileIdentity(
        writeDescriptor,
        snapshot.absolutePath,
        null,
        'Transaction recovery file',
        changedMessage,
      )
    } else {
      identityStats = assertOpenRegularFileIdentity(
        identityDescriptor,
        snapshot.absolutePath,
        null,
        'Transaction recovery file',
        changedMessage,
      )
      assertProjectPathSafe(
        snapshot.absoluteSafetyRoot,
        snapshot.absolutePath,
        'Transaction recovery file',
      )
      modeBeforeRestore = Number(identityStats.mode & 0o7777n)

      // 안전 불변식: read-only 해제와 실패 시 mode 원복은 모두 처음 연 descriptor에만 수행한다.
      // 따라서 검사 뒤 경로가 교체되어도 새 inode에는 chmod나 truncate가 도달하지 않는다.
      if ((modeBeforeRestore & 0o200) === 0) {
        fchmodSync(identityDescriptor, modeBeforeRestore | 0o200)
        temporaryModeApplied = true
        assertProjectPathSafe(
          snapshot.absoluteSafetyRoot,
          snapshot.absolutePath,
          'Transaction recovery file',
        )
        assertOpenRegularFileIdentity(
          identityDescriptor,
          snapshot.absolutePath,
          identityStats,
          'Transaction recovery file',
          changedMessage,
        )
      }

      writeDescriptor = openRegularFileNoFollow(snapshot.absolutePath, constants.O_WRONLY)
      assertProjectPathSafe(
        snapshot.absoluteSafetyRoot,
        snapshot.absolutePath,
        'Transaction recovery file',
      )
      assertOpenRegularFileIdentity(
        writeDescriptor,
        snapshot.absolutePath,
        identityStats,
        'Transaction recovery file',
        changedMessage,
      )
    }

    ftruncateSync(writeDescriptor, 0)
    writeFileSync(writeDescriptor, Buffer.from(snapshot.contentBase64 ?? '', 'base64'))
    fchmodSync(writeDescriptor, finalMode)
    temporaryModeApplied = false
    fsyncSync(writeDescriptor)

    assertProjectPathSafe(
      snapshot.absoluteSafetyRoot,
      snapshot.absolutePath,
      'Transaction recovery file',
    )
    assertOpenRegularFileIdentity(
      writeDescriptor,
      snapshot.absolutePath,
      identityStats,
      'Transaction recovery file',
      changedMessage,
    )
  } finally {
    try {
      if (temporaryModeApplied && identityDescriptor !== null && modeBeforeRestore !== null) {
        fchmodSync(identityDescriptor, modeBeforeRestore)
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
export function restoreJournalSnapshots(
  projectRoot: string,
  journal: TransactionJournal,
  mutatedTargets?: Set<string>,
) {
  const snapshots = resolveSnapshotsForRecovery(projectRoot, journal)
  // shouldRestoreFile 함수는 현재 프로세스가 실제 mutation을 시작한 파일만 선별한다.
  const shouldRestoreFile = (snapshot: ResolvedSnapshot) =>
    !mutatedTargets ||
    mutatedTargets.has(pathIdentity(snapshot.absolutePath, snapshot.absoluteSafetyRoot))
  const existingDirectories = snapshots
    .filter((snapshot) => snapshot.kind === 'directory' && snapshot.existed)
    .sort((left, right) => left.absolutePath.length - right.absolutePath.length)
  const existingFiles = snapshots.filter(
    (snapshot) => snapshot.kind === 'file' && snapshot.existed && shouldRestoreFile(snapshot),
  )
  const missingFiles = snapshots.filter(
    (snapshot) => snapshot.kind === 'file' && !snapshot.existed && shouldRestoreFile(snapshot),
  )
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
export function syncJournalResults(projectRoot: string, journal: TransactionJournal) {
  const snapshots = resolveSnapshotsForRecovery(projectRoot, journal)
  const directories = new Set<string>([projectRoot])

  for (const snapshot of snapshots) {
    const stats = inspectSnapshotTarget(snapshot)

    if (stats) {
      if (snapshot.kind === 'file') {
        syncRegularFile(snapshot)
        addExistingDirectoryChain(
          directories,
          dirname(snapshot.absolutePath),
          snapshot.absoluteSafetyRoot,
        )
      } else {
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
