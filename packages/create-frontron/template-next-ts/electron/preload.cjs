const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
  removeListener: (channel, func) => ipcRenderer.removeListener(channel, func),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  get: (key) => ipcRenderer.invoke('get-store-value', key),
  set: (key, value) => ipcRenderer.invoke('set-store-value', key, value),
});