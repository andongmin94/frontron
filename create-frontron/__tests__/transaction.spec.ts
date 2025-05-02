import fs from 'node:fs'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { applyStagedProject, recoverScaffoldTransaction, runCreateFrontron } from '../src/index'

const tempDirs: string[] = []

// createTempRoot 함수는 각 테스트가 독립적으로 쓸 임시 루트를 만든다.
function createTempRoot(label: string) {
  const root = mkdtempSync(join(tmpdir(), `create-frontron-${label}-`))
  tempDirs.push(root)
  return root
}

// writeFixture 함수는 테스트 파일의 부모 폴더를 만든 뒤 내용을 기록한다.
function writeFixture(root: string, relativePath: string, content: string) {
  const filePath = join(root, relativePath)
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

// transactionPaths 함수는 테스트 target의 영속 저널과 잠금 경로를 계산한다.
function transactionPaths(root: string) {
  const safeName = basename(root).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project'
  const prefix = join(dirname(root), `.${safeName}.frontron-transaction`)

  return {
    journalPath: `${prefix}.json`,
    lockPath: `${prefix}.lock`,
  }
}

// createRecoveryJournal 함수는 새 schema의 검증·오류 주입 테스트용 영속 저널을 만든다.
function createRecoveryJournal(root: string, overrides: Record<string, unknown> = {}) {
  const transactionId = 'testjournal'
  const safeName = basename(root).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project'
  const stagingRoot = join(dirname(root), `.${safeName}.frontron-staging-${transactionId}`)
  const backupRoot = join(dirname(root), `.${safeName}.frontron-backup-${transactionId}`)
  const journal = {
    schemaVersion: 1,
    pid: process.pid,
    transactionId,
    root,
    stagingRoot,
    backupRoot,
    mode: 'merge',
    rootExisted: true,
    affectedEntries: [] as unknown[],
    backedUpEntries: [] as unknown[],
    entries: [] as unknown[],
    ...overrides,
  }

  mkdirSync(stagingRoot)
  mkdirSync(backupRoot)
  writeFileSync(transactionPaths(root).journalPath, `${JSON.stringify(journal)}\n`, 'utf8')
  return { backupRoot, journal, stagingRoot, transactionId }
}

// builtModuleUrl 함수는 별도 Node 프로세스가 사용할 빌드 결과 URL을 반환한다.
function builtModuleUrl() {
  return pathToFileURL(join(__dirname, '..', 'dist', 'index.mjs')).href
}

// crashReplaceTransaction 함수는 replace commit 도중 자식 프로세스를 종료해 복구 저널을 남긴다.
function crashReplaceTransaction(workspace: string, root: string, stagingRoot: string) {
  const childSource = `
import { applyStagedProject } from ${JSON.stringify(builtModuleUrl())}

applyStagedProject(
  ${JSON.stringify(stagingRoot)},
  ${JSON.stringify(root)},
  'replace',
  { afterEntry() { process.exit(91) } },
)
`

  return spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
    cwd: workspace,
    encoding: 'utf8',
  })
}

// collectChildResult 함수는 동시 복구 자식의 종료 코드와 표준 출력을 모은다.
function collectChildResult(child: ChildProcess) {
  let stdout = ''
  let stderr = ''

  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })

  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

// isCaseInsensitiveDirectory 함수는 현재 임시 볼륨이 case-only 이름을 alias로 취급하는지 확인한다.
function isCaseInsensitiveDirectory(directory: string) {
  const probePath = join(directory, 'FrontronCaseProbe')
  writeFileSync(probePath, 'probe', 'utf8')
  const caseInsensitive = existsSync(join(directory, 'frontroncaseprobe'))
  rmSync(probePath)
  return caseInsensitive
}

