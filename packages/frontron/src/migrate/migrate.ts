import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createConfigSource,
  createMainSource,
  createPreloadSource,
  createRendererTypeSource,
} from "./templates";

const LEGACY_ELECTRON_FILES = [
  "src/electron/dev.ts",
  "src/electron/ipc.ts",
  "src/electron/serve.ts",
  "src/electron/splash.ts",
  "src/electron/tray.ts",
  "src/electron/window.ts",
] as const;

const GENERATED_FILES = [
  "src/electron/main.ts",
  "src/electron/preload.ts",
  "src/electron/frontron.config.ts",
  "src/electron.d.ts",
] as const;

function resolveCurrentPackageVersion() {
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(currentFileDir, "../../package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
  return pkgJson.version;
}

function normalizePath(targetPath: string) {
  return targetPath.replace(/\\/g, "/");
}

function ensureDirectory(targetPath: string) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function writeFile(targetPath: string, content: string) {
  ensureDirectory(targetPath);
  fs.writeFileSync(targetPath, content, "utf8");
}

function copyIfExists(src: string, dest: string) {
  if (!fs.existsSync(src)) {
    return;
  }
  ensureDirectory(dest);
  fs.copyFileSync(src, dest);
}

export interface MigrateOptions {
  projectDir?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface MigrateResult {
  projectDir: string;
  dryRun: boolean;
  backupDir: string | null;
  writtenFiles: string[];
  removedFiles: string[];
  dependencyUpdated: boolean;
}

export function migrateProject(options: MigrateOptions = {}): MigrateResult {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);

  const packageJsonPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found: ${packageJsonPath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    productName?: string;
    dependencies?: Record<string, string>;
    build?: {
      productName?: string;
    };
  };

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

  const writtenFiles: string[] = [];
  const removedFiles: string[] = [];

  let backupDir: string | null = null;
  const backupTargets = [...GENERATED_FILES, ...LEGACY_ELECTRON_FILES].filter((filePath) =>
    fs.existsSync(path.join(projectDir, filePath)),
  );
  if (!dryRun && !force && backupTargets.length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupDir = path.join(projectDir, ".frontron-migrate-backup", stamp);
    for (const relativePath of backupTargets) {
      copyIfExists(
        path.join(projectDir, relativePath),
        path.join(backupDir, relativePath),
      );
    }
  }

  if (dependencyUpdated) {
    writtenFiles.push("package.json");
    if (!dryRun) {
      writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    }
  }

  const generatedContentMap: Record<(typeof GENERATED_FILES)[number], string> = {
    "src/electron/main.ts": createMainSource(),
    "src/electron/preload.ts": createPreloadSource(),
    "src/electron/frontron.config.ts": createConfigSource({ appName }),
    "src/electron.d.ts": createRendererTypeSource(),
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
    dependencyUpdated,
  };
}
