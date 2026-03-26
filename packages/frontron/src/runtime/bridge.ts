import type { FrontronBridgeConfig, FrontronDesktopContext } from '../types'
import type { RustRuntimeHandle } from './native'

function mergeBridgeNamespaces(
  primaryBridge: FrontronBridgeConfig,
  secondaryBridge: FrontronBridgeConfig,
) {
  const merged: FrontronBridgeConfig = { ...primaryBridge }

  for (const [namespace, handlers] of Object.entries(secondaryBridge)) {
    merged[namespace] = {
      ...(primaryBridge[namespace] ?? {}),
      ...handlers,
    }
  }

  return merged
}

function readFiniteNumber(value: unknown, owner: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`[Frontron] "${owner}" requires a finite number.`)
  }

  return value
}

function readBooleanValueInput(input: unknown, owner: string) {
  if (
    !input ||
    typeof input !== 'object' ||
    !('value' in input) ||
    typeof (input as { value?: unknown }).value !== 'boolean'
  ) {
    throw new Error(`[Frontron] "${owner}" requires a \`{ value: boolean }\` object.`)
  }

  return (input as { value: boolean }).value
}

function readOpacityValueInput(input: unknown, owner: string) {
  if (
    !input ||
    typeof input !== 'object' ||
    !('value' in input)
  ) {
    throw new Error(`[Frontron] "${owner}" requires a \`{ value: number }\` object.`)
  }

  const value = readFiniteNumber((input as { value: unknown }).value, `${owner}.value`)

  if (value < 0 || value > 1) {
    throw new Error(`[Frontron] "${owner}" requires \`value\` to be between 0 and 1.`)
  }

  return value
}

function readWindowPositionInput(input: unknown, owner: string) {
  if (!input || typeof input !== 'object') {
    throw new Error(`[Frontron] "${owner}" requires a \`{ x, y }\` object.`)
  }

  return {
    x: readFiniteNumber((input as { x?: unknown }).x, `${owner}.x`),
    y: readFiniteNumber((input as { y?: unknown }).y, `${owner}.y`),
  }
}

function readWindowBoundsInput(input: unknown, owner: string) {
  if (!input || typeof input !== 'object') {
    throw new Error(`[Frontron] "${owner}" requires a \`{ x, y, width, height }\` object.`)
  }

  const bounds = {
    ...readWindowPositionInput(input, owner),
    width: readFiniteNumber((input as { width?: unknown }).width, `${owner}.width`),
    height: readFiniteNumber((input as { height?: unknown }).height, `${owner}.height`),
  }

  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error(`[Frontron] "${owner}" requires \`width\` and \`height\` to be greater than 0.`)
  }

  return bounds
}

function readWindowNameInput(
  input: unknown,
  owner: string,
) {
  if (
    !input ||
    typeof input !== 'object' ||
    !('name' in input) ||
    typeof (input as { name?: unknown }).name !== 'string' ||
    (input as { name: string }).name.trim().length === 0
  ) {
    throw new Error(`[Frontron] "${owner}" requires a non-empty \`{ name }\` object.`)
  }

  return (input as { name: string }).name.trim()
}

function ensureConfiguredWindowName(
  context: FrontronDesktopContext,
  name: string,
  owner: string,
) {
  if (!context.windows.listConfigured().includes(name)) {
    throw new Error(`[Frontron] "${owner}" references an unknown window "${name}".`)
  }

  return name
}

