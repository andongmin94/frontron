const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld('electron', {
  send: (channel: any, data: any) => ipcRenderer.send(channel, data),
  on: (channel: any, func: (...args: any[]) => any) => ipcRenderer.on(channel, (event: any, ...args: any[]) => func(...args)),
  get: (key: any) => ipcRenderer.invoke('get-value', key),
  removeListener: (channel: any, func: any) => ipcRenderer.removeListener(channel, func),
});