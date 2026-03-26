import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import { join } from 'node:path'

import { runCli, stageBuildApp } from '../src/cli'
import { GENERATED_BRIDGE_TYPES_RELATIVE_PATH } from '../src/bridge-types'
import { loadConfig } from '../src/config'
import { getRustTask } from '../src/rust'
import { resolveRustArtifactBasename } from '../src/runtime/native'
import { createFixtureProject, removeFixtureProject } from './helpers'

const fixtureDirs: string[] = []

afterEach(() => {
  for (const fixtureDir of fixtureDirs.splice(0)) {
    removeFixtureProject(fixtureDir)
  }
})

test('runCli validates dev config in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['dev', '--cwd', join(fixtureDir, 'src', 'nested'), '--check'],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
  )

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Loaded config'))).toBe(true)
  expect(info.some((message) => message.includes('Generated bridge types'))).toBe(true)
  expect(info.some((message) => message.includes('Rust slot:'))).toBe(true)
  expect(info.some((message) => message.includes('Configuration check passed'))).toBe(true)
  expect(existsSync(join(fixtureDir, GENERATED_BRIDGE_TYPES_RELATIVE_PATH))).toBe(true)
})

test('runCli check reports the first-run contract for a healthy project', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --port 4123',
          build: 'vite build',
          'app:dev': 'frontron dev',
          'app:build': 'frontron build',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'frontron', 'config.ts'),
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['check', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
  )

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Check root:'))).toBe(true)
  expect(info.some((message) => message.includes('app:dev script: frontron dev'))).toBe(true)
  expect(info.some((message) => message.includes('app:build script: frontron build'))).toBe(true)
  expect(info.some((message) => message.includes('Loaded config:'))).toBe(true)
  expect(info.some((message) => message.includes('Inferred web dev command: npm run dev'))).toBe(true)
  expect(info.some((message) => message.includes('Inferred web dev target: http://localhost:4123'))).toBe(true)
  expect(info.some((message) => message.includes('Check passed.'))).toBe(true)
})

test('runCli doctor remains a compatibility alias for check', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --port 4123',
          build: 'vite build',
          'app:dev': 'frontron dev',
          'app:build': 'frontron build',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'frontron', 'config.ts'),
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['doctor', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
  )

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Check passed.'))).toBe(true)
})

test('runCli check reports a dev-port conflict before app:dev starts', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --host 127.0.0.1 --port 4123',
          build: 'vite build',
          'app:dev': 'frontron dev',
          'app:build': 'frontron build',
        },
      },
      null,
      2,
    ),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['check', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
    {
      probeDevUrl() {
        return {
          portAvailable: false,
          responding: true,
        }
      },
    },
  )

  expect(exitCode).toBe(1)

  expect(
    error.some((message) => message.includes('Dev URL already responds before Frontron starts:')),
  ).toBe(true)
})

test('runCli check reports incomplete staged build artifacts', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          'app:dev': 'frontron dev',
          'app:build': 'frontron build',
        },
      },
      null,
      2,
    ),
  )

  mkdirSync(join(fixtureDir, '.frontron', 'runtime', 'build', 'app'), { recursive: true })
  writeFileSync(join(fixtureDir, '.frontron', 'runtime', 'build', 'app', 'manifest.json'), '{}')
  mkdirSync(join(fixtureDir, 'output'), { recursive: true })

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['check', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
  )

  expect(exitCode).toBe(1)
  expect(error.some((message) => message.includes('Framework staged app is incomplete'))).toBe(true)
  expect(error.some((message) => message.includes('Packaged output dir is empty: output'))).toBe(true)
})

test('runCli check reports a missing Rust toolchain when rust is enabled', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          'app:dev': 'frontron dev',
          'app:build': 'frontron build',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'frontron', 'config.ts'),
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '  rust: {',
      '    enabled: true,',
      '  },',
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['check', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
    {
      resolveCargoVersion() {
        return null
      },
    },
  )

  expect(exitCode).toBe(1)
  expect(error.some((message) => message.includes('Rust toolchain: cargo was not found'))).toBe(true)
})

