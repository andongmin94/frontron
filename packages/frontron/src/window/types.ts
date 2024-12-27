import type { BrowserWindow, IpcMain } from "electron";

export interface CreateMainWindowOptions {
  isDev: boolean;
  preloadPath: string;
  iconPath?: string;
  rendererDistPath: string;
  devServerHost?: string;
  devServerPort?: number;
  width?: number;
  height?: number;
  frame?: boolean;
  showOnReady?: boolean;
  resizableInDev?: boolean;
  disableContextMenu?: boolean;
  hideOnCloseForMac?: boolean;
  onDidFinishLoad?: (window: BrowserWindow) => void;
}

export interface WindowIpcChannels {
  hide: string;
  minimize: string;
  toggleMaximize: string;
  state: string;
  maximizedChanged: string;
}

export interface RegisterWindowIpcHandlersOptions {
  window: BrowserWindow;
  ipcMainInstance?: IpcMain;
  channels?: Partial<WindowIpcChannels>;
  includeLegacyChannels?: boolean;
}

export interface WindowStatePayload {
  isMaximized: boolean;
  isMinimized: boolean;
}
