import type { FrontronNativeStatus, FrontronWindowState } from './types'

export type BridgeHandler = (...args: unknown[]) => unknown
type BridgeNamespace = Record<string, BridgeHandler>
export type BridgeRuntime = Record<string, BridgeNamespace>

export interface FrontronBuiltInBridge {
  native: {
    getStatus(): Promise<FrontronNativeStatus>
    isReady(): Promise<boolean>
    add(left: number, right: number): Promise<number>
  }
  system: {
    getVersion(): Promise<string>
    getPlatform(): Promise<string>
    getNativeStatus(): Promise<FrontronNativeStatus>
    isNativeReady(): Promise<boolean>
    openExternal(input: string | { url: string }): Promise<null>
  }
  window: {
    minimize(): Promise<null>
    toggleMaximize(): Promise<null>
    hide(): Promise<null>
    getState(): Promise<FrontronWindowState>
    onMaximizedChanged(listener: (isMaximized: boolean) => void): () => void
  }
}

export interface FrontronGeneratedBridge {
  [namespace: string]: Record<string, BridgeHandler>
}

export type FrontronBridge = FrontronBuiltInBridge & FrontronGeneratedBridge

declare global {
  var __FRONTRON_BRIDGE__: BridgeRuntime | undefined

  interface Window {
    __FRONTRON_BRIDGE__?: BridgeRuntime
  }
}

function readBridgeRuntime() {
  if (globalThis.__FRONTRON_BRIDGE__) {
    return globalThis.__FRONTRON_BRIDGE__
  }

  if (typeof window !== 'undefined' && window.__FRONTRON_BRIDGE__) {
    return window.__FRONTRON_BRIDGE__
  }

  throw new Error(
    '[Frontron] Bridge runtime is unavailable. Attach the desktop bridge before calling frontron/client.',
  )
}

export const bridge = new Proxy({} as FrontronBridge, {
  get(_target, namespace) {
    return new Proxy({} as Record<string, BridgeHandler>, {
      get(_namespaceTarget, method) {
        return (...args: unknown[]) => {
          const runtime = readBridgeRuntime()
          const namespaceValue = runtime[String(namespace)]
          const handler = namespaceValue?.[String(method)]

          if (typeof handler !== 'function') {
            throw new Error(
              `[Frontron] Missing bridge handler "${String(namespace)}.${String(method)}".`,
            )
          }

          return handler(...args)
        }
      },
    })
  },
})

export function installBridgeRuntime(runtime: BridgeRuntime) {
  globalThis.__FRONTRON_BRIDGE__ = runtime
}

export function clearBridgeRuntime() {
  delete globalThis.__FRONTRON_BRIDGE__

  if (typeof window !== 'undefined') {
    delete window.__FRONTRON_BRIDGE__
  }
}