test('runCli check prints a monorepo and custom-script hint when the project uses workspace wrappers', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(join(fixtureDir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
  writeFileSync(join(fixtureDir, 'turbo.json'), '{ "tasks": {} }\n')
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        workspaces: ['apps/*'],
        scripts: {
          'app:dev': 'frontron dev',
          'app:build': 'frontron build',
          'frontend:dev': 'turbo run dev --filter web',
          'frontend:build': 'turbo run build --filter web',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'frontron', 'config.ts'),
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '  web: {',
      '    dev: {',
      "      command: 'pnpm --filter web dev',",
      "      url: 'http://localhost:4173',",
      '    },',
      '    build: {',
      "      command: 'pnpm --filter web build',",
      "      outDir: 'dist',",
      '    },',
      '  },',
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['check', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
    {
      probeDevUrl() {
        return {
          portAvailable: true,
          responding: false,
        }
      },
    },
  )

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Workspace/custom script hint:'))).toBe(true)
  expect(
    info.some((message) =>
      message.includes('Prefer explicit "web.dev.command", "web.dev.url", "web.build.command", and "web.build.outDir"'),
    ),
  ).toBe(true)
})

test('runCli check reports unsupported raw Electron migration blockers early', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  mkdirSync(join(fixtureDir, 'src', 'electron'), { recursive: true })

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --port 4123',
          build: 'vite build',
          'app:dev': 'frontron dev',
          'app:build': 'frontron build',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'src', 'legacy-renderer.ts'),
    [
      'export function closeWindow() {',
      '  return window.electron?.window?.close?.()',
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(fixtureDir, 'src', 'embedded-view.tsx'),
    [
      'export function EmbeddedView() {',
      '  return <webview src="https://example.com" />',
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(fixtureDir, 'src', 'electron', 'main.ts'),
    [
      "import { BrowserWindow } from 'electron'",
      '',
      'export function openLegacyWindows(mainWindow) {',
      '  const modalWindow = new BrowserWindow({',
      '    parent: mainWindow,',
      '    modal: true,',
      '    webPreferences: {',
      "      preload: 'preload.js',",
      '      nodeIntegration: true,',
      '      contextIsolation: false,',
      '      webviewTag: true,',
      '    },',
      '  })',
      "  modalWindow.loadURL('https://example.com')",
      '  modalWindow.setIgnoreMouseEvents(true)',
      '  return modalWindow',
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['check', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
  )

  expect(exitCode).toBe(1)
  expect(info.some((message) => message.includes('Loaded config:'))).toBe(true)
  expect(
    error.some((message) => message.includes('legacy raw-Electron project files were found under src/electron')),
  ).toBe(true)
  expect(
    error.some((message) => message.includes('legacy renderer globals were found in src/legacy-renderer.ts')),
  ).toBe(true)
  expect(
    error.some((message) =>
      message.includes('raw BrowserWindow security/runtime options were found in src/electron/main.ts'),
    ),
  ).toBe(true)
  expect(
    error.some((message) => message.includes('Electron <webview> usage was found in src/embedded-view.tsx')),
  ).toBe(true)
  expect(
    error.some((message) =>
      message.includes('overlay or click-through APIs were found in src/electron/main.ts'),
    ),
  ).toBe(true)
  expect(
    error.some((message) =>
      message.includes('parent/modal BrowserWindow relationships were found in src/electron/main.ts'),
    ),
  ).toBe(true)
  expect(
    error.some((message) =>
      message.includes('remote URL or file-backed window content was found in src/electron/main.ts'),
    ),
  ).toBe(true)
  expect(error.some((message) => message.includes('Check found problems.'))).toBe(true)
})

test('runCli check reports missing official config and scripts', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  rmSync(join(fixtureDir, 'frontron.config.ts'), { force: true })
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
        },
      },
      null,
      2,
    ),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['check', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
  )

  expect(exitCode).toBe(1)
  expect(info.some((message) => message.includes('package.json: found'))).toBe(true)
  expect(error).toContain('[Frontron] app:dev script: missing')
  expect(error).toContain('[Frontron] app:build script: missing')
  expect(error).toContain('[Frontron] Root frontron.config.ts: missing')
  expect(error.some((message) => message.includes('Run `npx frontron init`'))).toBe(true)
})

test('runCli dev check shows candidate scripts and root config hints when inference fails', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          'frontend:start': 'custom-dev-runner',
          'app:dev': 'frontron dev',
          'app:build': 'frontron build',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'frontron', 'config.ts'),
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['dev', '--cwd', fixtureDir, '--check'],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
  )

  expect(exitCode).toBe(1)
  expect(info).toEqual([])
  expect(error.some((message) => message.includes('"dev" requires "web.dev.command"'))).toBe(true)
  expect(error.some((message) => message.includes('Candidate package scripts: "frontend:start"'))).toBe(true)
  expect(error.some((message) => message.includes('Set "web.dev.command" in the root frontron.config.ts'))).toBe(true)
  expect(error.some((message) => message.includes('Run `npx frontron check`'))).toBe(true)
})

test('runCli build check shows candidate scripts and root config hints when inference fails', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          'frontend:bundle': 'custom-build-runner',
          'app:dev': 'frontron dev',
          'app:build': 'frontron build',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'frontron', 'config.ts'),
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['build', '--cwd', fixtureDir, '--check'],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
  )

  expect(exitCode).toBe(1)
  expect(info).toEqual([])
  expect(error.some((message) => message.includes('"build" requires "web.build.command"'))).toBe(true)
  expect(error.some((message) => message.includes('Candidate package scripts: "frontend:bundle"'))).toBe(true)
  expect(error.some((message) => message.includes('Set "web.build.command" in the root frontron.config.ts'))).toBe(true)
  expect(error.some((message) => message.includes('Run `npx frontron check`'))).toBe(true)
})

