import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import { applyInitChanges } from '../src/init/apply'
import { createFileHash, MANIFEST_PATH } from '../src/init/manifest'
import { createInitPlan, type InitPlan } from '../src/init/plan'
import { loadCreateFrontronTemplate } from '../src/init/runtime/create-frontron-template'
import type { InitConfig, PackageJson } from '../src/init/shared'
import * as fixtures from './helpers/frontron-cli-fixtures'

// createTemplateFixture 함수는 현재 frontron 버전과 일치하는 독립 템플릿 복사본을 만든다.
function createTemplateFixture() {
  const projectRoot = fixtures.createTempProject()
  const packageRoot = join(projectRoot, 'create-frontron-fixture')
  const templateDir = join(packageRoot, 'template')
  const frontronPackageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }

  fixtures.tempDirs.push(projectRoot)
  mkdirSync(packageRoot)
  cpSync(new URL('../../create-frontron/template', import.meta.url), templateDir, {
    recursive: true,
  })
  writeFileSync(
    join(packageRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'create-frontron',
        version: frontronPackageJson.version,
      },
      null,
      2,
    )}\n`,
  )

  return { packageRoot, projectRoot, templateDir }
}

// withTemplateFixture 함수는 환경 변수 템플릿을 한 검사 동안만 활성화하고 원래 값을 복원한다.
function withTemplateFixture<T>(templateDir: string, run: () => T) {
  const previousTemplateDir = process.env.FRONTRON_CREATE_TEMPLATE_DIR
  process.env.FRONTRON_CREATE_TEMPLATE_DIR = templateDir

  try {
    return run()
  } finally {
    if (typeof previousTemplateDir === 'undefined') {
      delete process.env.FRONTRON_CREATE_TEMPLATE_DIR
    } else {
      process.env.FRONTRON_CREATE_TEMPLATE_DIR = previousTemplateDir
    }
  }
}

describe('frontron init guardrails', () => {
  test.each([
    ['package.json', 'directory', 'must be a regular file; found a directory'],
    ['src/electron/main.ts', 'hard-link', 'must have exactly one hard link; found 2'],
    ['src/types/electron.d.ts', 'hard-link', 'must have exactly one hard link; found 2'],
  ] as const)(
    'create-frontron rejects an unsafe required template path: %s',
    (relativePath, replacement, expectedMessage) => {
      const { packageRoot, templateDir } = createTemplateFixture()
      const targetPath = join(templateDir, relativePath)

      if (replacement === 'directory') {
        unlinkSync(targetPath)
        mkdirSync(targetPath)
      } else {
        const hardLinkSource = join(
          packageRoot,
          `hard-link-source-${relativePath.replaceAll('/', '-')}`,
        )
        writeFileSync(hardLinkSource, readFileSync(targetPath))
        unlinkSync(targetPath)
        linkSync(hardLinkSource, targetPath)
      }

      expect(() => withTemplateFixture(templateDir, () => loadCreateFrontronTemplate())).toThrow(
        expectedMessage,
      )
    },
  )

  test('create-frontron rejects a linked parent of a required template file', () => {
    const { packageRoot, templateDir } = createTemplateFixture()
    const typesDir = join(templateDir, 'src', 'types')
    const linkedTypesTarget = join(packageRoot, 'linked-types-target')

    renameSync(typesDir, linkedTypesTarget)
    symlinkSync(linkedTypesTarget, typesDir, process.platform === 'win32' ? 'junction' : 'dir')

    expect(() => withTemplateFixture(templateDir, () => loadCreateFrontronTemplate())).toThrow(
      'found a symbolic link or junction',
    )
  })

  test('create-frontron rejects a symbolic link or junction in the Electron template tree', () => {
    const { templateDir } = createTemplateFixture()
    const outsideRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(outsideRoot)
    symlinkSync(
      outsideRoot,
      join(templateDir, 'src', 'electron', 'linked-tree'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    expect(() => withTemplateFixture(templateDir, () => loadCreateFrontronTemplate())).toThrow(
      'found a symbolic link or junction',
    )
  })

  test('create-frontron rejects a hard-linked optional file in the Electron template tree', () => {
    const { packageRoot, templateDir } = createTemplateFixture()
    const hardLinkSource = join(packageRoot, 'future-module-source.ts')
    writeFileSync(hardLinkSource, 'export const futureModule = true\n')
    linkSync(hardLinkSource, join(templateDir, 'src', 'electron', 'future-module.ts'))

    expect(() => withTemplateFixture(templateDir, () => loadCreateFrontronTemplate())).toThrow(
      'regular files must have exactly one hard link; found 2',
    )
  })

  test.skipIf(process.platform === 'win32')(
    'create-frontron rejects an unexpected socket in the Electron template tree',
    async () => {
      const { projectRoot, templateDir } = createTemplateFixture()
      const electronDir = join(templateDir, 'src', 'electron')
      const shortElectronDir = join(projectRoot, 'e')
      const socketPath = join(shortElectronDir, 's')
      const server = createServer()

      // macOS의 Unix socket 주소 길이 제한을 피하면서 실제 템플릿 디렉터리에 socket을 만든다.
      symlinkSync(electronDir, shortElectronDir, 'dir')

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(socketPath, resolve)
      })

      try {
        expect(() => withTemplateFixture(templateDir, () => loadCreateFrontronTemplate())).toThrow(
          'found a socket',
        )
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
      }
    },
  )

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

  test.each([
    ['the same directory', 'build/runtime', 'build/runtime'],
    ['an output directory containing the source root', 'build', 'build/server-runtime'],
    ['a source root containing the output directory', 'build/staged-runtime', 'build'],
  ])('init rejects %s before creating a plan', async (_label, outDir, serverRoot) => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(
      [
        'init',
        '--dry-run',
        '--adapter',
        'generic-node-server',
        '--out-dir',
        outDir,
        '--server-root',
        serverRoot,
        '--server-entry',
        'index.js',
      ],
      output,
      { cwd: projectRoot },
    )
    const error = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(error).toContain(
      'Frontend build output directory and node server runtime root must be separate, non-overlapping directories',
    )
    expect(output.info.mock.calls.flat().join('\n')).not.toContain('Detected:')
    expect(existsSync(join(projectRoot, MANIFEST_PATH))).toBe(false)
    expect(existsSync(join(projectRoot, 'electron'))).toBe(false)
  })

  test('init uses --server-entry as the Remix build source entry', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
      {
        dev: 'remix dev',
        build: 'remix build',
      },
      {
        dependencies: {
          '@remix-run/node': '^2.0.0',
        },
        devDependencies: {
          '@remix-run/dev': '^2.0.0',
        },
        extraFiles: {
          'remix.config.js': 'module.exports = {}\n',
        },
      },
    )
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes', '--server-entry', 'server/index.js'], output, {
      cwd: projectRoot,
    })
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')

    expect(exitCode).toBe(0)
    fixtures.expectEmbeddedNullableString(
      serveSource,
      'NODE_SERVER_SOURCE_ENTRY',
      'server/index.js',
    )
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY', 'server.cjs')
    expect(serveSource).toContain('NODE_SERVER_SOURCE_ENTRY ? [NODE_SERVER_SOURCE_ENTRY]')
    expect(existsSync(join(projectRoot, MANIFEST_PATH))).toBe(true)
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
      packageJsonExpectedHash: createFileHash(packageJsonBefore),
      files: [
        {
          path: join(linkedDesktopDir, 'main.ts'),
          action: 'create',
          reason: 'test generated file',
          content: 'generated\n',
          expectedHash: null,
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
    const tsconfigPath = join(projectRoot, 'tsconfig.json')
    writeFileSync(tsconfigPath, '{}\n')
    const plan = {
      config: {
        cwd: projectRoot,
      },
      packageJsonPlan: { packageJson: { name: 'sample-web-app' } },
      packageJsonExpectedHash: createFileHash(packageJsonBefore),
      tsconfigJsonPlan: {
        path: tsconfigPath,
        source: '{}\n',
        tsconfigJson: {},
        changes: [{ action: 'add', path: 'unsupported', value: 'electron' }],
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
          expectedHash: null,
        },
        {
          path: manifestPath,
          action: 'create',
          reason: 'test manifest',
          content: '{"createdFiles":[],"scripts":[]}\n',
          expectedHash: null,
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

  test('init rejects package.json changes made after planning', () => {
    const projectRoot = fixtures.createTempProject()
    fixtures.tempDirs.push(projectRoot)
    const packageJsonPath = join(projectRoot, 'package.json')
    const packageJsonSource = readFileSync(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonSource) as PackageJson
    const plan = createInitPlan({
      config: { cwd: projectRoot } as InitConfig,
      filesToWrite: new Map(),
      packageJsonPlan: {
        packageJson: { ...packageJson, version: '1.0.0' },
        changes: [],
        ownershipClaims: [],
        warnings: [],
        blockers: [],
      },
      packageJsonExpectedHash: createFileHash(packageJsonSource),
      warnings: [],
      blockers: [],
      blockedFiles: [],
      overwriteFiles: [],
    })

    const concurrentSource = `${packageJsonSource.trimEnd()}\n `
    writeFileSync(packageJsonPath, concurrentSource)

    expect(() => applyInitChanges(packageJsonPath, plan)).toThrow(
      'changed after the transaction plan was created',
    )
    expect(readFileSync(packageJsonPath, 'utf8')).toBe(concurrentSource)
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
