import path from "path";
import { fileURLToPath } from "url";
import { app, Menu } from "electron";

import { setupDevMenu } from "./dev.js";
import { setupIpcHandlers } from "./ipc.js";
import { determinePort, waitForPortReady } from "./serve.js";
import { closeSplash, createSplash } from "./splash.js";
import { createTray, destroyTray } from "./tray.js";
import { createWindow, mainWindow } from "./window.js";

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const isDev = process.env.NODE_ENV === "development";

async function initializeApp() {
  await app.whenReady();
  createSplash();

  const port = await determinePort();
  // 변경: 포트 계산이 잘못되면 즉시 실패 처리
  if (typeof port !== "number" || !Number.isFinite(port) || port <= 0) {
    throw new Error(`Failed to determine a valid port. Received: ${String(port)}`);
  }

  // 변경: 고정 지연(setTimeout) 대신 렌더러 준비 상태를 기다린 뒤 실행
  if (isDev) {
    await waitForPortReady(port);
  }

  createWindow(port);
  createTray();
  setupIpcHandlers();

  if (isDev) setupDevMenu();
  else Menu.setApplicationMenu(null);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    console.log("Second instance launched:", {
      event,
      commandLine,
      workingDirectory,
    });

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  initializeApp().catch(async (error) => {
    console.error("Failed to initialize app:", error);
    closeSplash();

    const { dialog } = await import("electron");
    if (dialog) {
      dialog.showErrorBox("Error", `Failed to initialize app:\n${(error as Error).message}`);
    }

    app.quit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (mainWindow === null) {
      console.log(
        "Activate event: No window found, consider re-initialization logic if needed.",
      );
    } else {
      mainWindow.show();
    }
  });

  app.on("before-quit", () => {
    destroyTray();
  });
}
