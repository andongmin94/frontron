import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron update', () => {
  test.each([
    '--adapter=generic-static',
    '--preset=minimal',
    '--desktop-dir=electron-next',
    '--app-script=desktop:dev',
    '--build-script=desktop:build',
    '--package-script=desktop:package',
    '--web-dev=web:dev',
    '--web-build=web:build',
    '--out-dir=web-dist',
    '--server-root=server-dist',
    '--server-entry=server.js',
    '--product-name=Replacement',
    '--app-id=com.example.replacement',
  ])('rejects migration override %s', async (option) => {
    const output = fixtures.createOutput()

    const exitCode = await runCli(['update', option], output)

    expect(exitCode).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain(
      `Unknown option "${option}" for "frontron update"`,
    )
  })

  test('update prints the guarded refresh plan without writing unless --yes is used', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')
    const mainSourceBefore = readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')

    const output = fixtures.createOutput()
    const updateExitCode = await runCli(['update'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(updateExitCode).toBe(0)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toBe(mainSourceBefore)
    expect(combined).toContain('Files to overwrite:')
    expect(combined).toContain('~ electron/main.ts')
    expect(combined).toContain('package.json changes:\n  (none)')
    expect(combined).toContain('Run "frontron update --yes" to apply this plan.')
  })

  test('update --yes blocks locally edited manifest-owned files and scripts without --force', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'stale generated script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'stale generated file\n')

    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')
    const manifestBefore = readFileSync(manifestPath, 'utf8')
    const output = fixtures.createOutput()
    const updateExitCode = await runCli(['update', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(updateExitCode).toBe(1)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toBe(
      'stale generated file\n',
    )
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBefore)
    expect(combined).toContain('Manifest-owned file has local edits: electron/main.ts')
    expect(combined).toContain('Manifest-owned script has local edits: frontron:dev')
    expect(combined).toContain('Re-run with --force')
  })

  test('update --yes applies when manifest-owned files and scripts are unchanged', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const exitCode = await runCli(['update', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain('createWindow')
  })

  test('update migrates a legacy minimal manifest to the exact-version template flow', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const templateOnlyFiles = [
      'electron/preload.ts',
      'electron/ipc.ts',
      'electron/dev.ts',
      'electron/splash.ts',
      'electron/tray.ts',
      'src/types/electron.d.ts',
    ]
    const legacyManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      preset?: string
      templateSource?: string
      templatePackage?: string
      templateVersion?: string | null
      templateResolvedFrom?: string
      createdFiles: string[]
      fileHashes?: Record<string, string>
    }

    legacyManifest.preset = 'minimal'
    legacyManifest.templateSource = 'frontron:minimal'
    delete legacyManifest.templatePackage
    delete legacyManifest.templateVersion
    delete legacyManifest.templateResolvedFrom
    legacyManifest.createdFiles = legacyManifest.createdFiles.filter(
      (filePath) => !templateOnlyFiles.includes(filePath),
    )

    for (const filePath of templateOnlyFiles) {
      rmSync(join(projectRoot, filePath), { force: true })
      delete legacyManifest.fileHashes?.[filePath]
    }

    writeFileSync(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`)

    expect(await runCli(['update', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const migratedManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      preset?: string
      templateSource?: string
      templatePackage?: string
      templateVersion?: string | null
      createdFiles: string[]
    }

    for (const filePath of templateOnlyFiles) {
      expect(existsSync(join(projectRoot, filePath))).toBe(true)
      expect(migratedManifest.createdFiles).toContain(filePath)
    }

    expect(migratedManifest.preset).toBeUndefined()
    expect(migratedManifest.templateSource).toBe('create-frontron')
    expect(migratedManifest.templatePackage).toBe('create-frontron')
    expect(migratedManifest.templateVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('update --yes --force replaces locally edited manifest-owned files and scripts', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'local script edit'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'local file edit\n')

    const exitCode = await runCli(['update', '--yes', '--force'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    const refreshedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(exitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain('createWindow')
    expect(refreshedPackageJson.scripts['frontron:dev']).toContain('--dev-app')
  })

  test('update --dry-run --force previews overwrites without writing', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'local script edit'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')
    const mainPath = join(projectRoot, 'electron', 'main.ts')
    const mainBefore = readFileSync(mainPath, 'utf8')
    const output = fixtures.createOutput()

    const exitCode = await runCli(['update', '--dry-run', '--force'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(readFileSync(mainPath, 'utf8')).toBe(mainBefore)
    expect(combined).toContain('Files to overwrite:')
    expect(combined).toContain('~ electron/main.ts')
    expect(combined).toContain('~ scripts.frontron:dev')
    expect(combined).toContain('No changes were written because --dry-run was used.')
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
    const updateExitCode = await runCli(['update', '--yes', '--force'], output, {
      cwd: projectRoot,
    })
    const refreshedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
      build: {
        files: string[]
      }
    }
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      desktopDir: string
      appScript: string
      webDevScript: string
      webBuildScript: string
      outDir: string
      templateSource?: string
      templatePackage?: string
      templateVersion?: string | null
      templateResolvedFrom?: string
    }
    const serveSource = readFileSync(join(projectRoot, 'apps', 'electron', 'serve.ts'), 'utf8')

    expect(updateExitCode).toBe(0)
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(false)
    expect(readFileSync(join(projectRoot, 'apps', 'electron', 'main.ts'), 'utf8')).toContain(
      'createWindow',
    )
    expect(readFileSync(join(projectRoot, 'apps', 'electron', 'main.ts'), 'utf8')).toContain(
      'createTray',
    )
    expect(existsSync(join(projectRoot, 'apps', 'electron', 'preload.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, 'apps', 'electron', 'dev.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, 'apps', 'electron', 'splash.ts'))).toBe(true)
    expect(existsSync(join(projectRoot, 'apps', 'electron', 'tray.ts'))).toBe(true)
    expect(refreshedPackageJson.scripts.desktop).toContain('--dev-app')
    expect(refreshedPackageJson.scripts['desktop:build']).toContain('--prepare-build')
    expect(refreshedPackageJson.scripts['desktop:package']).toContain('electron-builder')
    expect(refreshedPackageJson.scripts['frontron:dev']).toBeUndefined()
    expect(refreshedPackageJson.build.files).toContain('web-dist{,/**/*}')
    expect(refreshedPackageJson.build.files).toContain('public{,/**/*}')
    fixtures.expectEmbeddedString(serveSource, 'WEB_DEV_SCRIPT', 'web:dev')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'web-dist')
    expect(manifest.desktopDir).toBe('apps/electron')
    expect(manifest.appScript).toBe('desktop')
    expect(manifest.webDevScript).toBe('web:dev')
    expect(manifest.webBuildScript).toBe('web:build')
    expect(manifest.outDir).toBe('web-dist')
    expect(manifest.templateSource).toBe('create-frontron')
    expect(manifest.templatePackage).toBe('create-frontron')
    expect(manifest.templateVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(manifest.templateResolvedFrom).toBe('repo')
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

  test('update blocks manifest serve entries that point outside the project', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const initExitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })
    expect(initExitCode).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      createdFiles: string[]
    }
    manifest.createdFiles = [
      '../outside/serve.ts',
      ...manifest.createdFiles.filter((filePath) => !filePath.endsWith('/serve.ts')),
    ]
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['update', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('Manifest serve entry points outside the project')
  })
})
