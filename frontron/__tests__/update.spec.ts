import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { createFileHash } from '../src/init/manifest'
import * as fixtures from './helpers/frontron-cli-fixtures'

// configurePnpmOwnershipProject 함수는 update의 tsconfig와 pnpm 소유권 검사용 fixture를 준비한다.
function configurePnpmOwnershipProject(projectRoot: string) {
  const packageJsonPath = join(projectRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    packageManager?: string
  }

  packageJson.packageManager = 'pnpm@11.1.2'
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
  writeFileSync(
    join(projectRoot, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { target: 'ES2022' } }, null, 2)}\n`,
  )
  writeFileSync(
    join(projectRoot, 'pnpm-workspace.yaml'),
    `packages:
  - apps/*

allowBuilds:
  esbuild: false
`,
  )
}

// setYarnPackageManager 함수는 update의 Yarn 소유권 검사용 package manager를 지정한다.
function setYarnPackageManager(projectRoot: string) {
  const packageJsonPath = join(projectRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    packageManager?: string
  }

  packageJson.packageManager = 'yarn@4.9.2'
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

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

  test('update protects manifest-owned package fields from implicit overwrite', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      build: { extraMetadata: { main: string } }
    }
    packageJson.build.extraMetadata.main = 'custom/main.cjs'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['update', '--yes'], output, { cwd: projectRoot })

    expect(exitCode).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain(
      'Manifest-owned package.json field has local edits: build.extraMetadata.main',
    )
    expect(JSON.parse(readFileSync(packageJsonPath, 'utf8')).build.extraMetadata.main).toBe(
      'custom/main.cjs',
    )
  })

  test('update reports local edits to manifest-owned tsconfig and pnpm workspace values', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    configurePnpmOwnershipProject(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    writeFileSync(
      join(projectRoot, 'tsconfig.json'),
      `${JSON.stringify({ compilerOptions: { target: 'ES2022' }, exclude: [] }, null, 2)}\n`,
    )
    writeFileSync(
      join(projectRoot, 'pnpm-workspace.yaml'),
      `packages:
  - apps/*

allowBuilds:
  esbuild: false
  electron: false
  electron-winstaller: false
`,
    )
    const output = fixtures.createOutput()

    expect(await runCli(['update', '--yes'], output, { cwd: projectRoot })).toBe(1)
    const errors = output.error.mock.calls.flat().join('\n')
    expect(errors).toContain('Manifest-owned tsconfig.json field has local edits: exclude')
    expect(errors).toContain(
      'Manifest-owned pnpm-workspace.yaml field has local edits: allowBuilds.electron',
    )
    expect(errors).toContain(
      'Manifest-owned pnpm-workspace.yaml field has local edits: allowBuilds.electron-winstaller',
    )
  })

  test('update --force still blocks pnpm workspace YAML that cannot be edited safely', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    configurePnpmOwnershipProject(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'allowBuilds: *sharedBuilds\n')
    const output = fixtures.createOutput()

    expect(await runCli(['update', '--yes', '--force'], output, { cwd: projectRoot })).toBe(1)
    const errors = output.error.mock.calls.flat().join('\n')
    expect(errors).toContain('Update aborted because managed paths are unsafe')
    expect(errors).toContain('aliases are not supported safely')
  })

  test('update reports invalid manifest-owned tsconfig JSON without overwriting it', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    configurePnpmOwnershipProject(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    const invalidTsconfig = '{ "exclude": [\n'
    writeFileSync(join(projectRoot, 'tsconfig.json'), invalidTsconfig)
    const output = fixtures.createOutput()

    expect(await runCli(['update', '--yes'], output, { cwd: projectRoot })).toBe(1)
    expect(output.error.mock.calls.flat().join('\n')).toContain(
      'Manifest-owned tsconfig.json cannot be verified because it is invalid',
    )
    expect(readFileSync(join(projectRoot, 'tsconfig.json'), 'utf8')).toBe(invalidTsconfig)
  })

  test('update --force still blocks Yarn config syntax that cannot be edited safely', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    writeFileSync(join(projectRoot, '.yarnrc.yml'), 'nodeLinker: pnp\n')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    writeFileSync(join(projectRoot, '.yarnrc.yml'), 'nodeLinker: *workspaceLinker\n')
    const output = fixtures.createOutput()

    expect(await runCli(['update', '--yes', '--force'], output, { cwd: projectRoot })).toBe(1)
    const errors = output.error.mock.calls.flat().join('\n')
    expect(errors).toContain('Update aborted because managed paths are unsafe')
    expect(errors).toContain('aliases are not supported safely')
  })

  test('update --force rejects a manifest-owned Yarn config that became a directory', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    setYarnPackageManager(projectRoot)
    const yarnRcPath = join(projectRoot, '.yarnrc.yml')
    writeFileSync(yarnRcPath, 'nodeLinker: pnp\n')

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)
    rmSync(yarnRcPath)
    mkdirSync(yarnRcPath)
    const output = fixtures.createOutput()

    expect(await runCli(['update', '--yes', '--force'], output, { cwd: projectRoot })).toBe(1)
    const errors = output.error.mock.calls.flat().join('\n')
    expect(errors).toContain('Update aborted because managed paths are unsafe')
    expect(errors).toContain('.yarnrc.yml must be a regular file with one hard link')
  })

  test('update explains unverifiable ownership in legacy manifests', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemaVersion: number
      fileHashes?: Record<string, string>
      scriptCommands?: Record<string, string>
      packageJsonClaims?: unknown[]
    }
    manifest.schemaVersion = 1
    delete manifest.fileHashes
    delete manifest.scriptCommands
    delete manifest.packageJsonClaims
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const output = fixtures.createOutput()

    expect(await runCli(['update', '--yes'], output, { cwd: projectRoot })).toBe(1)
    const errors = output.error.mock.calls.flat().join('\n')
    expect(errors).toContain('Legacy manifest has no package.json ownership metadata')
    expect(errors).toContain('Manifest-owned file has no recorded hash: electron/main.ts')
    expect(errors).toContain('Manifest-owned script has no recorded command: frontron:dev')
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
      schemaVersion: number
      preset?: string
      templateSource?: string
      templatePackage?: string
      templateVersion?: string | null
      templateResolvedFrom?: string
      createdFiles: string[]
      fileHashes?: Record<string, string>
    }

    legacyManifest.schemaVersion = 1
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

    expect(
      await runCli(['update', '--yes', '--force'], fixtures.createOutput(), { cwd: projectRoot }),
    ).toBe(0)

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

  test('update --yes --force replaces locally edited manifest-owned package fields', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const original = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      build: { appId: string }
      devDependencies: { electron: string }
    }
    const edited = structuredClone(original)
    edited.build.appId = 'com.example.local-edit'
    edited.devDependencies.electron = '1.0.0'
    writeFileSync(packageJsonPath, `${JSON.stringify(edited, null, 2)}\n`)

    expect(
      await runCli(['update', '--yes', '--force'], fixtures.createOutput(), { cwd: projectRoot }),
    ).toBe(0)

    const refreshed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as typeof original
    const refreshedManifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      packageJsonClaims: Array<{ path: string; value: unknown }>
    }
    expect(refreshed.build.appId).toBe(original.build.appId)
    expect(refreshed.devDependencies.electron).toBe(original.devDependencies.electron)
    expect(refreshedManifest.packageJsonClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'build.appId', value: original.build.appId }),
        expect.objectContaining({
          path: 'devDependencies.electron',
          value: original.devDependencies.electron,
        }),
      ]),
    )
  })

  test('update removes unchanged files that disappeared from the template', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    expect(await runCli(['init', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const obsoleteManifestPath = 'electron/obsolete.ts'
    const obsoletePath = join(projectRoot, obsoleteManifestPath)
    const obsoleteSource = 'export const obsolete = true\n'
    const manifestPath = join(projectRoot, '.frontron', 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      createdFiles: string[]
      fileHashes: Record<string, string>
    }
    writeFileSync(obsoletePath, obsoleteSource)
    manifest.createdFiles.push(obsoleteManifestPath)
    manifest.fileHashes[obsoleteManifestPath] = createFileHash(obsoleteSource)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    expect(await runCli(['update', '--yes'], fixtures.createOutput(), { cwd: projectRoot })).toBe(0)

    const refreshedManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      createdFiles: string[]
    }
    expect(existsSync(obsoletePath)).toBe(false)
    expect(refreshedManifest.createdFiles).not.toContain(obsoleteManifestPath)
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
      fileHashes: Record<string, string>
    }
    const originalServeFile = manifest.createdFiles.find((filePath) =>
      filePath.endsWith('/serve.ts'),
    )
    manifest.createdFiles = [
      '../outside/serve.ts',
      ...manifest.createdFiles.filter((filePath) => !filePath.endsWith('/serve.ts')),
    ]
    if (originalServeFile) delete manifest.fileHashes[originalServeFile]
    manifest.fileHashes['../outside/serve.ts'] = '0'.repeat(64)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const output = fixtures.createOutput()
    const exitCode = await runCli(['update', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('.frontron/manifest.json is invalid.')
    expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(true)
  })
})
