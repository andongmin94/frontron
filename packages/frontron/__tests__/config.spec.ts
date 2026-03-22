import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import { join } from 'node:path'

import { defineConfig, findConfigPath, loadConfig } from '../src/index'
import { createFixtureProject, removeFixtureProject } from './helpers'

const fixtureDirs: string[] = []

afterEach(() => {
  for (const fixtureDir of fixtureDirs.splice(0)) {
    removeFixtureProject(fixtureDir)
  }
})

test('defineConfig returns the provided config object', () => {
  const config = {
    app: {
      name: 'Fixture App',
      id: 'com.example.fixture',
    },
  }

  expect(defineConfig(config)).toBe(config)
})

test('findConfigPath searches upward for frontron.config.ts', () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  const configPath = findConfigPath({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(configPath).toBe(join(fixtureDir, 'frontron.config.ts'))
})

test('loadConfig resolves root-based paths and extensionless ts imports', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.rootDir).toBe(fixtureDir)
  expect(loaded.configPath).toBe(join(fixtureDir, 'frontron.config.ts'))
  expect(loaded.config.app.name).toBe('Fixture App')
  expect(loaded.config.app.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(loaded.config.web?.build?.outDir).toBe(join(fixtureDir, 'dist'))
  expect(loaded.config.windows?.main.route).toBe('/')
  expect(loaded.config.menu?.[0]?.label).toBe('Window')
  expect(loaded.config.tray?.icon).toBe(join(fixtureDir, 'public', 'icon.png'))
  expect(typeof loaded.config.hooks?.beforeDev).toBe('function')
  expect(typeof loaded.config.hooks?.beforeBuild).toBe('string')
  expect(loaded.config.rust?.enabled).toBe(false)
  expect(loaded.config.rust?.bridge?.math?.add.symbol).toBe('frontron_native_add')
  expect(loaded.config.rust?.bridge?.math?.add.args).toEqual(['int', 'int'])
  expect(loaded.config.rust?.bridge?.math?.add.returns).toBe('int')
  expect(loaded.config.rust?.path).toBe(join(fixtureDir, 'frontron', 'rust'))
  expect(loaded.config.rust?.cargoTomlPath).toBe(
    join(fixtureDir, 'frontron', 'rust', 'Cargo.toml'),
  )
  expect(loaded.config.rust?.libRsPath).toBe(
    join(fixtureDir, 'frontron', 'rust', 'src', 'lib.rs'),
  )
})

test('loadConfig validates rust bridge binding descriptors', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace("returns: 'int'", "returns: 'number'"),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('must be one of: void, int, double, bool, string')
})

test('loadConfig rejects void rust bridge arguments', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(
    configPath,
    configSource.replace("args: ['int', 'int']", "args: ['void']"),
  )

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('cannot use "void"')
})

test('loadConfig resolves the official rust slot when it is enabled', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(configPath, configSource.replace('enabled: false', 'enabled: true'))

  const loaded = await loadConfig({
    cwd: join(fixtureDir, 'src', 'nested'),
  })

  expect(loaded.config.rust?.enabled).toBe(true)
  expect(loaded.config.rust?.cargoTomlPath).toBe(
    join(fixtureDir, 'frontron', 'rust', 'Cargo.toml'),
  )
  expect(loaded.config.rust?.libRsPath).toBe(
    join(fixtureDir, 'frontron', 'rust', 'src', 'lib.rs'),
  )
})

test('loadConfig fails when rust is enabled without the official slot files', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const configPath = join(fixtureDir, 'frontron', 'config.ts')
  const configSource = readFileSync(configPath, 'utf8')

  writeFileSync(configPath, configSource.replace('enabled: false', 'enabled: true'))
  rmSync(join(fixtureDir, 'frontron', 'rust', 'src', 'lib.rs'))

  await expect(
    loadConfig({
      cwd: join(fixtureDir, 'src', 'nested'),
    }),
  ).rejects.toThrow('Rust is enabled but src/lib.rs was not found')
})
