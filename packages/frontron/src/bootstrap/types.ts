import type { App, BrowserWindow } from "electron";

import type { CreateMainWindowOptions } from "../window";

export interface SplashOptions {
  width?: number;
  height?: number;
  message?: string;
  fontPath?: string;
  backgroundColor?: string;
  spinnerColor?: string;
  textColor?: string;
}

export interface TrayRuntimeOptions {
  enabled?: boolean;
  iconPath?: string;
  tooltip?: string;
  openLabel?: string;
  quitLabel?: string;
}

export interface StartFrontronAppOptions {
  appName?: string;
  isDev?: boolean;
  rendererDistPath: string;
  preloadPath: string;
  iconPath?: string;
  viteConfigPath?: string;
  devServerPort?: number;
  devServerHost?: string;
  includeLegacyWindowChannels?: boolean;
  splash?: false | SplashOptions;
  tray?: false | TrayRuntimeOptions;
  window?: Partial<
    Omit<
      CreateMainWindowOptions,
      | "isDev"
      | "preloadPath"
      | "iconPath"
      | "rendererDistPath"
      | "devServerHost"
      | "devServerPort"
    >
  >;
  onReady?: (context: FrontronAppContext) => void | Promise<void>;
  onAfterIpcSetup?:
    | ((context: FrontronAppContext) => void | (() => void))
    | ((context: FrontronAppContext) => Promise<void | (() => void)>);
}

export interface FrontronAppContext {
  app: App;
  isDev: boolean;
  devServerPort: number | null;
  mainWindow: BrowserWindow;
}

export interface FrontronAppHandle {
  started: boolean;
  reason?: "single-instance-locked";
}
