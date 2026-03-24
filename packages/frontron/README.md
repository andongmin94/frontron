# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron` is the framework-first desktop app layer for existing web projects.

## What It Owns

- `defineConfig`
- `frontron init`
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
- Packaging choices such as `build.outputDir`, `build.artifactName`, `build.asar`, `build.compression`, `build.files`, `build.extraResources`, `build.extraFiles`, `build.windows.*`, `build.nsis.*`, `build.mac.*`, and `build.linux.*` are user-owned.
- `create-frontron` is only a thin starter generator.
- The architecture contract lives in [`../../specs/framework-first.md`](../../specs/framework-first.md).

Docs: [frontron.andongmin.com](https://frontron.andongmin.com)

## License

MIT. Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)
