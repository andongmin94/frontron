import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron update', () => {
  test('update prints the force refresh plan without writing unless --yes is used', async () => {
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
    packageJson.scripts['frontron:dev'] = 'stale generated script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'stale generated file\n')
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')

    const output = fixtures.createOutput()
    const updateExitCode = await runCli(['update'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(updateExitCode).toBe(0)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toBe('stale generated file\n')
    expect(combined).toContain('Files to overwrite:')
    expect(combined).toContain('~ electron/main.ts')
    expect(combined).toContain('~ scripts.frontron:dev')
    expect(combined).toContain('Run "frontron update --yes" to apply this plan.')
  })

  test('update --yes refreshes manifest-owned files, scripts, and package metadata claims', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const initialManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      fileHashes: Record<string, string>
      packageJsonClaims: Array<{
        path: string
      }>
    }
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'stale generated script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'stale generated file\n')

    const output = fixtures.createOutput()
    const updateExitCode = await runCli(['update', '--yes'], output, {
      cwd: projectRoot,
    })
    const refreshedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    const refreshedManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      fileHashes: Record<string, string>
      packageJsonClaims: Array<{
        path: string
      }>
    }

    expect(updateExitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain('createMainWindow')
    expect(refreshedPackageJson.scripts['frontron:dev']).toContain('--dev-app')
    expect(refreshedManifest.fileHashes['electron/main.ts']).toBe(initialManifest.fileHashes['electron/main.ts'])
    expect(refreshedManifest.packageJsonClaims.length).toBeGreaterThan(0)
    expect(refreshedManifest.packageJsonClaims).toEqual(initialManifest.packageJsonClaims)
  })

  test('update preserves custom init settings from the manifest', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts({
      'web:dev': 'vite --host 127.0.0.1 --port 4200',
      'web:build': 'vite build --outDir web-dist',
    })
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(
      [
        'init',
        '--yes',
        '--preset',
        'starter-like',
        '--desktop-dir',
        'apps/electron',
        '--app-script',
        'desktop',
        '--build-script',
        'desktop:build',
        '--package-script',
        'desktop:package',
        '--web-dev',
        'web:dev',
        '--web-build',
        'web:build',
        '--out-dir',
        'web-dist',
      ],
      fixtures.createOutput(),
      { cwd: projectRoot },
    )
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts.desktop = 'stale generated script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(join(projectRoot, 'apps', 'electron', 'main.ts'), 'stale generated file\n')

    const output = fixtures.createOutput()
    const updateExitCode = await runCli(['update', '--yes'], output, {
      cwd: projectRoot,
    })
    const refreshedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
      build: {
        files: string[]
      }
    }
    const manifest = JSON.parse(readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8')) as {
      desktopDir: string
      appScript: string
      webDevScript: string
      webBuildScript: string
      outDir: string
      preset: string
    }
    const serveSource = readFileSync(join(projectRoot, 'apps', 'electron', 'serve.ts'), 'utf8')

    expect(updateExitCode).toBe(0)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(false)
    expect(readFileSync(join(projectRoot, 'apps', 'electron', 'main.ts'), 'utf8')).toContain('createMainWindow')
    expect(existsSync(join(projectRoot, 'apps', 'electron', 'preload.ts'))).toBe(true)
    expect(refreshedPackageJson.scripts.desktop).toContain('--dev-app')
    expect(refreshedPackageJson.scripts['desktop:build']).toContain('--prepare-build')
    expect(refreshedPackageJson.scripts['desktop:package']).toContain('electron-builder')
    expect(refreshedPackageJson.scripts['frontron:dev']).toBeUndefined()
    expect(refreshedPackageJson.build.files).toContain('web-dist{,/**/*}')
    fixtures.expectEmbeddedString(serveSource, 'WEB_DEV_SCRIPT', 'web:dev')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'web-dist')
    expect(manifest.desktopDir).toBe('apps/electron')
    expect(manifest.appScript).toBe('desktop')
    expect(manifest.webDevScript).toBe('web:dev')
    expect(manifest.webBuildScript).toBe('web:build')
    expect(manifest.outDir).toBe('web-dist')
    expect(manifest.preset).toBe('starter-like')
  })

  test('update refuses to run without a manifest', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['update', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json was not found')
  })
})
