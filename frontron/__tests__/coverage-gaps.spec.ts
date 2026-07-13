import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'

import { describe, expect, test, vi } from 'vitest'

import { addTsconfigExcludeValues, restoreTsconfigJsonClaims } from '../src/clean/tsconfig-source'
import { runCli } from '../src/cli'
import { parseJsonc } from '../src/init/jsonc'
import type { FrontronManifest, PackageJsonOwnershipClaim } from '../src/init/manifest'
import { createReadlinePrompter } from '../src/init/prompts'
import {
  assertProjectPathSafe,
  formatProjectPathBlocker,
  inspectProjectPath,
  normalizeProjectRelativePath,
} from '../src/project-paths'
import { TRANSACTION_JOURNAL_PATH } from '../src/transaction-journal'
import * as fixtures from './helpers/frontron-cli-fixtures'

function readJson<T>(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function manifestPath(projectRoot: string) {
  return join(projectRoot, '.frontron', 'manifest.json')
}

function readProjectManifest(projectRoot: string) {
  return readJson<FrontronManifest>(manifestPath(projectRoot))
}

function writeProjectManifest(projectRoot: string, manifest: FrontronManifest) {
  writeJson(manifestPath(projectRoot), manifest)
}

async function initializeProject(projectRoot: string, args: string[] = []) {
  const exitCode = await runCli(['init', '--yes', ...args], fixtures.createOutput(), {
    cwd: projectRoot,
  })

  expect(exitCode).toBe(0)
}

function ownershipClaim(
  value: string,
  previous: PackageJsonOwnershipClaim['previous'],
): PackageJsonOwnershipClaim {
  return {
    path: 'exclude',
    action: 'array-value',
    value,
    previous,
  }
}

function parseTsconfig(source: string) {
  return parseJsonc<{ compilerOptions?: object; exclude?: string[] }>(source)
}

describe('public CLI recovery and output paths', () => {
  test('the default CLI output reports help, option errors, and unknown commands', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runCli([], undefined, { cwd: projectRoot })).toBe(0)
    expect(await runCli(['init', '--not-a-real-option'], undefined, { cwd: projectRoot })).toBe(1)
    expect(await runCli(['launch'], undefined, { cwd: projectRoot })).toBe(1)

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage: frontron'))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown option'))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown command "launch"'))

    log.mockRestore()
    error.mockRestore()
  })

  test('help and argument errors are handled before pending transaction recovery', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)
    const journalSource = 'malformed pending journal\n'

    writeFileSync(journalPath, journalSource)

    expect(await runCli([], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['--help'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    expect(await runCli(['init', '--help'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const unknownOutput = fixtures.createOutput()
    const optionOutput = fixtures.createOutput()

    expect(await runCli(['launch'], unknownOutput, { cwd: projectRoot })).toBe(1)
    expect(await runCli(['init', '--not-a-real-option'], optionOutput, { cwd: projectRoot })).toBe(
      1,
    )
    expect(unknownOutput.error.mock.calls.flat().join('\n')).toContain('Unknown command "launch"')
    expect(optionOutput.error.mock.calls.flat().join('\n')).toContain('Unknown option')
    expect(readFileSync(journalPath, 'utf8')).toBe(journalSource)

    const lifecycleOutput = fixtures.createOutput()

    expect(await runCli(['init', '--dry-run'], lifecycleOutput, { cwd: projectRoot })).toBe(1)
    expect(lifecycleOutput.error.mock.calls.flat().join('\n')).toContain(
      'Could not recover an interrupted transaction',
    )
    expect(readFileSync(journalPath, 'utf8')).toBe(journalSource)
  })

  test('the readline prompter trims text and honors default, yes, and no answers', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const prompter = createReadlinePrompter(stdin, stdout)

    const textAnswer = prompter.text('Desktop directory', 'electron')
    stdin.write('  desktop  \n')
    expect(await textAnswer).toBe('desktop')

    const defaultTextAnswer = prompter.text('Output directory', 'dist-web')
    stdin.write('   \n')
    expect(await defaultTextAnswer).toBe('dist-web')

    const defaultConfirmation = prompter.confirm('Apply changes', true)
    stdin.write('\n')
    expect(await defaultConfirmation).toBe(true)

    const yesConfirmation = prompter.confirm('Apply changes', false)
    stdin.write('YES\n')
    expect(await yesConfirmation).toBe(true)

    const shortYesConfirmation = prompter.confirm('Apply changes', false)
    stdin.write('y\n')
    expect(await shortYesConfirmation).toBe(true)

    const noConfirmation = prompter.confirm('Apply changes', true)
    stdin.write('no\n')
    expect(await noConfirmation).toBe(false)

    prompter.close()
  })
})

describe('project path public guardrails', () => {
  test('일반 hard link는 디렉터리 경로 탈출 검사와 파일 nlink 검증의 책임을 섞지 않는다', () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    const outsideFile = join(outsideRoot, 'shared.txt')
    const linkedFile = join(projectRoot, 'linked.txt')
    writeFileSync(outsideFile, 'shared\n')
    linkSync(outsideFile, linkedFile)
    const realpathSpy = vi.spyOn(realpathSync, 'native')

    expect(inspectProjectPath(projectRoot, linkedFile)).toEqual({
      safe: true,
      absolutePath: linkedFile,
    })
    expect(realpathSpy).not.toHaveBeenCalledWith(linkedFile)
  })

  test('path inspection and normalization reject every user-visible escape form', () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    const outsidePath = join(outsideRoot, 'generated.ts')
    const inspection = inspectProjectPath(projectRoot, outsidePath)

    if (inspection.safe) {
      throw new Error('Expected an outside path inspection')
    }

    expect(inspection.reason).toBe('outside')
    expect(formatProjectPathBlocker(projectRoot, 'Generated file', inspection)).toBe(
      'Generated file must stay inside the project.',
    )
    expect(() => assertProjectPathSafe(projectRoot, outsidePath, 'Generated file')).toThrow(
      'must stay inside the project',
    )

    expect(normalizeProjectRelativePath(projectRoot, '', 'electron', 'Electron directory')).toBe(
      'electron',
    )
    expect(() =>
      normalizeProjectRelativePath(projectRoot, '\0', 'electron', 'Electron directory'),
    ).toThrow('non-empty relative path')
    expect(() =>
      normalizeProjectRelativePath(
        projectRoot,
        resolve(projectRoot, 'electron'),
        'electron',
        'Electron directory',
      ),
    ).toThrow('must be a relative path')
    expect(() =>
      normalizeProjectRelativePath(projectRoot, '.', 'electron', 'Electron directory'),
    ).toThrow('cannot target the project root')
  })

  test('resolved-outside blockers use the inspected path when no component is available', () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)

    expect(
      formatProjectPathBlocker(projectRoot, 'Generated file', {
        safe: false,
        absolutePath: join(outsideRoot, 'generated.ts'),
        reason: 'resolved-outside',
      }),
    ).toContain('Generated file resolves outside the project:')
  })
})

