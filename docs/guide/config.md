# Config

This page is a reference for the settings people change most often in a Frontron project.

You do not need to understand every value at once. Start with the values that have the biggest visible effect.

## Good first places to change

For most people, this order is enough:

1. `public/icon.ico`
2. root `frontron.config.ts` app metadata
3. build output policy in `frontron.config.ts`
4. `frontron/windows/index.ts`
5. `vite.config.ts`

## 1. Commands

The main run and build commands live in `package.json`.

The starter uses this shape:

```json
{
  "scripts": {
    "dev": "vite",
    "web:dev": "vite",
    "web:build": "vite build",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

For a standard Vite project, `frontron dev` and `frontron build` can infer the web command and target from `package.json` and `vite.config.*`.

Add `web.dev` and `web.build` only when your project needs explicit custom values that Frontron cannot infer safely.

## 2. App metadata

The main metadata values live in `frontron.config.ts`.

The most common fields are:

- `app.name`
- `app.id`
- `app.icon`
- `app.description`
- `app.author`
- `app.copyright`

If `app.icon` is omitted, Frontron uses its default packaged icon.

Example:

```ts
app: {
  name: 'My App',
  id: 'com.example.myapp',
  icon: './public/icon.ico',
  description: 'Desktop build for My App',
  author: 'My Team',
  copyright: 'Copyright 2026 My Team',
}
```

## 3. Packaging policy

Normal product decisions for packaging also live in `frontron.config.ts`.

```ts
build: {
  outputDir: 'release',
  artifactName: '${productName}-${version}-${target}.${ext}',
  publish: 'never',
  windows: {
    targets: ['portable', 'dir'],
  },
  mac: {
    targets: ['dmg', 'zip'],
  },
  linux: {
    targets: ['AppImage', 'deb'],
  },
}
```

The common fields are:

- `build.outputDir`: change the packaged output folder
- `build.artifactName`: change artifact naming
- `build.publish`: choose the publish mode for `electron-builder`
- `build.asar`: enable or disable `asar`
- `build.compression`: choose `store`, `normal`, or `maximum`
- `build.files`: filter staged packaged app contents
- `build.extraResources`: copy extra project files into packaged resources
- `build.extraFiles`: copy extra project files next to packaged app output
- `build.fileAssociations`: register packaged document/file associations
- `build.windows.targets`: choose Windows targets such as `nsis`, `portable`, or `dir`
- `build.windows.icon`, `build.windows.publisherName`, `build.windows.certificateSubjectName`, `build.windows.signAndEditExecutable`
- `build.windows.requestedExecutionLevel`, `build.windows.artifactName`
- `build.nsis.oneClick`, `build.nsis.perMachine`, `build.nsis.allowToChangeInstallationDirectory`
- `build.nsis.deleteAppDataOnUninstall`, `build.nsis.installerIcon`, `build.nsis.uninstallerIcon`
- `build.mac.targets`: choose macOS targets such as `dmg`, `zip`, `pkg`, or `dir`
- `build.mac.icon`, `build.mac.category`, `build.mac.identity`, `build.mac.hardenedRuntime`
- `build.mac.gatekeeperAssess`, `build.mac.entitlements`, `build.mac.entitlementsInherit`, `build.mac.artifactName`
- `build.linux.targets`: choose Linux targets such as `AppImage`, `deb`, `rpm`, or `dir`
- `build.linux.icon`, `build.linux.category`, `build.linux.packageCategory`, `build.linux.artifactName`
- `build.advanced.electronBuilder`: add guarded extra `electron-builder` fields for edge cases
- `deepLinks.enabled`, `deepLinks.name`, `deepLinks.schemes`
- `updates.enabled`, `updates.provider`, `updates.url`, `updates.checkOnLaunch`
- `security.externalNavigation`, `security.newWindow`

If you omit `build.outputDir`, Frontron uses `output/`.

Path-based resource settings such as `build.extraResources`, `build.extraFiles`, `build.windows.icon`, `build.nsis.installerIcon`, `build.mac.icon`, `build.mac.entitlements`, `build.mac.entitlementsInherit`, and `build.linux.icon` are resolved from the project root.

`build.files` is different. It filters the staged packaged app contents, so keep those patterns relative to the staged app root.

`build.fileAssociations` is the typed file-association surface. Use it for packaged document types instead of trying to push raw `fileAssociations` through `build.advanced.electronBuilder`.

Path-based file association icons are resolved from the project root.

On Windows, electron-builder only applies file associations for NSIS builds, and NSIS registration is effective when `build.nsis.perMachine` is `true`.

`build.advanced.electronBuilder` is a best-effort escape hatch. Prefer the typed `build.*` fields first. Frontron blocks framework-owned fields such as staged app paths, package entry wiring, and the typed packaging fields it already owns.

Typed signing fields describe normal product policy, not secret material. Certificates, keychains, and CI signing secrets still stay outside the repo.

`updates.*` is also a typed product-policy surface now, but this first slice is intentionally small. Frontron currently supports a generic feed URL with launch-time update checks for packaged macOS apps only.

Keep `updates.url` empty only when `updates.enabled` is `false`.

`deepLinks.*` controls custom protocol registration and runtime deep-link capture. The current slice registers the configured schemes through packaged build metadata and exposes incoming URLs through `bridge.deepLink.getState()` and `bridge.deepLink.consumePending()`.

`security.*` is the first typed runtime policy slice for external navigation. Use it when your product should explicitly decide whether external links stay in-app, are blocked, or are opened in the system browser.

Example:

```ts
security: {
  externalNavigation: 'openExternal',
  newWindow: 'deny',
}
```

Supported values are:

- `allow`
- `deny`
- `openExternal`

These policies only apply when renderer content tries to leave the current app origin. Same-origin navigation stays inside the app.

## 4. Window config

Window definitions live in `frontron/windows/index.ts`.

The starter uses a route-based window shape:

```ts
const windows = {
  main: {
    route: '/',
    width: 1280,
    height: 800,
    frame: false,
    minWidth: 960,
    minHeight: 640,
    center: true,
    autoHideMenuBar: true,
  },
}
```

`main` is still the primary window.

Any additional configured windows are runtime-owned named windows.

In the current slice, non-primary configured windows are lazy singleton windows. Frontron does not create them during bootstrap. Open them later from menu, tray, hooks, or renderer bridge calls such as `bridge.windows.open({ name: 'settings' })`.

Common window fields you can now change from `frontron.config.ts` or `frontron/windows/index.ts` are:

- `route`
- `width`, `height`
- `minWidth`, `minHeight`, `maxWidth`, `maxHeight`
- `frame`, `resizable`
- `show`, `center`
- `fullscreen`, `fullscreenable`
- `maximizable`, `minimizable`, `closable`
- `alwaysOnTop`, `skipTaskbar`
- `backgroundColor`, `transparent`
- `autoHideMenuBar`
- `title`, `titleBarStyle`
- `zoomFactor`, `sandbox`, `spellcheck`, `webSecurity`
- `advanced`: guarded extra `BrowserWindow` options for edge cases

Use `show: false` when your app should start hidden and open later from your tray or bridge logic.

For tray-style apps, pair hidden startup with the built-in toggle helpers:

```ts
onClick: ({ window }) => window.toggleVisibility()
```

```ts
onClick: ({ windows }) => windows.toggleVisibility('settings')
```

If your tray menu, click handler, or hotkey path needs to branch on current visibility or focus, use `window.isVisible()`, `window.isFocused()`, `windows.isVisible('settings')`, or `windows.isFocused('settings')` from the main-process desktop context.

`windows.*.advanced` is intentionally limited. Frontron still owns `webPreferences`, icon wiring, and the common typed window fields above.

The safe web preference subset is intentionally small. Use `zoomFactor`, `sandbox`, `spellcheck`, and `webSecurity` here, but keep `preload`, `contextIsolation`, `nodeIntegration`, and raw session ownership inside Frontron.

## 5. Development server alignment

If you set `web.dev.url` explicitly, the development server port in `vite.config.ts` must match it.

If they do not match, the desktop window can open with a blank page.

## 6. The desktop bridge

Renderer code should use only `frontron/client`.

```ts
import { bridge } from 'frontron/client'

