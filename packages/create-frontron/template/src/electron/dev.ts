import { Menu } from "electron";

import { getMainWindow } from "./window.js";

export function setupDevMenu() {
  const mainWindow = getMainWindow();
  const menu = Menu.buildFromTemplate([
    {
      label: "Developer",
      submenu: [
        {
          label: "Reload",
          accelerator: "F5",
          click: () => mainWindow?.reload(),
        },
        {
          label: "Toggle DevTools",
          accelerator: "F12",
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}
