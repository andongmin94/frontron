import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { TRANSACTION_JOURNAL_PATH, TRANSACTION_LOCK_PATH } from '../src/transaction-journal'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron doctor', () => {
  test('doctor clearly reports projects that have not been initialized', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('Status: not initialized')
    expect(combined).toContain('.frontron/manifest.json was not found')
    expect(combined).toContain('Frontron has not been initialized in this project.')
    expect(combined).toContain('Run "frontron init --dry-run" to preview the retrofit plan.')
    expect(combined).not.toContain('Missing dependency: electron')
    expect(combined).not.toContain('Missing tsconfig.electron.json')
  })

  test('doctor reports pending journal and lock state without modifying it', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const journalPath = join(projectRoot, TRANSACTION_JOURNAL_PATH)
    const lockPath = join(projectRoot, TRANSACTION_LOCK_PATH)
    const journalSource = 'pending journal sentinel\n'
    const lockSource = 'pending lock sentinel\n'

    writeFileSync(journalPath, journalSource)
    writeFileSync(lockPath, lockSource)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('Status: blocked')
    expect(combined).toContain(`Pending transaction journal detected: ${TRANSACTION_JOURNAL_PATH}`)
    expect(combined).toContain(`Pending transaction lock detected: ${TRANSACTION_LOCK_PATH}`)
    expect(combined).toContain('Doctor did not recover or modify the pending transaction state.')
    expect(readFileSync(journalPath, 'utf8')).toBe(journalSource)
    expect(readFileSync(lockPath, 'utf8')).toBe(lockSource)
  })

  test('doctor passes after a successful init', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(0)
    expect(combined).toContain('Frontron Doctor')
    expect(combined).toContain('Status: healthy')
    expect(combined).toContain('No blockers found.')
    expect(combined).toContain('No action needed.')
    expect(combined).toContain('scripts.frontron:dev exists')
    expect(combined).toContain('create-frontron template version matches frontron')
  })

  test('doctor warns when the manifest records a different create-frontron version', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      templateVersion?: string | null
    }
    manifest.templateVersion = '0.0.0'
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(0)
    expect(combined).toContain('Status: warnings')
    expect(combined).toContain('uses create-frontron@0.0.0')
    expect(combined).toContain('frontron update --yes')
  })

  test('doctor blocks packaging when a required Electron dependency is missing', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies: Record<string, string>
    }
    delete packageJson.devDependencies.electron
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('Status: blocked')
    expect(combined).toContain('Missing required dependency: electron')
  })

  test('doctor checks pnpm workspace claims from a nested package', async () => {
    const workspaceRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(workspaceRoot)
    const appRoot = join(workspaceRoot, 'apps', 'web')

    mkdirSync(appRoot, { recursive: true })
    writeFileSync(join(workspaceRoot, 'pnpm-lock.yaml'), '')
    writeFileSync(
      join(workspaceRoot, 'pnpm-workspace.yaml'),
      `packages:
  - apps/*
`,
    )
    writeFileSync(
      join(appRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'nested-web-app',
          version: '0.0.1',
          scripts: {
            dev: 'vite --port 5180',
            build: 'vite build',
          },
          devDependencies: {
            vite: '^8.0.1',
          },
        },
        null,
        2,
      )}\n`,
    )
    writeFileSync(
      join(appRoot, 'vite.config.ts'),
      `export default {
  build: {
    outDir: 'dist-web'
  }
}
`,
    )

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: appRoot,
    })
    expect(initExitCode).toBe(0)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: appRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(0)
    expect(combined).toContain('Status: healthy')
    expect(combined).toContain('pnpm-workspace.yaml allowBuilds.electron matches manifest')
    expect(combined).not.toContain('pnpm-workspace.yaml is missing')
  })

  test('doctor blocks an unsafe pnpm workspace instead of reporting missing fields', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      packageManager?: string
    }
    const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')

    packageJson.packageManager = 'pnpm@11.1.2'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(workspacePath, 'packages:\n  - apps/*\n')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const unsafeSource =
      'packages: ["apps/*"]\nallowBuilds: { electron: true, electron-winstaller: true }\n'
    writeFileSync(workspacePath, unsafeSource)
    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('Status: blocked')
    expect(combined).toContain('Cannot safely edit pnpm-workspace.yaml')
    expect(combined).not.toContain('Manifest-owned pnpm-workspace.yaml field is missing')
    expect(readFileSync(workspacePath, 'utf8')).toBe(unsafeSource)
  })

  test('doctor ignores legacy empty tsconfig ownership claims', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      tsconfigJsonClaims?: unknown[]
    }
    manifest.tsconfigJsonClaims = []
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(0)
    expect(combined).toContain('Status: healthy')
    expect(combined).not.toContain('tsconfig.json changes cannot be checked')
  })

  test('doctor reports missing manifest files as blockers', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    rmSync(join(projectRoot, 'electron', 'main.ts'), { force: true })

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('Status: blocked')
    expect(combined).toContain('Blockers:')
    expect(combined).toContain('Missing manifest file: electron/main.ts')
    expect(combined).toContain('Run "frontron update --dry-run" to inspect a guarded refresh plan.')
  })

  test('doctor reports modified manifest-owned files as warnings', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'user edits\n')

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(0)
    expect(combined).toContain('Status: warnings')
    expect(combined).toContain('Warnings:')
    expect(combined).toContain('Manifest-owned file has local edits: electron/main.ts')
  })

  test('doctor reports modified manifest-owned scripts as warnings', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'user script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(0)
    expect(combined).toContain('Warnings:')
    expect(combined).toContain('Manifest-owned script has local edits: frontron:dev')
  })

  test('doctor reports modified manifest-owned package fields as warnings', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies: Record<string, string>
    }
    packageJson.devDependencies.electron = '^99.0.0'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(0)
    expect(combined).toContain('Warnings:')
    expect(combined).toContain(
      'Manifest-owned package.json field has local edits: devDependencies.electron',
    )
  })

  test('doctor reports legacy file and script metadata as unverifiable', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemaVersion: number
      fileHashes: Record<string, string>
      scriptCommands: Record<string, string>
    }
    manifest.schemaVersion = 1
    delete manifest.fileHashes['electron/main.ts']
    delete manifest.scriptCommands['frontron:dev']
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(combined).toContain('Status: warnings')
    expect(combined).toContain('Manifest-owned file has no recorded hash: electron/main.ts')
    expect(combined).toContain('Manifest-owned script has no recorded command: frontron:dev')
  })

  test('doctor blocks a hard-linked manifest-owned file as unsafe', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const mainPath = join(projectRoot, 'electron', 'main.ts')
    const sharedPath = join(projectRoot, 'shared-main.ts')
    writeFileSync(sharedPath, readFileSync(mainPath))
    rmSync(mainPath)
    linkSync(sharedPath, mainPath)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('Status: blocked')
    expect(combined).toContain(
      'Manifest file entry must have exactly one hard link: electron/main.ts',
    )
  })

  test('doctor warns for a verifiable dependency major mismatch', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies: Record<string, string>
    }
    packageJson.devDependencies.electron = '^999.0.0'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(combined).toContain('Status: warnings')
    expect(combined).toContain(
      'electron major 999 does not match create-frontron template baseline',
    )
  })

  test('doctor treats protocol dependency declarations as present but unverifiable', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      devDependencies: Record<string, string>
    }
    packageJson.devDependencies.electron = 'workspace:*'
    packageJson.devDependencies['electron-builder'] = 'catalog:'
    packageJson.devDependencies.typescript = 'file:../typescript'
    packageJson.devDependencies['@types/node'] = 'npm:@types/node@latest'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(combined).toContain('Status: warnings')
    expect(combined).toContain('Could not verify electron version compatibility for "workspace:*"')
    expect(combined).toContain(
      'Could not verify electron-builder version compatibility for "catalog:"',
    )
    expect(combined).toContain(
      'Could not verify typescript version compatibility for "file:../typescript"',
    )
    expect(combined).toContain(
      'Could not verify @types/node version compatibility for "npm:@types/node@latest"',
    )
    expect(combined).toContain(
      'The protocol declaration is present and is not treated as an error.',
    )
    expect(combined).not.toContain('Missing required dependency:')
  })

  test('doctor does not follow a manifest path through a symbolic link or junction', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const projectManifestDirectory = join(projectRoot, '.frontron')
    const externalManifestDirectory = join(outsideRoot, 'external-manifest')

    renameSync(projectManifestDirectory, externalManifestDirectory)
    symlinkSync(
      externalManifestDirectory,
      projectManifestDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const output = fixtures.createOutput()
    const exitCode = await runCli(['doctor'], output, { cwd: projectRoot })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('Status: blocked')
    expect(combined).toContain(
      'Frontron manifest must not pass through a symbolic link or junction',
    )
  })
})
