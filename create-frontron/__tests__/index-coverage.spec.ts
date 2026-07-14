import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, parse, relative, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type PromptQuestion = {
  initial?: unknown | (() => unknown)
  message?: string | (() => string)
  name: string
  onState?: (state: { value: string }) => void
  type?: null | string | ((...args: any[]) => unknown)
  validate?: (value: string) => true | string
}

type PromptOptions = {
  onCancel: () => void
}

type PromptHandler = (
  questions: PromptQuestion[],
  options: PromptOptions,
) => Promise<Record<string, unknown>> | Record<string, unknown>

const promptControl = vi.hoisted(() => ({
  handler: undefined as PromptHandler | undefined,
  overrides: {} as Record<string, unknown>,
}))

vi.mock('prompts', () => {
  const prompt = vi.fn(async (questions: PromptQuestion[], options: PromptOptions) => {
    return promptControl.handler ? promptControl.handler(questions, options) : {}
  })

  return {
    default: Object.assign(prompt, {
      override: vi.fn((answers: Record<string, unknown>) => {
        promptControl.overrides = answers
      }),
    }),
  }
})

import { applyStagedProject, recoverScaffoldTransaction, runCreateFrontron } from '../src/index'

const packageRoot = resolve(__dirname, '..')
const initialCwd = process.cwd()
const initialPlatform = process.platform
const initialUserAgent = process.env.npm_config_user_agent
const tempDirs: string[] = []
const childProcesses: ChildProcess[] = []

// setProcessPlatform 함수는 운영체제 전용 복구 경로를 모든 CI 환경에서 검증하게 한다.
function setProcessPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    enumerable: true,
    value: platform,
  })
}

function createWorkspace(label: string) {
  const workspace = realpathSync.native(
    mkdtempSync(join(tmpdir(), `create-frontron-coverage-${label}-`)),
  )
  tempDirs.push(workspace)
  return workspace
}

function writeFixture(root: string, relativePath: string, contents: string) {
  const filePath = join(root, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, contents, 'utf8')
}

function transactionPaths(root: string) {
  const safeName = basename(root).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project'
  const prefix = join(dirname(root), `.${safeName}.frontron-transaction`)

  return {
    journalPath: `${prefix}.json`,
    lockPath: `${prefix}.lock`,
  }
}

function createJournal(root: string, overrides: Record<string, unknown> = {}) {
  const safeName = basename(root).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project'
  const stagingRoot = join(dirname(root), `.${safeName}.frontron-staging-journal`)
  const backupRoot = join(dirname(root), `.${safeName}.frontron-backup-journal`)
  const journal: Record<string, unknown> = {
    schemaVersion: 1,
    pid: process.pid,
    root: resolve(root),
    stagingRoot,
    backupRoot,
    mode: 'merge',
    rootExisted: true,
    affectedEntries: [],
    backedUpEntries: [],
    ...overrides,
  }

  mkdirSync(String(journal.stagingRoot), { recursive: true })
  mkdirSync(String(journal.backupRoot), { recursive: true })
  writeFileSync(transactionPaths(root).journalPath, `${JSON.stringify(journal)}\n`, 'utf8')
  return journal
}

function callQuestionType(question: PromptQuestion, ...args: any[]) {
  return typeof question.type === 'function' ? question.type(...args) : question.type
}

function readQuestionMessage(question: PromptQuestion) {
  return typeof question.message === 'function' ? question.message() : question.message
}

function transactionArtifacts(root: string) {
  const parent = dirname(root)
  const safeName = basename(root).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project'
  const prefix = `.${safeName}.frontron-`

  return existsSync(parent)
    ? readdirSync(parent).filter((entryName) => entryName.startsWith(prefix))
    : []
}

beforeEach(() => {
  vi.clearAllMocks()
  promptControl.handler = () => ({})
  promptControl.overrides = {}
})

