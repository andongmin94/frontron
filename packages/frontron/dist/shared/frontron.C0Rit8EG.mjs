import { ipcRenderer, contextBridge } from 'electron';
import { a as DEFAULT_ON_CHANNELS, b as DEFAULT_SEND_CHANNELS, D as DEFAULT_INVOKE_CHANNELS } from './frontron.CDRXnvFQ.mjs';

function assertChannel(channel, allowedChannels, allowUnsafeChannels, operation) {
  if (!allowUnsafeChannels && !allowedChannels.has(channel)) {
    throw new Error(`Blocked IPC ${operation} channel: "${channel}"`);
  }
}
function createFrontronBridge(options = {}) {
  const {
    allowUnsafeChannels = false,
    sendChannels = DEFAULT_SEND_CHANNELS,
    invokeChannels = DEFAULT_INVOKE_CHANNELS,
    onChannels = DEFAULT_ON_CHANNELS
  } = options;
  const sendSet = new Set(sendChannels);
  const invokeSet = new Set(invokeChannels);
  const onSet = new Set(onChannels);
  return {
    send(channel, payload) {
      assertChannel(channel, sendSet, allowUnsafeChannels, "send");
      ipcRenderer.send(channel, payload);
    },
    invoke(channel, payload) {
      assertChannel(channel, invokeSet, allowUnsafeChannels, "invoke");
      return ipcRenderer.invoke(channel, payload);
    },
    on(channel, listener) {
      assertChannel(channel, onSet, allowUnsafeChannels, "on");
      const wrapped = (_event, ...args) => listener(...args);
      ipcRenderer.on(channel, wrapped);
      return () => {
        ipcRenderer.removeListener(channel, wrapped);
      };
    },
    removeListener(channel, listener) {
      ipcRenderer.removeListener(channel, listener);
    }
  };
}
function exposeFrontronBridge(options = {}) {
  const key = options.globalKey ?? "electron";
  const bridge = createFrontronBridge(options);
  contextBridge.exposeInMainWorld(key, bridge);
}

export { createFrontronBridge as c, exposeFrontronBridge as e };
