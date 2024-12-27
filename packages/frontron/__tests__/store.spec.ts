import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { createStore } from "../src/store";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createStore creates defaults and persists patch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontron-store-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "settings.json");

  const store = createStore({
    filePath,
    defaults: { theme: "light", zoom: 1 },
    version: 1,
  });

  expect(store.get()).toEqual({ theme: "light", zoom: 1 });

  store.patch({ zoom: 1.25 });
  expect(store.get()).toEqual({ theme: "light", zoom: 1.25 });

  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    version: number;
    value: { theme: string; zoom: number };
  };
  expect(persisted.version).toBe(1);
  expect(persisted.value.zoom).toBe(1.25);
});

test("createStore applies migration steps up to target version", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontron-store-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "settings.json");

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      value: { theme: "dark" },
    }),
  );

  const store = createStore({
    filePath,
    defaults: { theme: "light", zoom: 1 },
    version: 2,
    migrations: {
      2(previous) {
        const value = previous as { theme: string };
        return {
          theme: value.theme,
          zoom: 1,
        };
      },
    },
  });

  expect(store.get()).toEqual({ theme: "dark", zoom: 1 });
});
