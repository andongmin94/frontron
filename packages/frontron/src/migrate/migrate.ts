import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createMainSource,
  createNextConfigSource,
  createNextServerSource,
  createPreloadSource,
  createReactConfigSource,
  createRendererTypeSource,
} from "./templates";

type TemplateKind = "react" | "next";

const REACT_LEGACY_ELECTRON_FILES = [
  "src/electron/dev.ts",
  "src/electron/ipc.ts",
  "src/electron/serve.ts",
  "src/electron/splash.ts",
  "src/electron/tray.ts",
  "src/electron/window.ts",
] as const;

const NEXT_LEGACY_ELECTRON_FILES = [
  "electron/dev.ts",
  "electron/ipc.ts",
  "electron/paths.ts",
  "electron/serve.ts",
  "electron/splash.ts",
  "electron/tray.ts",
  "electron/window.ts",
] as const;

const REACT_GENERATED_FILES = [
  "src/electron/main.ts",
  "src/electron/preload.ts",
  "src/electron/frontron.config.ts",
  "src/electron.d.ts",
] as const;

const NEXT_GENERATED_FILES = [
  "electron/main.ts",
  "electron/preload.mts",
  "electron/frontron.config.ts",
  "electron/next-server.ts",
  "electron.d.ts",
] as const;

function resolveCurrentPackageVersion() {
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(currentFileDir, "../../package.json");
  const pkgJson = readJsonFile<{ version: string }>(pkgPath);
  return pkgJson.version;
}

function readJsonFile<T>(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
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

function upsertCompilerOption(
  source: string,
  optionName: "module" | "moduleResolution",
  optionValue: "ESNext" | "Bundler",
) {
  const optionRegex = new RegExp(`("${optionName}"\\s*:\\s*")([^"]+)(")`, "i");
  if (optionRegex.test(source)) {
    return source.replace(optionRegex, `$1${optionValue}$3`);
  }

  const compilerOptionsRegex = /"compilerOptions"\s*:\s*{\r?\n/;
  const match = source.match(compilerOptionsRegex);
  if (!match || match.index === undefined) {
    return source;
  }

  const insertAt = match.index + match[0].length;
  return (
    source.slice(0, insertAt) +
    `    "${optionName}": "${optionValue}",\n` +
    source.slice(insertAt)
  );
}

function ensureElectronTsconfigBundler(source: string) {
  let updated = source;
  updated = upsertCompilerOption(updated, "module", "ESNext");
  updated = upsertCompilerOption(updated, "moduleResolution", "Bundler");
  return updated;
}

function detectTemplateKind(
  projectDir: string,
  packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
): TemplateKind {
  if (
    packageJson.dependencies?.next ||
    packageJson.devDependencies?.next ||
    fs.existsSync(path.join(projectDir, "electron"))
  ) {
    return "next";
  }
  return "react";
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
  template: TemplateKind;
}

export function migrateProject(options: MigrateOptions = {}): MigrateResult {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);

  const packageJsonPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found: ${packageJsonPath}`);
  }

  const packageJson = readJsonFile<{
    name?: string;
    productName?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    build?: {
      productName?: string;
    };
  }>(packageJsonPath);

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

  const generatedFiles =
    template === "next" ? [...NEXT_GENERATED_FILES] : [...REACT_GENERATED_FILES];
  const legacyFiles =
    template === "next"
      ? [...NEXT_LEGACY_ELECTRON_FILES]
      : [...REACT_LEGACY_ELECTRON_FILES];
  const tsconfigRelativePath = "tsconfig.electron.json";
  const tsconfigPath = path.join(projectDir, tsconfigRelativePath);

  let nextTsconfigContent: string | null = null;
  let tsconfigUpdated = false;
  if (fs.existsSync(tsconfigPath)) {
    const originalTsconfig = fs.readFileSync(tsconfigPath, "utf8");
    const updatedTsconfig = ensureElectronTsconfigBundler(originalTsconfig);
    if (updatedTsconfig !== originalTsconfig) {
      nextTsconfigContent = updatedTsconfig;
      tsconfigUpdated = true;
    }
  }

  const writtenFiles: string[] = [];
  const removedFiles: string[] = [];

  let backupDir: string | null = null;
  const backupTargets = [
    ...generatedFiles,
    ...legacyFiles,
    ...(tsconfigUpdated ? [tsconfigRelativePath] : []),
  ].filter((filePath) => fs.existsSync(path.join(projectDir, filePath)));
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

  if (tsconfigUpdated && nextTsconfigContent) {
    writtenFiles.push(tsconfigRelativePath);
    if (!dryRun) {
      writeFile(tsconfigPath, nextTsconfigContent);
    }
  }

  const generatedContentMap: Record<string, string> =
    template === "next"
      ? {
          "electron/main.ts": createMainSource(),
          "electron/preload.mts": createPreloadSource(),
          "electron/frontron.config.ts": createNextConfigSource({ appName }),
          "electron/next-server.ts": createNextServerSource(),
          "electron.d.ts": createRendererTypeSource(),
        }
      : {
          "src/electron/main.ts": createMainSource(),
          "src/electron/preload.ts": createPreloadSource(),
          "src/electron/frontron.config.ts": createReactConfigSource({ appName }),
          "src/electron.d.ts": createRendererTypeSource(),
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
    template,
  };
}