test('runCli init creates a basic config file and desktop scripts when install is skipped', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  rmSync(join(fixtureDir, 'frontron.config.ts'), { force: true })
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: '@scope/my-web-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
        },
      },
      null,
      2,
    ),
  )

  const info: string[] = []
  const error: string[] = []
  let installAttempted = false
  const exitCode = await runCli(
    ['init', '--cwd', fixtureDir, '--skip-install'],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
    {
      installDependency() {
        installAttempted = true
        return 0
      },
    },
  )

  const packageJson = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
  }
  const configSource = readFileSync(join(fixtureDir, 'frontron.config.ts'), 'utf8')

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(installAttempted).toBe(false)
  expect(packageJson.scripts).toMatchObject({
    dev: 'vite',
    'app:dev': 'frontron dev',
    'app:build': 'frontron build',
  })
  expect(packageJson.dependencies?.frontron).toBeUndefined()
  expect(configSource).toContain("import { defineConfig } from 'frontron'")
  expect(configSource).toContain("name: 'My Web App'")
  expect(configSource).toContain("id: 'com.example.my-web-app'")
  expect(info.some((message) => message.includes('Added package scripts: app:dev, app:build'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Created config:'))).toBe(true)
  expect(info.some((message) => message.includes('Skipped automatic frontron install (--skip-install).'))).toBe(
    true,
  )
})

test('runCli init auto-installs frontron when it is missing', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const frontronPackage = JSON.parse(
    readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
  ) as {
    version: string
  }

  rmSync(join(fixtureDir, 'frontron.config.ts'), { force: true })
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
        },
      },
      null,
      2,
    ),
  )

  const info: string[] = []
  const error: string[] = []
  const installRequests: Array<{
    command: string
    versionRange: string
  }> = []
  const exitCode = await runCli(
    ['init', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
    {
      installDependency(request) {
        installRequests.push({
          command: request.command,
          versionRange: request.versionRange,
        })

        const packageJson = JSON.parse(
          readFileSync(join(fixtureDir, 'package.json'), 'utf8'),
        ) as {
          dependencies?: Record<string, string>
        }

        packageJson.dependencies = {
          ...(packageJson.dependencies ?? {}),
          frontron: request.versionRange,
        }
        writeFileSync(join(fixtureDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)

        return 0
      },
    },
  )

  const packageJson = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(installRequests).toEqual([
    {
      command: `npm install frontron@^${frontronPackage.version}`,
      versionRange: `^${frontronPackage.version}`,
    },
  ])
  expect(packageJson.dependencies?.frontron).toBe(`^${frontronPackage.version}`)
  expect(info.some((message) => message.includes('Installing frontron: npm install frontron@'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes(`Installed dependency: frontron@^${frontronPackage.version}`))).toBe(
    true,
  )
})

test('runCli init does not overwrite existing config or scripts', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron.config.ts')
  const existingConfigSource = [
    "export default {",
    "  app: { name: 'Keep Me', id: 'com.example.keep-me' },",
    '}',
    '',
  ].join('\n')

  writeFileSync(configPath, existingConfigSource)
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        dependencies: {
          frontron: '^0.0.1',
        },
        scripts: {
          'app:dev': 'custom dev',
          'app:build': 'custom build',
        },
      },
      null,
      2,
    ),
  )

  const info: string[] = []
  const error: string[] = []
  let installAttempted = false
  const exitCode = await runCli(
    ['init', '--cwd', fixtureDir],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
    {
      installDependency() {
        installAttempted = true
        return 0
      },
    },
  )

  const packageJson = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(installAttempted).toBe(false)
  expect(packageJson.scripts).toMatchObject({
    'app:dev': 'custom dev',
    'app:build': 'custom build',
  })
  expect(readFileSync(configPath, 'utf8')).toBe(existingConfigSource)
  expect(info.some((message) => message.includes('Package scripts already include app:dev and app:build.'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Config already exists:'))).toBe(true)
  expect(info.some((message) => message.includes('Package already depends on frontron (^0.0.1).'))).toBe(
    true,
  )
})

test('runCli validates build config in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(
    ['build', '--cwd', fixtureDir, '--check', '--config', 'frontron.config.ts'],
    {
      info(message) {
        info.push(message)
      },
      error(message) {
        error.push(message)
      },
    },
  )

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Generated bridge types'))).toBe(true)
  expect(info.some((message) => message.includes('Web build target'))).toBe(true)
  expect(info.some((message) => message.includes('Rust slot:'))).toBe(true)
  expect(existsSync(join(fixtureDir, GENERATED_BRIDGE_TYPES_RELATIVE_PATH))).toBe(true)
})