const version = await bridge.system.getVersion()
const state = await bridge.window.getState()
const nativeStatus = await bridge.native.getStatus()
```

Custom namespaces are registered from `frontron/bridge/`.

```ts
// frontron/bridge/index.ts
const bridge = {
  app: {
    getGreeting: () => 'Hello from bridge',
  },
}

export default bridge
```

## 7. Output paths

The main generated paths are:

```text
dist/
output/
.frontron/
```

- `dist/`: built web output
- `output/`: default packaged desktop output
- `.frontron/`: Frontron staging, manifests, and generated types

If you set `build.outputDir`, replace `output/` with that folder when you inspect packaged output.

## 8. Menu, tray, and hooks

App-layer desktop extensions live under `frontron/`.

```ts
import menu from './frontron/menu'
import tray from './frontron/tray'
import hooks from './frontron/hooks'
```

- `frontron/menu.ts`: application menu definition
- `frontron/tray.ts`: system tray definition
- `frontron/hooks/`: `beforeDev`, `beforeBuild`, `afterPack`

## 9. Rust slot

The official Rust slot is enabled from the root `frontron.config.ts`.

```ts
export default defineConfig({
  rust: {
    enabled: true,
  },
})
```

The starter scaffold lives under `frontron/rust/`.

- `npm run app:dev`: runs `cargo build`
- `npm run app:build`: runs `cargo build --release`

Renderer code still goes through `frontron/client`.

## 10. How to use this page

This page is a reference page, not a tutorial.

::: tip
If you want a slower walkthrough before changing values, start with the "Change App Name and Icon" guide first.
:::
