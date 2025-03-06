const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
  get: (key) => ipcRenderer.invoke('get-value', key),
  removeListener: (channel, func) => ipcRenderer.removeListener(channel, func),
});