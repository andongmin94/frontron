import { afterEach, expect, test, vi } from 'vitest'

import { bridge, clearBridgeRuntime, installBridgeRuntime } from '../src/client'

afterEach(() => {
  clearBridgeRuntime()
  delete (globalThis as { window?: unknown }).window
  vi.restoreAllMocks()
})

test('bridge throws when runtime is unavailable', () => {
  expect(() => bridge.system.getVersion()).toThrow('Bridge runtime is unavailable')
})

test('bridge forwards calls to the installed runtime', async () => {
  installBridgeRuntime({
    native: {
      async add(left, right) {
        return Number(left) + Number(right)
      },
    },
    system: {
      async getVersion() {
        return '1.0.0'
      },
      async getNativeStatus() {
        return {
          enabled: true,
          loaded: true,
          ready: true,
        }
      },
    },
    windows: {
      async open(input) {
        return input
      },
      async isVisible(input) {
        return (input as { name: string }).name === 'settings'
      },
      async isFocused(input) {
        return (input as { name: string }).name === 'main'
      },
      async toggleVisibility(input) {
        return input
      },
      async setOpacity(input) {
        return input
      },
      async listConfigured() {
        return ['main', 'settings']
      },
    },
    window: {
      async isVisible() {
        return false
      },
      async isFocused() {
        return true
      },
      async toggleVisibility() {
        return null
      },
      async getBounds() {
        return {
          x: 40,
          y: 60,
          width: 800,
          height: 600,
        }
      },
    },
  })

  await expect(bridge.system.getVersion()).resolves.toBe('1.0.0')
  await expect(bridge.system.getNativeStatus()).resolves.toEqual({
    enabled: true,
    loaded: true,
    ready: true,
  })
  await expect(bridge.native.add(2, 3)).resolves.toBe(5)
  await expect(bridge.window.getBounds()).resolves.toEqual({
    x: 40,
    y: 60,
    width: 800,
    height: 600,
  })
  await expect(bridge.window.isVisible()).resolves.toBe(false)
  await expect(bridge.window.isFocused()).resolves.toBe(true)
  await expect(bridge.window.toggleVisibility()).resolves.toBeNull()
  await expect(bridge.windows.open({ name: 'settings' })).resolves.toEqual({ name: 'settings' })
  await expect(bridge.windows.isVisible({ name: 'settings' })).resolves.toBe(true)
  await expect(bridge.windows.isFocused({ name: 'settings' })).resolves.toBe(false)
  await expect(bridge.windows.toggleVisibility({ name: 'settings' })).resolves.toEqual({
    name: 'settings',
  })
  await expect(bridge.windows.setOpacity({ name: 'settings', value: 0.8 })).resolves.toEqual({
    name: 'settings',
    value: 0.8,
  })
  await expect(bridge.windows.listConfigured()).resolves.toEqual(['main', 'settings'])
})

test('bridge does not fall back to removed window.electron globals', () => {
  ;(globalThis as { window?: unknown }).window = {
    electron: {
      send: vi.fn(),
      invoke: vi.fn(),
      on: vi.fn(),
    },
  }

  expect(() => bridge.window.minimize()).toThrow('Bridge runtime is unavailable')
})
