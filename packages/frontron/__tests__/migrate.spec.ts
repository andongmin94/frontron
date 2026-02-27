import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { migrateProject } from "../src/migrate";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createReactLegacyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontron-migrate-react-"));
  tempDirs.push(dir);

  fs.mkdirSync(path.join(dir, "src", "electron"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "legacy-app",
        version: "1.0.0",
        dependencies: {
          react: "^19.0.0",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, "src", "electron", "main.ts"), "// old main");
  fs.writeFileSync(path.join(dir, "src", "electron", "preload.ts"), "// old preload");
  fs.writeFileSync(path.join(dir, "src", "electron", "window.ts"), "// old window");
  fs.writeFileSync(
    path.join(dir, "tsconfig.electron.json"),
    `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Node",
    "outDir": "./dist/electron",
    "rootDir": "./src/electron"
  },
  "include": ["src/electron/**/*.ts"]
}
`,
  );

  return dir;
}

function createNextLegacyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontron-migrate-next-"));
  tempDirs.push(dir);

  fs.mkdirSync(path.join(dir, "electron"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "legacy-next-app",
        version: "1.0.0",
        dependencies: {
          next: "^16.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, "electron", "main.ts"), "// old main");
  fs.writeFileSync(path.join(dir, "electron", "preload.mts"), "// old preload");
  fs.writeFileSync(path.join(dir, "electron", "window.ts"), "// old window");
  fs.writeFileSync(
    path.join(dir, "tsconfig.electron.json"),
    `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Node",
    "outDir": "./.electron",
    "rootDir": "./electron"
  },
  "include": ["electron/**/*.ts", "electron/**/*.mts"]
}
`,
  );

  return dir;
}

test("migrateProject writes react runtime files and removes legacy files", () => {
  const projectDir = createReactLegacyProject();
  const result = migrateProject({ projectDir });

  expect(result.template).toBe("react");
  expect(result.writtenFiles).toContain("src/electron/main.ts");
  expect(result.writtenFiles).toContain("src/electron/preload.ts");
  expect(result.writtenFiles).toContain("src/electron/frontron.config.ts");
  expect(result.writtenFiles).toContain("src/electron.d.ts");
  expect(result.writtenFiles).toContain("tsconfig.electron.json");
  expect(result.removedFiles).toContain("src/electron/window.ts");
  expect(fs.existsSync(path.join(projectDir, "src", "electron", "window.ts"))).toBe(false);

  const pkg = JSON.parse(
    fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  expect(pkg.dependencies?.frontron).toMatch(/^\^/);

  const tsconfigContent = fs.readFileSync(
    path.join(projectDir, "tsconfig.electron.json"),
    "utf8",
  );
  expect(tsconfigContent).toContain(`"module": "ESNext"`);
  expect(tsconfigContent).toContain(`"moduleResolution": "Bundler"`);
});

test("migrateProject react dry-run does not write files", () => {
  const projectDir = createReactLegacyProject();
  const originalMain = fs.readFileSync(
    path.join(projectDir, "src", "electron", "main.ts"),
    "utf8",
  );

  const result = migrateProject({ projectDir, dryRun: true });
  expect(result.dryRun).toBe(true);
  expect(result.template).toBe("react");

  const currentMain = fs.readFileSync(
    path.join(projectDir, "src", "electron", "main.ts"),
    "utf8",
  );
  expect(currentMain).toBe(originalMain);

  const tsconfigContent = fs.readFileSync(
    path.join(projectDir, "tsconfig.electron.json"),
    "utf8",
  );
  expect(tsconfigContent).toContain(`"module": "ESNext"`);
  expect(tsconfigContent).toContain(`"moduleResolution": "Node"`);
});

test("migrateProject writes next runtime files and removes legacy files", () => {
  const projectDir = createNextLegacyProject();
  const result = migrateProject({ projectDir });

  expect(result.template).toBe("next");
  expect(result.writtenFiles).toContain("electron/main.ts");
  expect(result.writtenFiles).toContain("electron/preload.mts");
  expect(result.writtenFiles).toContain("electron/frontron.config.ts");
  expect(result.writtenFiles).toContain("electron/next-server.ts");
  expect(result.writtenFiles).toContain("electron.d.ts");
  expect(result.writtenFiles).toContain("tsconfig.electron.json");
  expect(result.removedFiles).toContain("electron/window.ts");
  expect(fs.existsSync(path.join(projectDir, "electron", "window.ts"))).toBe(false);

  const pkg = JSON.parse(
    fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  expect(pkg.dependencies?.frontron).toMatch(/^\^/);

  const tsconfigContent = fs.readFileSync(
    path.join(projectDir, "tsconfig.electron.json"),
    "utf8",
  );
  expect(tsconfigContent).toContain(`"module": "ESNext"`);
  expect(tsconfigContent).toContain(`"moduleResolution": "Bundler"`);
});

test("migrateProject next dry-run does not write files", () => {
  const projectDir = createNextLegacyProject();
  const originalMain = fs.readFileSync(path.join(projectDir, "electron", "main.ts"), "utf8");

  const result = migrateProject({ projectDir, dryRun: true });
  expect(result.dryRun).toBe(true);
  expect(result.template).toBe("next");

  const currentMain = fs.readFileSync(path.join(projectDir, "electron", "main.ts"), "utf8");
  expect(currentMain).toBe(originalMain);

  const tsconfigContent = fs.readFileSync(
    path.join(projectDir, "tsconfig.electron.json"),
    "utf8",
  );
  expect(tsconfigContent).toContain(`"module": "ESNext"`);
  expect(tsconfigContent).toContain(`"moduleResolution": "Node"`);
});
