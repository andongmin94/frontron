import { Menu } from "electron";

import { mainWindow } from "./window.js";

export function setupDevMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Developer",
        submenu: [
          {
            label: "Reload",
            accelerator: "F5",
            click: () => mainWindow.reload(),
          },
          {
            label: "Toggle DevTools",
            accelerator: "F12",
            click: () => mainWindow.webContents.toggleDevTools(),
          },
        ],
      },
    ]),
  );
}
