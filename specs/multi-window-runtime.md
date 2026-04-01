# Multi-Window Runtime Design

## Purpose

This document defines the first Frontron multi-window runtime slice.

The goal is to remove the current single-main-window bias without giving runtime ownership back to app templates and without turning Frontron into raw Electron pass-through.

This design follows the current Frontron contract in `specs/framework-first.md`.

## Current problem

Today Frontron already accepts `windows` as a map in config and ships that map through the runtime manifest, but the runtime behaves as if only one window is real.

Current constraints:

- `packages/frontron/src/runtime/main.ts` stores one `mainWindow` global.
- built-in desktop context window controls target only that single window.
- built-in bridge namespace `window.*` targets only that single window.
- `main` or the first configured window is loaded, and every other configured window is effectively ignored.
- app activation, second-instance focus, and smoke reporting all assume one primary window.

This means the config shape implies a capability that the runtime does not actually provide.

## Non-goals for this slice

This first slice does not try to solve every Electron window problem.

Not in scope:

- raw `BrowserWindow` ownership in app code
- arbitrary per-window preload entrypoints
- per-window session and partition control
- window event streaming for every lifecycle event
- child windows, modal parent graphs, and advanced native window relationships
- persistent window state storage
- dynamic runtime window definitions that bypass config

Those can be considered only after the named-window runtime is stable.

## Design principles

- Preserve the current minimal path for users who only need one window.
- Keep `frontron.config.ts` and route-based window definitions as the source of truth.
- Preserve `bridge.window.*` and `desktopContext.window.*` as the primary-window convenience API.
- Add a new named-window API instead of redefining the existing single-window API.
- Treat configured secondary windows as singleton instances owned by the runtime.
- Prefer lazy creation for non-primary windows in the first slice.

## Runtime model

### Window roles

The runtime distinguishes two roles:

- primary window
- secondary configured windows

Primary window resolution:

1. use `windows.main` if present
2. otherwise use the first configured window
3. otherwise fall back to the current implicit default route `/`

Primary window behavior:

- created during app bootstrap
- used by existing `window.*` bridge methods
- used by current app activation and second-instance focus behavior
- used by current deep-link focus behavior

Secondary window behavior:

- defined in config up front
- not created during bootstrap
- created lazily the first time the runtime or renderer opens them
- managed as singletons keyed by window name
- recreated if closed and later reopened

## Public API changes

### Keep existing primary-window API

The existing API stays intact and continues to mean "primary window":

- `desktopContext.window.show()`
- `desktopContext.window.hide()`
- `desktopContext.window.focus()`
- `desktopContext.window.minimize()`
- `desktopContext.window.toggleMaximize()`
- `desktopContext.window.getState()`
- `bridge.window.*`
- `bridge.window.onMaximizedChanged(...)`

This preserves current renderer and app-layer behavior.

### Add a named-window API

Add a new `windows` surface to the desktop context and built-in bridge.

Proposed desktop context surface:

```ts
windows: {
  open(name: string): Promise<void>
  show(name: string): Promise<void>
  hide(name: string): void
  focus(name: string): void
  close(name: string): void
  minimize(name: string): void
  toggleMaximize(name: string): void
  exists(name: string): boolean
  getState(name: string): FrontronWindowState | null
  listConfigured(): string[]
  listOpen(): string[]
}
```

Proposed built-in bridge namespace:

```ts
bridge.windows.open({ name: 'settings' })
bridge.windows.close({ name: 'settings' })
bridge.windows.getState({ name: 'settings' })
bridge.windows.exists({ name: 'settings' })
bridge.windows.listConfigured()
bridge.windows.listOpen()
```

Bridge notes:

- built-in bridge methods should validate that `name` is a non-empty string
- unknown window names should fail with a clear Frontron error
- `open` should create the window if needed, then show and focus it
- `show` should create the window if needed, then show it
- `hide`, `focus`, `close`, `minimize`, and `toggleMaximize` should be safe no-ops when the window is not currently open
- `getState` should return `null` when the window is not currently open

### Why a new namespace instead of changing `window.*`

Changing `window.*` to require names would break the current simple path and make the common case worse.

The new namespace keeps this split clear:

- `window.*` means "primary window convenience"
- `windows.*` means "named configured windows"

## Config model for the first slice

No new config field is required for the first multi-window slice.

Existing shape remains valid:

```ts
windows: {
  main: {
    route: '/',
    width: 1280,
    height: 800,
  },
  settings: {
    route: '/settings',
    width: 960,
    height: 720,
  },
}
```

Initial semantics:

- primary window is booted automatically
- non-primary configured windows are lazy singleton windows

This avoids growing the config surface before the runtime model is proven.