afterEach(() => {
  process.chdir(initialCwd)
  setProcessPlatform(initialPlatform)

  if (typeof initialUserAgent === 'undefined') {
    delete process.env.npm_config_user_agent
  } else {
    process.env.npm_config_user_agent = initialUserAgent
  }

  vi.restoreAllMocks()

  for (const child of childProcesses.splice(0)) {
    if (child.exitCode === null) child.kill()
  }

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

describe('runCreateFrontron branch coverage', () => {
  test('retries a transient template file copy lock', async () => {
    const workspace = createWorkspace('transient-template-copy')
    const root = join(workspace, 'app')
    const copyFile = fs.copyFileSync.bind(fs)
    let injectedLock = false
    process.chdir(workspace)

    vi.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, mode) => {
      if (!injectedLock) {
        injectedLock = true
        throw Object.assign(new Error('injected transient file lock'), { code: 'EBUSY' })
      }

      return copyFile(source, destination, mode)
    })

    await runCreateFrontron(['app'])

    expect(injectedLock).toBe(true)
    expect(existsSync(join(root, 'package.json'))).toBe(true)
    expect(transactionArtifacts(root)).toEqual([])
  })

  test('prints help for both aliases and rejects removed or invalid options', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runCreateFrontron(['--help'])
    await runCreateFrontron(['-h'])

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage: create-frontron'))
    await expect(runCreateFrontron(['app', '--template', 'react'])).rejects.toThrow(
      'Template selection has been removed',
    )
    await expect(runCreateFrontron(['app', '-t', 'react'])).rejects.toThrow(
      'Template selection has been removed',
    )
    await expect(runCreateFrontron(['app', '--overwrite', 'invalid'])).rejects.toThrow(
      '--overwrite must be either',
    )
    await expect(runCreateFrontron(['app', '--unknown'])).rejects.toThrow(
      'Unknown option: --unknown',
    )
    await expect(runCreateFrontron(['app', 'extra'])).rejects.toThrow(
      'Unexpected positional argument: "extra"',
    )
  })

  test('rejects filesystem roots and target paths that cross a symbolic link', async () => {
    const workspace = createWorkspace('target-validation')
    const externalRoot = join(workspace, 'external')
    const linkedRoot = join(workspace, 'linked')
    mkdirSync(externalRoot)
    symlinkSync(externalRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
    process.chdir(workspace)

    const filesystemRootTarget = relative(workspace, parse(workspace).root)
    await expect(runCreateFrontron([filesystemRootTarget])).rejects.toThrow(
      'cannot be a filesystem root',
    )
    await expect(runCreateFrontron(['linked/app'])).rejects.toThrow(
      'must not pass through a symbolic link',
    )
  })

  test('uses prompt state, validates package names, scaffolds, and prints yarn commands', async () => {
    const workspace = createWorkspace('prompted-scaffold')
    const root = join(workspace, 'nested', 'My App')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    process.chdir(workspace)
    process.env.npm_config_user_agent = 'yarn/4.6.0 npm/? node/v22.15.0 win32 x64'

    promptControl.handler = (questions) => {
      const [projectQuestion, overwriteQuestion, checkerQuestion, packageQuestion] = questions

      expect(projectQuestion.type).toBe('text')
      projectQuestion.onState?.({ value: '   ' })
      projectQuestion.onState?.({ value: 'nested/My App///' })
      expect(callQuestionType(overwriteQuestion)).toBeNull()
      expect(readQuestionMessage(overwriteQuestion)).toContain('Target directory "nested/My App"')
      expect(callQuestionType(checkerQuestion, undefined, {})).toBeNull()
      expect(callQuestionType(packageQuestion)).toBe('text')
      expect((packageQuestion.initial as () => string)()).toBe('my-app')
      expect(packageQuestion.validate?.('Bad Package')).toBe('Invalid package.json name')
      expect(packageQuestion.validate?.('valid-package')).toBe(true)

      return { packageName: 'my-app' }
    }

    await runCreateFrontron([])

    const generatedPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(promptControl.overrides).toEqual({ overwrite: undefined })
    expect(generatedPackage.name).toBe('my-app')
    expect(generatedPackage.productName).toBe('My App')
    expect(generatedPackage.build.productName).toBe('My App')
    expect(generatedPackage.build.appId).toBe('com.example.my-app')
    expect(existsSync(join(root, '.gitignore'))).toBe(true)
    expect(existsSync(join(root, '.npmignore'))).toBe(false)
    expect(log).toHaveBeenCalledWith(`  cd "${join('nested', 'My App')}"`)
    expect(log).toHaveBeenCalledWith('  yarn')
    expect(log).toHaveBeenCalledWith('  yarn app')
    expect(transactionArtifacts(root)).toEqual([])
  })

  test('replaces the current directory, preserves .git, and prints npm commands', async () => {
    const workspace = createWorkspace('current-replace')
    const root = join(workspace, 'app')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    writeFixture(root, '.git/HEAD', 'ref: refs/heads/main\n')
    writeFixture(root, 'old.txt', 'remove me\n')
    process.chdir(root)
    delete process.env.npm_config_user_agent

    promptControl.handler = (questions) => {
      const [, overwriteQuestion, checkerQuestion, packageQuestion] = questions
      expect(callQuestionType(overwriteQuestion)).toBe('select')
      expect(readQuestionMessage(overwriteQuestion)).toContain('Current directory is not empty')
      expect(callQuestionType(checkerQuestion, undefined, { overwrite: 'yes' })).toBeNull()
      expect(callQuestionType(packageQuestion)).toBeNull()
      return { overwrite: 'yes' }
    }

    await runCreateFrontron(['.', '--overwrite', 'yes'])

    expect(existsSync(join(root, 'old.txt'))).toBe(false)
    expect(readFileSync(join(root, '.git/HEAD'), 'utf8')).toContain('refs/heads/main')
    expect(existsSync(join(root, 'src/electron/main.ts'))).toBe(true)
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/^  cd /))
    expect(log).toHaveBeenCalledWith('  npm install')
    expect(log).toHaveBeenCalledWith('  npm run app')
    expect(transactionArtifacts(root)).toEqual([])
  })

  test('handles overwrite rejection and interactive cancellation without writing files', async () => {
    const workspace = createWorkspace('cancellation')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    process.chdir(workspace)

    promptControl.handler = (questions) => {
      callQuestionType(questions[2], undefined, { overwrite: 'no' })
      return {}
    }
    await runCreateFrontron(['cancelled-app', '--overwrite', 'no'])

    promptControl.handler = (_questions, options) => {
      options.onCancel()
      return {}
    }
    await runCreateFrontron(['cancelled-app'])

    expect(log).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenNthCalledWith(1, expect.stringContaining('Operation cancelled'))
    expect(log).toHaveBeenNthCalledWith(2, expect.stringContaining('Operation cancelled'))
    expect(existsSync(join(workspace, 'cancelled-app'))).toBe(false)
  })

  test('reports a missing template directory before creating transaction paths', async () => {
    const workspace = createWorkspace('missing-template')
    const templateDir = join(packageRoot, 'template')
    const originalExistsSync = fs.existsSync.bind(fs)
    process.chdir(workspace)
    promptControl.handler = () => ({})

    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => {
      return resolve(String(candidate)) === templateDir ? false : originalExistsSync(candidate)
    })

    await expect(runCreateFrontron(['missing-template-app'])).rejects.toThrow(
      'Template directory not found',
    )
    expect(transactionArtifacts(join(workspace, 'missing-template-app'))).toEqual([])
  })

  test('refuses a target that becomes non-empty before the merge commit', async () => {
    const workspace = createWorkspace('cli-failed-merge')
    const root = join(workspace, 'app')
    const externalRoot = join(workspace, 'external')
    process.chdir(workspace)
    writeFixture(externalRoot, 'keep.txt', 'external\n')

    promptControl.handler = () => {
      mkdirSync(root, { recursive: true })
      symlinkSync(
        externalRoot,
        join(root, 'src'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      return {}
    }

    await expect(runCreateFrontron(['app'])).rejects.toThrow('is not empty')

    expect(readFileSync(join(externalRoot, 'keep.txt'), 'utf8')).toBe('external\n')
    expect(existsSync(join(externalRoot, 'main.ts'))).toBe(false)
    expect(transactionArtifacts(root)).toEqual([])
  })
})