describe('update recovery and manifest validation', () => {
  test('update restores legacy options from owned paths and the generated runtime', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const original = readProjectManifest(projectRoot)
    const legacy = readProjectManifest(projectRoot)

    delete legacy.desktopDir
    delete legacy.appScript
    delete legacy.buildScript
    delete legacy.packageScript
    delete legacy.webDevScript
    delete legacy.outDir
    delete legacy.nodeServerSourceRoot
    delete legacy.nodeServerEntry
    writeProjectManifest(projectRoot, legacy)

    const exitCode = await runCli(['update', '--yes', '--force'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    const refreshed = readProjectManifest(projectRoot)

    expect(exitCode).toBe(0)
    expect(refreshed.desktopDir).toBe(original.desktopDir)
    expect(refreshed.appScript).toBe(original.appScript)
    expect(refreshed.buildScript).toBe(original.buildScript)
    expect(refreshed.packageScript).toBe(original.packageScript)
    expect(refreshed.webDevScript).toBe(original.webDevScript)
    expect(refreshed.outDir).toBe(original.outDir)
  })

  test('update recreates a missing runtime and infers output from legacy package claims', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const legacy = readProjectManifest(projectRoot)
    const expectedOutDir = legacy.outDir
    const servePath = join(projectRoot, legacy.desktopDir ?? 'electron', 'serve.ts')
    const reservedClaims: PackageJsonOwnershipClaim[] = [
      {
        path: 'build.files',
        action: 'array-value',
        value: 'dist-electron',
        previous: { state: 'missing' },
      },
      {
        path: 'build.files',
        action: 'array-value',
        value: 'package.json{,/**/*}',
        previous: { state: 'missing' },
      },
    ]

    delete legacy.webDevScript
    delete legacy.outDir
    legacy.packageJsonClaims = [...reservedClaims, ...(legacy.packageJsonClaims ?? [])]
    writeProjectManifest(projectRoot, legacy)
    rmSync(servePath)

    const exitCode = await runCli(['update', '--yes', '--force'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    const refreshed = readProjectManifest(projectRoot)

    expect(exitCode).toBe(0)
    expect(existsSync(servePath)).toBe(true)
    expect(refreshed.outDir).toBe(expectedOutDir)
    expect(refreshed.webDevScript).toBe('dev')
  })

  test('update reports missing ownership metadata without overwriting the project', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const manifest = readProjectManifest(projectRoot)
    const ownedFile = manifest.createdFiles.find(
      (filePath) => filePath !== '.frontron/manifest.json' && manifest.fileHashes?.[filePath],
    )
    const [scriptWithoutCommand, missingScript] = manifest.scripts

    if (!ownedFile || !scriptWithoutCommand || !missingScript || !manifest.fileHashes) {
      throw new Error('Expected initialized ownership metadata')
    }

    delete manifest.fileHashes[ownedFile]
    delete manifest.scriptCommands?.[scriptWithoutCommand]
    writeProjectManifest(projectRoot, manifest)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = readJson<{ scripts: Record<string, string> }>(packageJsonPath)
    delete packageJson.scripts[missingScript]
    writeJson(packageJsonPath, packageJson)
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')
    const output = fixtures.createOutput()

    const exitCode = await runCli(['update', '--yes'], output, { cwd: projectRoot })
    const errors = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(errors).toContain(`Manifest-owned file has no recorded hash: ${ownedFile}`)
    expect(errors).toContain(
      `Manifest-owned script has no recorded command: ${scriptWithoutCommand}`,
    )
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
  })

  test('update rejects manifest-owned paths that are absolute or not regular files', async () => {
    const absoluteProject = fixtures.createTempProject()
    const directoryProject = fixtures.createTempProject()
    fixtures.tempDirs.push(absoluteProject, directoryProject)
    await initializeProject(absoluteProject)
    await initializeProject(directoryProject)

    const absoluteManifest = readProjectManifest(absoluteProject)
    absoluteManifest.createdFiles.unshift(join(absoluteProject, 'electron', 'main.ts'))
    writeProjectManifest(absoluteProject, absoluteManifest)
    const absoluteOutput = fixtures.createOutput()

    expect(
      await runCli(['update', '--yes', '--force'], absoluteOutput, { cwd: absoluteProject }),
    ).toBe(1)
    expect(absoluteOutput.error.mock.calls.flat().join('\n')).toContain('must be relative')

    const directoryManifest = readProjectManifest(directoryProject)
    mkdirSync(join(directoryProject, 'owned-directory'))
    directoryManifest.createdFiles.unshift('owned-directory')
    directoryManifest.fileHashes = {
      ...directoryManifest.fileHashes,
      'owned-directory': 'not-a-file-hash',
    }
    writeProjectManifest(directoryProject, directoryManifest)
    const directoryOutput = fixtures.createOutput()

    expect(
      await runCli(['update', '--yes', '--force'], directoryOutput, { cwd: directoryProject }),
    ).toBe(1)
    expect(directoryOutput.error.mock.calls.flat().join('\n')).toContain('not a regular file')
  })

  test('update refuses to follow a manifest-owned path through a junction', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    await initializeProject(projectRoot)
    writeFileSync(join(outsideRoot, 'external.ts'), 'outside\n')
    symlinkSync(
      outsideRoot,
      join(projectRoot, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const manifest = readProjectManifest(projectRoot)
    manifest.createdFiles.unshift('linked/external.ts')
    manifest.fileHashes = {
      ...manifest.fileHashes,
      'linked/external.ts': 'not-relevant',
    }
    writeProjectManifest(projectRoot, manifest)
    const output = fixtures.createOutput()

    expect(await runCli(['update', '--yes', '--force'], output, { cwd: projectRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain('symbolic link or junction')
    expect(readFileSync(join(outsideRoot, 'external.ts'), 'utf8')).toBe('outside\n')
  })
})

describe('doctor diagnostics for recoverable project damage', () => {
  test('doctor reports a missing package.json through the CLI error channel', async () => {
    const emptyRoot = join(tmpdir(), `frontron-doctor-empty-${Date.now()}-${Math.random()}`)
    mkdirSync(emptyRoot)
    fixtures.tempDirs.push(emptyRoot)
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: emptyRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain('package.json was not found')
  })

  test('doctor combines legacy warnings with unsafe, missing, and invalid project state', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    await initializeProject(projectRoot)

    mkdirSync(join(projectRoot, 'owned-directory'))
    writeFileSync(join(outsideRoot, 'external.ts'), 'outside\n')
    symlinkSync(
      outsideRoot,
      join(projectRoot, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const manifest = readProjectManifest(projectRoot)
    delete manifest.fileHashes
    delete manifest.scriptCommands
    delete manifest.packageJsonClaims
    manifest.preset = 'starter-like'
    delete manifest.templateSource
    delete manifest.templatePackage
    manifest.adapter = 'remix-node-server'
    manifest.tsconfigJsonClaims = [ownershipClaim('electron', { state: 'missing' })]
    manifest.pnpmWorkspaceClaims = [
      {
        path: 'allowBuilds.electron',
        action: 'set',
        value: true,
        previous: { state: 'missing' },
      },
    ]
    manifest.createdFiles.unshift(
      join(projectRoot, 'electron', 'main.ts'),
      '../outside.ts',
      'linked/external.ts',
      'owned-directory',
    )
    writeProjectManifest(projectRoot, manifest)

    rmSync(join(projectRoot, 'tsconfig.json'), { force: true })
    rmSync(join(projectRoot, 'tsconfig.electron.json'), { force: true })
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = readJson<{
      version: string
      scripts: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      build?: { extraMetadata?: { main?: string } }
    }>(packageJsonPath)
    packageJson.version = 'not-semver'
    delete packageJson.scripts[manifest.scripts[0]]
    delete packageJson.build?.extraMetadata?.main
    for (const dependency of [
      'electron',
      'electron-builder',
      'typescript',
      '@types/node',
      '@remix-run/serve',
      'esbuild',
    ]) {
      delete packageJson.dependencies?.[dependency]
      delete packageJson.devDependencies?.[dependency]
    }
    writeJson(packageJsonPath, packageJson)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const report = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(report).toContain('Status: blocked')
    expect(report).toContain('does not include file hashes')
    expect(report).toContain('does not include script commands')
    expect(report).toContain('does not include package.json ownership')
    expect(report).toContain('tsconfig.json is missing')
    expect(report).toContain('pnpm-workspace.yaml is missing')
    expect(report).toContain('does not include create-frontron template metadata')
    expect(report).toContain('Manifest file entry must be relative')
    expect(report).toContain('Manifest file entry points outside the project')
    expect(report).toContain('symbolic link or junction')
    expect(report).toContain('not a regular file')
    expect(report).toContain(`Missing package.json script: ${manifest.scripts[0]}`)
    expect(report).toContain('package.json version must be a valid SemVer value')
    expect(report).toContain('Remix packaging requires @remix-run/serve')
    expect(report).toContain('Remix packaging requires esbuild')
    expect(report).toContain('build.extraMetadata.main must point to dist-electron/main.js')
    expect(report).toContain('Missing tsconfig.electron.json')
  })

  test('doctor distinguishes missing ownership entries from local edits', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const manifest = readProjectManifest(projectRoot)
    const ownedFile = manifest.createdFiles.find(
      (filePath) => filePath !== '.frontron/manifest.json' && manifest.fileHashes?.[filePath],
    )
    const ownedScript = manifest.scripts[0]

    if (!ownedFile || !ownedScript || !manifest.fileHashes || !manifest.scriptCommands) {
      throw new Error('Expected initialized ownership metadata')
    }

    delete manifest.fileHashes[ownedFile]
    delete manifest.scriptCommands[ownedScript]
    writeProjectManifest(projectRoot, manifest)
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(0)
    const report = output.info.mock.calls.flat().join('\n')
    expect(report).toContain(`Manifest file hash is missing for: ${ownedFile}`)
    expect(report).toContain(`Manifest script command is missing for: ${ownedScript}`)
  })

  test('doctor checks valid, locally edited, and malformed tsconfig ownership', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const tsconfigPath = join(projectRoot, 'tsconfig.json')
    writeFileSync(tsconfigPath, '{\n  "compilerOptions": {},\n  "exclude": []\n}\n')
    await initializeProject(projectRoot)

    const healthyOutput = fixtures.createOutput()
    expect(await runCli(['doctor'], healthyOutput, { cwd: projectRoot })).toBe(0)
    expect(healthyOutput.info.mock.calls.flat().join('\n')).toContain('Status: healthy')

    writeFileSync(tsconfigPath, '{\n  "compilerOptions": {},\n  "exclude": []\n}\n')
    const editedOutput = fixtures.createOutput()
    expect(await runCli(['doctor'], editedOutput, { cwd: projectRoot })).toBe(0)
    expect(editedOutput.info.mock.calls.flat().join('\n')).toContain(
      'Manifest-owned tsconfig.json array value is missing: exclude',
    )

    writeFileSync(tsconfigPath, '{ "exclude": [')
    const malformedOutput = fixtures.createOutput()
    expect(await runCli(['doctor'], malformedOutput, { cwd: projectRoot })).toBe(0)
    expect(malformedOutput.info.mock.calls.flat().join('\n')).toContain(
      'tsconfig.json could not be parsed as JSON or JSONC',
    )
  })
})

describe('tsconfig JSONC public transformations', () => {
  test.each([
    ['compact empty object', '{}'],
    ['compact property', '{"compilerOptions": {}}'],
    ['compact trailing property', '{"compilerOptions": {},}'],
    ['compact empty exclude', '{"exclude": []}', '{"exclude": [ ]}'],
    ['compact populated exclude', '{"exclude": ["coverage"]}'],
    ['compact trailing exclude', '{"exclude": ["coverage",],}', '{"exclude": ["coverage", ],}'],
    ['multiline empty object', '{\n}\n'],
    ['multiline property', '{\n  "compilerOptions": {}\n}\n'],
    ['multiline trailing property', '{\n  "compilerOptions": {},\n}\n'],
    ['tab-indented exclude', '{\n\t"exclude": [\n\t\t"coverage"\n\t]\n}\n'],
    ['CRLF trailing exclude', '{\r\n  "exclude": [\r\n    "coverage",\r\n  ],\r\n}\r\n'],
  ])('adds and restores %s', (_label, originalSource, expectedRestored = originalSource) => {
    const before = parseTsconfig(originalSource)
    const values = ['electron', 'dist-electron']
    const initializedSource = addTsconfigExcludeValues(originalSource, [...values, 'electron'])
    const initialized = parseTsconfig(initializedSource)
    const previous: PackageJsonOwnershipClaim['previous'] = Object.hasOwn(before, 'exclude')
      ? { state: 'value', value: before.exclude }
      : { state: 'missing' }
    const claims = values.map((value) => ownershipClaim(value, previous))

    expect(initialized.exclude).toEqual([...(before.exclude ?? []), ...values])
    expect(restoreTsconfigJsonClaims(initializedSource, claims)).toBe(expectedRestored)
  })

  test('clean keeps a user comment added inside a newly owned empty exclude array', () => {
    const source = `{
  "exclude": [
    // keep this user note
    "electron"
  ]
}
`
    const restored = restoreTsconfigJsonClaims(source, [
      ownershipClaim('electron', { state: 'missing' }),
    ])

    expect(parseTsconfig(restored).exclude).toEqual([])
    expect(restored).toContain('// keep this user note')
  })

  test('clean preserves user values added beside a newly owned value', () => {
    const restored = restoreTsconfigJsonClaims('{"exclude":["electron","user-cache"]}', [
      ownershipClaim('electron', { state: 'missing' }),
    ])

    expect(parseTsconfig(restored).exclude).toEqual(['user-cache'])
  })

  test.each([
    ['missing property', '{"compilerOptions":{}}', '{"compilerOptions":{}}'],
    ['missing value', '{"exclude":["coverage"]}', '{"exclude":["coverage"]}'],
    ['first compact value', '{"exclude":["electron","coverage"]}', '{"exclude":["coverage"]}'],
    ['last compact value', '{"exclude":["coverage","electron"]}', '{"exclude":["coverage"]}'],
    ['only compact value', '{"exclude":["electron"]}', '{"exclude":[]}'],
  ])('restores %s without disturbing unrelated structure', (_label, source, expected) => {
    const restored = restoreTsconfigJsonClaims(source, [
      ownershipClaim('electron', { state: 'value', value: [] }),
    ])

    expect(parseTsconfig(restored)).toEqual(parseTsconfig(expected))
    expect(restored).toBe(expected)
  })

  test('appends to a multiline exclude whose closing bracket shares a content line', () => {
    const source = `{
  "exclude": [
    "coverage" /* keep inline note */]
}
`
    const initialized = addTsconfigExcludeValues(source, ['electron'])

    expect(parseTsconfig(initialized).exclude).toEqual(['coverage', 'electron'])
    expect(initialized).toContain('/* keep inline note */')
  })

  test.each([
    ['unterminated block comment', '/* unfinished'],
    ['unterminated string', '{"exclude": ["unfinished]}'],
    ['missing top-level object', '[]'],
    ['unsupported top-level property', '{ true }'],
    ['non-array exclude', '{"exclude": {}}'],
    ['non-string exclude entry', '{"exclude": [true]}'],
    ['unterminated nested object', '{"compilerOptions": {'],
  ])('rejects %s before changing tsconfig.json', (_label, source) => {
    expect(() => addTsconfigExcludeValues(source, ['electron'])).toThrow(/tsconfig\.json/)
  })

  test('rejects multiline objects whose closing brace cannot be edited safely', () => {
    const source = `{
  "compilerOptions": {} /* keep inline note */}
`

    expect(() => addTsconfigExcludeValues(source, ['electron'])).toThrow(
      'closing brace must start on its own line',
    )
  })

  test('rejects unsupported ownership claims instead of rewriting JSONC', () => {
    expect(() =>
      restoreTsconfigJsonClaims('{}', [
        {
          path: 'compilerOptions.outDir',
          action: 'set',
          value: 'dist',
          previous: { state: 'missing' },
        },
      ]),
    ).toThrow('Cannot restore tsconfig.json claim without replacing JSONC formatting')
  })

  test('adding no values is a semantic no-op even for non-JSON input', () => {
    expect(addTsconfigExcludeValues('leave this untouched', [])).toBe('leave this untouched')
  })
})
