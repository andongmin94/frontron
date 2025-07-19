// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron")

const getAppInfoChannel = "app:get-info"
const openTextFileChannel = "file:open-text"
const saveTextFileChannel = "file:save-text"
const readClipboardTextChannel = "clipboard:read-text"
const writeClipboardTextChannel = "clipboard:write-text"
const showNotificationChannel = "notification:show"

contextBridge.exposeInMainWorld("electron", {
  getAppInfo: () => ipcRenderer.invoke(getAppInfoChannel),
  openTextFile: (options?: unknown) =>
    ipcRenderer.invoke(openTextFileChannel, options),
  saveTextFile: (options: unknown) =>
    ipcRenderer.invoke(saveTextFileChannel, options),
  readClipboardText: () => ipcRenderer.invoke(readClipboardTextChannel),
  writeClipboardText: (text: string) =>
    ipcRenderer.invoke(writeClipboardTextChannel, text),
  showNotification: (options: unknown) =>
    ipcRenderer.invoke(showNotificationChannel, options),
})
