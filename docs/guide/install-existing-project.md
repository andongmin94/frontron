# Install into an Existing Project

This page is for the main Frontron workflow.

Use it when you already have a web frontend project and want to add the desktop app layer without switching to the starter.

## 1. What you need first

Before you start, make sure the project already runs as a normal web app.

You should have:

- Node.js `22+`
- a working web project
- a root `package.json`

## 2. Fastest bootstrap

For the shortest setup, run:

```bash
npx frontron init
```

When `frontron` is missing, that command installs it automatically and then adds these basics when they are missing:

- `app:dev` in `package.json`
- `app:build` in `package.json`
- a root `frontron.config.ts`

It does not overwrite existing scripts or config files.

If you want to manage the dependency yourself, use:

```bash
npx frontron init --skip-install
```

## 3. Manual install if needed

If you prefer to install the dependency yourself first, this is still valid:

```bash
npm install frontron
npx frontron init --skip-install
```

## 4. Add desktop scripts manually if needed

Keep your normal web scripts.

Add desktop scripts next to them:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

`npm run dev` stays browser-only.

`npm run app:dev` is the desktop command.

## 5. Add `frontron.config.ts` manually if needed

Create a root `frontron.config.ts`:

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
      targets: ['portable', 'dir'],
    },
  },
  windows: {
    main: {
      route: '/',
      width: 1280,
      height: 800,
    },
  },
})
```

For a standard Vite project, Frontron can infer these values from your project:

- the web dev command from `package.json`
- the web dev port from `vite.config.*`, `--port`, `PORT=`, or the Vite default
- the build command from `package.json`
- the build output folder from `vite.config.*` or the Vite default

It can also follow common frontend defaults such as React Scripts, Astro, Angular CLI, Vue CLI, standard VitePress `docs:dev` / `docs:build` scripts, and well-known namespaced scripts such as `frontend:dev`, `frontend:build`, `client:dev`, `client:build`, `ui:dev`, and `renderer:build`.

For Next.js, Frontron can infer the packaged build output when `next.config.*` uses `output: 'export'`.

For Nuxt, Frontron can infer the packaged build output when your project uses a static `nuxt generate` / `nuxi generate` flow or another prerendered static output.

If your project uses a custom or non-standard setup, add `web.dev` and `web.build` explicitly.

```ts
export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
  },
  web: {
    dev: {
      command: 'npm run dev',
      url: 'http://localhost:5173',
    },
    build: {
      command: 'npm run build',
      outDir: 'dist',
    },
  },
})
```

## 6. Run the desktop app

Start desktop mode:

```bash
npm run app:dev
```

You should see a desktop window.

If you only run `npm run dev`, you only get the web preview.

## 7. Build the desktop app

Package the app with:

```bash
npm run app:build
```

Frontron stages the runtime under `.frontron/` and writes packaged output under `output/` by default.

In packaged production, Frontron serves the built frontend through its own local loopback server instead of `file://`.

If `app.icon` is not set, Frontron uses its default icon automatically.

You can move or reshape the packaged output from `frontron.config.ts`.

Common user-owned build settings are:

- `app.description`
- `app.author`
- `app.copyright`
- `build.outputDir`
- `build.artifactName`
- `build.windows.targets`

## 8. Common product settings

Use `app` for normal product metadata, and the top-level `build` block for packaged output policy.

`web.build` is still the frontend build step.

The top-level `build` block is for desktop packaging decisions such as output folder, artifact naming, publish mode, and Windows targets.

```ts
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
    windows: {
      targets: ['nsis', 'portable', 'dir'],
    },
  },
})
```

## 9. What you do not need to create by hand

With this flow, you do not need to add:

- Electron `main.ts`
- preload files
- direct IPC wiring
- Electron Builder config files

Frontron owns those parts.

## 10. What to do next

After the first run, the most useful next pages are:

1. [Understand the Bridge Flow](/guide/understand-bridge-flow)
2. [Run in Development](/guide/run-development)
3. [Use the Desktop Bridge](/guide/use-bridge)
4. [Build and Package](/guide/build-and-package)

::: tip
You can stay with only `frontron.config.ts` at first.

Create `frontron/` later when your app-layer code grows.
:::
