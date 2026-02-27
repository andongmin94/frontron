import fs from "node:fs";
import path from "node:path";

import type { FrontronStore, StoreOptions } from "./types";

interface StoreEnvelope<T> {
  version: number;
  value: T;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isEnvelope(value: unknown): value is StoreEnvelope<unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.version === "number" && "value" in candidate;
}

function ensureDirectory(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function writeEnvelope<T>(filePath: string, version: number, value: T) {
  ensureDirectory(filePath);
  const envelope: StoreEnvelope<T> = {
    version,
    value,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

function loadFromDisk<T>(options: StoreOptions<T>): T {
  const { filePath, defaults, version, migrations = {}, validate } = options;

  if (!fs.existsSync(filePath)) {
    const initial = cloneValue(defaults);
    writeEnvelope(filePath, version, initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    let currentVersion = 0;
    let currentValue: unknown = parsed;

    if (isEnvelope(parsed)) {
      currentVersion = parsed.version;
      currentValue = parsed.value;
    }

    while (currentVersion < version) {
      const nextVersion = currentVersion + 1;
      const migration = migrations[nextVersion];
      if (migration) {
        currentValue = migration(currentValue);
      }
      currentVersion = nextVersion;
    }

    const validated = validate ? validate(currentValue) : (currentValue as T);
    writeEnvelope(filePath, version, validated);
    return validated;
  } catch {
    const fallback = cloneValue(defaults);
    writeEnvelope(filePath, version, fallback);
    return fallback;
  }
}

export function createStore<T>(options: StoreOptions<T>): FrontronStore<T> {
  const { filePath, version } = options;
  let value = loadFromDisk(options);

  const persist = () => {
    writeEnvelope(filePath, version, value);
  };

  return {
    filePath,
    get() {
      return cloneValue(value);
    },
    set(nextValue: T) {
      value = cloneValue(nextValue);
      persist();
    },
    patch(partial: Partial<T>) {
      value = { ...(value as Record<string, unknown>), ...partial } as T;
      persist();
    },
    reset() {
      value = cloneValue(options.defaults);
      persist();
    },
  };
}