describe('transaction lock, journal, and rollback coverage', () => {
  test('rejects a lock owned by a running process', async () => {
    const workspace = createWorkspace('active-lock')
    const root = join(workspace, 'app')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    })
    childProcesses.push(child)
    await once(child, 'spawn')
    writeFileSync(transactionPaths(root).lockPath, `${JSON.stringify({ pid: child.pid })}\n`)

    expect(() => recoverScaffoldTransaction(root)).toThrow(
      'Another create-frontron transaction is active',
    )
    expect(existsSync(transactionPaths(root).lockPath)).toBe(true)
  })

  test('cleans malformed and stale locks without deleting unjournaled prefix paths', () => {
    const workspace = createWorkspace('stale-lock')
    const root = join(workspace, 'app')
    const preserved = join(workspace, '.app.frontron-staging-preserved')
    const orphanStaging = join(workspace, '.app.frontron-staging-orphan')
    const orphanBackup = join(workspace, '.app.frontron-backup-orphan')
    const orphanTemporary = join(workspace, '.app.frontron-transaction.tmp-orphan')
    mkdirSync(preserved)
    mkdirSync(orphanStaging)
    mkdirSync(orphanBackup)
    writeFileSync(orphanTemporary, 'temporary')
    writeFileSync(transactionPaths(root).lockPath, 'not json')

    expect(recoverScaffoldTransaction(root)).toBe(false)
    expect(existsSync(transactionPaths(root).lockPath)).toBe(false)
    expect(existsSync(preserved)).toBe(true)
    expect(existsSync(orphanStaging)).toBe(true)
    expect(existsSync(orphanBackup)).toBe(true)
    expect(existsSync(orphanTemporary)).toBe(true)

    writeFileSync(
      transactionPaths(root).lockPath,
      `${JSON.stringify({ pid: Number.MAX_SAFE_INTEGER })}\n`,
    )
    expect(recoverScaffoldTransaction(root)).toBe(false)
    expect(recoverScaffoldTransaction(join(workspace, 'missing-parent', 'app'))).toBe(false)
  })

  test('restores backed up entries and removes transaction artifacts', () => {
    const workspace = createWorkspace('journal-restore')
    const root = join(workspace, 'app')
    const journal = createJournal(root, {
      affectedEntries: ['old.txt', 'new.txt'],
      backedUpEntries: ['old.txt'],
    })
    writeFixture(root, 'old.txt', 'partially replaced\n')
    writeFixture(root, 'new.txt', 'generated\n')
    writeFixture(String(journal.backupRoot), 'old.txt', 'original\n')
    writeFileSync(transactionPaths(root).lockPath, `${JSON.stringify({ pid: process.pid })}\n`)

    expect(recoverScaffoldTransaction(root)).toBe(true)

    expect(readFileSync(join(root, 'old.txt'), 'utf8')).toBe('original\n')
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
    expect(existsSync(String(journal.stagingRoot))).toBe(false)
    expect(existsSync(String(journal.backupRoot))).toBe(false)
    expect(transactionArtifacts(root)).toEqual([])
  })

  test('removes a target that did not exist before the interrupted transaction', () => {
    const workspace = createWorkspace('journal-new-root')
    const root = join(workspace, 'app')
    createJournal(root, {
      rootExisted: false,
      affectedEntries: ['generated.txt'],
      backedUpEntries: [],
    })
    writeFixture(root, 'generated.txt', 'generated\n')

    expect(recoverScaffoldTransaction(root)).toBe(true)
    expect(existsSync(root)).toBe(false)
    expect(transactionArtifacts(root)).toEqual([])
  })

  test('retains an incomplete journal for manual recovery', () => {
    const workspace = createWorkspace('incomplete-backup')
    const root = join(workspace, 'app')
    createJournal(root, {
      affectedEntries: ['old.txt'],
      backedUpEntries: ['old.txt'],
    })

    expect(() => recoverScaffoldTransaction(root)).toThrow('recovery backup is incomplete')
    expect(existsSync(transactionPaths(root).journalPath)).toBe(true)
  })

  test('rejects a journal path that is not a regular file', () => {
    const workspace = createWorkspace('journal-file-type')
    const root = join(workspace, 'app')
    mkdirSync(transactionPaths(root).journalPath)

    expect(() => recoverScaffoldTransaction(root)).toThrow('not a regular file')
  })

  test.each([
    [
      'schema version',
      (_root: string, journal: Record<string, unknown>) => ({ ...journal, schemaVersion: 2 }),
    ],
    [
      'root mismatch',
      (root: string, journal: Record<string, unknown>) => ({ ...journal, root: `${root}-other` }),
    ],
    [
      'commit mode',
      (_root: string, journal: Record<string, unknown>) => ({ ...journal, mode: 'copy' }),
    ],
    [
      'root flag',
      (_root: string, journal: Record<string, unknown>) => ({ ...journal, rootExisted: 'yes' }),
    ],
    [
      'entry type',
      (_root: string, journal: Record<string, unknown>) => ({ ...journal, affectedEntries: [42] }),
    ],
    [
      'empty entry',
      (_root: string, journal: Record<string, unknown>) => ({ ...journal, affectedEntries: [''] }),
    ],
    [
      'git entry',
      (_root: string, journal: Record<string, unknown>) => ({
        ...journal,
        affectedEntries: ['.git'],
      }),
    ],
    [
      'nested entry',
      (_root: string, journal: Record<string, unknown>) => ({
        ...journal,
        affectedEntries: ['nested/file'],
      }),
    ],
    [
      'invalid backup entry',
      (_root: string, journal: Record<string, unknown>) => ({
        ...journal,
        backedUpEntries: [false],
      }),
    ],
    [
      'unaffected backup entry',
      (_root: string, journal: Record<string, unknown>) => ({
        ...journal,
        affectedEntries: ['tracked.txt'],
        backedUpEntries: ['other.txt'],
      }),
    ],
    [
      'missing entry arrays',
      (_root: string, journal: Record<string, unknown>) => {
        const invalidJournal: Record<string, unknown> = { ...journal, schemaVersion: 2 }
        delete invalidJournal.affectedEntries
        delete invalidJournal.backedUpEntries
        return invalidJournal
      },
    ],
  ])('rejects invalid journal data: %s', (_label, makeInvalidJournal) => {
    const workspace = createWorkspace('invalid-journal')
    const root = join(workspace, 'app')
    const journal = createJournal(root)
    writeFileSync(
      transactionPaths(root).journalPath,
      `${JSON.stringify(makeInvalidJournal(root, journal))}\n`,
      'utf8',
    )

    expect(() => recoverScaffoldTransaction(root)).toThrow('transaction journal is invalid')
  })

  test('rejects transaction directories outside the project parent', () => {
    const workspace = createWorkspace('outside-transaction-directory')
    const root = join(workspace, 'app')
    createJournal(root, {
      stagingRoot: join(workspace, 'nested', 'staging'),
    })

    expect(() => recoverScaffoldTransaction(root)).toThrow('must stay beside the target project')
  })

  test('rejects a symbolic-link backup directory', () => {
    const workspace = createWorkspace('linked-backup')
    const root = join(workspace, 'app')
    const externalRoot = join(workspace, 'external')
    const journal = createJournal(root)
    mkdirSync(externalRoot)
    rmSync(String(journal.backupRoot), { recursive: true })
    symlinkSync(
      externalRoot,
      String(journal.backupRoot),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    expect(() => recoverScaffoldTransaction(root)).toThrow('must not be a symbolic link')
  })

  test('rejects symbolic links in staging and cleans merge transaction paths', () => {
    const workspace = createWorkspace('linked-staging-entry')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const externalRoot = join(workspace, 'external')
    writeFixture(root, 'keep.txt', 'keep\n')
    mkdirSync(stagingRoot)
    mkdirSync(externalRoot)
    symlinkSync(
      externalRoot,
      join(stagingRoot, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    expect(() => applyStagedProject(stagingRoot, root, 'merge')).toThrow(
      'Template entries must not be symbolic links',
    )
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('keep\n')
    expect(transactionArtifacts(root)).toEqual([])
  })

  test('cleans the durable journal temporary file when journal activation fails', () => {
    const workspace = createWorkspace('journal-rename-failure')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const originalRenameSync = fs.renameSync.bind(fs)
    writeFixture(root, 'keep.txt', 'keep\n')
    writeFixture(stagingRoot, 'new.txt', 'new\n')

    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(destination).endsWith('.frontron-transaction.json')) {
        throw new Error('injected journal rename failure')
      }
      return originalRenameSync(source, destination)
    })

    expect(() => applyStagedProject(stagingRoot, root, 'merge')).toThrow(
      'injected journal rename failure',
    )
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('keep\n')
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
    expect(transactionArtifacts(root)).toEqual([])
  })

  test('successfully replaces a target that did not previously exist', () => {
    const workspace = createWorkspace('new-replace-target')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    writeFixture(stagingRoot, 'package.json', '{"name":"app"}\n')

    applyStagedProject(stagingRoot, root, 'replace')

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('"app"')
    expect(transactionArtifacts(root)).toEqual([])
  })

  test('accepts Windows fsync limitations while committing a scaffold', () => {
    const workspace = createWorkspace('windows-fsync-limitations')
    const root = join(workspace, 'app')
    const stagingRoot = join(workspace, 'staging')
    const syncError = Object.assign(new Error('injected Windows fsync limitation'), {
      code: 'EACCES',
    })
    const originalOpenSync = fs.openSync.bind(fs)
    writeFixture(stagingRoot, 'package.json', '{"name":"app"}\n')
    setProcessPlatform('win32')
    vi.spyOn(fs, 'openSync').mockImplementation(((...args: unknown[]) => {
      if (args[1] === 'r' || args[1] === 'r+') throw syncError
      return Reflect.apply(originalOpenSync, undefined, args) as number
    }) as typeof fs.openSync)

    applyStagedProject(stagingRoot, root, 'merge')

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('"app"')
    expect(transactionArtifacts(root)).toEqual([])
  })

  test.each(['merge', 'replace'] as const)(
    'retains the backup when %s rollback also fails',
    (mode) => {
      const workspace = createWorkspace(`${mode}-rollback-failure`)
      const root = join(workspace, 'app')
      const stagingRoot = join(workspace, 'staging')
      const originalCpSync = fs.cpSync.bind(fs)
      let failRollback = false
      writeFixture(root, 'project.txt', 'original\n')
      writeFixture(stagingRoot, 'project.txt', 'generated\n')

      vi.spyOn(fs, 'cpSync').mockImplementation((source, destination, options) => {
        if (failRollback && String(source).includes('frontron-backup')) {
          throw new Error('injected rollback copy failure')
        }
        return originalCpSync(source, destination, options)
      })

      expect(() =>
        applyStagedProject(stagingRoot, root, mode, {
          afterEntry() {
            failRollback = true
            throw new Error('injected commit failure')
          },
        }),
      ).toThrow('Rollback also failed')

      expect(existsSync(transactionPaths(root).journalPath)).toBe(true)
      expect(transactionArtifacts(root).some((entryName) => entryName.includes('backup'))).toBe(
        true,
      )
      expect(existsSync(transactionPaths(root).lockPath)).toBe(false)
    },
  )
})
