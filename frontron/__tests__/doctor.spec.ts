import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
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
    expect(combined).toContain('Manifest-owned package.json field has local edits: devDependencies.electron')
  })
})
