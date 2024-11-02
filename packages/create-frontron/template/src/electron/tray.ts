import path from "path";
import { app, Menu, nativeImage, Tray } from "electron";

import { __dirname } from "./main.js"; // __dirname을 main.ts에서 가져옴
import { mainWindow } from "./window.js";

let tray: any;

export function createTray() {
  if (tray || !mainWindow) return; // 중복 생성 방지 및 mainWindow 확인

  try {
    const iconPath = path.join(__dirname, "../../public/icon.ico");
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.error("Failed to load tray icon:", iconPath);
      return;
    }
    tray = new Tray(icon);
    tray.setToolTip("Frontron");

    tray.on("double-click", () => {
      mainWindow.show();
    });

    const contextMenu = Menu.buildFromTemplate([
      { label: "열기", type: "normal", click: () => mainWindow.show() },
      { type: "separator" },
      {
        label: "종료",
        type: "normal",
        click: () => {
          app.quit(); // 앱 종료 요청 (before-quit 이벤트 트리거)
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  } catch (error) {
    console.error("Failed to create tray:", error);
  }
}

/**
 * 트레이 아이콘 제거
 */
export function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}