test('runCli reports configurable packaging settings in build check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
      [
        '  deepLinks: {',
        "    name: 'Fixture Link Handler',",
        "    schemes: ['fixture-app', 'fixture-auth'],",
        '  },',
        '  updates: {',
        "    url: 'https://updates.example.com/appcast.xml',",
        '  },',
        '  build: {',
        "    outputDir: 'release-output',",
        "    artifactName: 'fixture-${version}-${target}.${ext}',",
        '    asar: false,',
        "    compression: 'maximum',",
        "    files: ['**/*'],",
        "    extraResources: ['public/icon.png'],",
        "    extraFiles: ['public/icon.png'],",
        "    fileAssociations: [{ ext: ['fixture', 'fixturedoc'], name: 'Fixture Document' }],",
        "    windows: { targets: ['portable', 'dir'], artifactName: 'fixture-win-${version}.${ext}', certificateSubjectName: 'Fixture Desktop Signing', requestedExecutionLevel: 'highestAvailable' },",
        "    mac: { targets: ['dmg', 'zip'], artifactName: 'fixture-mac-${version}.${ext}', category: 'public.app-category.developer-tools', identity: 'Developer ID Application: Fixture Team', hardenedRuntime: true },",
        "    linux: { targets: ['AppImage', 'deb'], artifactName: 'fixture-linux-${version}.${ext}', category: 'Development', packageCategory: 'devel' },",
        "    advanced: { electronBuilder: { compressionLevel: 7 } },",
        '  },',
        '  windows,',
        '  bridge,',
        '  menu,',
        '  tray,',
        '  hooks,',
      ].join('\n'),
    ),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes(`Package output dir: ${join(fixtureDir, 'release-output')}`))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Deep-link schemes: fixture-app, fixture-auth'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Deep-link registration name: Fixture Link Handler'))).toBe(
    true,
  )
  expect(
    info.some((message) =>
      message.includes('File association extensions: fixture, fixturedoc'),
    ),
  ).toBe(true)
  expect(info.some((message) => message.includes('Auto updates: enabled (generic)'))).toBe(true)
  expect(
    info.some((message) =>
      message.includes('Auto update feed URL: https://updates.example.com/appcast.xml'),
    ),
  ).toBe(true)
  expect(info.some((message) => message.includes('Auto update launch check: enabled'))).toBe(true)
  expect(
    info.some((message) =>
      message.includes('Auto update runtime is currently supported for packaged macOS apps with a generic feed URL.'),
    ),
  ).toBe(true)
  expect(info.some((message) => message.includes('Package artifact pattern: fixture-${version}-${target}.${ext}'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Windows package targets: portable, dir'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Package asar: disabled'))).toBe(true)
  expect(info.some((message) => message.includes('Package compression: maximum'))).toBe(true)
  expect(info.some((message) => message.includes('Package file patterns: 1'))).toBe(true)
  expect(info.some((message) => message.includes('Package extra resources: 1'))).toBe(true)
  expect(info.some((message) => message.includes('Package extra files: 1'))).toBe(true)
  expect(info.some((message) => message.includes('Windows artifact pattern: fixture-win-${version}.${ext}'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Windows signing subject: Fixture Desktop Signing'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Windows execution level: highestAvailable'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('macOS package targets: dmg, zip'))).toBe(true)
  expect(info.some((message) => message.includes('macOS artifact pattern: fixture-mac-${version}.${ext}'))).toBe(
    true,
  )
  expect(
    info.some((message) =>
      message.includes('macOS category: public.app-category.developer-tools'),
    ),
  ).toBe(true)
  expect(
    info.some((message) =>
      message.includes('macOS signing identity: Developer ID Application: Fixture Team'),
    ),
  ).toBe(true)
  expect(info.some((message) => message.includes('macOS hardened runtime: enabled'))).toBe(true)
  expect(info.some((message) => message.includes('Linux package targets: AppImage, deb'))).toBe(
    true,
  )
  expect(
    info.some((message) =>
      message.includes('Linux artifact pattern: fixture-linux-${version}.${ext}'),
    ),
  ).toBe(true)
  expect(info.some((message) => message.includes('Linux category: Development'))).toBe(true)
  expect(info.some((message) => message.includes('Linux package category: devel'))).toBe(true)
  expect(info.some((message) => message.includes('Advanced electron-builder overrides: enabled'))).toBe(true)
})

test('runCli infers Vite dev settings and the default icon in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --port 3001',
          build: 'vite build',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'vite.config.ts'),
    [
      "import { defineConfig } from 'vite'",
      '',
      'export default defineConfig({',
      '  server: {',
      '    port: 3001,',
      '  },',
      '})',
      '',
    ].join('\n'),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['dev', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('App icon: using the default Frontron icon.'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Inferred web dev command:'))).toBe(true)
  expect(info.some((message) => message.includes('Inferred web dev target: http://localhost:3001'))).toBe(
    true,
  )
})

test('runCli infers a generic dev target from the package script port flag in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'next dev --hostname 127.0.0.1 --port 4100',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['dev', '--cwd', fixtureDir, '--check'], {
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
  expect(info.some((message) => message.includes('Inferred web dev target: http://127.0.0.1:4100'))).toBe(
    true,
  )
})

test('runCli loads the official frontron.config.ts in commonjs Next.js projects', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        scripts: {
          dev: 'next dev --hostname 127.0.0.1 --port 4100',
        },
        dependencies: {
          next: '^16.0.0',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(fixtureDir, 'frontron.config.ts'),
    [
      "export { default } from './frontron/config'",
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['dev', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes(`Loaded config: ${join(fixtureDir, 'frontron.config.ts')}`))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Inferred web dev target: http://127.0.0.1:4100'))).toBe(
    true,
  )
})

test('runCli infers Vite build settings in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          build: 'vite build --outDir custom-dist',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'vite.config.ts'),
    [
      "import { defineConfig } from 'vite'",
      '',
      'export default defineConfig({',
      '  build: {',
      "    outDir: 'custom-dist',",
      '  },',
      '})',
      '',
    ].join('\n'),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Inferred web build command:'))).toBe(true)
  expect(info.some((message) => message.includes(join(fixtureDir, 'custom-dist')))).toBe(true)
})

test('runCli infers Next.js static export build settings in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        scripts: {
          build: 'next build',
        },
        dependencies: {
          next: '^16.0.0',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'next.config.ts'),
    [
      'export default {',
      "  output: 'export',",
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )
  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Inferred web build command: npm run build'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes(join(fixtureDir, 'out')))).toBe(true)
})

