import path from 'node:path';
import { BrowserWindow, app, dialog, Menu } from 'electron';
import { c as createTrayController } from './frontron.BnuOy2Eo.mjs';
import { c as createMainWindow, r as registerWindowControlIpcHandlers } from './frontron.DMGoGMve.mjs';
import fs from 'node:fs';
import net from 'node:net';

function getPortFromViteConfig(viteConfigPath) {
  if (!fs.existsSync(viteConfigPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(viteConfigPath, "utf8");
    const serverBlockMatch = content.match(/server\s*:\s*\{([\s\S]*?)\}/m);
    if (!serverBlockMatch?.[1]) {
      return null;
    }
    const portMatch = serverBlockMatch[1].match(/port\s*:\s*(\d+)/);
    if (!portMatch?.[1]) {
      return null;
    }
    return Number.parseInt(portMatch[1], 10);
  } catch {
    return null;
  }
}
function isPortOpen(port, host, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
async function waitForPortReady(port, options = {}) {
  const {
    host = "127.0.0.1",
    timeoutMs = 3e4,
    intervalMs = 250,
    probeTimeoutMs = 1e3
  } = options;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port, host, probeTimeoutMs)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for dev server on http://${host}:${port}`);
}

function toFileUrl(filePath) {
  return `file://${filePath.replace(/\\/g, "/")}`;
}
function createSplashWindow(options = {}) {
  const {
    width = 360,
    height = 220,
    message = "Loading",
    fontPath,
    backgroundColor = "#0d1117",
    spinnerColor = "#60a5fa",
    textColor = "#e5e7eb"
  } = options;
  const splashWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    transparent: false
  });
  const fontFaceRule = fontPath ? `
        @font-face {
          font-family: "FrontronSans";
          src: url("${toFileUrl(path.resolve(fontPath))}") format("woff2");
          font-weight: 400;
          font-style: normal;
        }
      ` : "";
  const html = `
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Loading...</title>
        <style>
          ${fontFaceRule}
          :root {
            color-scheme: dark;
          }
          body {
            margin: 0;
            height: 100vh;
            display: grid;
            place-items: center;
            background: ${backgroundColor};
            color: ${textColor};
            font-family: "FrontronSans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .stack {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .spinner {
            width: 34px;
            height: 34px;
            border-radius: 999px;
            border: 4px solid rgba(255, 255, 255, 0.16);
            border-left-color: ${spinnerColor};
            animation: spin 1s linear infinite;
          }
          .message {
            font-size: 16px;
            letter-spacing: 0.02em;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="stack">
          <div class="spinner"></div>
          <div class="message">${message}</div>
        </div>
      </body>
    </html>
  `;
  void splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );
  splashWindow.on("closed", () => {
  });
  return splashWindow;
}
function closeSplashWindow(splashWindow) {
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }
  splashWindow.destroy();
}

function setupDevMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Developer",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" }
        ]
      }
    ])
  );
}
async function startFrontronApp(options) {
  const isDev = options.isDev ?? process.env.NODE_ENV === "development";
  const includeLegacyWindowChannels = options.includeLegacyWindowChannels ?? true;
  const devServerHost = options.devServerHost ?? "127.0.0.1";
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return {
      started: false,
      reason: "single-instance-locked"
    };
  }
  let mainWindow = null;
  let splashWindow = null;
  let cleanupIpc = () => {
  };
  let cleanupCustom = () => {
  };
  let trayController = null;
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
    let resolvedDevPort = null;
    if (isDev) {
      resolvedDevPort = options.devServerPort ?? (options.viteConfigPath ? getPortFromViteConfig(options.viteConfigPath) : null) ?? 3e3;
      await waitForPortReady(resolvedDevPort, { host: devServerHost });
    }
    const windowInstance = createMainWindow({
      isDev,
      preloadPath: options.preloadPath,
      iconPath: options.iconPath,
      rendererDistPath: options.rendererDistPath,
      devServerHost,
      devServerPort: resolvedDevPort ?? 3e3,
      ...options.window,
      onDidFinishLoad(window) {
        closeSplashWindow(splashWindow);
        splashWindow = null;
        options.window?.onDidFinishLoad?.(window);
      }
    });
    mainWindow = windowInstance;
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
    cleanupIpc = registerWindowControlIpcHandlers({
      window: windowInstance,
      includeLegacyChannels: includeLegacyWindowChannels
    });
    const context = {
      app,
      isDev,
      devServerPort: resolvedDevPort,
      mainWindow: windowInstance
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
          quitLabel: trayOptions.quitLabel
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
      `Failed to initialize application.
${error.message}`
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

export { createSplashWindow as a, closeSplashWindow as c, getPortFromViteConfig as g, startFrontronApp as s, waitForPortReady as w };
