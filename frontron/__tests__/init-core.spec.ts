import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron init core flow', () => {
  test('init seeds the minimal Electron layer with defaults', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      build: {
        appId: string
        productName: string
        files: string[]
        extraMetadata: {
          main: string
        }
      }
      devDependencies: Record<string, string>
    }

    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain('createMainWindow')
    expect(readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')).toContain('BrowserWindow')
    expect(readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')).toContain('Content-Security-Policy')
    expect(readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')).toContain("mainWindow.webContents.on('context-menu'")
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    fixtures.expectEmbeddedString(serveSource, 'WEB_DEV_SCRIPT', 'dev')
    fixtures.expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:5180')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'dist-web')
    expect(serveSource).toContain(
      "createRequire(import.meta.url)",
    )
    expect(serveSource).toContain(
      `JSON.stringify({ type: 'module' }, null, 2)`,
    )
    expect(readFileSync(join(projectRoot, 'tsconfig.electron.json'), 'utf8')).toContain('"rootDir": "./electron"')
    expect(readFileSync(join(projectRoot, 'tsconfig.electron.json'), 'utf8')).toContain('"module": "ESNext"')
    const manifest = JSON.parse(readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8')) as {
      adapter: string
      adapterConfidence: string
      adapterReasons: string[]
      strategy: string
      createdFiles: string[]
      fileHashes: Record<string, string>
      scripts: string[]
      scriptCommands: Record<string, string>
      packageJsonClaims: Array<{
        path: string
        action?: string
        value: unknown
        previous: {
          state: string
        }
      }>
    }

    expect(packageJson.scripts['frontron:dev']).toBe('tsc -p tsconfig.electron.json && node dist-electron/serve.js --dev-app')
    expect(packageJson.scripts['frontron:build']).toContain('vite build')
    expect(packageJson.scripts['frontron:build']).toContain('--prepare-build')
    expect(packageJson.scripts['frontron:build']).not.toContain('electron-builder')
    expect(packageJson.scripts['frontron:package']).toContain('vite build')
    expect(packageJson.scripts['frontron:package']).toContain('electron-builder')
    expect(packageJson.build.appId).toBe('com.local.sample-web-app')
    expect(packageJson.build.productName).toBe('Sample Web App')
    expect(packageJson.build.files).toContain('dist-web{,/**/*}')
    expect(packageJson.build.files).toContain('dist-electron{,/**/*}')
    expect(packageJson.build.extraMetadata.main).toBe('dist-electron/main.js')
    expect(packageJson.devDependencies.electron).toBeTruthy()
    expect(packageJson.devDependencies['electron-builder']).toBeTruthy()
    expect(packageJson.devDependencies.typescript).toBeTruthy()
    expect(manifest.adapter).toBe('generic-static')
    expect(manifest.adapterConfidence).toBe('low')
    expect(manifest.adapterReasons).toContain('No specific framework adapter matched; using generic static fallback.')
    expect(manifest.strategy).toBe('static-export')
    expect(manifest.createdFiles).toContain('electron/main.ts')
    expect(manifest.createdFiles).toContain('tsconfig.electron.json')
    expect(manifest.createdFiles).toContain('.frontron/manifest.json')
    expect(manifest.fileHashes['electron/main.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.fileHashes['.frontron/manifest.json']).toBeUndefined()
    expect(manifest.scripts).toEqual(['frontron:dev', 'frontron:build', 'frontron:package'])
    expect(manifest.scriptCommands['frontron:dev']).toBe(
      'tsc -p tsconfig.electron.json && node dist-electron/serve.js --dev-app',
    )
    expect(manifest.scriptCommands['frontron:build']).toContain('--prepare-build')
    expect(manifest.scriptCommands['frontron:package']).toContain('electron-builder')
    expect(manifest.packageJsonClaims).toContainEqual(
      expect.objectContaining({
        path: 'devDependencies.electron',
        action: 'set',
        previous: {
          state: 'missing',
        },
      }),
    )
    expect(manifest.packageJsonClaims).toContainEqual(
      expect.objectContaining({
        path: 'build.files',
        action: 'array-value',
        value: 'dist-web{,/**/*}',
      }),
    )
  })

  test('init --dry-run prints the plan without writing files or package changes', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()
    const packageJsonBefore = readFileSync(join(projectRoot, 'package.json'), 'utf8')

    const exitCode = await runCli(['init', '--dry-run'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
    expect(existsSync(join(projectRoot, 'tsconfig.electron.json'))).toBe(false)
    expect(combined).toContain('Detected:')
    expect(combined).toContain('Confidence: low')
    expect(combined).toContain('No specific framework adapter matched')
    expect(combined).toContain('Files to create:')
    expect(combined).toContain('+ scripts.frontron:dev')
    expect(combined).toContain('+ scripts.frontron:build')
    expect(combined).toContain('+ scripts.frontron:package')
    expect(combined).toContain('No changes were written because --dry-run was used.')
  })

  test('init --dry-run separates blockers from warnings', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    writeFileSync(join(projectRoot, 'tsconfig.electron.json'), '{}\n')

    const exitCode = await runCli(['init', '--dry-run'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'tsconfig.electron.json'), 'utf8')).toBe('{}\n')
    expect(combined).toContain('Blockers:')
    expect(combined).toContain('Existing file will not be overwritten automatically: tsconfig.electron.json')
    expect(combined).not.toContain('Warnings:\n  - Existing file will not be overwritten automatically')
  })

  test('init respects interactive custom directory and script names', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init'], output, {
      cwd: projectRoot,
      prompter: fixtures.createPromptAnswers([
        'dev',
        'build',
        'apps/electron',
        'desktop',
        'desktop:build',
        'desktop:package',
        'minimal',
        'dist-web',
        'Sample Desktop',
        'com.example.sample',
      ]),
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      build: {
        appId: string
        productName: string
      }
    }

    expect(readFileSync(join(projectRoot, 'apps', 'electron', 'main.ts'), 'utf8')).toContain('createMainWindow')
    expect(packageJson.scripts.desktop).toBe(
      'tsc -p tsconfig.electron.json && node dist-electron/serve.js --dev-app',
    )
    expect(packageJson.scripts['desktop:build']).toContain('vite build')
    expect(packageJson.scripts['desktop:build']).not.toContain('electron-builder')
    expect(packageJson.scripts['desktop:package']).toContain('electron-builder')
    expect(packageJson.build.appId).toBe('com.example.sample')
    expect(packageJson.build.productName).toBe('Sample Desktop')
  })

  test('init supports the starter-like preset and adds the preload bridge files', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes', '--preset', 'starter-like'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain('setupIpcHandlers')
    expect(readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')).toContain('preload: preloadPath')
    expect(readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')).toContain('Preload bridge is unavailable')
    expect(readFileSync(join(projectRoot, 'electron', 'preload.ts'), 'utf8')).toContain(
      "contextBridge.exposeInMainWorld('electron'",
    )
    expect(readFileSync(join(projectRoot, 'electron', 'ipc.ts'), 'utf8')).toContain(
      "const quitAppChannel = 'app:quit'",
    )
    expect(readFileSync(join(projectRoot, 'src', 'types', 'electron.d.ts'), 'utf8')).toContain(
      'interface Window',
    )
  })

  test('init re-prompts when the default desktop script names already exist', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts({
      dev: 'vite',
      build: 'vite build',
      'frontron:dev': 'already-used',
      'frontron:build': 'already-used-too',
      'frontron:package': 'already-used-three',
    })
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()
    const prompter = fixtures.createPromptAnswers([
      'dev',
      'build',
      'electron',
      'frontron:dev',
      'desktop:app',
      'frontron:build',
      'desktop:build',
      'frontron:package',
      'desktop:package',
      'minimal',
      'dist',
      'Sample Web App',
      'com.local.sample-web-app',
    ])

    const exitCode = await runCli(['init'], output, {
      cwd: projectRoot,
      prompter,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['desktop:app']).toBe(
      'tsc -p tsconfig.electron.json && node dist-electron/serve.js --dev-app',
    )
    expect(packageJson.scripts['desktop:build']).toContain('--prepare-build')
    expect(packageJson.scripts['desktop:build']).not.toContain('electron-builder')
    expect(packageJson.scripts['desktop:package']).toContain('electron-builder')
  })

  test('init --yes falls back instead of overwriting default frontron scripts', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts({
      dev: 'vite',
      build: 'vite build',
      'frontron:dev': 'existing-dev',
      'frontron:build': 'existing-build',
      'frontron:package': 'existing-package',
    })
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes', '--out-dir', 'dist'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['frontron:dev']).toBe('existing-dev')
    expect(packageJson.scripts['frontron:build']).toBe('existing-build')
    expect(packageJson.scripts['frontron:package']).toBe('existing-package')
    expect(packageJson.scripts['frontron:dev:electron']).toContain('--dev-app')
    expect(packageJson.scripts['frontron:build:electron']).toContain('--prepare-build')
    expect(packageJson.scripts['frontron:package:electron']).toContain('electron-builder')
    expect(output.info.mock.calls.flat().join('\n')).toContain(
      'Existing "frontron:dev" script found. Using "frontron:dev:electron" instead.',
    )
  })

  test('init treats existing target files as blockers even with --force', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    writeFileSync(join(projectRoot, 'tsconfig.electron.json'), '{}\n')

    const exitCode = await runCli(['init', '--yes', '--force'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(readFileSync(join(projectRoot, 'tsconfig.electron.json'), 'utf8')).toBe('{}\n')
    expect(combined).toContain('target files already exist')
  })

  test('init --force only refreshes files and scripts recorded in the manifest', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const firstExitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })
    expect(firstExitCode).toBe(0)

    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }
    packageJson.scripts['frontron:dev'] = 'stale generated script'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(join(projectRoot, 'electron', 'main.ts'), 'stale generated file\n')

    const secondOutput = fixtures.createOutput()
    const secondExitCode = await runCli(['init', '--yes', '--force'], secondOutput, {
      cwd: projectRoot,
    })
    const refreshedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(secondExitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain('createMainWindow')
    expect(refreshedPackageJson.scripts['frontron:dev']).toContain('--dev-app')
    expect(refreshedPackageJson.scripts['frontron:dev:electron']).toBeUndefined()
  })

  test('init --dry-run --force reports manifest-owned files as overwrites', async () => {
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
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')

    const output = fixtures.createOutput()
    const dryRunExitCode = await runCli(['init', '--dry-run', '--force'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(dryRunExitCode).toBe(0)
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(combined).toContain('Files to overwrite:')
    expect(combined).toContain('~ electron/main.ts')
    expect(combined).toContain('~ .frontron/manifest.json')
    expect(combined).toContain('~ scripts.frontron:dev')
    expect(combined).not.toContain('Existing file will not be overwritten automatically: electron/main.ts')
  })

  test('init does not duplicate required packages already listed in dependencies', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
      {
        dev: 'vite',
        build: 'vite build',
      },
      {
        dependencies: {
          electron: '^40.0.0',
          'electron-builder': '^26.0.0',
          typescript: '^5.0.0',
          '@types/node': '^24.0.0',
        },
      },
    )
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes', '--out-dir', 'dist'], output, {
      cwd: projectRoot,
    })
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(exitCode).toBe(0)
    expect(packageJson.dependencies.electron).toBe('^40.0.0')
    expect(packageJson.devDependencies?.electron).toBeUndefined()
    expect(packageJson.devDependencies?.['electron-builder']).toBeUndefined()
    expect(packageJson.devDependencies?.typescript).toBeUndefined()
    expect(packageJson.devDependencies?.['@types/node']).toBeUndefined()
  })
})