test('runCli infers Nuxt generate build settings in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          build: 'nuxt build',
          generate: 'nuxt generate',
        },
        dependencies: {
          nuxt: '^4.0.0',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'nuxt.config.ts'),
    [
      'export default defineNuxtConfig({})',
      '',
    ].join('\n'),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )
  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Inferred web build command: npm run generate'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes(join(fixtureDir, '.output', 'public')))).toBe(
    true,
  )
})

test('runCli infers Astro build settings in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          build: 'astro build',
        },
        dependencies: {
          astro: '^5.0.0',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'astro.config.ts'),
    [
      'export default {',
      "  outDir: 'astro-dist',",
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes(join(fixtureDir, 'astro-dist')))).toBe(true)
})

test('runCli infers Vue CLI build settings in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          build: 'vue-cli-service build',
        },
        dependencies: {
          '@vue/cli-service': '^5.0.0',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'vue.config.js'),
    [
      'module.exports = {',
      "  outputDir: 'vue-cli-dist',",
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes(join(fixtureDir, 'vue-cli-dist')))).toBe(true)
})

test('runCli infers Angular build settings in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          build: 'ng build fixture-app',
        },
        devDependencies: {
          '@angular/cli': '^20.0.0',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'angular.json'),
    JSON.stringify(
      {
        version: 1,
        defaultProject: 'fixture-app',
        projects: {
          'fixture-app': {
            architect: {
              build: {
                options: {
                  outputPath: 'dist/fixture-app/browser',
                },
              },
            },
          },
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes(join(fixtureDir, 'dist', 'fixture-app', 'browser')))).toBe(
    true,
  )
})

test('runCli infers the default Angular output path when outputPath is omitted', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          build: 'ng build',
        },
        devDependencies: {
          '@angular/cli': '^20.0.0',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'angular.json'),
    JSON.stringify(
      {
        version: 1,
        defaultProject: 'fixture-app',
        projects: {
          'fixture-app': {
            architect: {
              build: {
                builder: '@angular/build:application',
                options: {},
              },
            },
          },
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(
    info.some((message) =>
      message.includes(join(fixtureDir, 'dist', 'fixture-app', 'browser')),
    ),
  ).toBe(true)
})

test('runCli infers VitePress dev settings in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          'docs:dev': 'vitepress dev docs --host 127.0.0.1 --port 4173',
          'docs:build': 'vitepress build docs',
        },
        devDependencies: {
          vitepress: '^1.6.4',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['dev', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Inferred web dev command: npm run docs:dev'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Inferred web dev target: http://127.0.0.1:4173'))).toBe(
    true,
  )
})

test('runCli infers VitePress build settings in check mode', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          'docs:build': 'vitepress build docs',
        },
        devDependencies: {
          vitepress: '^1.6.4',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const exitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Inferred web build command: npm run docs:build'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes(join(fixtureDir, 'docs', '.vitepress', 'dist')))).toBe(
    true,
  )
})

