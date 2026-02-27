import type {
  AutoUpdaterLike,
  FrontronUpdaterController,
  SetupAutoUpdaterOptions,
  UpdaterEventName,
  UpdaterLogger,
} from "./types";

const DEFAULT_LOGGER: UpdaterLogger = {
  info(message) {
    console.info(message);
  },
  warn(message) {
    console.warn(message);
  },
  error(message) {
    console.error(message);
  },
};

const TRACKED_EVENTS: readonly UpdaterEventName[] = [
  "checking-for-update",
  "update-available",
  "update-not-available",
  "download-progress",
  "update-downloaded",
  "error",
];

export function setupAutoUpdater(
  options: SetupAutoUpdaterOptions,
): FrontronUpdaterController {
  const { updater, onStatus } = options;
  const logger = options.logger ?? DEFAULT_LOGGER;

  const listeners = TRACKED_EVENTS.map((eventName) => {
    const handler = (payload: unknown) => {
      onStatus?.(eventName, payload);
      if (eventName === "error") {
        logger.error(`[frontron/updater] ${String((payload as Error)?.message ?? payload)}`);
      } else {
        logger.info(`[frontron/updater] ${eventName}`);
      }
    };
    updater.on(eventName, handler);
    return { eventName, handler };
  });

  return {
    async check() {
      try {
        await updater.checkForUpdatesAndNotify();
      } catch (error) {
        logger.error(
          `[frontron/updater] check failed: ${String((error as Error).message ?? error)}`,
        );
      }
    },
    dispose() {
      for (const { eventName, handler } of listeners) {
        updater.removeListener(eventName, handler);
      }
    },
  };
}

export async function loadElectronAutoUpdater(): Promise<AutoUpdaterLike | null> {
  try {
    const dynamicImport = new Function(
      "modulePath",
      "return import(modulePath)",
    ) as (modulePath: string) => Promise<{ autoUpdater?: AutoUpdaterLike }>;
    const imported = await dynamicImport("electron-updater");
    return imported.autoUpdater ?? null;
  } catch {
    return null;
  }
}
