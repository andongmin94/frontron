import { contextBridge, ipcRenderer } from "electron";

import {
  DEFAULT_INVOKE_CHANNELS,
  DEFAULT_ON_CHANNELS,
  DEFAULT_SEND_CHANNELS,
} from "./channels";
import type { ExposeBridgeOptions, FrontronBridge, FrontronListener } from "./types";

function assertChannel(
  channel: string,
  allowedChannels: ReadonlySet<string>,
  allowUnsafeChannels: boolean,
  operation: "send" | "invoke" | "on",
) {
  if (!allowUnsafeChannels && !allowedChannels.has(channel)) {
    throw new Error(`Blocked IPC ${operation} channel: "${channel}"`);
  }
}

export function createFrontronBridge(options: ExposeBridgeOptions = {}): FrontronBridge {
  const {
    allowUnsafeChannels = false,
    sendChannels = DEFAULT_SEND_CHANNELS,
    invokeChannels = DEFAULT_INVOKE_CHANNELS,
    onChannels = DEFAULT_ON_CHANNELS,
  } = options;

  const sendSet = new Set(sendChannels);
  const invokeSet = new Set(invokeChannels);
  const onSet = new Set(onChannels);

  return {
    send(channel: string, payload?: unknown) {
      assertChannel(channel, sendSet, allowUnsafeChannels, "send");
      ipcRenderer.send(channel, payload);
    },
    invoke<TResult = unknown>(channel: string, payload?: unknown) {
      assertChannel(channel, invokeSet, allowUnsafeChannels, "invoke");
      return ipcRenderer.invoke(channel, payload) as Promise<TResult>;
    },
    on(channel: string, listener: FrontronListener) {
      assertChannel(channel, onSet, allowUnsafeChannels, "on");
      const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args);
      ipcRenderer.on(channel, wrapped);
      return () => {
        ipcRenderer.removeListener(channel, wrapped);
      };
    },
    removeListener(channel: string, listener: FrontronListener) {
      ipcRenderer.removeListener(channel, listener as (...args: unknown[]) => void);
    },
  };
}

export function exposeFrontronBridge(options: ExposeBridgeOptions = {}) {
  const key = options.globalKey ?? "electron";
  const bridge = createFrontronBridge(options);
  contextBridge.exposeInMainWorld(key, bridge);
}
