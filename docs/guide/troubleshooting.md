# Troubleshooting

Most first-time users get stuck in similar places.

This page is meant to help you decide where to look first.

## If the app does not start

Check these things first:

- `npm install` finished successfully
- `npm run app:dev` does not already show a terminal error
- your Node.js version is `22+`
- the root `frontron.config.ts` exists

## If you see a blank page

A blank page is often a development-server mismatch.

Check:

- the port in `vite.config.ts`
- the `web.dev.url` value in `frontron/config.ts`
- whether another process is already using the same port

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

## If the icon does not change

Check these in order:

1. confirm that `public/icon.ico` was replaced
2. confirm that `frontron/config.ts` still points to that file
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

## If Windows packaging fails with file-not-found errors

Very deep project paths can still break Windows packaging.

If you see long paths inside packaging output, especially under staged app paths, try moving the project to a shorter path and build again.

- example: `C:\dev\my-app`
- example: `C:\work\demo`

::: tip
When something breaks, start with the file you changed most recently.
:::
