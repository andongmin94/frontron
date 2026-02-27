import path from "node:path";

import { BrowserWindow, ipcMain } from "electron";

import { LEGACY_WINDOW_CHANNELS, WINDOW_CHANNELS } from "../core/channels";
import type {
  CreateMainWindowOptions,
  RegisterWindowIpcHandlersOptions,
  WindowIpcChannels,
  WindowLoadTarget,
  WindowStatePayload,
} from "./types";

function getWindowState(window: BrowserWindow): WindowStatePayload {
  return {
    isMaximized: window.isMaximized(),
    isMinimized: window.isMinimized(),
  };
}

export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
  const {
    isDev,
    preloadPath,
    iconPath,
    rendererDistPath,
    devServerHost = "127.0.0.1",
    devServerPort = 3000,
    width = 1200,
    height = 800,
    frame = false,
    showOnReady = true,
    resizableInDev = true,
    disableContextMenu = true,
    hideOnCloseForMac = true,
    loadTarget,
    onDidFinishLoad,
  } = options;

  const mainWindow = new BrowserWindow({
    show: false,
    width,
    height,
    frame,
    resizable: isDev ? resizableInDev : true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  const resolvedLoadTarget: WindowLoadTarget =
    loadTarget ??
    (isDev
      ? {
          kind: "url",
          value: `http://${devServerHost}:${devServerPort}`,
        }
      : {
          kind: "file",
          value: path.join(rendererDistPath ?? "", "index.html"),
        });

  if (resolvedLoadTarget.kind === "url") {
    void mainWindow.loadURL(resolvedLoadTarget.value);
  } else {
    if (!rendererDistPath && !loadTarget) {
      throw new Error(
        "rendererDistPath is required for file load target when loadTarget is not provided.",
      );
    }
    void mainWindow.loadFile(resolvedLoadTarget.value);
  }

  mainWindow.webContents.on("did-finish-load", () => {
    if (showOnReady) {
      mainWindow.show();
    }
    onDidFinishLoad?.(mainWindow);
  });

  if (disableContextMenu) {
    if (process.platform === "win32") {
      mainWindow.on("system-context-menu", (event) => {
        event.preventDefault();
      });
    } else {
      mainWindow.webContents.on("context-menu", (event) => {
        event.preventDefault();
      });
    }
  }

  mainWindow.on("close", (event) => {
    if (hideOnCloseForMac && process.platform === "darwin") {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}

export function registerWindowControlIpcHandlers(
  options: RegisterWindowIpcHandlersOptions,
) {
  const { window, ipcMainInstance = ipcMain, includeLegacyChannels = true } = options;
  const channels: WindowIpcChannels = {
    hide: options.channels?.hide ?? WINDOW_CHANNELS.hide,
    minimize: options.channels?.minimize ?? WINDOW_CHANNELS.minimize,
    toggleMaximize: options.channels?.toggleMaximize ?? WINDOW_CHANNELS.toggleMaximize,
    state: options.channels?.state ?? WINDOW_CHANNELS.state,
    maximizedChanged:
      options.channels?.maximizedChanged ?? WINDOW_CHANNELS.maximizedChanged,
  };

  const hideChannels = includeLegacyChannels
    ? [channels.hide, LEGACY_WINDOW_CHANNELS.hide]
    : [channels.hide];
  const minimizeChannels = includeLegacyChannels
    ? [channels.minimize, LEGACY_WINDOW_CHANNELS.minimize]
    : [channels.minimize];
  const toggleChannels = includeLegacyChannels
    ? [channels.toggleMaximize, LEGACY_WINDOW_CHANNELS.toggleMaximize]
    : [channels.toggleMaximize];
  const stateChannels = includeLegacyChannels
    ? [channels.state, LEGACY_WINDOW_CHANNELS.state]
    : [channels.state];
  const stateEventChannels = includeLegacyChannels
    ? [channels.maximizedChanged, LEGACY_WINDOW_CHANNELS.maximizedChanged]
    : [channels.maximizedChanged];

  const sendWindowState = () => {
    const payload = window.isMaximized();
    for (const channel of stateEventChannels) {
      window.webContents.send(channel, payload);
    }
  };

  const onMinimize = () => {
    if (!window.isDestroyed()) {
      window.minimize();
    }
  };
  const onHide = () => {
    if (!window.isDestroyed()) {
      window.hide();
    }
  };
  const onToggleMaximize = () => {
    if (window.isDestroyed()) {
      return;
    }
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    sendWindowState();
  };

  for (const channel of minimizeChannels) {
    ipcMainInstance.on(channel, onMinimize);
  }
  for (const channel of hideChannels) {
    ipcMainInstance.on(channel, onHide);
  }
  for (const channel of toggleChannels) {
    ipcMainInstance.on(channel, onToggleMaximize);
  }
  for (const channel of stateChannels) {
    ipcMainInstance.removeHandler(channel);
    ipcMainInstance.handle(channel, () => getWindowState(window));
  }

  window.on("maximize", sendWindowState);
  window.on("unmaximize", sendWindowState);

  return () => {
    window.removeListener("maximize", sendWindowState);
    window.removeListener("unmaximize", sendWindowState);

    for (const channel of minimizeChannels) {
      ipcMainInstance.removeListener(channel, onMinimize);
    }
    for (const channel of hideChannels) {
      ipcMainInstance.removeListener(channel, onHide);
    }
    for (const channel of toggleChannels) {
      ipcMainInstance.removeListener(channel, onToggleMaximize);
    }
    for (const channel of stateChannels) {
      ipcMainInstance.removeHandler(channel);
    }
  };
}
