import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StartFrontronAppOptions } from "frontron/bootstrap";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const frontronAppOptions: StartFrontronAppOptions = {
  appName: "Frontron",
  isDev: process.env.NODE_ENV === "development",
  viteConfigPath: path.join(__dirname, "../../vite.config.ts"),
  rendererDistPath: path.join(__dirname, "../../dist"),
  preloadPath: path.join(__dirname, "preload.js"),
  iconPath: path.join(__dirname, "../../public/icon.ico"),
  includeLegacyWindowChannels: true,
  splash: {
    fontPath: path.join(__dirname, "../../public/fonts/PretendardVariable.woff2"),
    message: "Loading",
  },
  tray: {
    enabled: true,
    iconPath: path.join(__dirname, "../../public/icon.ico"),
    tooltip: "Frontron",
  },
};