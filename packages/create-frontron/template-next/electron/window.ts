import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { app, BrowserWindow } from "electron";

import { isDev } from "./main.js";
import { resolvePublicPath } from "./paths.js";
import { closeSplash } from "./splash.js";

export let mainWindow: any = null;
const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function createWindow(port: number) {
  const iconPath = resolvePublicPath("icon.ico");

  mainWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    frame: false,
    resizable: isDev,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      sandbox: false,
      contextIsolation: true,
      preload: path.join(currentDir, "preload.mjs"),
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.webContents.on("did-finish-load", () => {
    closeSplash();
    mainWindow?.show();
  });

  if (process.platform === "win32") {
    mainWindow.on("system-context-menu", (event: any) => {
      event.preventDefault();
    });
  } else {
    mainWindow.webContents.on("context-menu", (event: any) => {
      event.preventDefault();
    });
  }

  mainWindow.on("close", (event: any) => {
    if (process.platform === "darwin") {
      event.preventDefault();
      mainWindow?.hide();
      app.dock?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
