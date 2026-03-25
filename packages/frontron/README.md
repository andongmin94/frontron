# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron` is the framework-first desktop app layer for existing web projects.

## What It Owns

- `defineConfig`
- `frontron init`
- `frontron check`
- `frontron dev`
- `frontron build`
- config discovery for root `frontron.config.ts`
- `frontron/client`
- runtime and build ownership
- typed bridge registration
- app-layer expansion under `frontron/`
- the official `frontron/rust` slot

## Existing Project Bootstrap

Use the one-step bootstrap:

```bash
npx frontron init
```

When `frontron` is missing, the CLI installs the matching package version, adds `app:dev` and `app:build`, and creates the root `frontron.config.ts`.

If the first desktop run still fails, run:

```bash
npx frontron check
```

`npx frontron doctor` still works as a compatibility alias, but `check` is now the primary command name.

It checks:

- `package.json`
- root `frontron.config.ts`
- `app:dev` and `app:build`
- inferred or explicit `web.dev` and `web.build`
- dev-port conflicts before `app:dev` starts
- frontend build output, `.frontron/`, and packaged output state
- Rust toolchain presence when `rust.enabled` is true
- monorepo and custom-script hints when inference is likely ambiguous

If you want manual dependency control:

```bash
npm install frontron
npx frontron init --skip-install
```

## Minimal Usage

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
    description: 'My desktop app',
    author: 'My Team',
  },
  build: {
    outputDir: 'release',
    artifactName: '${productName}-${version}-${target}.${ext}',
    windows: {
      targets: ['nsis', 'dir'],
    },
  },
})
```

```json
{
  "scripts": {
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

## Common Product Settings

Use `app` for normal product metadata, and the top-level `build` block for packaged output policy.

`web.build` is still the frontend build step.

The top-level `build` block is Frontron's desktop package output config.

Packaged production apps load the built frontend through a Frontron-owned local loopback server instead of `file://`.

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
    description: 'Desktop shell for My App',
    author: 'Example Team',
    copyright: 'Copyright (c) 2026 Example Team',
  },
  build: {
    outputDir: 'artifacts',
    artifactName: '${productName}-${version}.${ext}',
    publish: 'onTag',
    asar: true,
    compression: 'maximum',
    files: ['main.mjs', { from: 'public', to: 'public-files', filter: ['**/*'] }],
    extraResources: ['resources'],
    extraFiles: [{ from: 'licenses', to: 'licenses' }],
    windows: {
      targets: ['nsis', 'portable', 'dir'],
      icon: 'public/icon.ico',
      publisherName: ['Example Team'],
      signAndEditExecutable: true,
      requestedExecutionLevel: 'highestAvailable',
      artifactName: '${productName}-win-${version}.${ext}',
    },
    nsis: {
      oneClick: false,
      perMachine: true,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: true,
      installerIcon: 'public/installer.ico',
      uninstallerIcon: 'public/uninstaller.ico',
    },
    mac: {
      targets: ['dmg', 'zip'],
      icon: 'public/icon.icns',
      category: 'public.app-category.developer-tools',
      artifactName: '${productName}-mac-${version}.${ext}',
    },
    linux: {
      targets: ['AppImage', 'deb'],
      icon: 'public/icons',
      category: 'Development',
      packageCategory: 'devel',
      artifactName: '${productName}-linux-${version}.${ext}',
    },
  },
})
```

## Notes

- The public renderer API is `frontron/client`.
- Frontron can infer common existing-project scripts such as Vite `dev` / `build`, VitePress `docs:dev` / `docs:build`, Astro, Angular CLI, Vue CLI, and well-known namespaced scripts like `frontend:dev`, `client:build`, `ui:dev`, and `renderer:build`. For Next.js build output, keep `next.config.*` on `output: 'export'`. For Nuxt build output, keep a static `nuxt generate` or prerender flow. If your project is more custom, set `web.dev` and `web.build` explicitly.
- Package metadata such as `app.description` and `app.author` is user-owned.
- Packaging choices such as `build.outputDir`, `build.artifactName`, `build.asar`, `build.compression`, `build.files`, `build.extraResources`, `build.extraFiles`, `build.fileAssociations`, `build.windows.*`, `build.nsis.*`, `build.mac.*`, and `build.linux.*` are user-owned.
- Code-signing policy fields such as `build.windows.certificateSubjectName`, `build.mac.identity`, `build.mac.hardenedRuntime`, `build.mac.gatekeeperAssess`, `build.mac.entitlements`, and `build.mac.entitlementsInherit` are now part of the typed config surface.
- Auto-update policy fields such as `updates.enabled`, `updates.provider`, `updates.url`, and `updates.checkOnLaunch` are now part of the typed config surface for packaged macOS apps that use a generic feed URL.
- Deep-link policy fields such as `deepLinks.enabled`, `deepLinks.name`, and `deepLinks.schemes` are now part of the typed config surface.
- Runtime security policy fields such as `security.externalNavigation` and `security.newWindow` are now part of the typed config surface.
- Safe renderer/runtime tuning such as `windows.*.zoomFactor`, `windows.*.sandbox`, `windows.*.spellcheck`, and `windows.*.webSecurity` is now user-owned.
- `build.advanced.electronBuilder` and `windows.*.advanced` are guarded escape hatches for edge cases. Frontron still blocks framework-owned runtime/build wiring and expects the typed config surface first.
- Signing credentials still stay outside the repo and config file. Certificates, keychains, and CI secrets are still supplied by the local machine or CI environment.
- Windows auto-update stays intentionally closed in this slice because Frontron does not yet expose a safe updater contract for the current Windows packaging targets.
- Incoming deep links are available through the built-in bridge with `bridge.deepLink.getState()` and `bridge.deepLink.consumePending()`.
- File associations now have a first typed config slice through `build.fileAssociations`. Frontron maps that list into packaged build metadata while still blocking raw `fileAssociations` overrides inside `build.advanced.electronBuilder`.
- Electron Builder applies file associations only on supported targets. In practice, Windows associations depend on NSIS packaging and require `build.nsis.perMachine: true`.
- `security.externalNavigation` and `security.newWindow` control what happens when renderer content tries to leave the app origin. They support `allow`, `deny`, and `openExternal`.
- Frontron still keeps `preload`, `nodeIntegration`, `contextIsolation`, and raw session ownership inside the framework.
- `create-frontron` is only a thin starter generator.
- The architecture contract lives in [`../../specs/framework-first.md`](../../specs/framework-first.md).

Docs: [frontron.andongmin.com](https://frontron.andongmin.com)

## License

MIT. Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)
