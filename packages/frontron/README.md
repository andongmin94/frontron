# frontron

Runtime toolkit for Electron apps scaffolded by `create-frontron`.

## Modules

- `frontron/core`: preload bridge and IPC channel constants
- `frontron/window`: window creation and window-control IPC handlers
- `frontron/tray`: tray lifecycle helpers
- `frontron/store`: versioned JSON store with migrations
- `frontron/bootstrap`: app startup orchestration
- `frontron/updater`: auto-updater integration helpers

## Install

```bash
npm i frontron
```

`electron` is a peer dependency and should be installed by your app.

## Quick Usage

```ts
import { startFrontronApp } from "frontron/bootstrap";

void startFrontronApp({
  appName: "My App",
  isDev: process.env.NODE_ENV === "development",
  viteConfigPath: "./vite.config.ts",
  rendererDistPath: "./dist",
  preloadPath: "./dist/electron/preload.js",
  iconPath: "./public/icon.ico",
});
```

```ts
import { exposeFrontronBridge } from "frontron/core";

exposeFrontronBridge();
```

## Migration CLI

Use the CLI to migrate existing template projects to the runtime package.

```bash
npx frontron migrate
npx frontron migrate ./path/to/project --dry-run
```

What migration does:

- adds/updates `frontron` dependency in `package.json`
- writes `src/electron/main.ts`, `src/electron/preload.ts`, `src/electron/frontron.config.ts`
- writes `src/electron.d.ts`
- removes legacy template runtime files (`window.ts`, `ipc.ts`, `tray.ts`, `serve.ts`, ...)
- creates backup under `.frontron-migrate-backup/*` (unless `--force`)

## License

MIT