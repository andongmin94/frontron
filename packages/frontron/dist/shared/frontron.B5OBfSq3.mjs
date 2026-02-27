import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function createMainSource() {
  return `import { startFrontronApp } from "frontron/bootstrap";
import { frontronAppOptions } from "./frontron.config.js";

void startFrontronApp(frontronAppOptions);
`;
}
function createPreloadSource() {
  return `import { exposeFrontronBridge } from "frontron/core";

exposeFrontronBridge();
`;
}
function createReactConfigSource(context) {
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
function createNextConfigSource(context) {
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
function createNextServerSource() {
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
function createRendererTypeSource() {
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

const REACT_LEGACY_ELECTRON_FILES = [
  "src/electron/dev.ts",
  "src/electron/ipc.ts",
  "src/electron/serve.ts",
  "src/electron/splash.ts",
  "src/electron/tray.ts",
  "src/electron/window.ts"
];
const NEXT_LEGACY_ELECTRON_FILES = [
  "electron/dev.ts",
  "electron/ipc.ts",
  "electron/paths.ts",
  "electron/serve.ts",
  "electron/splash.ts",
  "electron/tray.ts",
  "electron/window.ts"
];
const REACT_GENERATED_FILES = [
  "src/electron/main.ts",
  "src/electron/preload.ts",
  "src/electron/frontron.config.ts",
  "src/electron.d.ts"
];
const NEXT_GENERATED_FILES = [
  "electron/main.ts",
  "electron/preload.mts",
  "electron/frontron.config.ts",
  "electron/next-server.ts",
  "electron.d.ts"
];
function resolveCurrentPackageVersion() {
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(currentFileDir, "../../package.json");
  const pkgJson = readJsonFile(pkgPath);
  return pkgJson.version;
}
function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}
function normalizePath(targetPath) {
  return targetPath.replace(/\\/g, "/");
}
function ensureDirectory(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}
function writeFile(targetPath, content) {
  ensureDirectory(targetPath);
  fs.writeFileSync(targetPath, content, "utf8");
}
function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
  ensureDirectory(dest);
  fs.copyFileSync(src, dest);
}
function upsertCompilerOption(source, optionName, optionValue) {
  const optionRegex = new RegExp(`("${optionName}"\\s*:\\s*")([^"]+)(")`, "i");
  if (optionRegex.test(source)) {
    return source.replace(optionRegex, `$1${optionValue}$3`);
  }
  const compilerOptionsRegex = /"compilerOptions"\s*:\s*{\r?\n/;
  const match = source.match(compilerOptionsRegex);
  if (!match || match.index === void 0) {
    return source;
  }
  const insertAt = match.index + match[0].length;
  return source.slice(0, insertAt) + `    "${optionName}": "${optionValue}",
` + source.slice(insertAt);
}
function ensureElectronTsconfigBundler(source) {
  let updated = source;
  updated = upsertCompilerOption(updated, "module", "ESNext");
  updated = upsertCompilerOption(updated, "moduleResolution", "Bundler");
  return updated;
}
function detectTemplateKind(projectDir, packageJson) {
  if (packageJson.dependencies?.next || packageJson.devDependencies?.next || fs.existsSync(path.join(projectDir, "electron"))) {
    return "next";
  }
  return "react";
}
function migrateProject(options = {}) {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found: ${packageJsonPath}`);
  }
  const packageJson = readJsonFile(packageJsonPath);
  const template = detectTemplateKind(projectDir, packageJson);
  const packageName = packageJson.build?.productName ?? packageJson.productName ?? packageJson.name;
  const appName = packageName ?? "Frontron App";
  const currentFrontronVersion = resolveCurrentPackageVersion();
  const dependencyRange = `^${currentFrontronVersion}`;
  const currentDependency = packageJson.dependencies?.frontron;
  const dependencyUpdated = currentDependency !== dependencyRange;
  if (dependencyUpdated) {
    packageJson.dependencies = packageJson.dependencies ?? {};
    packageJson.dependencies.frontron = dependencyRange;
  }
  const generatedFiles = template === "next" ? [...NEXT_GENERATED_FILES] : [...REACT_GENERATED_FILES];
  const legacyFiles = template === "next" ? [...NEXT_LEGACY_ELECTRON_FILES] : [...REACT_LEGACY_ELECTRON_FILES];
  const tsconfigRelativePath = "tsconfig.electron.json";
  const tsconfigPath = path.join(projectDir, tsconfigRelativePath);
  let nextTsconfigContent = null;
  let tsconfigUpdated = false;
  if (fs.existsSync(tsconfigPath)) {
    const originalTsconfig = fs.readFileSync(tsconfigPath, "utf8");
    const updatedTsconfig = ensureElectronTsconfigBundler(originalTsconfig);
    if (updatedTsconfig !== originalTsconfig) {
      nextTsconfigContent = updatedTsconfig;
      tsconfigUpdated = true;
    }
  }
  const writtenFiles = [];
  const removedFiles = [];
  let backupDir = null;
  const backupTargets = [
    ...generatedFiles,
    ...legacyFiles,
    ...tsconfigUpdated ? [tsconfigRelativePath] : []
  ].filter((filePath) => fs.existsSync(path.join(projectDir, filePath)));
  if (!dryRun && !force && backupTargets.length > 0) {
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    backupDir = path.join(projectDir, ".frontron-migrate-backup", stamp);
    for (const relativePath of backupTargets) {
      copyIfExists(
        path.join(projectDir, relativePath),
        path.join(backupDir, relativePath)
      );
    }
  }
  if (dependencyUpdated) {
    writtenFiles.push("package.json");
    if (!dryRun) {
      writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}
`);
    }
  }
  if (tsconfigUpdated && nextTsconfigContent) {
    writtenFiles.push(tsconfigRelativePath);
    if (!dryRun) {
      writeFile(tsconfigPath, nextTsconfigContent);
    }
  }
  const generatedContentMap = template === "next" ? {
    "electron/main.ts": createMainSource(),
    "electron/preload.mts": createPreloadSource(),
    "electron/frontron.config.ts": createNextConfigSource({ appName }),
    "electron/next-server.ts": createNextServerSource(),
    "electron.d.ts": createRendererTypeSource()
  } : {
    "src/electron/main.ts": createMainSource(),
    "src/electron/preload.ts": createPreloadSource(),
    "src/electron/frontron.config.ts": createReactConfigSource({ appName }),
    "src/electron.d.ts": createRendererTypeSource()
  };
  for (const relativePath of generatedFiles) {
    writtenFiles.push(relativePath);
    if (!dryRun) {
      writeFile(path.join(projectDir, relativePath), generatedContentMap[relativePath]);
    }
  }
  for (const relativePath of legacyFiles) {
    const absolutePath = path.join(projectDir, relativePath);
    if (fs.existsSync(absolutePath)) {
      removedFiles.push(relativePath);
      if (!dryRun) {
        fs.rmSync(absolutePath, { force: true });
      }
    }
  }
  return {
    projectDir: normalizePath(projectDir),
    dryRun,
    backupDir: backupDir ? normalizePath(backupDir) : null,
    writtenFiles: writtenFiles.map(normalizePath),
    removedFiles: removedFiles.map(normalizePath),
    dependencyUpdated,
    template
  };
}

export { migrateProject as m };
