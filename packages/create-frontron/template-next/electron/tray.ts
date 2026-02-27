import { app, Menu, nativeImage, Tray } from "electron";

import { resolvePublicPath } from "./paths.js";
import { mainWindow } from "./window.js";

let tray: Tray | null = null;

export function createTray() {
  if (tray || !mainWindow) return;

  try {
    const iconPath = resolvePublicPath("icon.ico");
    const icon = nativeImage.createFromPath(iconPath);

    if (icon.isEmpty()) {
      console.warn("Tray icon could not be loaded:", iconPath);
      return;
    }

    tray = new Tray(icon);
    tray.setToolTip("Frontron");

    tray.on("double-click", () => {
      mainWindow?.show();
    });

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open",
        type: "normal",
        click: () => mainWindow?.show(),
      },
      { type: "separator" },
      {
        label: "Quit",
        type: "normal",
        click: () => app.quit(),
      },
    ]);

    tray.setContextMenu(contextMenu);
  } catch (error) {
    console.error("Failed to create tray:", error);
  }
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }

  tray = null;
}
