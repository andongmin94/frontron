# Support Matrix

This page is the honest capability map for Frontron's current Electron surface.

Use it to answer three questions before you migrate:

- what Frontron covers well today
- what it only partly covers
- what stays intentionally closed or unsupported

## 0. Evidence levels

- `Verified`: backed by representative tests or smoke coverage in this repository
- `Conditional`: supported with clear constraints, but still depends on your project shape
- `Unsupported`: outside the current framework contract

## 1. Migration fit by app pattern

Frontron is strongest when the desktop app is still one web app plus a small desktop shell.

| App pattern | Fit | Evidence | Notes |
| --- | --- | --- | --- |
| Main window plus settings/about/help windows | Good fit | Verified | Static named windows map cleanly to the current model |
| Tray-driven hidden windows | Good fit | Verified | Use named windows with `show: false`, then reveal them from tray, menu, hooks, or `bridge.windows.*` |
| Route-based named extra windows | Good fit | Verified | This is the intended multi-window model today |
| Single transparent or frameless utility-style window | Conditional fit | Conditional | `transparent`, `frame: false`, and `alwaysOnTop` exist, but Frontron does not currently claim overlay or click-through support |
| Child/modal window graphs | Poor fit / currently unsupported | Unsupported | No first-class parent/child or modal relationship surface today |
| Dynamic document windows or multiple instances of the same window kind | Poor fit / currently unsupported | Unsupported | Windows are addressed by configured name and reused as singletons |
| Overlay or click-through windows | Poor fit / currently unsupported | Unsupported | No `setIgnoreMouseEvents`-style contract and no overlay-specific lifecycle surface |
| Remote-content viewer windows | Poor fit / currently unsupported | Unsupported | The current contract is route-oriented and app-origin oriented by default |
| Apps that require `webviewTag`, `nodeIntegration`, custom `webPreferences`, or direct preload globals | Poor fit / currently unsupported | Unsupported | Those areas stay intentionally closed |

## 2. Current multi-window model

Frontron's current multi-window slice is **named, route-based, lazy singleton windows**.

- Windows are declared ahead of time in `windows`.
- `windows.main` is the primary window when it exists. Otherwise, Frontron uses the first configured window as primary.
- Each configured window loads a route from the same app origin.
- Non-primary windows are created only when first opened, then reused by name.
- Frontron does not currently create arbitrary runtime window instances.
- Frontron does not currently model parent/child relationships, modal graphs, or multiple instances of one named window.

This means Frontron already supports a small set of named desktop windows well, but it is not a raw Electron multi-window runtime.

The current named-window model is `Verified` by representative bridge tests and runtime smoke coverage in this repository.

## 3. Built-in window bridge surface

The built-in bridge supports window control, but it is intentionally thinner than raw Electron.

| Surface | Current contract | Current limitations |
| --- | --- | --- |
| `bridge.window.*` | Primary-window convenience API: `isVisible()`, `isFocused()`, `toggleVisibility()`, `showInactive()`, `minimize()`, `toggleMaximize()`, `hide()`, `get/setBounds()`, `get/setPosition()`, `get/setAlwaysOnTop()`, `get/setOpacity()`, `getState()`, `onMaximizedChanged()` | Still no parent/modal graph control, arbitrary window creation, or raw `BrowserWindow` lifecycle hooks |
| `bridge.windows.*` | Named-window control for configured windows only: `open`, `isVisible`, `isFocused`, `show`, `showInactive`, `toggleVisibility`, `hide`, `focus`, `close`, `minimize`, `toggleMaximize`, `exists`, `get/setBounds`, `get/setPosition`, `get/setAlwaysOnTop`, `get/setOpacity`, `getState`, `listConfigured`, `listOpen` | No dynamic instance creation, no parent/modal control, no named-window event subscriptions |
| `desktopContext.window.*` | Main-process helper API for the primary window | Still primary-window scoped |
| `desktopContext.windows.*` | Main-process helper API for named configured windows | Same named-singleton limits as the renderer bridge |

If you need arbitrary `BrowserWindow` lifecycle control, Frontron is currently the wrong abstraction layer.

## 4. Typed `frontron.config.ts` surface

These areas are first-class product config today:

