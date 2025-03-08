# Build and Package

If development mode works, the next step is to create distributable output.

This page explains what `npm run app:build` does, which product decisions stay configurable, and where the results appear.

## 1. Command

```bash
npm run app:build
```

That runs:

```bash
frontron build
```

In many starters, `npm run build` forwards to `npm run app:build`.

## 2. What happens during the build?

The build flow is:

1. build the renderer output
2. stage runtime files under `.frontron/`
3. package the desktop app

The runtime and packaging pipeline are still owned by `frontron`, not by copied template files.

## 3. Good checks before you build

- confirm that `npm run app:dev` worked at least once
- save any changes to the icon, app metadata, or build policy
- make sure the terminal does not already show a runtime error

## 4. Common packaging decisions in `frontron.config.ts`

Normal product decisions stay in config:

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
    description: 'Desktop build for My App',
    author: 'My Team',
    copyright: 'Copyright 2026 My Team',
  },
  build: {
    outputDir: 'release',
    artifactName: '${productName}-${version}-${target}.${ext}',
    asar: true,
    compression: 'maximum',
    extraResources: ['resources'],
    extraFiles: [{ from: 'licenses', to: 'licenses' }],
    fileAssociations: [
      {
        ext: ['mydoc', 'mydocx'],
        name: 'My Document',
        description: 'My desktop document',
        icon: 'public/icon.ico',
      },
    ],
    windows: {
      targets: ['portable', 'dir'],
      certificateSubjectName: 'My Team Code Signing',
      requestedExecutionLevel: 'highestAvailable',
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
    },
    mac: {
      targets: ['dmg', 'zip'],
      category: 'public.app-category.developer-tools',
      identity: 'Developer ID Application: My Team',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'entitlements.mac.plist',
      entitlementsInherit: 'entitlements.mac.inherit.plist',
    },
    linux: {
      targets: ['AppImage', 'deb'],
      category: 'Development',
      packageCategory: 'devel',
    },
  },
})
```

The most common fields are:

- `app.description`
- `app.author`
- `app.copyright`
- `build.outputDir`
- `build.artifactName`
- `build.asar`
- `build.compression`
- `build.files`
- `build.extraResources`
- `build.extraFiles`
- `build.fileAssociations`
- `build.windows.targets`
- `build.windows.icon`
- `build.windows.publisherName`
- `build.windows.certificateSubjectName`
- `build.windows.signAndEditExecutable`
- `build.windows.requestedExecutionLevel`
- `build.windows.artifactName`
- `build.nsis.oneClick`
- `build.nsis.perMachine`
- `build.nsis.allowToChangeInstallationDirectory`
- `build.nsis.deleteAppDataOnUninstall`
- `build.nsis.installerIcon`
- `build.nsis.uninstallerIcon`
- `build.mac.targets`
- `build.mac.icon`
- `build.mac.category`
- `build.mac.identity`
- `build.mac.hardenedRuntime`
- `build.mac.gatekeeperAssess`
- `build.mac.entitlements`
- `build.mac.entitlementsInherit`
- `build.mac.artifactName`
- `build.linux.targets`
- `build.linux.icon`
- `build.linux.category`
- `build.linux.packageCategory`
- `build.linux.artifactName`
- `build.advanced.electronBuilder`

Path-based resource settings such as `build.extraResources`, `build.extraFiles`, `build.windows.icon`, `build.nsis.installerIcon`, `build.mac.icon`, `build.mac.entitlements`, `build.mac.entitlementsInherit`, and `build.linux.icon` are resolved from the project root.

`build.files` is different. It filters the staged packaged app contents, so keep those patterns relative to the staged app root.

`build.advanced.electronBuilder` is the guarded last-mile override block. Use it only for edge cases. Frontron still blocks framework-owned fields such as staged app paths, package entry wiring, and the common typed packaging fields.

The typed signing fields describe product policy, not secret material. Certificates, signing secrets, and keychain access still come from the local machine or CI environment.

Auto updates now have a first typed config slice too:

- `updates.enabled`
- `updates.provider`
- `updates.url`
- `updates.checkOnLaunch`

This slice currently targets packaged macOS apps with a generic feed URL. Windows auto-update is still intentionally outside the typed surface for the current packaging targets.

Deep links also have a first typed config slice:

- `deepLinks.enabled`
- `deepLinks.name`
- `deepLinks.schemes`

Frontron stages those schemes into packaged build metadata and captures incoming URLs at runtime. Renderer code can then read them through `bridge.deepLink.getState()` and `bridge.deepLink.consumePending()`.

File associations now also have a first typed config slice:

- `build.fileAssociations[].ext`
- `build.fileAssociations[].name`
- `build.fileAssociations[].description`
- `build.fileAssociations[].mimeType`
- `build.fileAssociations[].icon`
- `build.fileAssociations[].role`
- `build.fileAssociations[].isPackage`
- `build.fileAssociations[].rank`

Frontron maps those associations into packaged build metadata and still blocks raw `fileAssociations` overrides inside `build.advanced.electronBuilder`.

Target support is still limited by electron-builder itself. In practice, Windows associations depend on NSIS packaging and require `build.nsis.perMachine: true`.

## 5. What outputs should you expect on Windows?

With the default setup, packaged output is written under `output/`.

If you set `build.outputDir`, inspect that folder instead.

With the default Windows target setup, you will usually see:

- `win-unpacked/`
- an installer `.exe`

If you change `build.windows.targets`, the output shape changes too.

Examples:

- `['portable']`: portable `.exe`
- `['dir']`: unpacked app only
- `['portable', 'dir']`: both portable and unpacked output

The exact file names can also change with `app.name`, the app version, and `build.artifactName`.

## 6. What should you inspect after the build?

Start with these folders:

```text
dist/
.frontron/
output/
```

- `dist/`: the built web frontend
- `.frontron/`: Frontron staging and generated files
- `output/`: the default packaged desktop output

If you configured `build.outputDir`, replace `output/` with that folder when you inspect results.

::: tip
If the build succeeds but the output folders are confusing, read the next page and check each folder one by one.
:::

::: warning
On Windows, very deep project paths can still break packaging steps. If you see file-not-found errors inside long packaging paths, try building from a shorter path such as `C:\dev\my-app`.
:::
