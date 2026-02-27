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

function createLegacyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontron-migrate-"));
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

  return dir;
}

test("migrateProject writes new frontron files and removes legacy files", () => {
  const projectDir = createLegacyProject();
  const result = migrateProject({ projectDir });

  expect(result.writtenFiles).toContain("src/electron/main.ts");
  expect(result.writtenFiles).toContain("src/electron/preload.ts");
  expect(result.removedFiles).toContain("src/electron/window.ts");
  expect(fs.existsSync(path.join(projectDir, "src", "electron", "window.ts"))).toBe(false);

  const pkg = JSON.parse(
    fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  expect(pkg.dependencies?.frontron).toMatch(/^\^/);
});

test("migrateProject dry-run does not write files", () => {
  const projectDir = createLegacyProject();
  const originalMain = fs.readFileSync(
    path.join(projectDir, "src", "electron", "main.ts"),
    "utf8",
  );

  const result = migrateProject({ projectDir, dryRun: true });
  expect(result.dryRun).toBe(true);

  const currentMain = fs.readFileSync(
    path.join(projectDir, "src", "electron", "main.ts"),
    "utf8",
  );
  expect(currentMain).toBe(originalMain);
});