| Area | Main fields | Notes |
| --- | --- | --- |
| App metadata | `app.name`, `app.id`, `app.icon`, `app.description`, `app.author`, `app.copyright` | Normal product identity |
| Web wiring | `web.dev.command`, `web.dev.url`, `web.build.command`, `web.build.outDir` | Use when auto inference is not enough |
| Build policy | `build.outputDir`, `build.artifactName`, `build.publish`, `build.asar`, `build.compression`, `build.files`, `build.extraResources`, `build.extraFiles` | Typed packaging defaults |
| Platform packaging | `build.windows.*`, `build.nsis.*`, `build.mac.*`, `build.linux.*` | Common platform decisions |
| File associations | `build.fileAssociations[]` | Typed packaged file registration |
| Window config | `windows.*.route`, size, frame, visibility, title, `alwaysOnTop`, `transparent`, `skipTaskbar` | Typed route-based named window config |
| Safe runtime tuning | `windows.*.zoomFactor`, `windows.*.sandbox`, `windows.*.spellcheck`, `windows.*.webSecurity` | Small safe subset only |
| Updates | `updates.enabled`, `updates.provider`, `updates.url`, `updates.checkOnLaunch` | Current typed slice is intentionally small |
| Deep links | `deepLinks.enabled`, `deepLinks.name`, `deepLinks.schemes` | Registers schemes and captures incoming URLs |
| Security policy | `security.externalNavigation`, `security.newWindow` | External navigation policy only |
| App-layer modules | `bridge`, `menu`, `tray`, `hooks`, `rust` | Still owned by `frontron`, configured from app layer |

The typed window surface is for named application windows, not for every raw `BrowserWindow` pattern.

## 5. Guarded advanced-only fields

Use these only when the typed surface is not enough:

| Surface | Intended use | Still blocked |
| --- | --- | --- |
| `build.advanced.electronBuilder` | Last-mile packaging exceptions | Framework-owned paths, package entry wiring, typed packaging fields, raw `protocols`, raw `fileAssociations` |
| `windows.*.advanced` | Last-mile `BrowserWindow` exceptions | `webPreferences`, icon wiring, and fields that already have typed support |

`advanced` is a best-effort escape hatch, not the normal path.

Prefer the typed `build.*` and `windows.*` fields first.

## 6. Runtime-owned closed fields

These stay intentionally closed because Frontron owns runtime and build orchestration:

| Closed area | Why it stays closed |
| --- | --- |
| `preload` path | Frontron owns preload wiring |
| `contextIsolation` | Frontron keeps the bridge security boundary stable |
| `nodeIntegration` | Frontron keeps renderer security defaults stable |
| Raw `session` / `partition` | Still outside the typed surface |
| Raw `webviewTag` and custom preload globals | Public renderer contract stays `frontron/client` only |
| Staged app paths and generated runtime layout | Frontron owns build staging |
| Template-level Electron core logic | `create-frontron` must stay thin |
| Direct runtime ownership of arbitrary `BrowserWindow` instances | Frontron keeps the window contract config-driven |

## 7. Frontend stack support

Current practical support looks like this:

| Stack | Dev inference | Build inference | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Vite | Yes | Yes | Verified | Best-supported path |
| React with Vite | Yes | Yes | Verified | Same Vite path |
| Vue with Vite | Yes | Yes | Verified | Same Vite path |
| VitePress | Yes | Yes | Verified | `docs:dev` / `docs:build` style support |
| Astro | Yes | Yes | Verified | Static output path support |
| Angular CLI | Yes | Yes | Verified | Current Angular `dist/<app>/browser` output support |
| Next.js | Yes | Conditional | Conditional | Build support is for static export flows |
| Nuxt | Yes | Conditional | Conditional | Build support is for generate / prerender flows |
| Monorepo custom app | Sometimes | Sometimes | Conditional | Often needs explicit `web.dev` / `web.build` |
| Wrapper scripts | Sometimes | Sometimes | Conditional | Prefer explicit `web.*` when inference is unclear |

## 8. Representative proof in this repo

The strongest `Verified` claims on this page map to current tests in this repository:

- frontend stack inference for Vite, VitePress, Astro, Angular, Next static export, and Nuxt generate is covered in `packages/frontron/__tests__/cli.spec.ts`
- named-window bridge behavior is covered in `packages/frontron/__tests__/runtime-bridge.spec.ts` and `packages/frontron/__tests__/runtime-shell.spec.ts`
- route-based named-window runtime loading is covered in `packages/frontron/__tests__/runtime-smoke.spec.ts`

`Conditional` rows still depend on your project shape matching the documented constraints, even when one representative path is tested here.

## 9. When to stop relying on inference

Add explicit `web.dev` and `web.build` when:

- your project uses wrapper scripts like `turbo run dev --filter web`
- multiple frontend apps live in one repo
- your static output path is not obvious
- your team wants fully explicit desktop wiring

If you are unsure, run:

```bash
npx frontron check
```

Then move to the recipes page for a concrete stack setup.

## 10. When Frontron is the wrong tool

Frontron is probably the wrong tool today if your app needs any of these as first-class requirements:

- arbitrary runtime-created windows instead of configured named windows
- more than one instance of the same window kind
- modal or parent/child window graphs
- overlay or click-through behavior
- remote URLs, `file://`, or inline HTML as independent window content modes
- `webviewTag`, `nodeIntegration`, custom preload globals, or custom `webPreferences`

`npx frontron check` now flags common migration blockers such as legacy `window.electron`, raw BrowserWindow security options, overlay APIs, modal graphs, remote `loadURL()` / `loadFile()`, and `<webview>` usage before you do deeper migration work.

In those cases, raw Electron is still a better fit than stretching Frontron past its current contract.
