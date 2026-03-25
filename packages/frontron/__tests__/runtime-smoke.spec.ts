import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

import { loadConfig } from '../src/config'
import { runCli, stageBuildApp } from '../src/cli'
import { createFixtureProject, removeFixtureProject } from './helpers'

const fixtureDirs: string[] = []
const activeChildren: Array<ReturnType<typeof spawn>> = []
const smokeEnvKeys = [
  'FRONTRON_SMOKE_TEST',
  'FRONTRON_SMOKE_RESULT_PATH',
  'FRONTRON_SMOKE_OPEN_WINDOWS',
] as const
const previousSmokeEnv = new Map<string, string | undefined>()
const require = createRequire(import.meta.url)
const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const buildLockPath = join(packageRoot, '.test-build.lock')
let hasEnsuredBuiltRuntime = false

function sleepSync(timeoutMs: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeoutMs)
}

function withBuildLock<T>(run: () => T) {
  while (true) {
    try {
      writeFileSync(buildLockPath, String(process.pid), { flag: 'wx' })
      break
    } catch {
      sleepSync(50)
    }
  }

  try {
    return run()
  } finally {
    rmSync(buildLockPath, { force: true })
  }
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
}

async function removeFixtureProjectWithRetry(rootDir: string, timeoutMs = 5_000) {
  const startedAt = Date.now()
  let lastError: unknown

  while (Date.now() - startedAt < timeoutMs) {
    try {
      removeFixtureProject(rootDir)
      return
    } catch (error) {
      lastError = error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    }
  }

  throw lastError
}

afterEach(async () => {
  for (const child of activeChildren.splice(0)) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  for (const key of smokeEnvKeys) {
    const previousValue = previousSmokeEnv.get(key)

    if (typeof previousValue === 'undefined') {
      delete process.env[key]
    } else {
      process.env[key] = previousValue
    }
  }

  previousSmokeEnv.clear()

  for (const fixtureDir of fixtureDirs.splice(0)) {
    const serverPidPath = join(fixtureDir, '.dev-server.pid')

    if (existsSync(serverPidPath)) {
      const serverPid = Number(readFileSync(serverPidPath, 'utf8'))

      if (Number.isInteger(serverPid) && serverPid > 0) {
        try {
          process.kill(serverPid, 'SIGTERM')
        } catch {
          // The server was already terminated by the CLI runtime path.
        }

        await waitForProcessExit(serverPid)

        if (isProcessRunning(serverPid)) {
          try {
            process.kill(serverPid, 'SIGKILL')
          } catch {
            // The process may have already exited between checks.
          }

          await waitForProcessExit(serverPid)
        }
      }
    }

    await removeFixtureProjectWithRetry(fixtureDir)
  }
})

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 30_000) {
  return new Promise<{
    exitCode: number
    stderr: string
  }>((resolvePromise, rejectPromise) => {
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      rejectPromise(new Error('[Frontron] Electron smoke test timed out.'))
    }, timeoutMs)

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      rejectPromise(error)
    })

    child.on('exit', (code) => {
      clearTimeout(timeout)
      resolvePromise({
        exitCode: code ?? 0,
        stderr,
      })
    })
  })
}

function ensureBuiltRuntime() {
  withBuildLock(() => {
    if (hasEnsuredBuiltRuntime) {
      return
    }

    execSync('npm run build', {
      cwd: packageRoot,
      stdio: 'ignore',
    })
    hasEnsuredBuiltRuntime = true
  })
}

async function waitForFile(path: string, timeoutMs = 5_000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(path)) {
      return
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }

  throw new Error(`[Frontron] Timed out waiting for smoke result: ${path}`)
}

function getAvailablePort() {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    const server = createServer()

    server.on('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        server.close()
        rejectPromise(new Error('[Frontron] Could not reserve a dev smoke test port.'))
        return
      }

      server.close(() => {
        resolvePromise(address.port)
      })
    })
  })
}

