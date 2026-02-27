import type { App, BrowserWindow, Tray } from "electron";

export interface TrayOptions {
  app: App;
  window: BrowserWindow;
  iconPath: string;
  tooltip?: string;
  openLabel?: string;
  quitLabel?: string;
}

export interface TrayController {
  tray: Tray | null;
  destroy(): void;
}
