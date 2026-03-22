# Framework-First Contract

This page describes the official structure and responsibility split that Frontron is built around.

## Goal

`frontron` must be the real product surface.

- You must be able to install `frontron` into an existing web project.
- The root `frontron.config.ts` must be the official entrypoint.
- `create-frontron` must stay a thin starter generator.

## Official start flow

The supported start flow is:

1. Prepare an existing web frontend project
2. Install `frontron`
3. Add a root `frontron.config.ts`
4. Run `app:dev`
5. Run `app:build`

## Official structure

The important shape is:

```text
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
  frontron/
```

`frontron/` is the dedicated app-layer area.

- `bridge/`
- `windows/`
- `tray.ts`
- `menu.ts`
- `hooks/`
- `rust/`

## Responsibility split

The web project owns:

- pages
- components
- state management
- routing
- API calls

`frontron` owns:

- Electron runtime ownership
- preload and main wiring
- packaging and build ownership
- typed bridge runtime
- native loading

`create-frontron` owns:

- starter generation for the official shape
- `frontron` dependency wiring
- example `frontron.config.ts`

## Current state

The repository already implements this structure.

- `frontron` owns config discovery, the CLI, and runtime/build staging.
- `create-frontron` generates the official starter shape instead of a template-owned runtime.
- The public renderer API is now only `frontron/client`.
- The official Rust slot is now `frontron/rust`.

## Older apps

Older `window.electron` renderer code is no longer supported.

Older apps must move to this rule set:

- use only `frontron/client` in renderer code
- do not depend on preload globals or internal bridge wiring
- do not restore the old `src/electron/*` structure
