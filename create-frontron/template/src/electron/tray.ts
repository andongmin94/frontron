import { existsSync } from "node:fs"
import path from "path"
import { app, Menu, nativeImage, Tray } from "electron"

import { __dirname } from "./main.js"
import { mainWindow } from "./window.js"

let tray: Tray | null = null

function loadTrayIcon() {
  const candidatePaths = [
    path.join(__dirname, "../../public/icon.ico"),
    path.join(__dirname, "../../public/logo.svg"),
  ]

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue
    }

    const icon = nativeImage.createFromPath(candidatePath)

    if (!icon.isEmpty()) {
      return icon
    }
  }

  return null
}

export function createTray() {
  const window = mainWindow

  if (tray || !window) return

  const trayIcon = loadTrayIcon()

  if (!trayIcon) {
    console.error(
      "Failed to load a tray icon from public/icon.ico or public/logo.svg."
    )
    return
  }

  tray = new Tray(trayIcon)
  tray.setToolTip(app.getName())

  tray.on("double-click", () => {
    window.show()
  })

  const contextMenu = Menu.buildFromTemplate([
    { label: "Open", type: "normal", click: () => window.show() },
    { type: "separator" },
    {
      label: "Quit",
      type: "normal",
      click: () => app.quit(),
    },
  ])

  tray.setContextMenu(contextMenu)
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}
