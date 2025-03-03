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

test('runCli init creates a basic config file and desktop scripts', async () => {
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
  const exitCode = await runCli(['init', '--cwd', fixtureDir], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  const packageJson = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const configSource = readFileSync(join(fixtureDir, 'frontron.config.ts'), 'utf8')

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(packageJson.scripts).toMatchObject({
    dev: 'vite',
    'app:dev': 'frontron dev',
    'app:build': 'frontron build',
  })
  expect(configSource).toContain("import { defineConfig } from 'frontron'")
  expect(configSource).toContain("name: 'My Web App'")
  expect(configSource).toContain("id: 'com.example.my-web-app'")
  expect(info.some((message) => message.includes('Added package scripts: app:dev, app:build'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Created config:'))).toBe(true)
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
  const exitCode = await runCli(['init', '--cwd', fixtureDir], {
    info(message) {
      info.push(message)
    },
    error(message) {
      error.push(message)
    },
  })

  const packageJson = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }

  expect(exitCode).toBe(0)
  expect(error).toEqual([])
  expect(packageJson.scripts).toMatchObject({
    'app:dev': 'custom dev',
    'app:build': 'custom build',
  })
  expect(readFileSync(configPath, 'utf8')).toBe(existingConfigSource)
  expect(info.some((message) => message.includes('Package scripts already include app:dev and app:build.'))).toBe(
    true,
  )
  expect(info.some((message) => message.includes('Config already exists:'))).toBe(true)
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

test('stageBuildApp rewrites the production manifest to packaged runtime paths', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  mkdirSync(join(fixtureDir, 'public'), { recursive: true })
  mkdirSync(join(fixtureDir, 'dist'), { recursive: true })
  writeFileSync(join(fixtureDir, 'public', 'icon.png'), 'icon')
  writeFileSync(join(fixtureDir, 'dist', 'index.html'), '<html><body>fixture</body></html>')

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
    devDependencies?: {
      electron?: string
    }
  }
  const builderConfig = JSON.parse(readFileSync(stagedBuild.builderConfigPath, 'utf8')) as {
    electronVersion?: string
  }

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
  expect(stagedPackageJson.devDependencies?.electron).toMatch(/^\d+\.\d+\.\d+/)
  expect(builderConfig.electronVersion).toBe(stagedPackageJson.devDependencies?.electron)
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