// waitForMilliseconds 함수는 자식 프로세스 잠금 상태를 관찰할 짧은 비동기 간격을 만든다.
function waitForMilliseconds(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

afterEach(() => {
  vi.restoreAllMocks()

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

describe('create-frontron scaffold transaction', () => {
  test('replace 백업 중 실패해도 이동한 항목과 아직 이동하지 않은 항목을 모두 보존한다', () => {
    const workspace = createTempRoot('replace-backup-rollback')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')

    writeFixture(root, 'first.txt', 'first original\n')
    writeFixture(root, 'second.txt', 'second original\n')
    writeFixture(stagingRoot, 'package.json', '{"name":"new-app"}\n')

    expect(() =>
      applyStagedProject(stagingRoot, root, 'replace', {
        afterBackupEntry() {
          throw new Error('injected backup failure')
        },
      }),
    ).toThrow('Existing files were restored')

    expect(readFileSync(join(root, 'first.txt'), 'utf8')).toBe('first original\n')
    expect(readFileSync(join(root, 'second.txt'), 'utf8')).toBe('second original\n')
    expect(existsSync(join(root, 'package.json'))).toBe(false)
  })

  test('replace 실패 시 기존 프로젝트와 .git을 모두 복원한다', () => {
    const workspace = createTempRoot('replace-rollback')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')

    writeFixture(root, '.git/HEAD', 'ref: refs/heads/main\n')
    writeFixture(root, 'old.txt', 'old project\n')
    writeFixture(root, 'src/user.ts', 'export const user = true\n')
    writeFixture(stagingRoot, 'package.json', '{"name":"new-app"}\n')
    writeFixture(stagingRoot, 'src/main.ts', 'export const main = true\n')

    expect(() =>
      applyStagedProject(stagingRoot, root, 'replace', {
        afterEntry() {
          throw new Error('injected commit failure')
        },
      }),
    ).toThrow('Existing files were restored')

    expect(readFileSync(join(root, 'old.txt'), 'utf8')).toBe('old project\n')
    expect(readFileSync(join(root, 'src/user.ts'), 'utf8')).toContain('user = true')
    expect(readFileSync(join(root, '.git/HEAD'), 'utf8')).toContain('refs/heads/main')
    expect(existsSync(join(root, 'package.json'))).toBe(false)
  })

  test('merge 실패 시 덮어쓴 파일과 새 파일을 모두 원래 상태로 복원한다', () => {
    const workspace = createTempRoot('merge-rollback')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')

    writeFixture(root, 'package.json', '{"name":"existing"}\n')
    writeFixture(root, 'src/user.ts', 'export const user = true\n')
    writeFixture(stagingRoot, 'package.json', '{"name":"generated"}\n')
    writeFixture(stagingRoot, 'src/main.ts', 'export const generated = true\n')

    expect(() =>
      applyStagedProject(stagingRoot, root, 'merge', {
        afterEntry() {
          throw new Error('injected merge failure')
        },
      }),
    ).toThrow('Existing files were restored')

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('{"name":"existing"}\n')
    expect(readFileSync(join(root, 'src/user.ts'), 'utf8')).toContain('user = true')
    expect(existsSync(join(root, 'src/main.ts'))).toBe(false)
  })

  test('merge 대상의 부모 링크를 따라 외부 디렉터리에 쓰지 않는다', () => {
    const workspace = createTempRoot('merge-symlink-guard')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const externalRoot = join(workspace, 'external')

    writeFixture(externalRoot, 'keep.txt', 'external data\n')
    mkdirSync(root, { recursive: true })
    symlinkSync(externalRoot, join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
    writeFixture(stagingRoot, 'src/main.ts', 'export const generated = true\n')

    expect(() => applyStagedProject(stagingRoot, root, 'merge')).toThrow('symbolic link')
    expect(readFileSync(join(externalRoot, 'keep.txt'), 'utf8')).toBe('external data\n')
    expect(existsSync(join(externalRoot, 'main.ts'))).toBe(false)
  })

  test('프로젝트 내부의 .. 접두사 파일명은 외부 경로로 오판하지 않는다', () => {
    const workspace = createTempRoot('dot-prefix-name')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')

    writeFixture(stagingRoot, '..metadata', 'inside project\n')

    applyStagedProject(stagingRoot, root, 'merge')

    expect(readFileSync(join(root, '..metadata'), 'utf8')).toBe('inside project\n')
  })

  test('커밋 중 프로세스가 종료되면 다음 CLI 실행이 영속 저널로 원본을 복구한다', async () => {
    const workspace = createTempRoot('crash-recovery')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, '.app.frontron-staging-crash')
    const builtModuleUrl = pathToFileURL(join(__dirname, '..', 'dist', 'index.mjs')).href

    writeFixture(root, 'old.txt', 'old project\n')
    writeFixture(root, 'src/user.ts', 'export const user = true\n')
    writeFixture(stagingRoot, 'package.json', '{"name":"new-app"}\n')
    writeFixture(stagingRoot, 'src/main.ts', 'export const main = true\n')

    const childSource = `
import { applyStagedProject } from ${JSON.stringify(builtModuleUrl)}

applyStagedProject(
  ${JSON.stringify(stagingRoot)},
  ${JSON.stringify(root)},
  'replace',
  { afterEntry() { process.exit(91) } },
)
`
    const crashed = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
      cwd: workspace,
      encoding: 'utf8',
    })

    expect(crashed.status).toBe(91)
    expect(existsSync(join(workspace, '.app.frontron-transaction.json'))).toBe(true)

    await runCreateFrontron([root, '--overwrite', 'no'])

    expect(readFileSync(join(root, 'old.txt'), 'utf8')).toBe('old project\n')
    expect(readFileSync(join(root, 'src/user.ts'), 'utf8')).toContain('user = true')
    expect(existsSync(join(root, 'package.json'))).toBe(false)
    expect(readdirSync(workspace).some((entryName) => entryName.startsWith('.app.frontron-'))).toBe(
      false,
    )
  })

  test('두 복구 프로세스가 같은 저널을 동시에 처리해도 원본은 한 번만 복원한다', async () => {
    const workspace = createTempRoot('concurrent-recovery')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')

    writeFixture(root, 'old.txt', 'original\n')
    writeFixture(stagingRoot, 'new.txt', 'generated\n')

    expect(crashReplaceTransaction(workspace, root, stagingRoot).status).toBe(91)

    const childSource = `
import { recoverScaffoldTransaction } from ${JSON.stringify(builtModuleUrl())}
const recovered = recoverScaffoldTransaction(${JSON.stringify(root)})
process.stdout.write(JSON.stringify(recovered))
`
    const children = [
      spawn(process.execPath, ['--input-type=module', '--eval', childSource], { cwd: workspace }),
      spawn(process.execPath, ['--input-type=module', '--eval', childSource], { cwd: workspace }),
    ]
    const results = await Promise.all(children.map(collectChildResult))

    expect(results.map((result) => result.code)).toEqual([0, 0])
    expect(results.map((result) => JSON.parse(result.stdout)).sort()).toEqual([false, true])
    expect(results.map((result) => result.stderr)).toEqual(['', ''])
    expect(readFileSync(join(root, 'old.txt'), 'utf8')).toBe('original\n')
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
  })

  test('잠금 경로에는 빈 파일 없이 완성된 소유권 JSON만 원자적으로 게시한다', async () => {
    const workspace = createTempRoot('atomic-lock-record')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const { lockPath } = transactionPaths(root)

    writeFixture(root, 'old.txt', 'original\n')
    writeFixture(stagingRoot, 'new.txt', 'generated\n')

    const childSource = `
import { applyStagedProject } from ${JSON.stringify(builtModuleUrl())}
try {
  applyStagedProject(
    ${JSON.stringify(stagingRoot)},
    ${JSON.stringify(root)},
    'replace',
    {
      afterBackupEntry() {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750)
        throw new Error('stop after lock observation')
      },
    },
  )
} catch {}
`
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
      cwd: workspace,
    })
    const childResult = collectChildResult(child)
    const observedRecords: Array<Record<string, unknown>> = []
    const observationDeadline = Date.now() + 2_000

    while (Date.now() < observationDeadline && observedRecords.length < 20) {
      if (existsSync(lockPath)) {
        try {
          observedRecords.push(JSON.parse(readFileSync(lockPath, 'utf8')))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }

      if (child.exitCode !== null) break
      await waitForMilliseconds(5)
    }

    expect((await childResult).code).toBe(0)
    expect(observedRecords.length).toBeGreaterThan(0)
    expect(observedRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemaVersion: 1,
          pid: expect.any(Number),
          token: expect.any(String),
          root,
        }),
      ]),
    )
  })

  test('저널이 없으면 사용자 소유 staging 및 backup 접두사 디렉터리를 보존한다', () => {
    const workspace = createTempRoot('user-prefix-preservation')
    const root = join(workspace, 'app')
    const userStaging = join(workspace, '.app.frontron-staging-user-data')
    const userBackup = join(workspace, '.app.frontron-backup-user-data')
    const userTemporary = join(workspace, '.app.frontron-transaction.tmp-user-data')

    writeFixture(userStaging, 'keep.txt', 'staging user data\n')
    writeFixture(userBackup, 'keep.txt', 'backup user data\n')
    writeFixture(userTemporary, 'keep.txt', 'temporary user data\n')

    expect(recoverScaffoldTransaction(root)).toBe(false)
    expect(readFileSync(join(userStaging, 'keep.txt'), 'utf8')).toContain('staging user data')
    expect(readFileSync(join(userBackup, 'keep.txt'), 'utf8')).toContain('backup user data')
    expect(readFileSync(join(userTemporary, 'keep.txt'), 'utf8')).toContain('temporary user data')
  })

  test('case-only target 엔트리는 원래 casing과 내용으로 한 번만 복구한다', () => {
    const workspace = createTempRoot('case-only-recovery')

    if (!isCaseInsensitiveDirectory(workspace)) return

    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    writeFixture(root, 'Settings.JSON', 'original settings\n')
    writeFixture(stagingRoot, 'settings.json', 'generated settings\n')

    expect(crashReplaceTransaction(workspace, root, stagingRoot).status).toBe(91)
    expect(recoverScaffoldTransaction(root)).toBe(true)

    const matchingEntries = readdirSync(root).filter(
      (entryName) => entryName.toLowerCase() === 'settings.json',
    )
    expect(matchingEntries).toEqual(['Settings.JSON'])
    expect(readFileSync(join(root, 'Settings.JSON'), 'utf8')).toBe('original settings\n')
  })

  test('target root junction alias로 복구해도 실제 root의 동일한 저널과 잠금을 사용한다', () => {
    const workspace = createTempRoot('root-alias-recovery')
    const root = join(workspace, 'actual-app')
    const rootAlias = join(workspace, 'app-alias')
    const stagingRoot = join(workspace, 'staging')

    writeFixture(root, 'old.txt', 'original through alias\n')
    writeFixture(stagingRoot, 'new.txt', 'generated\n')
    expect(crashReplaceTransaction(workspace, root, stagingRoot).status).toBe(91)
    symlinkSync(root, rootAlias, process.platform === 'win32' ? 'junction' : 'dir')

    expect(recoverScaffoldTransaction(rootAlias)).toBe(true)
    expect(readFileSync(join(root, 'old.txt'), 'utf8')).toBe('original through alias\n')
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
    expect(existsSync(transactionPaths(root).journalPath)).toBe(false)
    expect(existsSync(transactionPaths(root).lockPath)).toBe(false)
  })

  test('깨진 symlink는 링크 자체를 백업하고 중단 뒤 같은 링크로 복구한다', () => {
    const workspace = createTempRoot('broken-symlink-recovery')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const missingTarget = join(workspace, 'missing-target.txt')
    const linkPath = join(root, 'legacy-link')

    mkdirSync(root)
    if (process.platform === 'win32') {
      mkdirSync(missingTarget)
      symlinkSync(missingTarget, linkPath, 'junction')
      rmSync(missingTarget, { recursive: true })
    } else {
      symlinkSync(missingTarget, linkPath, 'file')
    }
    const originalLinkTarget = readlinkSync(linkPath)
    writeFixture(stagingRoot, 'package.json', '{"name":"generated"}\n')

    expect(existsSync(linkPath)).toBe(false)
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
    expect(crashReplaceTransaction(workspace, root, stagingRoot).status).toBe(91)
    expect(recoverScaffoldTransaction(root)).toBe(true)

    expect(existsSync(linkPath)).toBe(false)
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(linkPath)).toBe(originalLinkTarget)
    expect(existsSync(join(root, 'package.json'))).toBe(false)
  })

  test('fsync EIO를 무시하지 않고 전파한 뒤 기존 파일을 rollback한다', () => {
    const workspace = createTempRoot('fsync-eio')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const originalFsyncSync = fs.fsyncSync.bind(fs)
    let injectNextSync = false
    let injected = false

    writeFixture(root, 'project.txt', 'original\n')
    writeFixture(stagingRoot, 'project.txt', 'generated\n')

    vi.spyOn(fs, 'fsyncSync').mockImplementation((descriptor) => {
      if (injectNextSync && !injected) {
        injected = true
        throw Object.assign(new Error('injected fsync EIO'), { code: 'EIO' })
      }

      return originalFsyncSync(descriptor)
    })

    let receivedError: unknown

    try {
      applyStagedProject(stagingRoot, root, 'merge', {
        afterEntry() {
          injectNextSync = true
        },
      })
    } catch (error) {
      receivedError = error
    }

    expect(injected).toBe(true)
    expect((receivedError as NodeJS.ErrnoException).code).toBe('EIO')
    expect((receivedError as Error).message).toContain('injected fsync EIO')
    expect(readFileSync(join(root, 'project.txt'), 'utf8')).toBe('original\n')
    expect(existsSync(transactionPaths(root).journalPath)).toBe(false)
  })

  test('잠금 소유 토큰이 바뀌면 종료 시 다른 소유자의 잠금을 제거하지 않는다', () => {
    const workspace = createTempRoot('lock-ownership')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const { lockPath } = transactionPaths(root)

    writeFixture(stagingRoot, 'package.json', '{"name":"generated"}\n')

    expect(() =>
      applyStagedProject(stagingRoot, root, 'merge', {
        afterEntry() {
          const lockRecord = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>
          lockRecord.token = 'replacement-owner-token'
          writeFileSync(lockPath, `${JSON.stringify(lockRecord)}\n`, 'utf8')
        },
      }),
    ).toThrow('Lost create-frontron transaction lock ownership')

    expect(existsSync(lockPath)).toBe(true)
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).token).toBe('replacement-owner-token')
  })
})