test('runCli infers root VitePress settings without an explicit content dir', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  mkdirSync(join(fixtureDir, '.vitepress'), { recursive: true })
  writeFileSync(
    join(fixtureDir, '.vitepress', 'config.ts'),
    [
      "import { defineConfig } from 'vitepress'",
      '',
      'export default defineConfig({})',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          'docs:dev': 'vitepress dev',
          'docs:build': 'vitepress build',
        },
        devDependencies: {
          vitepress: '^1.6.4',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const devExitCode = await runCli(['dev', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })
  const buildExitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(devExitCode).toBe(0)
  expect(buildExitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Inferred web dev command: npm run docs:dev'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Inferred web dev target: http://localhost:5173'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Inferred web build command: npm run docs:build'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes(join(fixtureDir, '.vitepress', 'dist')))).toBe(
    true,
  )
})

test('runCli prefers well-known frontend-prefixed scripts over generic dev/build scripts', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --port 3001',
          build: 'vite build --outDir generic-dist',
          'frontend:dev': 'vite --host 127.0.0.1 --port 4310',
          'frontend:build': 'vite build --outDir frontend-dist',
        },
        devDependencies: {
          vite: '^8.0.0',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fixtureDir, 'vite.config.ts'),
    [
      "import { defineConfig } from 'vite'",
      '',
      'export default defineConfig({})',
      '',
    ].join('\n'),
  )
  writeFileSync(
    configPath,
    [
      'export default {',
      "  app: { name: 'Fixture App', id: 'com.example.fixture' },",
      '}',
      '',
    ].join('\n'),
  )

  const info: string[] = []
  const error: string[] = []
  const devExitCode = await runCli(['dev', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })
  const buildExitCode = await runCli(['build', '--cwd', fixtureDir, '--check'], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  expect(devExitCode).toBe(0)
  expect(buildExitCode).toBe(0)
  expect(error).toEqual([])
  expect(info.some((message) => message.includes('Inferred web dev command: npm run frontend:dev'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Inferred web dev target: http://127.0.0.1:4310'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Inferred web build command: npm run frontend:build'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes(join(fixtureDir, 'frontend-dist')))).toBe(true)
})

test('stageBuildApp preserves the production html for the packaged web server', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  mkdirSync(join(fixtureDir, 'public'), { recursive: true })
  mkdirSync(join(fixtureDir, 'dist'), { recursive: true })
  writeFileSync(join(fixtureDir, 'public', 'icon.png'), 'icon')
  writeFileSync(
    join(fixtureDir, 'dist', 'index.html'),
    [
      '<!doctype html>',
      '<html>',
      '  <head>',
      '    <link rel="icon" href="/favicon.svg" />',
      '    <script type="module" src="/assets/index.js"></script>',
      '    <link rel="stylesheet" href="/assets/index.css" />',
      '  </head>',
      '  <body>fixture</body>',
      '</html>',
    ].join('\n'),
  )

  const loadedConfig = await loadConfig({ cwd: fixtureDir })
  const stagedBuild = stageBuildApp(loadedConfig)
  const manifest = JSON.parse(
    readFileSync(join(stagedBuild.packagedAppDir, 'manifest.json'), 'utf8'),
  ) as {
    rootDir: string
    configFile?: string
    app: {
      icon?: string
    }
    web: {
      outDir?: string
    }
  }
  const stagedPackageJson = JSON.parse(
    readFileSync(join(stagedBuild.packagedAppDir, 'package.json'), 'utf8'),
  ) as {
    author?: unknown
    description?: string
    devDependencies?: {
      electron?: string
    }
  }
  const builderConfig = JSON.parse(readFileSync(stagedBuild.builderConfigPath, 'utf8')) as {
    appId?: string
    directories?: {
      output?: string
    }
    electronVersion?: string
  }
  const stagedIndexHtml = readFileSync(join(stagedBuild.packagedAppDir, 'web', 'index.html'), 'utf8')

  expect(existsSync(join(stagedBuild.packagedAppDir, 'web', 'index.html'))).toBe(true)
  expect(existsSync(join(stagedBuild.packagedAppDir, 'main.mjs'))).toBe(true)
  expect(existsSync(join(stagedBuild.packagedAppDir, 'preload.mjs'))).toBe(true)
  const stagedPreloadSource = readFileSync(join(stagedBuild.packagedAppDir, 'preload.mjs'), 'utf8')
  if (stagedPreloadSource.includes('./legacy.mjs')) {
    expect(existsSync(join(stagedBuild.packagedAppDir, 'legacy.mjs'))).toBe(true)
  }
  expect(existsSync(join(stagedBuild.packagedAppDir, 'frontron.config.ts'))).toBe(true)
  expect(existsSync(join(stagedBuild.packagedAppDir, 'frontron', 'bridge', 'index.ts'))).toBe(true)
  expect(existsSync(join(stagedBuild.packagedAppDir, 'frontron', 'rust', 'Cargo.toml'))).toBe(true)
  expect(existsSync(join(stagedBuild.packagedAppDir, 'frontron', 'rust', 'src', 'lib.rs'))).toBe(
    true,
  )
  expect(existsSync(join(stagedBuild.packagedAppDir, 'node_modules', 'frontron', 'index.js'))).toBe(true)
  expect(manifest.rootDir).toBe(stagedBuild.packagedAppDir)
  expect(manifest.configFile).toBe('frontron.config.ts')
  expect(manifest.web.outDir).toBe('./web')
  expect(manifest.app.icon).toBe('icon.png')
  expect(stagedIndexHtml).toContain('href="/favicon.svg"')
  expect(stagedIndexHtml).toContain('src="/assets/index.js"')
  expect(stagedIndexHtml).toContain('href="/assets/index.css"')
  expect(stagedPackageJson.description).toBe('Fixture package description')
  expect(stagedPackageJson.author).toBe('Fixture Package Author')
  expect(builderConfig.appId).toBe('com.example.fixture')
  expect(builderConfig.directories?.output).toBe(join(fixtureDir, 'output'))
  expect(stagedPackageJson.devDependencies?.electron).toMatch(/^\d+\.\d+\.\d+/)
  expect(builderConfig.electronVersion).toBe(stagedPackageJson.devDependencies?.electron)
})

test('stageBuildApp applies configurable metadata and Windows packaging targets', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource
      .replace(
        "const app: AppMeta = { name: 'Fixture App', id: 'com.example.fixture', icon: 'public/icon.png' }",
        "const app: AppMeta = { name: 'Fixture App', id: 'com.example.fixture', icon: 'public/icon.png', description: 'Desktop fixture', author: 'Fixture Desktop Team', copyright: 'Copyright 2026 Fixture' }",
      )
      .replace(
        '  windows,\n  bridge,\n  menu,\n  tray,\n  hooks,\n',
        [
          '  deepLinks: {',
          "    name: 'Fixture Link Handler',",
          "    schemes: ['fixture-app', 'fixture-auth'],",
          '  },',
          '  build: {',
          "    outputDir: 'release-output',",
          "    artifactName: 'fixture-${version}-${target}.${ext}',",
          "    publish: 'onTag',",
            '    asar: false,',
            "    compression: 'maximum',",
            "    files: ['main.mjs', { from: 'public', to: 'public-files', filter: ['**/*'] }],",
            "    extraResources: ['public/icon.png'],",
            "    extraFiles: [{ from: 'public', to: 'public-copy' }],",
            "    fileAssociations: [{ ext: ['fixture', 'fixturedoc'], name: 'Fixture Document', description: 'Fixture desktop document', icon: 'public/icon.png', role: 'Editor', rank: 'Owner' }, { ext: 'fixturemime', mimeType: 'application/x-fixture' }],",
            "    windows: { targets: ['portable', 'dir'], icon: 'public/icon.png', publisherName: ['Fixture Desktop Team'], certificateSubjectName: 'Fixture Desktop Signing', signAndEditExecutable: false, requestedExecutionLevel: 'highestAvailable', artifactName: 'fixture-win-${version}.${ext}' },",
            "    nsis: { oneClick: false, perMachine: true, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: true, installerIcon: 'public/icon.png', uninstallerIcon: 'public/icon.png' },",
            "    mac: { targets: ['dmg', 'zip'], icon: 'public/icon.png', category: 'public.app-category.developer-tools', identity: 'Developer ID Application: Fixture Team', hardenedRuntime: true, gatekeeperAssess: false, entitlements: 'entitlements.mac.plist', entitlementsInherit: 'entitlements.mac.inherit.plist', artifactName: 'fixture-mac-${version}.${ext}' },",
            "    linux: { targets: ['AppImage', 'deb'], icon: 'public/icon.png', category: 'Development', packageCategory: 'devel', artifactName: 'fixture-linux-${version}.${ext}' },",
            "    advanced: { electronBuilder: { compressionLevel: 7, directories: { buildResources: 'builder-resources' }, win: { verifyUpdateCodeSignature: false }, extraMetadata: { homepage: 'https://example.com' } } },",
            '  },',
          '  windows,',
          '  bridge,',
          '  menu,',
          '  tray,',
          '  hooks,',
        ].join('\n'),
      ),
  )

  const loadedConfig = await loadConfig({ cwd: fixtureDir })
  const stagedBuild = stageBuildApp(loadedConfig)
  const stagedPackageJson = JSON.parse(
    readFileSync(join(stagedBuild.packagedAppDir, 'package.json'), 'utf8'),
  ) as {
    author?: unknown
    copyright?: string
    description?: string
  }
  const builderConfig = JSON.parse(readFileSync(stagedBuild.builderConfigPath, 'utf8')) as {
    asar?: boolean
    artifactName?: string
    compression?: string
    compressionLevel?: number
    copyright?: string
    directories?: {
      buildResources?: string
      output?: string
    }
    extraMetadata?: {
      homepage?: string
    }
    extraFiles?: Array<Record<string, unknown> | string>
    extraResources?: string[]
    fileAssociations?: Array<{
      description?: string
      ext?: string | string[]
      icon?: string
      isPackage?: boolean
      mimeType?: string
      name?: string
      rank?: string
      role?: string
    }>
    files?: Array<Record<string, unknown> | string>
    protocols?: Array<{
      name?: string
      schemes?: string[]
    }>
    nsis?: {
      oneClick?: boolean
      perMachine?: boolean
      allowToChangeInstallationDirectory?: boolean
      deleteAppDataOnUninstall?: boolean
      installerIcon?: string
      uninstallerIcon?: string
    }
      mac?: {
        artifactName?: string
        category?: string
        entitlements?: string
        entitlementsInherit?: string
        gatekeeperAssess?: boolean
        hardenedRuntime?: boolean
        icon?: string
        identity?: string
        target?: string[]
      }
    linux?: {
      artifactName?: string
      category?: string
      icon?: string
      packageCategory?: string
      target?: string[]
    }
      win?: {
        artifactName?: string
        certificateSubjectName?: string
        icon?: string
        publisherName?: string[]
        requestedExecutionLevel?: string
      signAndEditExecutable?: boolean
      target?: string[]
      verifyUpdateCodeSignature?: boolean
    }
  }

  expect(stagedPackageJson.description).toBe('Desktop fixture')
  expect(stagedPackageJson.author).toBe('Fixture Desktop Team')
  expect(stagedPackageJson.copyright).toBe('Copyright 2026 Fixture')
  expect(builderConfig.copyright).toBe('Copyright 2026 Fixture')
  expect(builderConfig.asar).toBe(false)
  expect(builderConfig.artifactName).toBe('fixture-${version}-${target}.${ext}')
  expect(builderConfig.compression).toBe('maximum')
  expect(builderConfig.compressionLevel).toBe(7)
  expect(builderConfig.extraMetadata?.homepage).toBe('https://example.com')
  expect(builderConfig.directories?.buildResources).toBe('builder-resources')
  expect(builderConfig.directories?.output).toBe(join(fixtureDir, 'release-output'))
  expect(builderConfig.files).toEqual([
    '**/*',
    'main.mjs',
    {
      from: join(fixtureDir, 'public'),
      to: 'public-files',
      filter: ['**/*'],
    },
  ])
  expect(builderConfig.protocols).toEqual([
    {
      name: 'Fixture Link Handler',
      schemes: ['fixture-app', 'fixture-auth'],
    },
  ])
  expect(builderConfig.fileAssociations).toEqual([
    {
      ext: ['fixture', 'fixturedoc'],
      name: 'Fixture Document',
      description: 'Fixture desktop document',
      icon: join(fixtureDir, 'public', 'icon.png'),
      role: 'Editor',
      rank: 'Owner',
    },
    {
      ext: 'fixturemime',
      mimeType: 'application/x-fixture',
    },
  ])
  expect(builderConfig.extraResources).toEqual([join(fixtureDir, 'public', 'icon.png')])
  expect(builderConfig.extraFiles).toEqual([
    {
      from: join(fixtureDir, 'public'),
      to: 'public-copy',
    },
  ])
  expect(builderConfig.win?.target).toEqual(['portable', 'dir'])
  expect(builderConfig.win?.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(builderConfig.win?.publisherName).toEqual(['Fixture Desktop Team'])
  expect(builderConfig.win?.certificateSubjectName).toBe('Fixture Desktop Signing')
  expect(builderConfig.win?.signAndEditExecutable).toBe(false)
  expect(builderConfig.win?.requestedExecutionLevel).toBe('highestAvailable')
  expect(builderConfig.win?.artifactName).toBe('fixture-win-${version}.${ext}')
  expect(builderConfig.win?.verifyUpdateCodeSignature).toBe(false)
  expect(builderConfig.nsis).toEqual({
    oneClick: false,
    perMachine: true,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: true,
    installerIcon: join(fixtureDir, 'public', 'icon.png'),
    uninstallerIcon: join(fixtureDir, 'public', 'icon.png'),
  })
  expect(builderConfig.mac?.target).toEqual(['dmg', 'zip'])
  expect(builderConfig.mac?.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(builderConfig.mac?.category).toBe('public.app-category.developer-tools')
  expect(builderConfig.mac?.identity).toBe('Developer ID Application: Fixture Team')
  expect(builderConfig.mac?.hardenedRuntime).toBe(true)
  expect(builderConfig.mac?.gatekeeperAssess).toBe(false)
  expect(builderConfig.mac?.entitlements).toBe(join(fixtureDir, 'entitlements.mac.plist'))
  expect(builderConfig.mac?.entitlementsInherit).toBe(
    join(fixtureDir, 'entitlements.mac.inherit.plist'),
  )
  expect(builderConfig.mac?.artifactName).toBe('fixture-mac-${version}.${ext}')
  expect(builderConfig.linux?.target).toEqual(['AppImage', 'deb'])
  expect(builderConfig.linux?.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(builderConfig.linux?.category).toBe('Development')
  expect(builderConfig.linux?.packageCategory).toBe('devel')
  expect(builderConfig.linux?.artifactName).toBe('fixture-linux-${version}.${ext}')
  expect(stagedBuild.outputDir).toBe(join(fixtureDir, 'release-output'))
  expect(stagedBuild.publishMode).toBe('onTag')
})

test('stageBuildApp falls back to the default Frontron icon when app.icon is omitted', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace(
      "const app: AppMeta = { name: 'Fixture App', id: 'com.example.fixture', icon: 'public/icon.png' }",
      "const app: AppMeta = { name: 'Fixture App', id: 'com.example.fixture' }",
    ),
  )

  const loadedConfig = await loadConfig({ cwd: fixtureDir })
  const stagedBuild = stageBuildApp(loadedConfig)
  const manifest = JSON.parse(
    readFileSync(join(stagedBuild.packagedAppDir, 'manifest.json'), 'utf8'),
  ) as {
    app: {
      icon?: string
    }
  }

  expect(manifest.app.icon).toBe('icon.ico')
  expect(existsSync(join(stagedBuild.packagedAppDir, 'icon.ico'))).toBe(true)
})

