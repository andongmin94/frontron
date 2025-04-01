import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron init guardrails', () => {
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

    const exitCode = await runCli(['init', '--yes', '--app-script', 'app'], output, { cwd: projectRoot })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('already exists')
  })

  test('init keeps the root package type and emits an ESM Electron runtime', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts({
      dev: 'vite --port 5180',
      build: 'vite build',
    }, {
      viteConfigSource: `export default {
  build: {
    outDir: 'dist-web'
  }
}
`,
    })
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
    expect(tsconfigElectron).toContain('"module": "ESNext"')
    expect(tsconfigElectron).toContain('"moduleResolution": "Bundler"')
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
