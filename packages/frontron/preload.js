const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frontron', {
  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
  on: (channel, func) => {
    ipcRenderer.on(channel, (event, ...args) => func(...args));
  }
});

module.exports = { contextBridge };