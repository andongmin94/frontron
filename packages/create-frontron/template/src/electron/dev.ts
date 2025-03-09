import { Menu } from "electron"

import { mainWindow } from "./window.js"

export function setupDevMenu() {
  const window = mainWindow

  if (!window) return

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Developer",
        submenu: [
          {
            label: "Reload",
            accelerator: "F5",
            click: () => window.reload(),
          },
          {
            label: "Toggle DevTools",
            accelerator: "F12",
            click: () => window.webContents.toggleDevTools(),
          },
        ],
      },
    ])
  )
}
