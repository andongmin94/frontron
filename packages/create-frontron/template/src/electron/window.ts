import { existsSync } from "node:fs";
import path from "path";
import { app, BrowserWindow } from "electron";

import { __dirname, isDev } from "./main.js"; // isDev를 main.ts에서 가져옴
import { closeSplash } from "./splash.js";

export let mainWindow: any;

export function createWindow(port: number) {
  const preloadPath = path.join(__dirname, "preload.js");
  if (!existsSync(preloadPath)) {
    console.error(
      `[Frontron] Preload script not found at ${preloadPath}. The custom title bar requires window.electron.`,
    );
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    frame: false,
    resizable: isDev,
    icon: path.join(__dirname, "../../public/icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath, // preload 사용 시 주석 해제
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.webContents.on("did-finish-load", () => {
    void mainWindow.webContents
      .executeJavaScript("Boolean(window.electron)")
      .then((hasBridge) => {
        if (!hasBridge) {
          console.error(
            `[Frontron] window.electron is unavailable in the renderer. Check the preload build output and BrowserWindow preload path: ${preloadPath}`,
          );
        }
      })
      .catch((error: unknown) => {
        console.error("[Frontron] Failed to verify the preload bridge.", error);
      });

    closeSplash(); // 스플래시 닫기
    mainWindow.show();
  });

  // --- 플랫폼별 우클릭 메뉴 비활성화 시도 ---
  if (process.platform === "win32") {
    mainWindow.on("system-context-menu", (event:any) => {
      event.preventDefault();
    });
  } else {
    mainWindow.webContents.on("context-menu", (event: any) => {
      console.log("Main process context-menu event triggered on macOS/Linux");
      event.preventDefault();
    });
  }

  // 창 닫기 이벤트 처리
  mainWindow.on("close", (e: any) => {
    if (process.platform === "darwin") {
      // macOS: 사용자가 명시적으로 종료(Cmd+Q 등)하지 않으면 숨김
      e.preventDefault();
      mainWindow.hide();
      app.dock?.hide(); // Dock 에서도 숨김
    }
    // 다른 OS 에서는 window-all-closed 에서 앱 종료 처리
  });

  mainWindow.on("closed", () => {
    mainWindow = null; // 창 참조 제거
  });
}