test('stageBuildApp stages the native loader dependency and rust artifact when rust is enabled', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')
  const artifactBasename = resolveRustArtifactBasename('fixture_app_native')
  const artifactPath = join(fixtureDir, 'frontron', 'rust', 'target', 'release', artifactBasename)

  writeFileSync(configPath, configSource.replace('enabled: false', 'enabled: true'))
  mkdirSync(join(fixtureDir, 'frontron', 'rust', 'target', 'release'), { recursive: true })
  writeFileSync(artifactPath, 'native-artifact')

  const loadedConfig = await loadConfig({ cwd: fixtureDir })
  const stagedBuild = stageBuildApp(loadedConfig)

  expect(existsSync(join(stagedBuild.packagedAppDir, 'node_modules', 'koffi', 'package.json'))).toBe(
    true,
  )
  expect(
    existsSync(
      join(
        stagedBuild.packagedAppDir,
        'frontron',
        'rust',
        'target',
        'release',
        artifactBasename,
      ),
    ),
  ).toBe(true)
})

test('getRustTask maps dev and build commands to cargo in the official slot', () => {
  const rust = {
    enabled: true,
    path: '/tmp/frontron/rust',
    cargoTomlPath: '/tmp/frontron/rust/Cargo.toml',
    sourceDir: '/tmp/frontron/rust/src',
    libRsPath: '/tmp/frontron/rust/src/lib.rs',
  }

  expect(getRustTask('dev', rust)).toEqual({
    command: 'cargo',
    args: ['build'],
    cwd: '/tmp/frontron/rust',
    displayCommand: 'cargo build',
  })
  expect(getRustTask('build', rust)).toEqual({
    command: 'cargo',
    args: ['build', '--release'],
    cwd: '/tmp/frontron/rust',
    displayCommand: 'cargo build --release',
  })
  expect(getRustTask('dev', { ...rust, enabled: false })).toBeNull()
})
