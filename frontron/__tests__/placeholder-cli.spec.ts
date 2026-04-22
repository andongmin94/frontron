import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { runCli, type CliContext } from '../src/cli'

function createOutput() {
  return {
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  }
}

function createTempProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'frontron-init-'))

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
        devDependencies: {
          vite: '^8.0.1',
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(projectRoot, 'vite.config.ts'),
    `export default {
  build: {
    outDir: 'dist-web'
  }
}
`,
  )

  return projectRoot
}

function createTempProjectWithScripts(
  scripts: Record<string, string>,
  options?: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    extraFiles?: Record<string, string>
    viteConfigSource?: string
  },
) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'frontron-init-'))

  writeFileSync(
    join(projectRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'sample-web-app',
        version: '0.0.1',
        scripts,
        dependencies: options?.dependencies ?? {},
        devDependencies: options?.devDependencies ?? {
          vite: '^8.0.1',
        },
      },
      null,
      2,
    )}\n`,
  )

  if (options?.viteConfigSource) {
    writeFileSync(join(projectRoot, 'vite.config.ts'), options.viteConfigSource)
  }

  for (const [filePath, source] of Object.entries(options?.extraFiles ?? {})) {
    writeFileSync(join(projectRoot, filePath), source)
  }

  return projectRoot
}

function createPromptAnswers(answers: string[], confirms: boolean[] = []): CliContext['prompter'] {
  let textIndex = 0
  let confirmIndex = 0

  return {
    async text(_message, defaultValue) {
      return answers[textIndex++] ?? defaultValue
    },
    async confirm(_message, defaultValue) {
      return confirms[confirmIndex++] ?? defaultValue
    },
    close() {},
  }
}

function expectEmbeddedString(source: string, name: string, value: string) {
  expect(source).toContain(
    `const ${name} = readEmbeddedJson<string>(${JSON.stringify(JSON.stringify(value))})`,
  )
}

function expectEmbeddedNullableString(source: string, name: string, value: string | null) {
  expect(source).toContain(
    `const ${name} = readEmbeddedJson<string | null>(${JSON.stringify(JSON.stringify(value))})`,
  )
}

function expectEmbeddedRuntimeStrategy(
  source: string,
  value: 'static-export' | 'node-server',
) {
  expect(source).toContain(
    `const RUNTIME_STRATEGY = readEmbeddedJson<'static-export' | 'node-server'>(${JSON.stringify(JSON.stringify(value))})`,
  )
}

const tempDirs: string[] = []

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('frontron CLI', () => {
  test('prints init-focused help when no command is given', async () => {
    const output = createOutput()

    const exitCode = await runCli([], output)
    const combined = output.info.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(combined).toContain('Usage: frontron init [options]')
    expect(combined).toContain('frontron init')
    expect(combined).toContain('npm create frontron@latest')
    expect(combined).toContain('app-owned')
    expect(combined).toContain(
      '--adapter <generic-static|next-export|next-standalone|nuxt-node-server|remix-node-server|sveltekit-static|sveltekit-node|generic-node-server>',
    )
    expect(combined).toContain('--server-root <path>')
    expect(combined).toContain('--server-entry <path>')
  })

  test('init seeds the minimal Electron layer with defaults', async () => {
    const projectRoot = createTempProject()
    tempDirs.push(projectRoot)
    const output = createOutput()

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
    expectEmbeddedString(serveSource, 'WEB_DEV_SCRIPT', 'dev')
    expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:5180')
    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'dist-web')
    expect(serveSource).toContain(
      "createRequire(import.meta.url)",
    )
    expect(serveSource).toContain(
      `JSON.stringify({ type: 'module' }, null, 2)`,
    )
    expect(readFileSync(join(projectRoot, 'tsconfig.electron.json'), 'utf8')).toContain('"rootDir": "./electron"')
    expect(readFileSync(join(projectRoot, 'tsconfig.electron.json'), 'utf8')).toContain('"module": "ESNext"')

    expect(packageJson.scripts.app).toBe('tsc -p tsconfig.electron.json && node dist-electron/serve.js --dev-app')
    expect(packageJson.scripts['app:build']).toContain('vite build')
    expect(packageJson.scripts['app:build']).toContain('electron-builder')
    expect(packageJson.build.appId).toBe('com.local.sample-web-app')
    expect(packageJson.build.productName).toBe('Sample Web App')
    expect(packageJson.build.files).toContain('dist-web{,/**/*}')
    expect(packageJson.build.files).toContain('dist-electron{,/**/*}')
    expect(packageJson.build.extraMetadata.main).toBe('dist-electron/main.js')
    expect(packageJson.devDependencies.electron).toBeTruthy()
    expect(packageJson.devDependencies['electron-builder']).toBeTruthy()
    expect(packageJson.devDependencies.typescript).toBeTruthy()
  })

  test('init respects interactive custom directory and script names', async () => {
    const projectRoot = createTempProject()
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init'], output, {
      cwd: projectRoot,
      prompter: createPromptAnswers([
        'dev',
        'build',
        'apps/electron',
        'desktop',
        'desktop:build',
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
    expect(packageJson.build.appId).toBe('com.example.sample')
    expect(packageJson.build.productName).toBe('Sample Desktop')
  })

  test('init supports the starter-like preset and adds the preload bridge files', async () => {
    const projectRoot = createTempProject()
    tempDirs.push(projectRoot)
    const output = createOutput()

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
    const projectRoot = createTempProjectWithScripts({
      dev: 'vite',
      build: 'vite build',
      app: 'already-used',
      'app:build': 'already-used-too',
    })
    tempDirs.push(projectRoot)
    const output = createOutput()
    const prompter = createPromptAnswers([
      'dev',
      'build',
      'electron',
      'app',
      'desktop:app',
      'app:build',
      'desktop:build',
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
    expect(packageJson.scripts['desktop:build']).toContain('electron-builder')
  })

  test('init infers Vite-family script names and outDir from the selected build script', async () => {
    const projectRoot = createTempProjectWithScripts({
      'web:dev': 'vite --host 0.0.0.0 --port 4200',
      'web:build': 'vite build --outDir build/client',
    })
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      build: {
        files: string[]
      }
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')

    expectEmbeddedString(serveSource, 'WEB_DEV_SCRIPT', 'web:dev')
    expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:4200')
    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'build/client')
    expect(packageJson.build.files).toContain('build/client{,/**/*}')
  })

  test('init auto-detects Next.js static export projects and composes the desktop build command', async () => {
    const projectRoot = createTempProjectWithScripts(
      {
        dev: 'next dev --hostname 127.0.0.1 --port 3300',
        build: 'next build',
        export: 'next export -o static-out',
      },
      {
        dependencies: {
          next: '^16.0.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
      },
    )
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      build: {
        files: string[]
      }
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    const combined = output.info.mock.calls.flat().join('\n')

    expectEmbeddedString(serveSource, 'WEB_DEV_SCRIPT', 'dev')
    expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:3300')
    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'static-out')
    expect(packageJson.scripts['app:build']).toContain('next build && next export -o static-out')
    expect(packageJson.build.files).toContain('static-out{,/**/*}')
    expect(combined).toContain('- adapter: next-export')
  })

  test('init detects next.config export mode and falls back to the default out directory', async () => {
    const projectRoot = createTempProjectWithScripts(
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
  output: 'export',
}
`,
        },
      },
    )
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      build: {
        files: string[]
      }
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    const combined = output.info.mock.calls.flat().join('\n')

    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'out')
    expect(packageJson.scripts['app:build']).toContain('next build')
    expect(packageJson.build.files).toContain('out{,/**/*}')
    expect(combined).toContain('- adapter: next-export')
  })

  test('init detects Next.js standalone output and stages a packaged node-server runtime', async () => {
    const projectRoot = createTempProjectWithScripts(
      {
        dev: 'next dev --port 3400',
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
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      build: {
        files: string[]
        asarUnpack: string[]
      }
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    const combined = output.info.mock.calls.flat().join('\n')

    expectEmbeddedRuntimeStrategy(serveSource, 'node-server')
    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/next-standalone')
    expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', '.next/standalone')
    expect(serveSource).toContain("ELECTRON_RUN_AS_NODE: '1'")
    expect(serveSource).toContain('Node server entry not found')
    expect(packageJson.scripts['app:build']).toContain('next build')
    expect(packageJson.build.files).toContain('.frontron/runtime/next-standalone{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/next-standalone{,/**/*}')
    expect(combined).toContain('- adapter: next-standalone')
    expect(combined).toContain('- runtime strategy: node-server')
    expect(combined).toContain('- server runtime root: .next/standalone')
    expect(combined).toContain('- server entry: server.js')
  })

  test('init auto-detects Nuxt node-server projects', async () => {
    const projectRoot = createTempProjectWithScripts(
      {
        dev: 'nuxt dev --host 127.0.0.1 --port 3500',
        build: 'nuxt build',
      },
      {
        dependencies: {
          nuxt: '^4.0.0',
        },
        extraFiles: {
          'nuxt.config.ts': `export default defineNuxtConfig({})
`,
        },
      },
    )
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      build: {
        files: string[]
        asarUnpack: string[]
      }
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    const combined = output.info.mock.calls.flat().join('\n')

    expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:3500')
    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/nuxt-node-server')
    expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', '.output')
    expectEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY', 'server/index.mjs')
    expect(packageJson.build.files).toContain('.frontron/runtime/nuxt-node-server{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/nuxt-node-server{,/**/*}')
    expect(combined).toContain('- adapter: nuxt-node-server')
    expect(combined).toContain('- server runtime root: .output')
    expect(combined).toContain('- server entry: server/index.mjs')
  })

  test('init auto-detects Remix node-server projects', async () => {
    const projectRoot = createTempProjectWithScripts(
      {
        dev: 'remix dev --host 127.0.0.1 --port 8002',
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
          'remix.config.js': `module.exports = {}
`,
        },
      },
    )
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      build: {
        files: string[]
        asarUnpack: string[]
      }
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    const combined = output.info.mock.calls.flat().join('\n')

    expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:8002')
    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/remix-node-server')
    expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', 'build')
    expectEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY', 'server/index.js')
    expect(packageJson.build.files).toContain('.frontron/runtime/remix-node-server{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/remix-node-server{,/**/*}')
    expect(combined).toContain('- adapter: remix-node-server')
    expect(combined).toContain('- server runtime root: build')
    expect(combined).toContain('- server entry: server/index.js')
  })

  test('init auto-detects SvelteKit static projects', async () => {
    const projectRoot = createTempProjectWithScripts(
      {
        dev: 'vite --host 127.0.0.1 --port 4173',
        build: 'vite build',
      },
      {
        devDependencies: {
          vite: '^8.0.1',
          '@sveltejs/kit': '^2.0.0',
          '@sveltejs/adapter-static': '^3.0.0',
        },
        extraFiles: {
          'svelte.config.js': `import adapter from '@sveltejs/adapter-static'

export default {
  kit: {
    adapter: adapter(),
  },
}
`,
        },
      },
    )
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      build: {
        files: string[]
      }
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    const combined = output.info.mock.calls.flat().join('\n')

    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'build')
    expect(packageJson.build.files).toContain('build{,/**/*}')
    expect(combined).toContain('- adapter: sveltekit-static')
    expect(combined).toContain('- runtime strategy: static-export')
  })

  test('init auto-detects SvelteKit node adapter projects', async () => {
    const projectRoot = createTempProjectWithScripts(
      {
        dev: 'vite --host 127.0.0.1 --port 4173',
        build: 'vite build',
      },
      {
        devDependencies: {
          vite: '^8.0.1',
          '@sveltejs/kit': '^2.0.0',
          '@sveltejs/adapter-node': '^5.0.0',
        },
        extraFiles: {
          'svelte.config.js': `import adapter from '@sveltejs/adapter-node'

export default {
  kit: {
    adapter: adapter(),
  },
}
`,
        },
      },
    )
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init', '--yes'], output, {
      cwd: projectRoot,
    })

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      build: {
        files: string[]
        asarUnpack: string[]
      }
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    const combined = output.info.mock.calls.flat().join('\n')

    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/sveltekit-node')
    expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', 'build')
    expectEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY', 'index.js')
    expect(packageJson.build.files).toContain('.frontron/runtime/sveltekit-node{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/sveltekit-node{,/**/*}')
    expect(combined).toContain('- adapter: sveltekit-node')
    expect(combined).toContain('- server entry: index.js')
  })

  test('init supports a manual generic node-server adapter', async () => {
    const projectRoot = createTempProjectWithScripts({
      dev: 'node server/dev.js',
      build: 'node scripts/build.js',
    })
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(
      [
        'init',
        '--yes',
        '--adapter',
        'generic-node-server',
        '--web-dev',
        'dev',
        '--web-build',
        'build',
        '--out-dir',
        '.frontron/runtime/custom-node-server',
        '--server-root',
        'build',
        '--server-entry',
        'server/index.js',
      ],
      output,
      {
        cwd: projectRoot,
      },
    )

    expect(exitCode).toBe(0)

    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      build: {
        files: string[]
        asarUnpack: string[]
      }
    }
    const serveSource = readFileSync(join(projectRoot, 'electron', 'serve.ts'), 'utf8')
    const combined = output.info.mock.calls.flat().join('\n')

    expectEmbeddedRuntimeStrategy(serveSource, 'node-server')
    expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/custom-node-server')
    expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', 'build')
    expectEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY', 'server/index.js')
    expect(packageJson.build.files).toContain('.frontron/runtime/custom-node-server{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/custom-node-server{,/**/*}')
    expect(combined).toContain('- adapter: generic-node-server')
    expect(combined).toContain('- server runtime root: build')
    expect(combined).toContain('- server entry: server/index.js')
  })

  test('init requires node-server metadata for the generic adapter in --yes mode', async () => {
    const projectRoot = createTempProjectWithScripts({
      dev: 'node server/dev.js',
      build: 'node scripts/build.js',
    })
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(['init', '--yes', '--adapter', 'generic-node-server'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('Unable to infer the node server runtime root')
  })

  test('init requires an explicit output directory when it cannot infer a non-Vite build output in --yes mode', async () => {
    const projectRoot = createTempProjectWithScripts({
      'web:dev': 'next dev --port 3000',
      'web:build': 'webpack --output-path dist-web',
    })
    tempDirs.push(projectRoot)
    const output = createOutput()

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
    const projectRoot = createTempProject()
    tempDirs.push(projectRoot)
    const output = createOutput()

    const exitCode = await runCli(
      ['init', '--yes', '--app-script', 'desktop', '--build-script', 'desktop'],
      output,
      { cwd: projectRoot },
    )
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('already exists')
  })

  test('init fails when the chosen desktop script names already exist', async () => {
    const projectRoot = createTempProject()
    tempDirs.push(projectRoot)
    const output = createOutput()

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

    const exitCode = await runCli(['init', '--yes'], output, { cwd: projectRoot })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('already exists')
  })

  test('init keeps the root package type and emits an ESM Electron runtime', async () => {
    const projectRoot = createTempProjectWithScripts({
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
    tempDirs.push(projectRoot)
    const output = createOutput()

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
    const projectRoot = createTempProject()
    tempDirs.push(projectRoot)
    const output = createOutput()

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
    expect(combined).toContain('build.extraMetadata.main already exists')
  })
})
