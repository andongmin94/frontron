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
