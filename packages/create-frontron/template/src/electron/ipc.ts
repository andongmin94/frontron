import { ipcMain } from "electron";
import { mainWindow } from "./window.js";

export function setupIpcHandlers() {
  if (!mainWindow) return;

  // 창 상태 변화 이벤트 → 렌더러에 전달
  const sendMaxState = () =>
    mainWindow.webContents.send("window-maximized-changed", mainWindow.isMaximized());

  mainWindow.on("maximize", sendMaxState);
  mainWindow.on("unmaximize", sendMaxState);

  ipcMain.on("hidden", () => {
    mainWindow.hide();
  });

  ipcMain.on("minimize", () => {
    mainWindow.minimize();
  });

  // 토글 방식으로 변경
  ipcMain.on("toggle-maximize", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    sendMaxState();
  });

  // (선택) 렌더러가 초기 상태 요청할 수 있게
  ipcMain.handle("get-window-state", () => ({
    isMaximized: mainWindow.isMaximized(),
    isMinimized: mainWindow.isMinimized(),
  }));
}