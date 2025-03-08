import { existsSync, readFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'

import { loadConfig } from '../src/config'
import {
  GENERATED_BRIDGE_TYPES_RELATIVE_PATH,
  getGeneratedBridgeTypesPath,
  renderBridgeTypes,
  writeBridgeTypes,
} from '../src/bridge-types'
import { createFixtureProject, removeFixtureProject } from './helpers'

const fixtureDirs: string[] = []

afterEach(() => {
  for (const fixtureDir of fixtureDirs.splice(0)) {
    removeFixtureProject(fixtureDir)
  }
})

test('renderBridgeTypes emits custom namespaces for frontron/client augmentation', () => {
  const source = renderBridgeTypes({
    rootDir: '/workspace/app',
    configPath: '/workspace/app/frontron.config.ts',
    config: {
      app: {
        name: 'Fixture App',
        id: 'com.example.fixture',
      },
      bridge: {
        app: {
          getGreeting() {
            return 'hello'
          },
          add(left: number, right: number) {
            return left + right
          },
        },
      },
      rust: {
        bridge: {
          math: {
            add: {
              symbol: 'frontron_native_add',
              args: ['int', 'int'],
              returns: 'int',
            },
          },
        },
      },
    },
  } as any)

  expect(source).toContain("import 'frontron/client'")
  expect(source).toContain('type FrontronConfigModule = typeof import("../../frontron.config")')
  expect(source).toContain('type FrontronBridgeMethod<T> = T extends (...args: infer Args) => infer Result')
  expect(source).toContain('type FrontronRustBridgeMap<T> = {')
  expect(source).toContain('type FrontronRustBindingReturn<T> = T extends { returns: infer ReturnType extends string }')
  expect(source).toContain('type FrontronBridgeSource = FrontronConfigValue extends { bridge: infer Bridge } ? Bridge : unknown')
  expect(source).toContain('interface FrontronGeneratedBridge extends FrontronBridgeMap<FrontronBridgeSource>, FrontronRustBridgeMap<FrontronRustBridgeSource>')
  expect(source).toContain("declare module 'frontron/client'")
  expect(source).toContain('"app": {')
  expect(source).toContain('"math": {')
  expect(source).toContain('"getGreeting": (...args: unknown[]) => Promise<unknown>')
  expect(source).toContain('"add": (...args: unknown[]) => Promise<unknown>')
})

test('writeBridgeTypes writes the generated client augmentation into .frontron/types', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)
  const loadedConfig = await loadConfig({ cwd: fixtureDir })
  const filePath = writeBridgeTypes(loadedConfig)

  expect(filePath).toBe(getGeneratedBridgeTypesPath(fixtureDir))
  expect(filePath.endsWith(GENERATED_BRIDGE_TYPES_RELATIVE_PATH)).toBe(true)
  expect(existsSync(filePath)).toBe(true)

  const source = readFileSync(filePath, 'utf8')

  expect(source).toContain("import 'frontron/client'")
  expect(source).toContain('type FrontronConfigModule = typeof import("../../frontron.config")')
  expect(source).toContain('type FrontronBridgeMap<T> = {')
  expect(source).toContain('type FrontronRustBridgeMap<T> = {')
  expect(source).toContain('type FrontronRustBridgeSource = FrontronRustConfigValue extends { bridge: infer Bridge } ? Bridge : unknown')
  expect(source).toContain('"app": {')
  expect(source).toContain('"math": {')
  expect(source).toContain('"getGreeting": (...args: unknown[]) => Promise<unknown>')
  expect(source).toContain('"add": (...args: unknown[]) => Promise<unknown>')
})
