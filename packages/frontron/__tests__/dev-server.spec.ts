import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { getPortFromViteConfig } from "../src/bootstrap";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("getPortFromViteConfig extracts port from server block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontron-vite-"));
  tempDirs.push(dir);
  const configPath = path.join(dir, "vite.config.ts");

  fs.writeFileSync(
    configPath,
    `
      export default defineConfig({
        server: {
          host: "0.0.0.0",
          port: 4210,
        },
      })
    `,
    "utf8",
  );

  expect(getPortFromViteConfig(configPath)).toBe(4210);
});

test("getPortFromViteConfig returns null when file is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontron-vite-"));
  tempDirs.push(dir);
  const configPath = path.join(dir, "missing-vite.config.ts");

  expect(getPortFromViteConfig(configPath)).toBeNull();
});