function writeDevServerFixture(rootDir: string, port: number) {
  const serverPidPath = join(rootDir, '.dev-server.pid')

  writeFileSync(
    join(rootDir, 'dev-server.mjs'),
    [
      "import { writeFileSync } from 'node:fs'",
      "import { createServer } from 'node:http'",
      '',
      'const port = Number(process.argv[2])',
      'const pidPath = process.argv[3]',
      '',
      'const server = createServer((_request, response) => {',
      "  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })",
      "  response.end('<!doctype html><html><body>dev smoke</body></html>')",
      '})',
      '',
      "server.listen(port, '127.0.0.1', () => {",
      '  writeFileSync(pidPath, String(process.pid))',
      '})',
      '',
      'const shutdown = () => {',
      '  server.close(() => process.exit(0))',
      '}',
      '',
      "process.on('SIGTERM', shutdown)",
      "process.on('SIGINT', shutdown)",
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'config.ts'),
    [
      "import type { AppMeta } from './types'",
      "import bridge from './bridge'",
      "import hooks from './hooks'",
      "import menu from './menu'",
      "import tray from './tray'",
      "import windows from './windows'",
      '',
      "const app: AppMeta = { name: 'Fixture App', id: 'com.example.fixture', icon: 'public/icon.png' }",
      '',
      'export default {',
      '  app,',
      '  web: {',
      `    dev: { command: 'node ./dev-server.mjs ${port} ${serverPidPath.replace(/\\/g, '/')}', url: 'http://127.0.0.1:${port}' },`,
      "    build: { command: 'node -e \"process.stdout.write(\\'build-ok\\')\"', outDir: 'dist' },",
      '  },',
      '  windows,',
      '  bridge,',
      '  menu,',
      '  tray,',
      '  hooks,',
      '  rust: {',
      '    enabled: false,',
      '  },',
      '}',
      '',
    ].join('\n'),
  )
}

function writeInferredDevServerFixture(rootDir: string, port: number) {
  const serverPidPath = join(rootDir, '.dev-server.pid')

  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: `node ./dev-server.mjs ${port} ${serverPidPath.replace(/\\/g, '/')}`,
          build: 'vite build',
        },
      },
      null,
      2,
    ),
  )

  writeFileSync(
    join(rootDir, 'vite.config.ts'),
    [
      "import { defineConfig } from 'vite'",
      '',
      'export default defineConfig({',
      '  server: {',
      `    port: ${port},`,
      '  },',
      '})',
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'dev-server.mjs'),
    [
      "import { writeFileSync } from 'node:fs'",
      "import { createServer } from 'node:http'",
      '',
      'const port = Number(process.argv[2])',
      'const pidPath = process.argv[3]',
      '',
      'const server = createServer((_request, response) => {',
      "  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })",
      "  response.end('<!doctype html><html><body>inferred dev smoke</body></html>')",
      '})',
      '',
      "server.listen(port, '127.0.0.1', () => {",
      '  writeFileSync(pidPath, String(process.pid))',
      '})',
      '',
      'const shutdown = () => {',
      '  server.close(() => process.exit(0))',
      '}',
      '',
      "process.on('SIGTERM', shutdown)",
      "process.on('SIGINT', shutdown)",
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'config.ts'),
    [
      "import bridge from './bridge'",
      "import hooks from './hooks'",
      "import menu from './menu'",
      "import tray from './tray'",
      "import windows from './windows'",
      '',
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '  windows,',
      '  bridge,',
      '  menu,',
      '  tray,',
      '  hooks,',
      '  rust: {',
      '    enabled: false,',
      '  },',
      '}',
      '',
    ].join('\n'),
  )
}

function writePortFlagInferredDevServerFixture(rootDir: string, port: number) {
  const serverPidPath = join(rootDir, '.dev-server.pid')

  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: `node ./dev-server.mjs --host 127.0.0.1 --port ${port} --pid ${serverPidPath.replace(/\\/g, '/')}`,
          build: 'vite build',
        },
      },
      null,
      2,
    ),
  )

  writeFileSync(
    join(rootDir, 'dev-server.mjs'),
    [
      "import { writeFileSync } from 'node:fs'",
      "import { createServer } from 'node:http'",
      '',
      'const port = Number(process.argv[process.argv.indexOf(\'--port\') + 1])',
      "const host = process.argv[process.argv.indexOf('--host') + 1]",
      "const pidPath = process.argv[process.argv.indexOf('--pid') + 1]",
      '',
      'const server = createServer((_request, response) => {',
      "  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })",
      "  response.end('<!doctype html><html><body>generic inferred dev smoke</body></html>')",
      '})',
      '',
      'server.listen(port, host, () => {',
      '  writeFileSync(pidPath, String(process.pid))',
      '})',
      '',
      'const shutdown = () => {',
      '  server.close(() => process.exit(0))',
      '}',
      '',
      "process.on('SIGTERM', shutdown)",
      "process.on('SIGINT', shutdown)",
      '',
    ].join('\n'),
  )

  writeFileSync(
    join(rootDir, 'frontron', 'config.ts'),
    [
      "import bridge from './bridge'",
      "import hooks from './hooks'",
      "import menu from './menu'",
      "import tray from './tray'",
      "import windows from './windows'",
      '',
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '  windows,',
      '  bridge,',
      '  menu,',
      '  tray,',
      '  hooks,',
      '  rust: {',
      '    enabled: false,',
      '  },',
      '}',
      '',
    ].join('\n'),
  )
}

