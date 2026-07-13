import { existsSync } from "node:fs"
import path from "path"
import { app, Menu, nativeImage, Tray } from "electron"

import { __dirname } from "./main.js"
import { mainWindow } from "./window.js"

let tray: Tray | null = null

async function loadTrayIcon() {
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

  try {
    const executableIcon = await app.getFileIcon(process.execPath)

    if (!executableIcon.isEmpty()) {
      return executableIcon
    }
  } catch (error) {
    console.warn(`Failed to load the executable icon at ${process.execPath}.`, error)
  }

  return null
}

export async function createTray() {
  const window = mainWindow

  if (tray || !window) return

  const trayIcon = await loadTrayIcon()

  if (!trayIcon) {
    console.error(
      "Failed to load a tray icon from public assets or the app executable."
    )
    return
  }

  if (tray || window.isDestroyed()) return

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
