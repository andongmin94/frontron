import { app, ipcMain } from "electron"

import { mainWindow } from "./window.js"

const hideWindowChannel = "window:hide"
const minimizeWindowChannel = "window:minimize"
const toggleMaximizeWindowChannel = "window:toggle-maximize"
const getWindowStateChannel = "window:get-state"
const maximizedChangedChannel = "window:maximized-changed"
const quitAppChannel = "app:quit"

export function setupIpcHandlers() {
  const window = mainWindow

  if (!window) return

  const sendMaxState = () =>
    window.webContents.send(maximizedChangedChannel, window.isMaximized())

  window.on("maximize", sendMaxState)
  window.on("unmaximize", sendMaxState)

  ipcMain.on(hideWindowChannel, () => {
    window.hide()
  })

  ipcMain.on(minimizeWindowChannel, () => {
    window.minimize()
  })

  ipcMain.on(toggleMaximizeWindowChannel, () => {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    sendMaxState()
  })

  ipcMain.on(quitAppChannel, () => {
    app.quit()
  })

  ipcMain.handle(getWindowStateChannel, () => ({
    isMaximized: window.isMaximized(),
    isMinimized: window.isMinimized(),
  }))
}
