const DEFAULT_LOGGER = {
  info(message) {
    console.info(message);
  },
  warn(message) {
    console.warn(message);
  },
  error(message) {
    console.error(message);
  }
};
const TRACKED_EVENTS = [
  "checking-for-update",
  "update-available",
  "update-not-available",
  "download-progress",
  "update-downloaded",
  "error"
];
function setupAutoUpdater(options) {
  const { updater, onStatus } = options;
  const logger = options.logger ?? DEFAULT_LOGGER;
  const listeners = TRACKED_EVENTS.map((eventName) => {
    const handler = (payload) => {
      onStatus?.(eventName, payload);
      if (eventName === "error") {
        logger.error(`[frontron/updater] ${String(payload?.message ?? payload)}`);
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
          `[frontron/updater] check failed: ${String(error.message ?? error)}`
        );
      }
    },
    dispose() {
      for (const { eventName, handler } of listeners) {
        updater.removeListener(eventName, handler);
      }
    }
  };
}
async function loadElectronAutoUpdater() {
  try {
    const dynamicImport = new Function(
      "modulePath",
      "return import(modulePath)"
    );
    const imported = await dynamicImport("electron-updater");
    return imported.autoUpdater ?? null;
  } catch {
    return null;
  }
}

export { loadElectronAutoUpdater, setupAutoUpdater };
