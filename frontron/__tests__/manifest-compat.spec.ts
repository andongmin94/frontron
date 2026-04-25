import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron manifest compatibility', () => {
  test('manifest readers reject invalid file hash metadata', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      fileHashes: unknown
    }
    manifest.fileHashes = ['not-valid']
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json is invalid')
  })

  test('manifest readers reject invalid script command metadata', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      scriptCommands: unknown
    }
    manifest.scriptCommands = ['not-valid']
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json is invalid')
  })

  test('manifest readers reject invalid package ownership metadata', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      packageJsonClaims: unknown
    }
    manifest.packageJsonClaims = [{ path: 'build.files', previous: { state: 'nope' } }]
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const doctorExitCode = await runCli(['doctor'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(doctorExitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json is invalid')
  })

  test('legacy manifests without script commands still clean with a warning', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      scriptCommands?: Record<string, string>
    }
    delete manifest.scriptCommands
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(cleanExitCode).toBe(0)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
    expect(combined).toContain(
      '.frontron/manifest.json does not include script commands. Run "frontron update --yes" to refresh it.',
    )
  })

  test('legacy manifests without package ownership leave package metadata intact', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      packageJsonClaims?: unknown
    }
    delete manifest.packageJsonClaims
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const cleanExitCode = await runCli(['clean', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
      build: {
        extraMetadata: {
          main: string
        }
      }
    }

    expect(cleanExitCode).toBe(0)
    expect(packageJson.devDependencies.electron).toBeTruthy()
    expect(packageJson.build.extraMetadata.main).toBe('dist-electron/main.js')
    expect(combined).toContain(
      '.frontron/manifest.json does not include package.json ownership. Run "frontron update --yes" to refresh it.',
    )
  })
})
