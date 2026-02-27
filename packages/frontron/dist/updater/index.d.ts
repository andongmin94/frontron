type UpdaterEventName = "checking-for-update" | "update-available" | "update-not-available" | "download-progress" | "update-downloaded" | "error";
interface AutoUpdaterLike {
    on(event: UpdaterEventName, listener: (...args: unknown[]) => void): void;
    removeListener(event: UpdaterEventName, listener: (...args: unknown[]) => void): void;
    checkForUpdatesAndNotify(): Promise<unknown>;
}
interface UpdaterLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
interface SetupAutoUpdaterOptions {
    updater: AutoUpdaterLike;
    logger?: UpdaterLogger;
    onStatus?: (event: UpdaterEventName, payload: unknown) => void;
}
interface FrontronUpdaterController {
    check(): Promise<void>;
    dispose(): void;
}

declare function setupAutoUpdater(options: SetupAutoUpdaterOptions): FrontronUpdaterController;
declare function loadElectronAutoUpdater(): Promise<AutoUpdaterLike | null>;

export { loadElectronAutoUpdater, setupAutoUpdater };
export type { AutoUpdaterLike, FrontronUpdaterController, SetupAutoUpdaterOptions, UpdaterEventName, UpdaterLogger };
