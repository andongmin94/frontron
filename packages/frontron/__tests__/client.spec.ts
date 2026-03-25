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
      async listConfigured() {
        return ['main', 'settings']
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
  await expect(bridge.windows.open({ name: 'settings' })).resolves.toEqual({ name: 'settings' })
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
