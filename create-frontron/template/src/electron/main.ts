import path from "path"
import { fileURLToPath } from "url"
import { app, Menu } from "electron"

import { setupDevMenu } from "./dev.js"
import { setupIpcHandlers } from "./ipc.js"
import {
  inferDevUrl,
  startRendererServer,
  stopRendererServer,
  waitForUrlReady,
} from "./serve.js"
import { closeSplash, createSplash } from "./splash.js"
import { createTray, destroyTray } from "./tray.js"
import { createWindow, mainWindow } from "./window.js"

export const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const isDev = process.env.NODE_ENV === "development"
export let isQuitting = false

async function initializeApp() {
  await app.whenReady()
  createSplash()

  let rendererUrl: string

  if (isDev) {
    rendererUrl =
      process.env.ELECTRON_RENDERER_URL?.trim() || (await inferDevUrl())
    await waitForUrlReady(rendererUrl)
  } else {
    rendererUrl = await startRendererServer()
  }

  createWindow(rendererUrl)
  createTray()
  setupIpcHandlers()

  if (isDev) setupDevMenu()
  else Menu.setApplicationMenu(null)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  initializeApp().catch(async (error) => {
    console.error("Failed to initialize app:", error)
    closeSplash()
    await stopRendererServer().catch(() => {})

    const { dialog } = await import("electron")
    dialog.showErrorBox(
      "Error",
      `Failed to initialize app:\n${(error as Error).message}`
    )

    app.quit()
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("activate", () => {
    if (mainWindow) {
      mainWindow.show()
    }
  })

  app.on("before-quit", () => {
    isQuitting = true
    destroyTray()
    void stopRendererServer().catch((error: unknown) => {
      console.error("Failed to stop renderer server:", error)
    })
  })
}
