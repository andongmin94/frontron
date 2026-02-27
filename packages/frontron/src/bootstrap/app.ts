import path from "node:path";

import { Menu, app, dialog } from "electron";

import { createTrayController } from "../tray";
import { createMainWindow, registerWindowControlIpcHandlers } from "../window";
import { getPortFromViteConfig, waitForPortReady } from "./dev-server";
import { closeSplashWindow, createSplashWindow } from "./splash";
import type { FrontronAppHandle, StartFrontronAppOptions } from "./types";

function setupDevMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Developer",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
        ],
      },
    ]),
  );
}

export async function startFrontronApp(
  options: StartFrontronAppOptions,
): Promise<FrontronAppHandle> {
  const isDev = options.isDev ?? process.env.NODE_ENV === "development";
  const includeLegacyWindowChannels = options.includeLegacyWindowChannels ?? true;
  const devServerHost = options.devServerHost ?? "127.0.0.1";
  const waitForDevServer = options.waitForDevServer ?? true;

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return {
      started: false,
      reason: "single-instance-locked",
    };
  }

  let mainWindow: Electron.BrowserWindow | null = null;
  let splashWindow: Electron.BrowserWindow | null = null;
  let cleanupIpc = () => {};
  let cleanupCustom = () => {};
  let trayController: ReturnType<typeof createTrayController> | null = null;

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  const initialize = async () => {
    await app.whenReady();

    if (options.splash !== false) {
      splashWindow = createSplashWindow(options.splash ?? {});
    }

    let resolvedDevPort: number | null = null;
    if (isDev) {
      if (options.resolveDevServerPort) {
        resolvedDevPort = await options.resolveDevServerPort({ app, isDev });
      } else {
        resolvedDevPort =
          options.devServerPort ??
          (options.viteConfigPath ? getPortFromViteConfig(options.viteConfigPath) : null) ??
          3000;
      }
      if (waitForDevServer) {
        await waitForPortReady(resolvedDevPort, { host: devServerHost });
      }
    }

    const resolvedLoadTarget = options.resolveRendererLoadTarget
      ? await options.resolveRendererLoadTarget({
          app,
          isDev,
          devServerPort: resolvedDevPort,
          devServerHost,
          rendererDistPath: options.rendererDistPath,
        })
      : undefined;

    const windowInstance = createMainWindow({
      isDev,
      preloadPath: options.preloadPath,
      iconPath: options.iconPath,
      rendererDistPath: options.rendererDistPath,
      devServerHost,
      devServerPort: resolvedDevPort ?? 3000,
      loadTarget: resolvedLoadTarget,
      ...options.window,
      onDidFinishLoad(window) {
        closeSplashWindow(splashWindow);
        splashWindow = null;
        options.window?.onDidFinishLoad?.(window);
      },
    });

    mainWindow = windowInstance;
    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    cleanupIpc = registerWindowControlIpcHandlers({
      window: windowInstance,
      includeLegacyChannels: includeLegacyWindowChannels,
    });

    const context = {
      app,
      isDev,
      devServerPort: resolvedDevPort,
      mainWindow: windowInstance,
    };

    const customCleanup = await options.onAfterIpcSetup?.(context);
    if (typeof customCleanup === "function") {
      cleanupCustom = customCleanup;
    }

    if (options.tray !== false) {
      const trayOptions = options.tray ?? {};
      const trayIconPath = trayOptions.iconPath ?? options.iconPath;
      if (trayOptions.enabled !== false && trayIconPath) {
        trayController = createTrayController({
          app,
          window: windowInstance,
          iconPath: path.resolve(trayIconPath),
          tooltip: trayOptions.tooltip,
          openLabel: trayOptions.openLabel,
          quitLabel: trayOptions.quitLabel,
        });
      }
    }

    if (isDev) {
      setupDevMenu();
    } else {
      Menu.setApplicationMenu(null);
    }

    await options.onReady?.(context);
  };

  void initialize().catch((error) => {
    console.error("[frontron/bootstrap] failed to initialize app:", error);
    closeSplashWindow(splashWindow);
    splashWindow = null;
    dialog.showErrorBox(
      options.appName ?? "Frontron",
      `Failed to initialize application.\n${(error as Error).message}`,
    );
    app.quit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
  });

  app.on("before-quit", () => {
    cleanupCustom();
    cleanupIpc();
    trayController?.destroy();
    closeSplashWindow(splashWindow);
  });

  return { started: true };
}
