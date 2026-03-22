import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { loadConfig } from '../src/config'
import { runHook } from '../src/hooks'
import { createFixtureProject, removeFixtureProject } from './helpers'

const fixtureDirs: string[] = []

afterEach(() => {
  for (const fixtureDir of fixtureDirs.splice(0)) {
    removeFixtureProject(fixtureDir)
  }
})

test('runHook executes function and shell-command hooks from config', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  const loadedConfig = await loadConfig({ cwd: fixtureDir })
  const outputMessages: string[] = []

  await runHook(
    'beforeDev',
    loadedConfig.config.hooks?.beforeDev,
    {
      rootDir: loadedConfig.rootDir,
      configPath: loadedConfig.configPath,
      command: 'dev',
    },
    {
      info(message) {
        outputMessages.push(message)
      },
      error(message) {
        outputMessages.push(message)
      },
    },
  )

  await runHook(
    'beforeBuild',
    loadedConfig.config.hooks?.beforeBuild,
    {
      rootDir: loadedConfig.rootDir,
      configPath: loadedConfig.configPath,
      command: 'build',
    },
    {
      info(message) {
        outputMessages.push(message)
      },
      error(message) {
        outputMessages.push(message)
      },
    },
  )

  await runHook(
    'afterPack',
    loadedConfig.config.hooks?.afterPack,
    {
      rootDir: loadedConfig.rootDir,
      configPath: loadedConfig.configPath,
      command: 'build',
      outputDir: join(loadedConfig.rootDir, 'output'),
      packagedAppDir: join(loadedConfig.rootDir, '.frontron', 'runtime', 'build', 'app'),
    },
    {
      info(message) {
        outputMessages.push(message)
      },
      error(message) {
        outputMessages.push(message)
      },
    },
  )

  expect(outputMessages.some((message) => message.includes('beforeDev'))).toBe(true)
  expect(outputMessages.some((message) => message.includes('beforeBuild'))).toBe(true)
  expect(outputMessages.some((message) => message.includes('afterPack'))).toBe(true)
  expect(existsSync(join(fixtureDir, '.before-dev-hook'))).toBe(true)
  expect(existsSync(join(fixtureDir, '.before-build-hook'))).toBe(true)
  expect(readFileSync(join(fixtureDir, '.after-pack-hook'), 'utf8')).toContain(
    join(fixtureDir, 'output'),
  )
})
