// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron")

const hideWindowChannel = "window:hide"
const minimizeWindowChannel = "window:minimize"
const toggleMaximizeWindowChannel = "window:toggle-maximize"
const getWindowStateChannel = "window:get-state"
const maximizedChangedChannel = "window:maximized-changed"
const quitAppChannel = "app:quit"

contextBridge.exposeInMainWorld("electron", {
  hideWindow: () => ipcRenderer.send(hideWindowChannel),
  minimizeWindow: () => ipcRenderer.send(minimizeWindowChannel),
  toggleMaximizeWindow: () => ipcRenderer.send(toggleMaximizeWindowChannel),
  quitApp: () => ipcRenderer.send(quitAppChannel),
  getWindowState: () => ipcRenderer.invoke(getWindowStateChannel),
  onWindowMaximizedChanged: (listener: (isMaximized: boolean) => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      listener(Boolean(value))
    }

    ipcRenderer.on(maximizedChangedChannel, wrapped)
    return () => ipcRenderer.removeListener(maximizedChangedChannel, wrapped)
  },
})
