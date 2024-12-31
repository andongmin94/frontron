export interface MigrateTemplateContext {
  appName: string;
}

export function createMainSource() {
  return `import { startFrontronApp } from "frontron/bootstrap";
import { frontronAppOptions } from "./frontron.config.js";

void startFrontronApp(frontronAppOptions);
`;
}

export function createPreloadSource() {
  return `import { exposeFrontronBridge } from "frontron/core";

exposeFrontronBridge();
`;
}

export function createReactConfigSource(context: MigrateTemplateContext) {
  const appNameLiteral = JSON.stringify(context.appName);

  return `import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StartFrontronAppOptions } from "frontron/bootstrap";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const frontronAppOptions: StartFrontronAppOptions = {
  appName: ${appNameLiteral},
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
    tooltip: ${appNameLiteral},
  },
};
`;
}

export function createNextConfigSource(context: MigrateTemplateContext) {
  const appNameLiteral = JSON.stringify(context.appName);

  return `import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StartFrontronAppOptions } from "frontron/bootstrap";

import { closeNextRendererServer, ensureNextRendererServer, resolveNextDevPort } from "./next-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const frontronAppOptions: StartFrontronAppOptions = {
  appName: ${appNameLiteral},
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
        value: \`http://\${devServerHost}:\${devServerPort ?? resolveNextDevPort()}\`,
      };
    }

    const port = await ensureNextRendererServer(app.getAppPath());
    return {
      kind: "url",
      value: \`http://127.0.0.1:\${port}\`,
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
    tooltip: ${appNameLiteral},
  },
};
`;
}

export function createNextServerSource() {
  return `import http from "node:http";

import next from "next";

let nextRendererServer: http.Server | null = null;
let nextRendererPort: number | null = null;

function parsePort(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return null;
  }

  if (parsed < 1 || parsed > 65535) {
    return null;
  }

  return parsed;
}

function isUnsafePort(port: number): boolean {
  const blocked = new Set([1, 7, 9, 21, 22, 23, 25, 110, 143, 2049, 3659, 4045, 6000]);
  if (blocked.has(port)) {
    return true;
  }
  return port >= 6665 && port <= 6669;
}

export function resolveNextDevPort() {
  const byEnv = parsePort(process.env.NEXT_PORT) ?? parsePort(process.env.PORT);
  const candidate = byEnv ?? 3000;
  return isUnsafePort(candidate) ? 3000 : candidate;
}

export async function ensureNextRendererServer(appDir: string): Promise<number> {
  if (nextRendererPort !== null) {
    return nextRendererPort;
  }

  const nextApp = next({ dev: false, dir: appDir });
  const requestHandler = nextApp.getRequestHandler();

  await nextApp.prepare();

  nextRendererServer = http.createServer((request, response) => {
    requestHandler(request, response);
  });

  const port = await new Promise<number>((resolve, reject) => {
    if (!nextRendererServer) {
      reject(new Error("Next renderer server is not initialized."));
      return;
    }

    nextRendererServer.once("error", reject);
    nextRendererServer.listen(0, "127.0.0.1", () => {
      const address = nextRendererServer?.address();
      const resolvedPort =
        typeof address === "object" && address !== null ? address.port : null;

      if (typeof resolvedPort !== "number") {
        reject(new Error("Failed to resolve Next renderer server port."));
        return;
      }

      resolve(resolvedPort);
    });
  });

  nextRendererPort = port;
  return port;
}

export function closeNextRendererServer() {
  if (nextRendererServer) {
    nextRendererServer.close();
  }

  nextRendererServer = null;
  nextRendererPort = null;
}
`;
}

export function createRendererTypeSource() {
  return `import type { FrontronBridge } from "frontron/core";

declare global {
  interface Window {
    electron: FrontronBridge;
  }

  const electron: FrontronBridge;
}

export {};
`;
}
