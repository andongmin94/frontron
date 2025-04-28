import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'
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
    const combined = output.info.mock.calls.flat().join('\n')

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

    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain(
      'createMainWindow',
    )
    expect(readFileSync(join(projectRoot, 'electron', 'package.json'), 'utf8')).toContain(
      '"type": "module"',
    )
    const windowSource = readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')
    expect(windowSource).toContain('BrowserWindow')
    expect(windowSource).toContain('Content-Security-Policy')
    expect(windowSource).not.toContain('unsafe-eval')
    expect(windowSource).toContain("mainWindow.webContents.on('context-menu'")
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    fixtures.expectEmbeddedString(serveSource, 'WEB_DEV_SCRIPT', 'dev')
    fixtures.expectEmbeddedString(serveSource, 'DEV_URL', 'http://localhost:5180')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'dist-web')
    expect(serveSource).toContain('function createLoopbackUrlCandidates')
    expect(serveSource).toContain('const readyDevUrl = await waitForUrlReady(DEV_URL)')
    expect(serveSource).toContain('ELECTRON_RENDERER_URL: readyDevUrl')
    expect(serveSource).toContain('createRequire(import.meta.url)')
    expect(serveSource).toContain(`JSON.stringify({ type: 'module' }, null, 2)`)
    expect(readFileSync(join(projectRoot, 'tsconfig.electron.json'), 'utf8')).toContain(
      '"rootDir": "./electron"',
    )
    expect(readFileSync(join(projectRoot, 'tsconfig.electron.json'), 'utf8')).toContain(
      '"module": "NodeNext"',
    )
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      adapter: string
      adapterConfidence: string
      adapterReasons: string[]
      strategy: string
      templateSource?: string
      templatePackage?: string
      templateVersion?: string | null
      templateResolvedFrom?: string
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

    expect(packageJson.scripts['frontron:dev']).toContain('tsc -p tsconfig.electron.json')
    expect(packageJson.scripts['frontron:dev']).toContain('dist-electron/package.json')
    expect(packageJson.scripts['frontron:dev']).toContain(
      'node --no-deprecation dist-electron/serve.js --dev-app',
    )
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
    expect(combined).toContain('Next steps:')
    expect(combined).toContain('- Electron template: frontron minimal')
    expect(combined).toContain('1. Run "npm install" to install the new desktop dependencies.')
    expect(combined).toContain('2. Run "npm run frontron:dev" to start the desktop app.')
    expect(combined).toContain('   The dev runner waits for http://localhost:5180.')
    expect(combined).toContain('3. Run "npm run frontron:build" to prepare the desktop build.')
    expect(combined).toContain(
      '4. Run "npm run frontron:package" to create a packaged build when you are ready to distribute.',
    )
    expect(manifest.adapter).toBe('generic-static')
    expect(manifest.adapterConfidence).toBe('high')
    expect(manifest.adapterReasons).toContain('vite dependency found.')
    expect(manifest.adapterReasons).toContain('vite config file found.')
    expect(manifest.adapterReasons).toContain('package.json has a Vite build script.')
    expect(manifest.strategy).toBe('static-export')
    expect(manifest.templateSource).toBe('frontron:minimal')
    expect(manifest.templatePackage).toBeUndefined()
    expect(manifest.templateVersion).toBeUndefined()
    expect(manifest.templateResolvedFrom).toBeUndefined()
    expect(manifest.createdFiles).toContain('electron/main.ts')
    expect(manifest.createdFiles).toContain('electron/package.json')
    expect(manifest.createdFiles).toContain('tsconfig.electron.json')
    expect(manifest.createdFiles).toContain('.frontron/manifest.json')
    expect(manifest.fileHashes['electron/main.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.fileHashes['.frontron/manifest.json']).toBeUndefined()
    expect(manifest.scripts).toEqual(['frontron:dev', 'frontron:build', 'frontron:package'])
    expect(manifest.scriptCommands['frontron:dev']).toBe(packageJson.scripts['frontron:dev'])
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

  test.each([
    ['pnpm', 'pnpm-lock.yaml', 'pnpm install', 'pnpm run frontron:dev'],
    ['yarn', 'yarn.lock', 'yarn install', 'yarn frontron:dev'],
    ['bun', 'bun.lock', 'bun install', 'bun run frontron:dev'],
  ])(
    'init prints copyable %s commands from the project lockfile',
    async (_name, lockfile, installCommand, devCommand) => {
      const projectRoot = fixtures.createTempProject()
      fixtures.tempDirs.push(projectRoot)
      writeFileSync(join(projectRoot, lockfile), '')
      const output = fixtures.createOutput()

      const exitCode = await runCli(['init', '--yes'], output, {
        cwd: projectRoot,
      })
      const combined = output.info.mock.calls.flat().join('\n')

      expect(exitCode).toBe(0)
      expect(combined).toContain(
        `1. Run "${installCommand}" to install the new desktop dependencies.`,
      )
      expect(combined).toContain(`2. Run "${devCommand}" to start the desktop app.`)
    },
  )

  test('init prints copyable commands from package.json packageManager', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      packageManager?: string
    }

    packageJson.packageManager = 'pnpm@10.0.0'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(combined).toContain('1. Run "pnpm install" to install the new desktop dependencies.')
    expect(combined).toContain('2. Run "pnpm run frontron:dev" to start the desktop app.')
  })

  test('init pre-approves Electron install builds for pnpm workspaces', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      packageManager?: string
    }

    packageJson.packageManager = 'pnpm@11.1.2'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    writeFileSync(
      join(projectRoot, 'pnpm-workspace.yaml'),
      `packages:
  - apps/*

allowBuilds:
  esbuild: false
  electron: set this to true or false
`,
    )
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)
    const pnpmWorkspaceSource = readFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'utf8')
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      pnpmWorkspaceClaims?: Array<{
        path: string
        value: unknown
      }>
    }

    expect(pnpmWorkspaceSource).toContain('  esbuild: false')
    expect(pnpmWorkspaceSource).toContain('  electron: true')
    expect(pnpmWorkspaceSource).toContain('  electron-winstaller: true')
    expect(manifest.pnpmWorkspaceClaims).toContainEqual(
      expect.objectContaining({
        path: 'allowBuilds.electron',
        value: true,
      }),
    )
    expect(manifest.pnpmWorkspaceClaims).toContainEqual(
      expect.objectContaining({
        path: 'allowBuilds.electron-winstaller',
        value: true,
      }),
    )
  })

  test('init updates the existing pnpm workspace file from a nested package', async () => {
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

    const exitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: appRoot,
    })
    const workspaceSource = readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8')

    expect(exitCode).toBe(0)
    expect(workspaceSource).toContain('allowBuilds:')
    expect(workspaceSource).toContain('  electron: true')
    expect(workspaceSource).toContain('  electron-winstaller: true')
    expect(existsSync(join(appRoot, 'pnpm-workspace.yaml'))).toBe(false)
  })

  test('generated Electron runtime type-checks under a Next-style ES5 project target', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)

    const exitCode = await runCli(['init', '--yes'], fixtures.createOutput(), {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const servePath = join(projectRoot, 'electron', 'serve.ts')
    const program = ts.createProgram([servePath], {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      lib: ['lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.esnext.d.ts'],
      types: ['node'],
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)

    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      ),
    ).toEqual([])
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
    expect(combined).toContain('Confidence: high')
    expect(combined).toContain('vite dependency found.')
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
    expect(combined).toContain(
      'Existing file will not be overwritten automatically: tsconfig.electron.json',
    )
    expect(combined).not.toContain(
      'Warnings:\n  - Existing file will not be overwritten automatically',
    )
  })

  test('init accepts --option=value for value-based CLI options', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(
      [
        'init',
        '--yes',
        '--desktop-dir=desktop-shell',
        '--out-dir=dist-web',
        '--app-script=desktop:dev',
        '--build-script=desktop:build',
        '--package-script=desktop:package',
        '--product-name=Sample Desktop',
        '--app-id=com.example.sample-desktop',
      ],
      output,
      {
        cwd: projectRoot,
      },
    )
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      build: {
        appId: string
        productName: string
        files: string[]
      }
    }

    expect(exitCode).toBe(0)
    expect(existsSync(join(projectRoot, 'desktop-shell', 'main.ts'))).toBe(true)
    expect(packageJson.scripts['desktop:dev']).toContain('dist-electron/serve.js')
    expect(packageJson.build.files).toContain('dist-web{,/**/*}')
    expect(packageJson.build.productName).toBe('Sample Desktop')
    expect(packageJson.build.appId).toBe('com.example.sample-desktop')
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

    expect(readFileSync(join(projectRoot, 'apps', 'electron', 'main.ts'), 'utf8')).toContain(
      'createMainWindow',
    )
    expect(packageJson.scripts.desktop).toContain('tsc -p tsconfig.electron.json')
    expect(packageJson.scripts.desktop).toContain('dist-electron/package.json')
    expect(packageJson.scripts.desktop).toContain(
      'node --no-deprecation dist-electron/serve.js --dev-app',
    )
    expect(packageJson.scripts['desktop:build']).toContain('vite build')
    expect(packageJson.scripts['desktop:build']).not.toContain('electron-builder')
    expect(packageJson.scripts['desktop:package']).toContain('electron-builder')
    expect(packageJson.build.appId).toBe('com.example.sample')
    expect(packageJson.build.productName).toBe('Sample Desktop')
  })

  test('init supports the starter-like preset from the create-frontron Electron template', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes', '--preset', 'starter-like'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)
    const combined = output.info.mock.calls.flat().join('\n')
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      build: {
        files: string[]
      }
    }
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.frontron', 'manifest.json'), 'utf8'),
    ) as {
      templateSource?: string
      templatePackage?: string
      templateVersion?: string | null
      templateResolvedFrom?: string
    }

    expect(combined).toContain('- Electron template: create-frontron@')
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain('createSplash')
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain('createTray')
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain(
      'setupIpcHandlers',
    )
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain('setupDevMenu')
    expect(readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')).toContain(
      'preload: preloadPath',
    )
    expect(readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')).toContain(
      '../public/icon.ico',
    )
    expect(readFileSync(join(projectRoot, 'electron', 'window.ts'), 'utf8')).toContain(
      'Preload bridge is unavailable',
    )
    expect(readFileSync(join(projectRoot, 'electron', 'preload.ts'), 'utf8')).toContain(
      'contextBridge.exposeInMainWorld("electron"',
    )
    expect(readFileSync(join(projectRoot, 'electron', 'ipc.ts'), 'utf8')).toContain(
      'const quitAppChannel = "app:quit"',
    )
    expect(readFileSync(join(projectRoot, 'electron', 'dev.ts'), 'utf8')).toContain('setupDevMenu')
    expect(readFileSync(join(projectRoot, 'electron', 'splash.ts'), 'utf8')).toContain(
      'createSplash',
    )
    expect(readFileSync(join(projectRoot, 'electron', 'tray.ts'), 'utf8')).toContain('createTray')
    expect(readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')).toContain(
      'export const startRendererServer = startRendererRuntime',
    )
    expect(readFileSync(join(projectRoot, 'src', 'types', 'electron.d.ts'), 'utf8')).toContain(
      'interface Window',
    )
    expect(packageJson.build.files).toContain('public{,/**/*}')
    expect(manifest.templateSource).toBe('create-frontron')
    expect(manifest.templatePackage).toBe('create-frontron')
    expect(manifest.templateVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(manifest.templateResolvedFrom).toBe('repo')
  })

  test('starter-like preset fails clearly when FRONTRON_CREATE_TEMPLATE_DIR is incomplete', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const partialTemplateDir = join(projectRoot, 'partial-template')
    const output = fixtures.createOutput()
    const previousTemplateDir = process.env.FRONTRON_CREATE_TEMPLATE_DIR

    mkdirSync(join(partialTemplateDir, 'src', 'electron'), { recursive: true })
    writeFileSync(join(partialTemplateDir, 'src', 'electron', 'main.ts'), '// incomplete\n')
    process.env.FRONTRON_CREATE_TEMPLATE_DIR = partialTemplateDir

    try {
      const exitCode = await runCli(['init', '--yes', '--preset', 'starter-like'], output, {
        cwd: projectRoot,
      })
      const combined = output.error.mock.calls.flat().join('\n')

      expect(exitCode).toBe(1)
      expect(combined).toContain(
        'FRONTRON_CREATE_TEMPLATE_DIR does not contain a complete create-frontron template',
      )
      expect(existsSync(join(projectRoot, 'electron', 'main.ts'))).toBe(false)
    } finally {
      if (typeof previousTemplateDir === 'undefined') {
        delete process.env.FRONTRON_CREATE_TEMPLATE_DIR
      } else {
        process.env.FRONTRON_CREATE_TEMPLATE_DIR = previousTemplateDir
      }
    }
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

    expect(packageJson.scripts['desktop:app']).toContain('tsc -p tsconfig.electron.json')
    expect(packageJson.scripts['desktop:app']).toContain('dist-electron/package.json')
    expect(packageJson.scripts['desktop:app']).toContain(
      'node --no-deprecation dist-electron/serve.js --dev-app',
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
    const combined = output.info.mock.calls.flat().join('\n')

    expect(combined).toContain(
      'Existing "frontron:dev" script found. Using "frontron:dev:electron" instead.',
    )
    expect(combined).toContain('2. Run "npm run frontron:dev:electron" to start the desktop app.')
    expect(combined).toContain(
      '3. Run "npm run frontron:build:electron" to prepare the desktop build.',
    )
    expect(combined).toContain(
      '4. Run "npm run frontron:package:electron" to create a packaged build when you are ready to distribute.',
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
    expect(readFileSync(join(projectRoot, 'electron', 'main.ts'), 'utf8')).toContain(
      'createMainWindow',
    )
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
    expect(combined).not.toContain(
      'Existing file will not be overwritten automatically: electron/main.ts',
    )
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
