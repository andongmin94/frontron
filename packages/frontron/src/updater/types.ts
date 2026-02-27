export type UpdaterEventName =
  | "checking-for-update"
  | "update-available"
  | "update-not-available"
  | "download-progress"
  | "update-downloaded"
  | "error";

export interface AutoUpdaterLike {
  on(event: UpdaterEventName, listener: (...args: unknown[]) => void): void;
  removeListener(event: UpdaterEventName, listener: (...args: unknown[]) => void): void;
  checkForUpdatesAndNotify(): Promise<unknown>;
}

export interface UpdaterLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SetupAutoUpdaterOptions {
  updater: AutoUpdaterLike;
  logger?: UpdaterLogger;
  onStatus?: (event: UpdaterEventName, payload: unknown) => void;
}

export interface FrontronUpdaterController {
  check(): Promise<void>;
  dispose(): void;
}
