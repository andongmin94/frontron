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
      show: async (input: unknown) => {
        const name = ensureConfiguredWindowName(
          context,
          readWindowNameInput(input, 'windows.show'),
          'windows.show',
        )
        await context.windows.show(name)
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
