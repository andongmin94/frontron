import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { TRANSACTION_JOURNAL_PATH, TRANSACTION_LOCK_PATH } from '../src/transaction-journal'
import * as fixtures from './helpers/frontron-cli-fixtures'

async function initializeProject(projectRoot: string) {
  const exitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
    cwd: projectRoot,
  })

  expect(exitCode).toBe(0)
}

describe('frontron doctor', () => {
  test('doctor clearly reports projects that have not been initialized', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(1)
    const report = output.info.mock.calls.flat().join('\n')
    expect(report).toContain('Status: not initialized')
    expect(report).toContain('.frontron/manifest.json was not found')
    expect(report).toContain('Run "frontron init --dry-run" to preview the retrofit plan.')
  })

  test('doctor reports pending transaction state without modifying it', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)
    const lockPath = join(projectRoot, TRANSACTION_LOCK_PATH)
    const journalSource = 'pending journal sentinel\n'
    const lockSource = 'pending lock sentinel\n'
    writeFileSync(journalPath, journalSource)
    writeFileSync(lockPath, lockSource)
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(1)
    const report = output.info.mock.calls.flat().join('\n')
    expect(report).toContain(`Pending transaction journal detected: ${TRANSACTION_JOURNAL_PATH}`)
    expect(report).toContain(`Pending transaction lock detected: ${TRANSACTION_LOCK_PATH}`)
    expect(readFileSync(journalPath, 'utf8')).toBe(journalSource)
    expect(readFileSync(lockPath, 'utf8')).toBe(lockSource)
  })

  test('doctor passes after a successful init', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(0)
    const report = output.info.mock.calls.flat().join('\n')
    expect(report).toContain('Status: healthy')
    expect(report).toContain('No blockers found.')
    expect(report).toContain('No action needed.')
    expect(report).toContain('create-frontron template version matches frontron')
  })

  test('doctor warns when the recorded template version differs', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      templateVersion: string
    }
    manifest.templateVersion = '0.0.0'
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(0)
    const report = output.info.mock.calls.flat().join('\n')
    expect(report).toContain('Status: warnings')
    expect(report).toContain('uses create-frontron@0.0.0')
  })

  test('doctor reports missing generated files as blockers', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)
    rmSync(join(projectRoot, 'electron', 'main.ts'))
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(1)
    const report = output.info.mock.calls.flat().join('\n')
    expect(report).toContain('Status: blocked')
    expect(report).toContain('Missing manifest file: electron/main.ts')
  })

  test('doctor reports local file and script edits as warnings', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'user script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'user source\n')
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(0)
    const report = output.info.mock.calls.flat().join('\n')
    expect(report).toContain('Status: warnings')
    expect(report).toContain('Manifest-owned file has local edits: electron/main.ts')
    expect(report).toContain('Manifest-owned script has local edits: frontron:dev')
  })

  test('doctor blocks a missing required Electron dependency', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies: Record<string, string>
    }
    delete packageJson.devDependencies.electron
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(1)
    expect(output.info.mock.calls.flat().join('\n')).toContain(
      'Missing required dependency: electron',
    )
  })

  test('doctor blocks unsafe managed workspace configuration', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      packageManager?: string
    }
    packageJson.packageManager = 'pnpm@11.1.2'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    await initializeProject(projectRoot)

    const unsafeSource =
      'packages: ["apps/*"]\nallowBuilds: { electron: true, electron-winstaller: true }\n'
    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), unsafeSource)
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(1)
    expect(output.info.mock.calls.flat().join('\n')).toContain(
      'Cannot safely edit pnpm-workspace.yaml',
    )
  })

  test('doctor rejects an obsolete manifest schema', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    await initializeProject(projectRoot)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemaVersion: number
    }
    manifest.schemaVersion = 1
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const output = fixtures.createOutput()

    expect(await runCli(['doctor'], output, { cwd: projectRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain(
      'uses unsupported schema version 1',
    )
  })
})
