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
  const createStubWindow = () => {
    let bounds = {
      x: 40,
      y: 60,
      width: 800,
      height: 600,
    }
    let visible = false
    let focused = false
    let minimized = false
    let maximized = false
    let alwaysOnTop = false
    let opacity = 1

    return {
      hide() {
        visible = false
        focused = false
      },
      show() {
        visible = true
        focused = true
      },
      showInactive() {
        visible = true
        focused = false
      },
      focus() {
        focused = true
      },
      close() {},
      minimize() {
        minimized = true
      },
      restore() {
        minimized = false
      },
      maximize() {
        maximized = true
      },
      unmaximize() {
        maximized = false
      },
      isMaximized() {
        return maximized
      },
      isMinimized() {
        return minimized
      },
      isVisible() {
        return visible
      },
      isFocused() {
        return focused
      },
      getBounds() {
        return { ...bounds }
      },
      setBounds(nextBounds: typeof bounds) {
        bounds = { ...nextBounds }
      },
      getPosition() {
        return [bounds.x, bounds.y]
      },
      setPosition(x: number, y: number) {
        bounds = {
          ...bounds,
          x,
          y,
        }
      },
      isAlwaysOnTop() {
        return alwaysOnTop
      },
      setAlwaysOnTop(nextValue: boolean) {
        alwaysOnTop = nextValue
      },
      getOpacity() {
        return opacity
      },
      setOpacity(nextValue: number) {
        opacity = nextValue
      },
    }
  }
  const primaryWindow = createStubWindow() as any
  const windowController: RuntimeWindowController = {
    getPrimaryWindow() {
      return primaryWindow
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
  expect(await bridge.window.getBounds()).toEqual({
    x: 40,
    y: 60,
    width: 800,
    height: 600,
  })
  expect(await bridge.window.getPosition()).toEqual({
    x: 40,
    y: 60,
  })
  expect(await bridge.window.isVisible()).toBe(false)
  expect(await bridge.window.isFocused()).toBe(false)
  expect(await bridge.window.getAlwaysOnTop()).toBe(false)
  expect(await bridge.window.getOpacity()).toBe(1)
  expect(bridge.window.toggleVisibility()).toBeNull()
  expect(bridge.window.setBounds({ x: 10, y: 20, width: 640, height: 480 })).toBeNull()
  expect(bridge.window.setPosition({ x: 30, y: 45 })).toBeNull()
  expect(bridge.window.setAlwaysOnTop({ value: true })).toBeNull()
  expect(bridge.window.setOpacity({ value: 0.75 })).toBeNull()
  expect(bridge.window.showInactive()).toBeNull()
  expect(bridge.window.getState()).toEqual({
    isMaximized: false,
    isMinimized: false,
    isVisible: true,
    isFocused: false,
    alwaysOnTop: true,
    opacity: 0.75,
    bounds: {
      x: 30,
      y: 45,
      width: 640,
      height: 480,
    },
    position: {
      x: 30,
      y: 45,
    },
  })
  expect(await bridge.windows.listConfigured()).toEqual(['main', 'settings'])
  expect(await bridge.windows.listOpen()).toEqual([])
  expect(await bridge.windows.exists({ name: 'settings' })).toBe(false)
  expect(await bridge.windows.isVisible({ name: 'settings' })).toBe(false)
  expect(await bridge.windows.isFocused({ name: 'settings' })).toBe(false)
  expect(await bridge.windows.getBounds({ name: 'settings' })).toBeNull()
  expect(await bridge.windows.getPosition({ name: 'settings' })).toBeNull()
  expect(await bridge.windows.getAlwaysOnTop({ name: 'settings' })).toBeNull()
  expect(await bridge.windows.getOpacity({ name: 'settings' })).toBeNull()
  expect(await bridge.windows.getState({ name: 'settings' })).toBeNull()
  await expect(bridge.windows.toggleVisibility({ name: 'settings' })).resolves.toBeNull()
  expect(await bridge.windows.exists({ name: 'settings' })).toBe(true)
  expect(await bridge.windows.isVisible({ name: 'settings' })).toBe(true)
  expect(await bridge.windows.isFocused({ name: 'settings' })).toBe(true)
  expect(await bridge.windows.getState({ name: 'settings' })).toEqual({
    isMaximized: false,
    isMinimized: false,
    isVisible: true,
    isFocused: true,
    alwaysOnTop: false,
    opacity: 1,
    bounds: {
      x: 40,
      y: 60,
      width: 800,
      height: 600,
    },
    position: {
      x: 40,
      y: 60,
    },
  })
  await expect(bridge.windows.toggleVisibility({ name: 'settings' })).resolves.toBeNull()
  expect(await bridge.windows.isVisible({ name: 'settings' })).toBe(false)
  expect(await bridge.windows.isFocused({ name: 'settings' })).toBe(false)
  expect(await bridge.windows.getState({ name: 'settings' })).toEqual({
    isMaximized: false,
    isMinimized: false,
    isVisible: false,
    isFocused: false,
    alwaysOnTop: false,
    opacity: 1,
    bounds: {
      x: 40,
      y: 60,
      width: 800,
      height: 600,
    },
    position: {
      x: 40,
      y: 60,
    },
  })
  await expect(bridge.windows.open({ name: 'settings' })).resolves.toBeNull()
  expect(await bridge.windows.exists({ name: 'settings' })).toBe(true)
  expect(await bridge.windows.listOpen()).toEqual(['settings'])
  expect(
    bridge.windows.setBounds({ name: 'settings', x: 100, y: 120, width: 500, height: 400 }),
  ).toBeNull()
  expect(bridge.windows.setPosition({ name: 'settings', x: 110, y: 130 })).toBeNull()
  expect(bridge.windows.setAlwaysOnTop({ name: 'settings', value: true })).toBeNull()
  expect(bridge.windows.setOpacity({ name: 'settings', value: 0.5 })).toBeNull()
  await expect(bridge.windows.showInactive({ name: 'settings' })).resolves.toBeNull()
  expect(await bridge.windows.getBounds({ name: 'settings' })).toEqual({
    x: 110,
    y: 130,
    width: 500,
    height: 400,
  })
  expect(await bridge.windows.getPosition({ name: 'settings' })).toEqual({
    x: 110,
    y: 130,
  })
  expect(await bridge.windows.getAlwaysOnTop({ name: 'settings' })).toBe(true)
  expect(await bridge.windows.getOpacity({ name: 'settings' })).toBe(0.5)
  expect(await bridge.windows.isVisible({ name: 'settings' })).toBe(true)
  expect(await bridge.windows.isFocused({ name: 'settings' })).toBe(false)
  expect(await bridge.windows.getState({ name: 'settings' })).toEqual({
    isMaximized: false,
    isMinimized: false,
    isVisible: true,
    isFocused: false,
    alwaysOnTop: true,
    opacity: 0.5,
    bounds: {
      x: 110,
      y: 130,
      width: 500,
      height: 400,
    },
    position: {
      x: 110,
      y: 130,
    },
  })
  expect(() => bridge.window.setOpacity({ value: 2 })).toThrow(
    'requires `value` to be between 0 and 1',
  )
  await expect(bridge.windows.open({ name: 'unknown' })).rejects.toThrow(
    'references an unknown window "unknown"',
  )
  await expect(bridge.windows.open({ name: '' })).rejects.toThrow(
    'requires a non-empty `{ name }` object',
  )
})