export function createBuiltInBridge(
  appVersion: string,
  context: FrontronDesktopContext,
  rustRuntime: RustRuntimeHandle,
): FrontronBridgeConfig {
  return {
    system: {
      getVersion: () => appVersion,
      getPlatform: () => process.platform,
      getNativeStatus: () => rustRuntime.getStatus(),
      isNativeReady: () => rustRuntime.isReady(),
      openExternal: async (input: unknown) => {
        if (
          typeof input !== 'string' &&
          (!input ||
            typeof input !== 'object' ||
            !('url' in input) ||
            typeof (input as { url?: unknown }).url !== 'string')
        ) {
          throw new Error(
            '[Frontron] "system.openExternal" requires a string URL or `{ url }` object.',
          )
        }

        await context.shell.openExternal(input as string | { url: string })
        return null
      },
    },
    native: {
      getStatus: () => rustRuntime.getStatus(),
      isReady: () => rustRuntime.isReady(),
      add: (left: unknown, right: unknown) =>
        rustRuntime.add(
          readFiniteNumber(left, 'native.add(left)'),
          readFiniteNumber(right, 'native.add(right)'),
        ),
    },
    deepLink: {
      getState: () => context.deepLinks.getState(),
      consumePending: () => context.deepLinks.consumePending(),
    },
    window: {
      isVisible: () => context.window.isVisible(),
      isFocused: () => context.window.isFocused(),
      toggleVisibility: () => {
        context.window.toggleVisibility()
        return null
      },
      showInactive: () => {
        context.window.showInactive()
        return null
      },
      minimize: () => {
        context.window.minimize()
        return null
      },
      toggleMaximize: () => {
        context.window.toggleMaximize()
        return null
      },
      hide: () => {
        context.window.hide()
        return null
      },
      getBounds: () => context.window.getBounds(),
      setBounds: (input: unknown) => {
        context.window.setBounds(readWindowBoundsInput(input, 'window.setBounds'))
        return null
      },
      getPosition: () => context.window.getPosition(),
      setPosition: (input: unknown) => {
        context.window.setPosition(readWindowPositionInput(input, 'window.setPosition'))
        return null
      },
      getAlwaysOnTop: () => context.window.getAlwaysOnTop(),
      setAlwaysOnTop: (input: unknown) => {
        context.window.setAlwaysOnTop(readBooleanValueInput(input, 'window.setAlwaysOnTop'))
        return null
      },
      getOpacity: () => context.window.getOpacity(),
      setOpacity: (input: unknown) => {
        context.window.setOpacity(readOpacityValueInput(input, 'window.setOpacity'))
        return null
      },
      getState: () => context.window.getState(),
    },
    windows: {
      open: async (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.open'),
          'windows.open',
        )
        await context.windows.open(name)
        return null
      },
      isVisible: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.isVisible'),
          'windows.isVisible',
        )
        return context.windows.isVisible(name)
      },
      isFocused: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.isFocused'),
          'windows.isFocused',
        )
        return context.windows.isFocused(name)
      },
      show: async (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.show'),
          'windows.show',
        )
        await context.windows.show(name)
        return null
      },
      showInactive: async (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.showInactive'),
          'windows.showInactive',
        )
        await context.windows.showInactive(name)
        return null
      },
      toggleVisibility: async (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.toggleVisibility'),
          'windows.toggleVisibility',
        )
        await context.windows.toggleVisibility(name)
        return null
      },
      hide: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.hide'),
          'windows.hide',
        )
        context.windows.hide(name)
        return null
      },
      focus: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.focus'),
          'windows.focus',
        )
        context.windows.focus(name)
        return null
      },
      close: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.close'),
          'windows.close',
        )
        context.windows.close(name)
        return null
      },
      minimize: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.minimize'),
          'windows.minimize',
        )
        context.windows.minimize(name)
        return null
      },
      toggleMaximize: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.toggleMaximize'),
          'windows.toggleMaximize',
        )
        context.windows.toggleMaximize(name)
        return null
      },
      exists: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.exists'),
          'windows.exists',
        )
        return context.windows.exists(name)
      },
      getBounds: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.getBounds'),
          'windows.getBounds',
        )
        return context.windows.getBounds(name)
      },
      setBounds: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.setBounds'),
          'windows.setBounds',
        )
        context.windows.setBounds(name, readWindowBoundsInput(input, 'windows.setBounds'))
        return null
      },
      getPosition: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.getPosition'),
          'windows.getPosition',
        )
        return context.windows.getPosition(name)
      },
      setPosition: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.setPosition'),
          'windows.setPosition',
        )
        context.windows.setPosition(name, readWindowPositionInput(input, 'windows.setPosition'))
        return null
      },
      getAlwaysOnTop: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.getAlwaysOnTop'),
          'windows.getAlwaysOnTop',
        )
        return context.windows.getAlwaysOnTop(name)
      },
      setAlwaysOnTop: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.setAlwaysOnTop'),
          'windows.setAlwaysOnTop',
        )
        context.windows.setAlwaysOnTop(
          name,
          readBooleanValueInput(input, 'windows.setAlwaysOnTop'),
        )
        return null
      },
      getOpacity: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.getOpacity'),
          'windows.getOpacity',
        )
        return context.windows.getOpacity(name)
      },
      setOpacity: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.setOpacity'),
          'windows.setOpacity',
        )
        context.windows.setOpacity(name, readOpacityValueInput(input, 'windows.setOpacity'))
        return null
      },
      getState: (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.getState'),
          'windows.getState',
        )
        return context.windows.getState(name)
      },
      listConfigured: () => context.windows.listConfigured(),
      listOpen: () => context.windows.listOpen(),
    },
  }
}

export function createRuntimeBridge(
  configuredBridge: FrontronBridgeConfig | undefined,
  appVersion: string,
  context: FrontronDesktopContext,
  rustRuntime: RustRuntimeHandle,
) {
  const builtInBridge = createBuiltInBridge(appVersion, context, rustRuntime)
  const runtimeBridge = mergeBridgeNamespaces(rustRuntime.getBridge(), configuredBridge ?? {})

  return mergeBridgeNamespaces(runtimeBridge, builtInBridge)
}