describe('create-frontron transaction safety branches', () => {
  test('새 schema 저널을 복구하고 이미 사라진 staging 경로 외에는 정확히 정리한다', () => {
    const workspace = createTempRoot('new-journal-recovery')
    const root = join(workspace, 'app')
    const entry = {
      identity: 'name:new.txt',
      targetEntries: ['new.txt'],
      backupEntries: [],
    }
    const { backupRoot, stagingRoot } = createRecoveryJournal(root, {
      affectedEntries: ['new.txt'],
      backedUpEntries: [],
      entries: [entry],
    })

    writeFixture(root, 'new.txt', 'partially generated\n')
    rmSync(stagingRoot, { recursive: true })

    expect(recoverScaffoldTransaction(root)).toBe(true)
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
    expect(existsSync(backupRoot)).toBe(false)
    expect(existsSync(stagingRoot)).toBe(false)
  })

  test.each([
    ['null entry', [null], ['tracked.txt'], []],
    [
      'numeric identity',
      [{ identity: 42, targetEntries: ['tracked.txt'], backupEntries: [] }],
      ['tracked.txt'],
      [],
    ],
    [
      'empty identity',
      [{ identity: '', targetEntries: ['tracked.txt'], backupEntries: [] }],
      ['tracked.txt'],
      [],
    ],
    [
      'non-array targets',
      [{ identity: 'entry', targetEntries: 'tracked.txt', backupEntries: [] }],
      ['tracked.txt'],
      [],
    ],
    ['empty targets', [{ identity: 'entry', targetEntries: [], backupEntries: [] }], [], []],
    [
      'nested target',
      [{ identity: 'entry', targetEntries: ['nested/file'], backupEntries: [] }],
      ['nested/file'],
      [],
    ],
    [
      'non-array backups',
      [{ identity: 'entry', targetEntries: ['tracked.txt'], backupEntries: 'tracked.txt' }],
      ['tracked.txt'],
      ['tracked.txt'],
    ],
    [
      'nested backup',
      [{ identity: 'entry', targetEntries: ['tracked.txt'], backupEntries: ['nested/file'] }],
      ['tracked.txt'],
      ['nested/file'],
    ],
    [
      'target list mismatch',
      [{ identity: 'entry', targetEntries: ['tracked.txt'], backupEntries: [] }],
      ['other.txt'],
      [],
    ],
    [
      'backup list mismatch',
      [{ identity: 'entry', targetEntries: ['tracked.txt'], backupEntries: ['tracked.txt'] }],
      ['tracked.txt'],
      [],
    ],
  ] as const)(
    '잘못된 identity 저널 구조를 거부한다: %s',
    (_label, entries, affectedEntries, backedUpEntries) => {
      const workspace = createTempRoot('invalid-entry-journal')
      const root = join(workspace, 'app')
      createRecoveryJournal(root, { entries, affectedEntries, backedUpEntries })

      expect(() => recoverScaffoldTransaction(root)).toThrow('transaction journal is invalid')
      expect(existsSync(transactionPaths(root).journalPath)).toBe(true)
    },
  )

  test('malformed JSON과 transaction ID가 맞지 않는 저널을 거부한다', () => {
    const malformedWorkspace = createTempRoot('malformed-json-journal')
    const malformedRoot = join(malformedWorkspace, 'app')
    createRecoveryJournal(malformedRoot)
    writeFileSync(transactionPaths(malformedRoot).journalPath, '{partial', 'utf8')

    expect(() => recoverScaffoldTransaction(malformedRoot)).toThrow(
      'transaction journal is invalid',
    )

    const mismatchedWorkspace = createTempRoot('mismatched-id-journal')
    const mismatchedRoot = join(mismatchedWorkspace, 'app')
    createRecoveryJournal(mismatchedRoot, { transactionId: 'differentjournal' })

    expect(() => recoverScaffoldTransaction(mismatchedRoot)).toThrow(
      'paths do not match one transaction ID',
    )
  })

  test('저널 root를 canonicalize할 수 없으면 복구 전에 거부한다', () => {
    const workspace = createTempRoot('invalid-canonical-root')
    const root = join(workspace, 'app')
    createRecoveryJournal(root, { root: '\0invalid-root' })

    expect(() => recoverScaffoldTransaction(root)).toThrow('transaction journal is invalid')
  })

  test('잠금 후보 fsync EIO를 전파하고 부분 후보 파일을 제거한다', () => {
    const workspace = createTempRoot('lock-candidate-eio')
    const root = join(workspace, 'app')

    vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('candidate fsync EIO'), { code: 'EIO' })
    })

    expect(() => recoverScaffoldTransaction(root)).toThrow('candidate fsync EIO')
    expect(readdirSync(workspace).some((entryName) => entryName.includes('.lock.candidate-'))).toBe(
      false,
    )
    expect(existsSync(transactionPaths(root).lockPath)).toBe(false)
  })

  test('잠금 hard-link EIO를 전파하고 완성된 후보 파일을 제거한다', () => {
    const workspace = createTempRoot('lock-link-eio')
    const root = join(workspace, 'app')

    vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('lock link EIO'), { code: 'EIO' })
    })

    expect(() => recoverScaffoldTransaction(root)).toThrow('lock link EIO')
    expect(readdirSync(workspace).some((entryName) => entryName.includes('.lock.candidate-'))).toBe(
      false,
    )
    expect(existsSync(transactionPaths(root).lockPath)).toBe(false)
  })

  test('잠금 게시 후 부모 fsync EIO가 나면 자기 토큰 잠금만 제거한다', () => {
    const workspace = createTempRoot('lock-parent-eio')
    const root = join(workspace, 'app')
    const originalFsyncSync = fs.fsyncSync.bind(fs)
    let fsyncCallCount = 0

    vi.spyOn(fs, 'fsyncSync').mockImplementation((descriptor) => {
      fsyncCallCount += 1

      if (fsyncCallCount === 2) {
        throw Object.assign(new Error('lock parent fsync EIO'), { code: 'EIO' })
      }

      return originalFsyncSync(descriptor)
    })

    expect(() => recoverScaffoldTransaction(root)).toThrow('lock parent fsync EIO')
    expect(existsSync(transactionPaths(root).lockPath)).toBe(false)
    expect(readdirSync(workspace).some((entryName) => entryName.includes('.lock.candidate-'))).toBe(
      false,
    )
  })

  test('디렉터리 fsync의 명시적 unsupported 오류만 무시한다', () => {
    const workspace = createTempRoot('unsupported-directory-fsync')
    const root = join(workspace, 'app')
    const originalFsyncSync = fs.fsyncSync.bind(fs)
    let fsyncCallCount = 0

    vi.spyOn(fs, 'fsyncSync').mockImplementation((descriptor) => {
      fsyncCallCount += 1

      if (fsyncCallCount === 2) {
        throw Object.assign(new Error('directory fsync unsupported'), { code: 'EINVAL' })
      }

      return originalFsyncSync(descriptor)
    })

    expect(recoverScaffoldTransaction(root)).toBe(false)
    expect(existsSync(transactionPaths(root).lockPath)).toBe(false)
  })

  test('잠금 경로가 일반 파일이 아니면 사용자 엔트리를 삭제하지 않고 거부한다', () => {
    const workspace = createTempRoot('invalid-lock-type')
    const root = join(workspace, 'app')
    const { lockPath } = transactionPaths(root)
    mkdirSync(lockPath)

    expect(() => recoverScaffoldTransaction(root)).toThrow('lock is not a regular file')
    expect(lstatSync(lockPath).isDirectory()).toBe(true)
  })

  test('다른 부모의 staging을 소유 경로로 옮긴 뒤 정상 적용한다', () => {
    const workspace = createTempRoot('cross-parent-staging')
    const root = join(workspace, 'target-parent', 'app')
    const stagingRoot = join(workspace, 'source-parent', 'staging')
    writeFixture(stagingRoot, 'package.json', '{"name":"generated"}\n')

    applyStagedProject(stagingRoot, root, 'merge')

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('generated')
    expect(existsSync(stagingRoot)).toBe(false)
  })

  test('target이 디렉터리가 아니면 staging 적용 전에 거부한다', () => {
    const workspace = createTempRoot('file-target')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    writeFileSync(root, 'not a directory', 'utf8')
    writeFixture(stagingRoot, 'package.json', '{"name":"generated"}\n')

    expect(() => applyStagedProject(stagingRoot, root, 'replace')).toThrow(
      'Project target must be a real directory',
    )
    expect(readFileSync(root, 'utf8')).toBe('not a directory')
  })

  test('merge가 깨진 링크를 덮어쓴 뒤 실패하면 링크 자체를 복구한다', () => {
    const workspace = createTempRoot('broken-link-merge')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const missingTarget = join(workspace, 'missing-directory')
    const linkPath = join(root, 'generated-entry')
    mkdirSync(root)

    if (process.platform === 'win32') {
      mkdirSync(missingTarget)
      symlinkSync(missingTarget, linkPath, 'junction')
      rmSync(missingTarget, { recursive: true })
    } else {
      symlinkSync(missingTarget, linkPath, 'dir')
    }

    const originalLinkTarget = readlinkSync(linkPath)
    writeFixture(stagingRoot, 'generated-entry', 'generated\n')

    expect(() =>
      applyStagedProject(stagingRoot, root, 'merge', {
        afterEntry() {
          throw new Error('rollback broken link')
        },
      }),
    ).toThrow('Existing files were restored')

    expect(existsSync(linkPath)).toBe(false)
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(linkPath)).toBe(originalLinkTarget)
  })

  test('rollback 전에 백업이 사라지면 저널을 유지하고 불완전 복구를 보고한다', () => {
    const workspace = createTempRoot('missing-rollback-backup')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    writeFixture(root, 'old.txt', 'original\n')
    writeFixture(stagingRoot, 'new.txt', 'generated\n')

    expect(() =>
      applyStagedProject(stagingRoot, root, 'replace', {
        afterEntry() {
          const backupName = readdirSync(workspace).find((entryName) =>
            entryName.includes('.frontron-backup-'),
          )
          if (backupName) rmSync(join(workspace, backupName), { recursive: true })
          throw new Error('rollback after backup loss')
        },
      }),
    ).toThrow('Rollback also failed')

    expect(existsSync(transactionPaths(root).journalPath)).toBe(true)
  })

  test('lstat의 권한 오류를 존재하지 않음으로 오판하지 않는다', () => {
    const workspace = createTempRoot('lstat-error')
    const root = join(workspace, 'denied-app')
    const originalLstatSync = fs.lstatSync.bind(fs)

    vi.spyOn(fs, 'lstatSync').mockImplementation((targetPath, options) => {
      if (String(targetPath) === root) {
        throw Object.assign(new Error('lstat access denied'), { code: 'EACCES' })
      }

      return originalLstatSync(targetPath, options as never)
    })

    expect(() => recoverScaffoldTransaction(root)).toThrow('lstat access denied')
  })

  test('겹치는 세 저널 그룹을 실제 identity 두 개의 복구 단위로 합친다', () => {
    const workspace = createTempRoot('overlapping-entry-groups')
    const root = join(workspace, 'app')
    const entries = [
      { identity: 'first', targetEntries: ['first.txt'], backupEntries: [] },
      { identity: 'second', targetEntries: ['second.txt'], backupEntries: [] },
      {
        identity: 'bridge',
        targetEntries: ['first.txt', 'second.txt'],
        backupEntries: [],
      },
    ]
    createRecoveryJournal(root, {
      affectedEntries: ['first.txt', 'second.txt'],
      backedUpEntries: [],
      entries,
    })
    writeFixture(root, 'first.txt', 'generated first\n')
    writeFixture(root, 'second.txt', 'generated second\n')

    expect(recoverScaffoldTransaction(root)).toBe(true)
    expect(existsSync(join(root, 'first.txt'))).toBe(false)
    expect(existsSync(join(root, 'second.txt'))).toBe(false)
  })

  test('살아 있는 저널 잠금 소유자가 끝날 때까지 기다린 뒤 복구한다', async () => {
    const workspace = createTempRoot('wait-for-live-recovery')
    const root = join(workspace, 'app')
    const { lockPath } = transactionPaths(root)
    createRecoveryJournal(root)
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 150)'], {
      stdio: 'ignore',
    })
    const ownerResult = collectChildResult(owner)
    await waitForMilliseconds(20)
    writeFileSync(lockPath, `${JSON.stringify({ pid: owner.pid })}\n`, 'utf8')

    expect(recoverScaffoldTransaction(root)).toBe(true)
    expect((await ownerResult).code).toBe(0)
    expect(existsSync(lockPath)).toBe(false)
  })

  test('잠금 EEXIST 직후 파일이 사라지면 새 후보로 다시 획득한다', () => {
    const workspace = createTempRoot('vanished-existing-lock')
    const root = join(workspace, 'app')
    const originalLinkSync = fs.linkSync.bind(fs)
    let linkCallCount = 0

    vi.spyOn(fs, 'linkSync').mockImplementation((existingPath, newPath) => {
      linkCallCount += 1

      if (linkCallCount === 1) {
        throw Object.assign(new Error('simulated EEXIST'), { code: 'EEXIST' })
      }

      return originalLinkSync(existingPath, newPath)
    })

    expect(recoverScaffoldTransaction(root)).toBe(false)
    expect(linkCallCount).toBeGreaterThan(2)
    expect(existsSync(transactionPaths(root).lockPath)).toBe(false)
  })

  test.each([
    ['ENOENT', 'Lost create-frontron transaction lock ownership'],
    ['EIO', 'reclaim link EIO'],
  ] as const)('잠금 제거용 reclaim link %s를 안전하게 처리한다', (errorCode, message) => {
    const workspace = createTempRoot(`reclaim-${errorCode.toLowerCase()}`)
    const root = join(workspace, 'app')
    const originalLinkSync = fs.linkSync.bind(fs)
    let linkCallCount = 0

    vi.spyOn(fs, 'linkSync').mockImplementation((existingPath, newPath) => {
      linkCallCount += 1

      if (linkCallCount === 2) {
        throw Object.assign(new Error('reclaim link EIO'), { code: errorCode })
      }

      return originalLinkSync(existingPath, newPath)
    })

    expect(() => recoverScaffoldTransaction(root)).toThrow(message)
    expect(existsSync(transactionPaths(root).lockPath)).toBe(true)
  })

  test('오래된 reclaim hard-link를 제거한 뒤 stale 잠금을 회수한다', () => {
    const workspace = createTempRoot('stale-reclaim-link')
    const root = join(workspace, 'app')
    const { lockPath } = transactionPaths(root)
    writeFileSync(lockPath, `${JSON.stringify({ pid: Number.MAX_SAFE_INTEGER })}\n`, 'utf8')
    const lockStats = lstatSync(lockPath)
    const reclaimPath = `${lockPath}.reclaim-${lockStats.dev}-${lockStats.ino}`
    fs.linkSync(lockPath, reclaimPath)
    const staleTime = new Date(Date.now() - 10_000)
    fs.utimesSync(reclaimPath, staleTime, staleTime)

    expect(recoverScaffoldTransaction(root)).toBe(false)
    expect(existsSync(reclaimPath)).toBe(false)
    expect(existsSync(lockPath)).toBe(false)
  })

  test('backup 디렉터리 생성 직후 부모 fsync EIO가 나면 생성 경로를 정리한다', () => {
    const workspace = createTempRoot('backup-directory-sync-eio')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const originalFsyncSync = fs.fsyncSync.bind(fs)
    let fsyncCallCount = 0
    writeFixture(stagingRoot, 'package.json', '{"name":"generated"}\n')

    vi.spyOn(fs, 'fsyncSync').mockImplementation((descriptor) => {
      fsyncCallCount += 1

      if (fsyncCallCount === 4) {
        throw Object.assign(new Error('backup directory fsync EIO'), { code: 'EIO' })
      }

      return originalFsyncSync(descriptor)
    })

    expect(() => applyStagedProject(stagingRoot, root, 'merge')).toThrow(
      'backup directory fsync EIO',
    )
    expect(readdirSync(workspace).some((entryName) => entryName.includes('frontron-backup'))).toBe(
      false,
    )
    expect(readdirSync(workspace).some((entryName) => entryName.includes('frontron-staging'))).toBe(
      false,
    )
  })

  test('이미 존재하는 정확한 backup ID 경로를 지우지 않고 생성 실패를 보고한다', () => {
    const workspace = createTempRoot('backup-id-collision')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, '.app.frontron-staging-collision')
    const backupRoot = join(workspace, '.app.frontron-backup-collision')
    writeFixture(stagingRoot, 'package.json', '{"name":"generated"}\n')
    writeFixture(backupRoot, 'keep.txt', 'user backup\n')

    expect(() => applyStagedProject(stagingRoot, root, 'merge')).toThrow('EEXIST')
    expect(readFileSync(join(backupRoot, 'keep.txt'), 'utf8')).toBe('user backup\n')
  })

  test('없는 staging, staging symlink, target과 같은 staging을 각각 거부한다', () => {
    const missingWorkspace = createTempRoot('missing-staging')
    const missingRoot = join(missingWorkspace, 'app')
    expect(() =>
      applyStagedProject(join(missingWorkspace, 'missing'), missingRoot, 'merge'),
    ).toThrow('must be a real directory')

    const linkedWorkspace = createTempRoot('linked-staging-root')
    const linkedRoot = join(linkedWorkspace, 'app')
    const actualStaging = join(linkedWorkspace, 'actual-staging')
    const linkedStaging = join(linkedWorkspace, 'linked-staging')
    mkdirSync(actualStaging)
    symlinkSync(actualStaging, linkedStaging, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => applyStagedProject(linkedStaging, linkedRoot, 'merge')).toThrow(
      'must be a real directory',
    )

    const sameWorkspace = createTempRoot('same-staging-target')
    const sameRoot = join(sameWorkspace, 'app')
    mkdirSync(sameRoot)
    expect(() => applyStagedProject(sameRoot, sameRoot, 'merge')).toThrow(
      'must differ from the target project',
    )
  })

  test('백업 뒤 추가된 nested live symlink를 따라가지 않고 rollback한다', () => {
    const workspace = createTempRoot('nested-live-link')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const externalRoot = join(workspace, 'external')
    writeFixture(root, 'src/keep.txt', 'original\n')
    writeFixture(stagingRoot, 'src/linked/generated.txt', 'generated\n')
    writeFixture(externalRoot, 'keep.txt', 'external\n')

    expect(() =>
      applyStagedProject(stagingRoot, root, 'merge', {
        afterBackupEntry(entryName) {
          if (entryName === 'src') {
            symlinkSync(
              externalRoot,
              join(root, 'src', 'linked'),
              process.platform === 'win32' ? 'junction' : 'dir',
            )
          }
        },
      }),
    ).toThrow('symbolic link')

    expect(readFileSync(join(root, 'src/keep.txt'), 'utf8')).toBe('original\n')
    expect(readFileSync(join(externalRoot, 'keep.txt'), 'utf8')).toBe('external\n')
    expect(existsSync(join(externalRoot, 'generated.txt'))).toBe(false)
  })

  test('저널 파일 fsync EIO를 전파하고 해당 임시 파일만 제거한다', () => {
    const workspace = createTempRoot('journal-file-eio')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const originalFsyncSync = fs.fsyncSync.bind(fs)
    let fsyncCallCount = 0
    writeFixture(stagingRoot, 'package.json', '{"name":"generated"}\n')

    vi.spyOn(fs, 'fsyncSync').mockImplementation((descriptor) => {
      fsyncCallCount += 1

      if (fsyncCallCount === 12) {
        throw Object.assign(new Error('journal file fsync EIO'), { code: 'EIO' })
      }

      return originalFsyncSync(descriptor)
    })

    expect(() => applyStagedProject(stagingRoot, root, 'merge')).toThrow('journal file fsync EIO')
    expect(
      readdirSync(workspace).some((entryName) => entryName.includes('frontron-transaction.tmp-')),
    ).toBe(false)
    expect(existsSync(transactionPaths(root).journalPath)).toBe(false)
  })

  test('완료 후 소유 backup 정리 EIO를 호출 오류로 전파한다', () => {
    const workspace = createTempRoot('cleanup-eio')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const originalRmSync = fs.rmSync.bind(fs)
    let injected = false
    writeFixture(stagingRoot, 'package.json', '{"name":"generated"}\n')

    vi.spyOn(fs, 'rmSync').mockImplementation((targetPath, options) => {
      if (!injected && String(targetPath).includes('.frontron-backup-')) {
        injected = true
        throw Object.assign(new Error('cleanup rm EIO'), { code: 'EIO' })
      }

      return originalRmSync(targetPath, options)
    })

    expect(() => applyStagedProject(stagingRoot, root, 'merge')).toThrow('cleanup rm EIO')
    expect(injected).toBe(true)
    expect(existsSync(transactionPaths(root).journalPath)).toBe(false)
  })

  test('경로 suffix의 잘못된 transaction ID를 저널 검증에서 거부한다', () => {
    const workspace = createTempRoot('invalid-path-transaction-id')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, '.app.frontron-staging-bad.id')
    const backupRoot = join(workspace, '.app.frontron-backup-bad.id')
    mkdirSync(stagingRoot)
    mkdirSync(backupRoot)
    createRecoveryJournal(root, {
      transactionId: 'bad.id',
      stagingRoot,
      backupRoot,
    })

    expect(() => recoverScaffoldTransaction(root)).toThrow('transaction journal is invalid')
  })
})
