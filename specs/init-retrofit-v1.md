# Retrofit Init v1 Contract

## 1. Goal

`frontron init` is not a framework bootstrapper.

Its v1 goal is to take a compatible existing web frontend project and seed the
minimum Electron source needed to run and package that app as an Electron
desktop app.

After `init`, the generated Electron files are app-owned source files.
`frontron` does not keep owning the runtime contract.

## 2. Product position

- `create-frontron` remains the full starter/template entrypoint
- `frontron` exists for retrofit work in existing frontend projects
- the retrofit flow should copy a trimmed subset of the starter, not recreate a
  framework-owned runtime

## 3. v1 support scope

v1 should target the safest compatible path first:

- Vite-family frontend projects
- projects with a detectable or explicitly selectable web dev script
- projects with a detectable or explicitly selectable web build script
- projects with a resolvable frontend build output directory

v1 does **not** try to normalize every frontend stack at once.

## 4. Non-goals

v1 should not:

- introduce `frontron.config.ts`
- introduce `frontron/client`
- introduce a framework-owned runtime staging area
- overwrite the app's existing frontend structure
- copy the entire starter Electron feature set by default
- silently replace existing `dev` or `build` scripts

## 5. Interaction model

`frontron init` should be interactive by default.

It should infer what it can, then ask for the values most likely to conflict.

### Values to infer first

- package manager
- project name
- product name default
- app id default
- existing web dev script
- existing web build script
- probable frontend output directory
- whether the project already uses TypeScript

### Values to confirm or ask

- Electron source directory
  - default: `electron/`
- desktop development script name
  - default: `app`
- desktop build script name
  - default: `app:build`
- preset
  - default: `minimal`
- whether to include the starter-style preload bridge
  - default: `no`
- final product name / app id

Flags can be added later, but the prompt flow is the canonical v1 UX.

## 6. Presets

### `minimal` preset

This is the default.

It should generate the smallest coherent Electron layer that can:

- open the existing frontend in development
- open the built frontend in production
- package the app with Electron Builder

Generated files:

- `<desktopDir>/main.ts`
- `<desktopDir>/window.ts`
- `<desktopDir>/serve.ts`
- `tsconfig.electron.json`

Default behavior:

- use a normal framed window
- do not add a renderer preload bridge
- do not add tray, splash, or dev-menu helpers

### `starter-like` preset

This is optional and closer to the generated starter feel.

It should add:

- `<desktopDir>/preload.ts`
- `<desktopDir>/ipc.ts`
- `src/types/electron.d.ts`

This preset may expose `window.electron`, but that is app-owned starter source,
not a package contract.

## 7. Source of truth for generated files

The retrofit files should be derived from the starter template, but not copied
verbatim when the starter contains optional features.

v1 requires trimmed variants for retrofit:

- `main.ts`
- `window.ts`
- `serve.ts`

The following starter extras stay out of the default retrofit preset:

- `tray.ts`
- `splash.ts`
- `dev.ts`

## 8. Package.json mutation rules

v1 must be conservative.

### Existing scripts

- never overwrite the app's current web dev script automatically
- never overwrite the app's current web build script automatically
- add desktop scripts under new names
- default desktop script names are `app` and `app:build`
- if those names already exist, ask for alternatives

### Existing fields

- preserve existing `name` and `version`
- preserve existing `main` when present unless the user explicitly approves a change
- preserve existing `type` when present unless the user explicitly approves a change

### Build metadata

v1 should add the minimum Electron Builder metadata needed for packaging:

- `build.appId`
- `build.productName`
- `build.files`
- `build.directories.output`
- `build.extraMetadata.main` when that avoids conflicting with an existing root
  `main`

## 9. Dependency rules

v1 should add only the minimum desktop dependencies required for the generated
sources.

Baseline:

- `electron`
- `electron-builder`
- `@types/node`

Conditional:

- `typescript` only when needed for generated TypeScript Electron files and not
  already available in the project

The retrofit flow should not add unrelated starter web dependencies.

## 10. Conflict policy

Conflict handling must be explicit.

If the selected output would collide with existing files or scripts, `init`
should show the planned change and let the user choose:

- use a different name or path
- skip that change
- overwrite intentionally

The default must always be the safest non-destructive option.

## 11. Acceptance criteria

The v1 contract is correct when:

1. a compatible web frontend can run as an Electron app immediately after `init`
2. the generated Electron files are directly editable app code
3. the existing frontend scripts remain intact
4. the default path works with `electron/`, `app`, and `app:build`
5. the retrofit flow feels like a starter-derived initializer, not a framework

