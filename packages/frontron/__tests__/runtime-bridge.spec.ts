import { afterEach, expect, test } from 'vitest'

import { createFixtureProject, removeFixtureProject } from './helpers'
import { createDesktopContext, type RuntimeWindowController } from '../src/runtime/context'
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
      settings: {
        route: '/settings',
        width: 960,
        height: 720,
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
  const openWindows = new Map<string, any>()
  const createStubWindow = () => ({
    hide() {},
    show() {},
    focus() {},
    close() {},
    minimize() {},
    restore() {},
    maximize() {},
    unmaximize() {},
    isMaximized() {
      return false
    },
    isMinimized() {
      return false
    },
  })
  const windowController: RuntimeWindowController = {
    getPrimaryWindow() {
      return null
    },
    async openConfiguredWindow(name) {
      if (!openWindows.has(name)) {
        openWindows.set(name, createStubWindow())
      }

      return openWindows.get(name) ?? null
    },
    getConfiguredWindow(name) {
      return openWindows.get(name) ?? null
    },
    hasConfiguredWindow(name) {
      return ['main', 'settings'].includes(name)
    },
    listConfiguredWindows() {
      return ['main', 'settings']
    },
    listOpenWindows() {
      return [...openWindows.keys()].sort()
    },
  }
  const desktopContext = createDesktopContext(manifest, windowController)
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
  expect(bridge.deepLink.getState()).toEqual({
    enabled: false,
    schemes: [],
    pending: [],
  })
  expect(bridge.deepLink.consumePending()).toEqual([])
  expect(bridge.window.getState()).toEqual({
    isMaximized: false,
    isMinimized: false,
  })
  expect(await bridge.windows.listConfigured()).toEqual(['main', 'settings'])
  expect(await bridge.windows.listOpen()).toEqual([])
  expect(await bridge.windows.exists({ name: 'settings' })).toBe(false)
  expect(await bridge.windows.getState({ name: 'settings' })).toBeNull()
  await expect(bridge.windows.open({ name: 'settings' })).resolves.toBeNull()
  expect(await bridge.windows.exists({ name: 'settings' })).toBe(true)
  expect(await bridge.windows.listOpen()).toEqual(['settings'])
  await expect(bridge.windows.open({ name: 'unknown' })).rejects.toThrow(
    'references an unknown window "unknown"',
  )
  await expect(bridge.windows.open({ name: '' })).rejects.toThrow(
    'requires a non-empty `{ name }` object',
  )
})
