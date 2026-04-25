import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { runCli } from '../src/cli'
import * as fixtures from './helpers/frontron-cli-fixtures'

describe('frontron adapter init flows', () => {
  test('init infers Vite-family script names and outDir from the selected build script', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts({
      'web:dev': 'vite --host 0.0.0.0 --port 4200',
      'web:build': 'vite build --outDir build/client',
    })
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

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

    fixtures.expectEmbeddedString(serveSource, 'WEB_DEV_SCRIPT', 'web:dev')
    fixtures.expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:4200')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'build/client')
    expect(packageJson.build.files).toContain('build/client{,/**/*}')
  })

  test('init auto-detects Next.js static export projects and composes the desktop build command', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
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
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

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

    fixtures.expectEmbeddedString(serveSource, 'WEB_DEV_SCRIPT', 'dev')
    fixtures.expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:3300')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'static-out')
    expect(packageJson.scripts['frontron:package']).toContain('next build && next export -o static-out')
    expect(packageJson.build.files).toContain('static-out{,/**/*}')
    expect(combined).toContain('- adapter: next-export')
  })

  test('init detects next.config export mode and falls back to the default out directory', async () => {
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
  output: 'export',
}
`,
        },
      },
    )
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

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

    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'out')
    expect(packageJson.scripts['frontron:package']).toContain('next build')
    expect(packageJson.build.files).toContain('out{,/**/*}')
    expect(combined).toContain('- adapter: next-export')
  })

  test('init detects Next.js standalone output and stages a packaged node-server runtime', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
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
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

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

    fixtures.expectEmbeddedRuntimeStrategy(serveSource, 'node-server')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/next-standalone')
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', '.next/standalone')
    expect(serveSource).toContain("ELECTRON_RUN_AS_NODE: '1'")
    expect(serveSource).toContain('Node server entry not found')
    expect(packageJson.scripts['frontron:package']).toContain('next build')
    expect(packageJson.build.files).toContain('.frontron/runtime/next-standalone{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/next-standalone{,/**/*}')
    expect(combined).toContain('- adapter: next-standalone')
    expect(combined).toContain('- adapter confidence: high')
    expect(combined).toContain('- adapter reason: next dependency found.')
    expect(combined).toContain('- adapter reason: next config declares output: standalone.')
    expect(combined).toContain('- runtime strategy: node-server')
    expect(combined).toContain('- server runtime root: .next/standalone')
    expect(combined).toContain('- server entry: server.js')
  })

  test('init auto-detects Nuxt node-server projects', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
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
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

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

    fixtures.expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:3500')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/nuxt-node-server')
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', '.output')
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY', 'server/index.mjs')
    expect(packageJson.build.files).toContain('.frontron/runtime/nuxt-node-server{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/nuxt-node-server{,/**/*}')
    expect(combined).toContain('- adapter: nuxt-node-server')
    expect(combined).toContain('- server runtime root: .output')
    expect(combined).toContain('- server entry: server/index.mjs')
  })

  test('init auto-detects Remix node-server projects', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
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
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

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

    fixtures.expectEmbeddedString(serveSource, 'DEV_URL', 'http://127.0.0.1:8002')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/remix-node-server')
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', 'build')
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY', 'server/index.js')
    expect(packageJson.build.files).toContain('.frontron/runtime/remix-node-server{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/remix-node-server{,/**/*}')
    expect(combined).toContain('- adapter: remix-node-server')
    expect(combined).toContain('- server runtime root: build')
    expect(combined).toContain('- server entry: server/index.js')
  })

  test('init auto-detects SvelteKit static projects', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
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
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

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

    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', 'build')
    expect(packageJson.build.files).toContain('build{,/**/*}')
    expect(combined).toContain('- adapter: sveltekit-static')
    expect(combined).toContain('- runtime strategy: static-export')
  })

  test('init auto-detects SvelteKit node adapter projects', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts(
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
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

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

    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/sveltekit-node')
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', 'build')
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY', 'index.js')
    expect(packageJson.build.files).toContain('.frontron/runtime/sveltekit-node{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/sveltekit-node{,/**/*}')
    expect(combined).toContain('- adapter: sveltekit-node')
    expect(combined).toContain('- server entry: index.js')
  })

  test('init supports a manual generic node-server adapter', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts({
      dev: 'node server/dev.js',
      build: 'node scripts/build.js',
    })
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

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

    fixtures.expectEmbeddedRuntimeStrategy(serveSource, 'node-server')
    fixtures.expectEmbeddedString(serveSource, 'WEB_OUT_DIR', '.frontron/runtime/custom-node-server')
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_SOURCE_ROOT', 'build')
    fixtures.expectEmbeddedNullableString(serveSource, 'NODE_SERVER_ENTRY', 'server/index.js')
    expect(packageJson.build.files).toContain('.frontron/runtime/custom-node-server{,/**/*}')
    expect(packageJson.build.asarUnpack).toContain('.frontron/runtime/custom-node-server{,/**/*}')
    expect(combined).toContain('- adapter: generic-node-server')
    expect(combined).toContain('- adapter reason: Adapter was explicitly selected with --adapter generic-node-server.')
    expect(combined).toContain('- server runtime root: build')
    expect(combined).toContain('- server entry: server/index.js')
  })

  test('init requires node-server metadata for the generic adapter in --yes mode', async () => {
    const projectRoot = fixtures.createTempProjectWithScripts({
      dev: 'node server/dev.js',
      build: 'node scripts/build.js',
    })
    fixtures.tempDirs.push(projectRoot)
    const output = fixtures.createOutput()

    const exitCode = await runCli(['init', '--yes', '--adapter', 'generic-node-server'], output, {
      cwd: projectRoot,
    })
    const combined = output.error.mock.calls.flat().join('\n')

    expect(exitCode).toBe(1)
    expect(combined).toContain('Unable to infer the node server runtime root')
  })
})
