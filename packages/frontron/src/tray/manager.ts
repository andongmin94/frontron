import { Menu, Tray, nativeImage } from "electron";

import type { TrayController, TrayOptions } from "./types";

export function createTrayController(options: TrayOptions): TrayController {
  const {
    app,
    window,
    iconPath,
    tooltip = "Frontron",
    openLabel = "Open",
    quitLabel = "Quit",
  } = options;

  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    throw new Error(`Failed to load tray icon: ${iconPath}`);
  }

  const tray = new Tray(icon);
  tray.setToolTip(tooltip);

  tray.on("double-click", () => {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  });

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: openLabel,
        type: "normal",
        click: () => {
          if (window.isMinimized()) {
            window.restore();
          }
          window.show();
          window.focus();
        },
      },
      { type: "separator" },
      {
        label: quitLabel,
        type: "normal",
        click: () => app.quit(),
      },
    ]),
  );

  return {
    tray,
    destroy() {
      if (!tray.isDestroyed()) {
        tray.destroy();
      }
    },
  };
}
