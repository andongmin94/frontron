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
function createConfigSource(context) {
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

const LEGACY_ELECTRON_FILES = [
  "src/electron/dev.ts",
  "src/electron/ipc.ts",
  "src/electron/serve.ts",
  "src/electron/splash.ts",
  "src/electron/tray.ts",
  "src/electron/window.ts"
];
const GENERATED_FILES = [
  "src/electron/main.ts",
  "src/electron/preload.ts",
  "src/electron/frontron.config.ts",
  "src/electron.d.ts"
];
function resolveCurrentPackageVersion() {
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(currentFileDir, "../../package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkgJson.version;
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
function migrateProject(options = {}) {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found: ${packageJsonPath}`);
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
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
  const writtenFiles = [];
  const removedFiles = [];
  let backupDir = null;
  const backupTargets = [...GENERATED_FILES, ...LEGACY_ELECTRON_FILES].filter(
    (filePath) => fs.existsSync(path.join(projectDir, filePath))
  );
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
  const generatedContentMap = {
    "src/electron/main.ts": createMainSource(),
    "src/electron/preload.ts": createPreloadSource(),
    "src/electron/frontron.config.ts": createConfigSource({ appName }),
    "src/electron.d.ts": createRendererTypeSource()
  };
  for (const relativePath of GENERATED_FILES) {
    writtenFiles.push(relativePath);
    if (!dryRun) {
      writeFile(path.join(projectDir, relativePath), generatedContentMap[relativePath]);
    }
  }
  for (const relativePath of LEGACY_ELECTRON_FILES) {
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
    dependencyUpdated
  };
}

export { migrateProject as m };
