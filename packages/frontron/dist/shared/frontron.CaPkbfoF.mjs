import fs from 'node:fs';
import path from 'node:path';

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}
function isEnvelope(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value;
  return typeof candidate.version === "number" && "value" in candidate;
}
function ensureDirectory(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}
function writeEnvelope(filePath, version, value) {
  ensureDirectory(filePath);
  const envelope = {
    version,
    value
  };
  fs.writeFileSync(filePath, `${JSON.stringify(envelope, null, 2)}
`, "utf8");
}
function loadFromDisk(options) {
  const { filePath, defaults, version, migrations = {}, validate } = options;
  if (!fs.existsSync(filePath)) {
    const initial = cloneValue(defaults);
    writeEnvelope(filePath, version, initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    let currentVersion = 0;
    let currentValue = parsed;
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
    const validated = validate ? validate(currentValue) : currentValue;
    writeEnvelope(filePath, version, validated);
    return validated;
  } catch {
    const fallback = cloneValue(defaults);
    writeEnvelope(filePath, version, fallback);
    return fallback;
  }
}
function createStore(options) {
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
    set(nextValue) {
      value = cloneValue(nextValue);
      persist();
    },
    patch(partial) {
      value = { ...value, ...partial };
      persist();
    },
    reset() {
      value = cloneValue(options.defaults);
      persist();
    }
  };
}

export { createStore as c };