If needed later, Frontron can add an explicit launch policy field in a separate slice.

## Runtime behavior details

### Window registry

Replace the single `mainWindow` global with a runtime-owned registry:

```ts
Map<string, BrowserWindow>
```

Also track:

- `primaryWindowName`
- helper accessors for primary and named windows

### Window creation

Refactor current `createWindow(...)` into two layers:

- `createBrowserWindowInstance(name, config, ...)`
- `openConfiguredWindow(name, ...)`

Responsibilities:

- read config for the named window
- build BrowserWindow options from the named window config
- create the BrowserWindow instance
- register maximize and close listeners
- load the route for that named window
- apply security policy to that window's webContents

Important change:

`loadWindowContent(...)` must stop relying on the old `mainWindow` global and instead accept the target `BrowserWindow`.

### Primary-window compatibility

The runtime should expose helpers:

- `getPrimaryWindow()`
- `focusPrimaryWindow()`

Existing app lifecycle behavior should keep using the primary window:

- second-instance handling
- deep-link focus behavior
- macOS `activate`
- current smoke mode

### Menu and tray integration

Menu and tray handlers receive `desktopContext`.

Once `desktopContext.windows.open(name)` exists, menu and tray definitions can open configured secondary windows without raw Electron access.

This is one of the main product benefits of the slice.

### Security

Each created window must go through the same configured security policy path currently applied to the primary window.

Do not let secondary windows bypass:

- `security.externalNavigation`
- `security.newWindow`
- framework-owned preload
- framework-owned `contextIsolation`

## Required source changes

### `packages/frontron/src/types.ts`

Add:

- named-window desktop context surface
- built-in bridge types for `windows.*`

Keep:

- existing `window.*` types for primary-window compatibility

### `packages/frontron/src/client.ts`

Add built-in client types for `bridge.windows.*`.

Keep `bridge.window.*` unchanged.

### `packages/frontron/src/runtime/context.ts`

Refactor desktop context creation so it can operate on:

- primary window helpers
- named-window registry helpers

Add a `windows` module to the desktop context.

### `packages/frontron/src/runtime/bridge.ts`

Expose built-in `windows.*` bridge handlers backed by the new desktop context methods.

Keep the current `window.*` handlers mapped to the primary window.

### `packages/frontron/src/runtime/main.ts`

Refactor:

- single-window globals into a window registry
- primary-window helpers
- lazy secondary-window open path
- smoke reporting to include configured and open window names
- `loadWindowContent(...)` and maximize notification logic so they target the correct window

### `packages/frontron/src/runtime/manifest.ts`

Likely no shape change is needed in this slice because the manifest already contains `windows`.

Only update if helper types need stronger runtime semantics.

## Testing strategy

### Unit and integration tests

Update and extend:

- `packages/frontron/__tests__/runtime-bridge.spec.ts`
- `packages/frontron/__tests__/runtime-smoke.spec.ts`
- `packages/frontron/__tests__/client.spec.ts`
- `packages/frontron/__tests__/bridge-types.spec.ts`

Add coverage for:

- primary window API remains stable
- named-window bridge methods validate input
- unknown named-window access fails clearly
- `open('settings')` creates and shows a configured secondary window
- reopening a closed secondary window recreates it
- `listConfigured()` and `listOpen()` reflect runtime state correctly

### Smoke coverage

Add a smoke fixture with:

- `main` route `/`
- `settings` route `/settings`

Required assertions:

- primary window still loads on bootstrap
- secondary window is not created until explicitly opened
- named-window open path loads the correct route
- smoke payload reports both configured windows and the opened window list

## Documentation changes after implementation

Update:

- `docs/guide/config.md`
- `docs/guide/customize-app.md` if examples reference windows
- `docs/guide/features.md`
- `docs/guide/use-bridge.md`
- Korean equivalents under `docs/ko/guide/`

Docs should clearly explain:

- `window.*` is the primary-window convenience API
- `windows.*` is the named-window management API
- secondary windows are lazy singletons in the first slice

## Implementation order

### Phase 1. Runtime internals

- add window registry helpers in runtime
- refactor load and create paths away from the single `mainWindow` assumption
- preserve the current primary-window behavior

### Phase 2. Public surface

- add desktop context `windows.*`
- add built-in bridge `windows.*`
- add generated and public client types

### Phase 3. Validation and docs

- land runtime and bridge tests
- land smoke coverage
- update docs and examples

## Acceptance criteria

- Existing one-window apps keep working without config changes.
- `bridge.window.*` remains a valid primary-window API.
- Configured secondary windows can be opened and managed without raw Electron code.
- Non-primary windows are runtime-owned singletons created lazily.
- Multi-window behavior is covered by tests and smoke checks.
