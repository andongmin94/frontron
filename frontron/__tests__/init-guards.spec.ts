import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { applyInitChanges } from '../src/init/apply'
import { MANIFEST_PATH } from '../src/init/manifest'
import type { InitPlan } from '../src/init/plan'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron init guardrails', () => {
  test.each([
    [
      'Electron source directory',
      ['--desktop-dir', '../outside-electron'],
      'Electron source directory must not contain ".." path segments.',
    ],
    [
      'frontend output directory',
      ['--out-dir', '../outside-dist'],
      'Frontend build output directory must not contain ".." path segments.',
    ],
    [
      'node server runtime root',
      [
        '--adapter',
        'generic-node-server',
        '--out-dir',
        '.frontron/runtime/node-server',
        '--server-root',
        '../server',
        '--server-entry',
        'index.mjs',
      ],
      'Node server runtime root must not contain ".." path segments.',
    ],
    [
      'node server entry',
      [
        '--adapter',
        'generic-node-server',
        '--out-dir',
        '.frontron/runtime/node-server',
        '--server-root',
        'server',
        '--server-entry',
        '../index.mjs',
      ],
      'Node server entry must not contain ".." path segments.',
    ],
  ])('init rejects project-escaping %s', async (_label, args, expectedMessage) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes', ...args], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain(expectedMessage)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
  })

  test('init allows a project directory name that starts with two dots', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes', '--desktop-dir', '..foo/electron'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)
    expect(existsSync(join(projectRoot, '..foo', 'electron', 'main.ts'))).toBe(true)
  })

  test('init planning blocks a desktop directory whose parent is a symbolic link or junction', async () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    const linkedDesktopDir = join(projectRoot, 'linked-electron')

    symlinkSync(outsideRoot, linkedDesktopDir, process.platform === 'win32' ? 'junction' : 'dir')

    const output = fixtures.createOutput()
    const exitCode = await runCli(
      ['init', '--dry-run', '--desktop-dir', 'linked-electron'],
      output,
      { cwd: projectRoot },
    )
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('symbolic link or junction')
    expect(existsSync(join(outsideRoot, 'main.ts'))).toBe(false)
    expect(existsSync(join(projectRoot, MANIFEST_PATH))).toBe(false)
  })

  test('init apply rechecks parent links immediately before writing', () => {
    const projectRoot = fixtures.createTempProject()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot, outsideRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')
    const linkedDesktopDir = join(projectRoot, 'electron')

    symlinkSync(outsideRoot, linkedDesktopDir, process.platform === 'win32' ? 'junction' : 'dir')

    const plan = {
      config: { cwd: projectRoot },
      packageJsonPlan: { packageJson: { name: 'sample-web-app' } },
      files: [
        {
          path: join(linkedDesktopDir, 'main.ts'),
          action: 'create',
          reason: 'test generated file',
          content: 'generated\n',
        },
      ],
      warnings: [],
      blockers: [],
    } as unknown as InitPlan

    expect(() => applyInitChanges(packageJsonPath, plan)).toThrow('symbolic link or junction')
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(outsideRoot, 'main.ts'))).toBe(false)
  })

  test('init rolls back written files and applies the manifest only after patches succeed', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonBefore = readFileSync(packageJsonPath, 'utf8')
    const generatedPath = join(projectRoot, 'electron', 'main.ts')
    const manifestPath = join(projectRoot, MANIFEST_PATH)
    const plan = {
      config: {
        cwd: projectRoot,
      },
      packageJsonPlan: { packageJson: { name: 'sample-web-app' } },
      tsconfigJsonPlan: {
        path: join(projectRoot, 'electron'),
        tsconfigJson: {},
        changes: [{ action: 'add', path: 'exclude', value: 'electron' }],
        ownershipClaims: [],
        warnings: [],
        blockers: [],
      },
      files: [
        {
          path: generatedPath,
          action: 'create',
          reason: 'test generated file',
          content: 'generated\n',
        },
        {
          path: manifestPath,
          action: 'create',
          reason: 'test manifest',
          content: '{"createdFiles":[],"scripts":[]}\n',
        },
      ],
      warnings: [],
      blockers: [],
    } as unknown as InitPlan

    expect(() => applyInitChanges(packageJsonPath, plan)).toThrow('Written files were rolled back')

    expect(readFileSync(packageJsonPath, 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(generatedPath)).toBe(false)
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
    expect(existsSync(manifestPath)).toBe(false)
  })

  test('init requires an explicit output directory when it cannot infer a non-Vite build output in --yes mode', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts({
      'web:dev': 'next dev --port 3000',
      'web:build': 'webpack --output-path dist-web',
    })
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(
      ['init', '--yes', '--web-dev', 'web:dev', '--web-build', 'web:build'],
      output,
      {
        cwd: projectRoot,
      },
    )
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('Unable to infer the frontend build output')
  })

  test('init fails when desktop app and build script names resolve to the same value', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(
      ['init', '--yes', '--app-script', 'desktop', '--build-script', 'desktop'],
      output,
      { cwd: projectRoot },
    )
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('already exists')
  })

  test('init fails when an explicitly chosen desktop script name already exists', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    writeFileSync(
      join(projectRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'sample-web-app',
          version: '0.0.1',
          scripts: {
            dev: 'vite',
            build: 'vite build',
            app: 'already-used',
          },
        },
        null,
        2,
      )}\n`,
    )

    const exitCode = await runCli(['init', '--yes', '--app-script', 'app'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('already exists')
  })

  test('init rejects unsafe generated desktop script names before writing files', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes', '--app-script', 'desktop dev'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('Script name "desktop dev" is invalid')
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
    expect(existsSync(join(projectRoot, '.frontron', 'manifest.json'))).toBe(false)
  })

  test('init keeps the root package type and emits an ESM Electron runtime', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
      {
        dev: 'vite --port 5180',
        build: 'vite build',
      },
      {
        viteConfigSource: `export default {
  build: {
    outDir: 'dist-web'
  }
}
`,
      },
    )
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    writeFileSync(
      join(projectRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'sample-web-app',
          version: '0.0.1',
          type: 'module',
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

    const exitCode = await runCli(['init', '--yes'], output, { cwd: projectRoot })
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      type?: string
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    const tsconfigElectron = readFileSync(join(projectRoot, 'tsconfig.electron.json'), 'utf8')

    expect(exitCode).toBe(0)
    expect(packageJson.type).toBe('module')
    expect(serveSource).toContain('const runtimeDir = path.dirname(fileURLToPath(import.meta.url))')
    expect(serveSource).toContain(`JSON.stringify({ type: 'module' }, null, 2)`)
    expect(tsconfigElectron).toContain('"module": "NodeNext"')
    expect(tsconfigElectron).toContain('"moduleResolution": "NodeNext"')
  })

  test('init aborts instead of silently replacing an existing build.extraMetadata.main in --yes mode', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    writeFileSync(
      join(projectRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'sample-web-app',
          version: '0.0.1',
          scripts: {
            dev: 'vite --port 5180',
            build: 'vite build',
          },
          build: {
            extraMetadata: {
              main: 'existing/main.js',
            },
          },
          devDependencies: {
            vite: '^8.0.1',
          },
        },
        null,
        2,
      )}\n`,
    )

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('package.json cannot be patched')
    expect(combined).toContain('Existing build.extraMetadata.main will not be overwritten')
  })

  test('init aborts instead of silently replacing a non-object build field', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    writeFileSync(
      join(projectRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'sample-web-app',
          version: '0.0.1',
          scripts: {
            dev: 'vite --port 5180',
            build: 'vite build',
          },
          build: 'legacy-builder-config',
          devDependencies: {
            vite: '^8.0.1',
          },
        },
        null,
        2,
      )}\n`,
    )
    const packageJsonBefore = readFileSync(join(projectRoot, 'package.json'), 'utf8')

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
    expect(combined).toContain('package.json cannot be patched')
    expect(combined).toContain('build must be an object')
  })

  test('init --dry-run reports invalid package build fields as blockers without writing', async () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    writeFileSync(
      join(projectRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'sample-web-app',
          version: '0.0.1',
          scripts: {
            dev: 'vite',
            build: 'vite build',
          },
          build: {
            files: 'dist/**',
          },
        },
        null,
        2,
      )}\n`,
    )
    const packageJsonBefore = readFileSync(join(projectRoot, 'package.json'), 'utf8')

    const exitCode = await runCli(['init', '--dry-run', '--out-dir', 'dist'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(packageJsonBefore)
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
    expect(combined).toContain('Blockers:')
    expect(combined).toContain('build.files must be an array of strings')
  })

  test('init --dry-run discards partial package preview when package patching is blocked', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
      {
        dev: 'next dev --port 3000',
        build: 'next build',
      },
      {
        dependencies: {
          next: '^16.0.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        extraFiles: {
          'next.config.ts': `export default {
  output: 'standalone',
}
`,
        },
      },
    )
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    writeFileSync(
      join(projectRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'sample-web-app',
          version: '0.0.1',
          scripts: {
            dev: 'next dev --port 3000',
            build: 'next build',
          },
          dependencies: {
            next: '^16.0.0',
            react: '^19.0.0',
            'react-dom': '^19.0.0',
          },
          build: {
            asarUnpack: '.next/standalone/**',
          },
        },
        null,
        2,
      )}\n`,
    )
    const packageJsonBefore = readFileSync(join(projectRoot, 'package.json'), 'utf8')

    const exitCode = await runCli(['init', '--dry-run'], output, {
      cwd: projectRoot,
    })
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(readFileSync(join(projectRoot, 'package.json'), 'utf8')).toBe(packageJsonBefore)
    expect(combined).toContain('Blockers:')
    expect(combined).toContain('build.asarUnpack must be an array of strings')
    expect(combined).toContain('package.json changes:\n  (none)')
  })
})
