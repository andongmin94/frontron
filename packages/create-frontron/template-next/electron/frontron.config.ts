import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StartFrontronAppOptions } from "frontron/bootstrap";

import { closeNextRendererServer, ensureNextRendererServer, resolveNextDevPort } from "./next-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const frontronAppOptions: StartFrontronAppOptions = {
  appName: "Frontron",
  isDev: process.env.NODE_ENV === "development",
  rendererDistPath: path.join(__dirname, "../.next"),
  preloadPath: path.join(__dirname, "preload.mjs"),
  iconPath: path.join(__dirname, "../public/icon.ico"),
  includeLegacyWindowChannels: true,
  resolveDevServerPort() {
    return resolveNextDevPort();
  },
  resolveRendererLoadTarget: async ({ app, isDev, devServerHost, devServerPort }) => {
    if (isDev) {
      return {
        kind: "url",
        value: `http://${devServerHost}:${devServerPort ?? resolveNextDevPort()}`,
      };
    }

    const port = await ensureNextRendererServer(app.getAppPath());
    return {
      kind: "url",
      value: `http://127.0.0.1:${port}`,
    };
  },
  onAfterIpcSetup: async () => {
    return () => {
      closeNextRendererServer();
    };
  },
  splash: {
    fontPath: path.join(__dirname, "../public/fonts/PretendardVariable.woff2"),
    message: "Loading",
  },
  tray: {
    enabled: true,
    iconPath: path.join(__dirname, "../public/icon.ico"),
    tooltip: "Frontron",
  },
};
