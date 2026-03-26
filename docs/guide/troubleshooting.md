# Troubleshooting

Most first-time users get stuck in similar places.

This page is meant to help you decide where to look first.

## Start with `frontron check`

Before changing files by hand, run:

```bash
npx frontron check
```

It checks the first-run contract:

- `package.json`
- root `frontron.config.ts`
- `app:dev` and `app:build`
- inferred or explicit `web.dev` and `web.build`
- dev-port conflicts before `app:dev` starts
- frontend build output, `.frontron/`, and packaged output state
- Rust toolchain presence when `rust.enabled` is true
- monorepo and custom-script hints when inference is likely ambiguous
- legacy renderer globals and unsupported raw Electron migration blockers

## If the app does not start

Check these things first:

- `npx frontron check` already showed the first failing item
- `npm install` finished successfully
- `npm run app:dev` does not already show a terminal error
- your Node.js version is `22.15+`
- the root `frontron.config.ts` exists

## If you see a blank page

A blank page is often a development-server mismatch.

Check:

- the port in `vite.config.ts`
- the `web.dev.url` value in the root `frontron.config.ts`
- whether another process is already using the same port

If `frontron check` says the dev URL already responds before Frontron starts, another server is already occupying the target port.

- stop the stale server and run `npm run app:dev` again
- or keep `web.dev.url` pointed at that running server on purpose

## If window buttons or bridge calls do not react

Window controls and desktop bridge calls only work when `frontron/client` is connected to the framework runtime.

Check these first:

1. Make sure you ran `npm run app:dev`, not `npm run dev`
2. Make sure the renderer imports `frontron/client`
3. Check the terminal for preload or runtime errors

If you only see `Web preview` in the title bar, you are in browser-only preview mode, not desktop mode.

## If you are still running an older generated app

Older generated apps often fail here because they still use removed APIs.

- `window.electron` is no longer supported
- renderer code must use `frontron/client`
- the old `src/electron/*` structure is not part of the official contract anymore

The first things to check are:

1. the renderer import comes from `frontron/client`
2. direct preload-global reads are gone
3. window and system calls go through `bridge.window.*` and `bridge.system.*`

## If `check` reports migration blockers from an older Electron app

`frontron check` now scans for a small set of raw Electron patterns that usually block migration.

Common blockers are:

- `window.electron` or a leftover `src/electron/*` / `electron/` runtime contract
- raw `BrowserWindow` security fields such as `preload`, `webPreferences`, `nodeIntegration`, `contextIsolation`, or `webviewTag`
- overlay or click-through APIs such as `setIgnoreMouseEvents`
- parent/modal window graphs
- remote `loadURL()` / `loadFile()` window content modes
- renderer `<webview>` usage

When one of these appears, stop and compare the app requirements against the [support matrix](./support-matrix.md).

In most cases the fix is one of these:

- move renderer calls to `frontron/client`
- move desktop logic into the official `frontron/` app layer
- remove unsupported raw Electron assumptions
- or decide that raw Electron is still the better fit for this app

## If the icon does not change

Check these in order:

1. confirm that `public/icon.ico` was replaced
2. confirm that `app.icon` in the root `frontron.config.ts` still points to that file
3. run the build again
4. make sure you are not looking at an old packaged output

## If `output/` is empty or missing expected files

First confirm that the build finished all the way through.

Check:

- `dist/` exists
- `.frontron/` exists
- `.frontron/runtime/build/app/` contains `manifest.json`, `main.mjs`, `preload.mjs`, and `web/`
- the last terminal lines do not show an error

On Windows, the current default output usually includes `win-unpacked/` and an installer `.exe`.

`frontron check` now also reports:

- whether the frontend build output exists or is empty
- whether `.frontron/runtime/build/app/` is complete
- whether the packaged output directory exists but is empty

If `.frontron/runtime/build/app/` is incomplete, remove `.frontron/` and run `npm run app:build` again.

## If Rust is enabled and check reports `cargo` missing

Frontron only checks this when `rust.enabled` is true.

Do one of these:

- install Rust and make sure `cargo --version` works in the same terminal
- or disable `rust.enabled` until the Rust slot is ready

## If the project is a monorepo or uses wrapper scripts

Inference is intentionally conservative for workspace wrappers.

If check shows a monorepo/custom-script hint, prefer explicit config in the root `frontron.config.ts`:

```ts
web: {
  dev: {
    command: 'pnpm --filter web dev',
    url: 'http://localhost:5173',
  },
  build: {
    command: 'pnpm --filter web build',
    outDir: 'apps/web/dist',
  },
}
```

## If Windows packaging fails with file-not-found errors

Very deep project paths can still break Windows packaging.

If you see long paths inside packaging output, especially under staged app paths, try moving the project to a shorter path and build again.

- example: `C:\dev\my-app`
- example: `C:\work\demo`

::: tip
When something breaks, start with the file you changed most recently.
:::