test.sequential('staged build runtime boots in Electron smoke mode', async () => {
  ensureBuiltRuntime()

  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(
    join(fixtureDir, 'frontron', 'windows', 'index.ts'),
    [
      'const windows = {',
      '  main: {',
      "    route: '/settings/profile',",
      '    width: 1280,',
      '    height: 800,',
      '    zoomFactor: 1.25,',
      '  },',
      '  settings: {',
      "    route: '/settings',",
      '    width: 960,',
      '    height: 720,',
      '  },',
      '}',
      '',
      'export default windows',
      '',
    ].join('\n'),
  )

  const loadedConfig = await loadConfig({ cwd: fixtureDir })
  const stagedBuild = stageBuildApp(loadedConfig)
  const electronBinary = require('electron') as string
  const smokeResultPath = join(fixtureDir, '.frontron-smoke-result.json')
  const manifestPath = join(stagedBuild.packagedAppDir, 'manifest.json')
  const entryPath = join(stagedBuild.packagedAppDir, 'main.mjs')

  const child = spawn(electronBinary, [entryPath], {
    cwd: stagedBuild.packagedAppDir,
    env: {
      ...process.env,
      FRONTRON_MANIFEST_PATH: manifestPath,
      FRONTRON_SMOKE_TEST: '1',
      FRONTRON_SMOKE_RESULT_PATH: smokeResultPath,
      FRONTRON_SMOKE_OPEN_WINDOWS: 'settings',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  activeChildren.push(child)
  const result = await waitForExit(child)

  expect(result.exitCode).toBe(0)
  expect(result.stderr).not.toContain('App threw an error')
  expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
  await waitForFile(smokeResultPath)
  expect(existsSync(smokeResultPath)).toBe(true)

  const smokePayload = JSON.parse(readFileSync(smokeResultPath, 'utf8')) as {
    mode: string
    configFile?: string
    bridgeNamespaces: string[]
    hasMenu: boolean
    hasTray: boolean
    nativeStatus: {
      enabled: boolean
      loaded: boolean
      ready: boolean
    }
    windowRoute: string
    configuredWindowNames: string[]
    openWindowNames: string[]
    loadedUrl?: string
    zoomFactor?: number
    renderState: {
      title: string
      bodyText: string
      rootHtmlLength: number | null
    } | null
  }

  expect(smokePayload.mode).toBe('production')
  expect(smokePayload.configFile).toBe('frontron.config.ts')
  expect(smokePayload.bridgeNamespaces).toContain('app')
  expect(smokePayload.hasMenu).toBe(true)
  expect(smokePayload.hasTray).toBe(true)
  expect(smokePayload.nativeStatus).toEqual({
    enabled: false,
    loaded: false,
    ready: false,
  })
  expect(smokePayload.windowRoute).toBe('/settings/profile')
  expect(smokePayload.configuredWindowNames).toEqual(['main', 'settings'])
  expect(smokePayload.openWindowNames).toEqual(['main', 'settings'])
  expect(smokePayload.loadedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/settings\/profile$/)
  expect(smokePayload.zoomFactor).toBeCloseTo(1.25)
  expect(smokePayload.renderState?.bodyText).toContain('fixture')
}, 60_000)

test.sequential('runCli boots the development app flow in Electron smoke mode', async () => {
  ensureBuiltRuntime()

  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const port = await getAvailablePort()
  const smokeResultPath = join(fixtureDir, '.frontron-dev-smoke-result.json')
  const info: string[] = []
  const error: string[] = []

  writeDevServerFixture(fixtureDir, port)

  for (const key of smokeEnvKeys) {
    previousSmokeEnv.set(key, process.env[key])
  }

  process.env.FRONTRON_SMOKE_TEST = '1'
  process.env.FRONTRON_SMOKE_RESULT_PATH = smokeResultPath

  const exitCode = await runCli(['dev', '--cwd', fixtureDir], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Launching web dev command'))).toBe(true)
  expect(info.some((message) => message.includes('Launching framework runtime'))).toBe(true)
  expect(existsSync(join(fixtureDir, '.before-dev-hook'))).toBe(true)
  expect(existsSync(join(fixtureDir, '.frontron', 'runtime', 'dev-app', 'manifest.json'))).toBe(
    true,
  )
  await waitForFile(smokeResultPath)
  expect(existsSync(smokeResultPath)).toBe(true)

  const smokePayload = JSON.parse(readFileSync(smokeResultPath, 'utf8')) as {
    mode: string
    configFile?: string
    bridgeNamespaces: string[]
    hasMenu: boolean
    hasTray: boolean
    nativeStatus: {
      enabled: boolean
      loaded: boolean
      ready: boolean
    }
    windowRoute: string
  }

  expect(smokePayload.mode).toBe('development')
  expect(smokePayload.configFile).toBe('frontron.config.ts')
  expect(smokePayload.bridgeNamespaces).toContain('app')
  expect(smokePayload.hasMenu).toBe(true)
  expect(smokePayload.hasTray).toBe(true)
  expect(smokePayload.nativeStatus).toEqual({
    enabled: false,
    loaded: false,
    ready: false,
  })
  expect(smokePayload.windowRoute).toBe('/')
}, 30_000)

test.sequential('runCli infers the development app flow for a standard Vite-shaped project', async () => {
  ensureBuiltRuntime()

  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const port = await getAvailablePort()
  const smokeResultPath = join(fixtureDir, '.frontron-dev-inferred-smoke-result.json')
  const info: string[] = []
  const error: string[] = []

  writeInferredDevServerFixture(fixtureDir, port)

  for (const key of smokeEnvKeys) {
    previousSmokeEnv.set(key, process.env[key])
  }

  process.env.FRONTRON_SMOKE_TEST = '1'
  process.env.FRONTRON_SMOKE_RESULT_PATH = smokeResultPath

  const exitCode = await runCli(['dev', '--cwd', fixtureDir], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Inferred web dev command:'))).toBe(true)
  expect(info.some((message) => message.includes(`http://localhost:${port}`))).toBe(true)
  expect(info.some((message) => message.includes('App icon: using the default Frontron icon.'))).toBe(
    true,
  )
  await waitForFile(smokeResultPath)

  const smokePayload = JSON.parse(readFileSync(smokeResultPath, 'utf8')) as {
    mode: string
    nativeStatus: {
      enabled: boolean
      loaded: boolean
      ready: boolean
    }
    windowRoute: string
  }

  expect(smokePayload.mode).toBe('development')
  expect(smokePayload.nativeStatus).toEqual({
    enabled: false,
    loaded: false,
    ready: false,
  })
  expect(smokePayload.windowRoute).toBe('/')
}, 30_000)

test.sequential('runCli infers the development app flow from a generic script port flag', async () => {
  ensureBuiltRuntime()

  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const port = await getAvailablePort()
  const smokeResultPath = join(fixtureDir, '.frontron-dev-generic-port-smoke-result.json')
  const info: string[] = []
  const error: string[] = []

  writePortFlagInferredDevServerFixture(fixtureDir, port)

  for (const key of smokeEnvKeys) {
    previousSmokeEnv.set(key, process.env[key])
  }

  process.env.FRONTRON_SMOKE_TEST = '1'
  process.env.FRONTRON_SMOKE_RESULT_PATH = smokeResultPath

  const exitCode = await runCli(['dev', '--cwd', fixtureDir], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Inferred web dev command:'))).toBe(true)
  expect(info.some((message) => message.includes(`http://127.0.0.1:${port}`))).toBe(true)
  await waitForFile(smokeResultPath)

  const smokePayload = JSON.parse(readFileSync(smokeResultPath, 'utf8')) as {
    mode: string
    nativeStatus: {
      enabled: boolean
      loaded: boolean
      ready: boolean
    }
    windowRoute: string
  }

  expect(smokePayload.mode).toBe('development')
  expect(smokePayload.nativeStatus).toEqual({
    enabled: false,
    loaded: false,
    ready: false,
  })
  expect(smokePayload.windowRoute).toBe('/')
}, 30_000)
