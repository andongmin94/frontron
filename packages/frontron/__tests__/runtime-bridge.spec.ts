import { afterEach, expect, test } from 'vitest'

import { createFixtureProject, removeFixtureProject } from './helpers'
import { createDesktopContext } from '../src/runtime/context'
import { createRuntimeBridge } from '../src/runtime/bridge'
import { loadRuntimeConfig } from '../src/runtime/config'
import type { RuntimeManifest } from '../src/runtime/manifest'

const fixtureDirs: string[] = []

afterEach(() => {
  for (const fixtureDir of fixtureDirs.splice(0)) {
    removeFixtureProject(fixtureDir)
  }
})

function createFixtureManifest(rootDir: string): RuntimeManifest {
  return {
    rootDir,
    configFile: 'frontron.config.ts',
    mode: 'development',
    app: {
      name: 'Fixture App',
      id: 'com.example.fixture',
      version: '1.0.0',
      icon: undefined,
    },
    web: {
      devUrl: 'http://localhost:5173',
      outDir: undefined,
    },
    windows: {
      main: {
        route: '/',
        width: 1280,
        height: 800,
      },
    },
  }
}

test('loadRuntimeConfig loads custom bridge namespaces from config', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  const runtimeConfig = await loadRuntimeConfig(createFixtureManifest(fixtureDir))

  expect(runtimeConfig?.bridge?.app.getGreeting()).toBe('hello from bridge')
  expect(runtimeConfig?.bridge?.app.add(2, 3)).toBe(5)
})

test('createRuntimeBridge merges custom bridge namespaces with built-in handlers', async () => {
  const fixtureDir = createFixtureProject()
  fixtureDirs.push(fixtureDir)

  const manifest = createFixtureManifest(fixtureDir)
  const runtimeConfig = await loadRuntimeConfig(manifest)
  const desktopContext = createDesktopContext(manifest, () => null)
  const bridge = createRuntimeBridge(runtimeConfig?.bridge, manifest.app.version, desktopContext, {
    getStatus() {
      return {
        enabled: false,
        loaded: false,
        ready: false,
      }
    },
    isReady() {
      return false
    },
    add(left, right) {
      return left + right
    },
    getBridge() {
      return {
        math: {
          add(left: unknown, right: unknown) {
            return Number(left) + Number(right)
          },
        },
        system: {
          cpuCount() {
            return 8
          },
        },
      }
    },
  })

  expect(bridge.system.getVersion()).toBe('1.0.0')
  expect(bridge.system.getNativeStatus()).toEqual({
    enabled: false,
    loaded: false,
    ready: false,
  })
  expect(bridge.system.isNativeReady()).toBe(false)
  expect(await bridge.system.cpuCount()).toBe(8)
  expect(bridge.native.getStatus()).toEqual({
    enabled: false,
    loaded: false,
    ready: false,
  })
  expect(bridge.native.isReady()).toBe(false)
  expect(bridge.native.add(2, 3)).toBe(5)
  expect(await bridge.math.add(2, 3)).toBe(5)
  expect(bridge.app.getGreeting()).toBe('hello from bridge')
  expect(bridge.window.getState()).toEqual({
    isMaximized: false,
    isMinimized: false,
  })
})
