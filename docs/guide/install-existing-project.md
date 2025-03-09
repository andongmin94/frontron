# Install into an Existing Project

This page describes the manual or retrofit path.

Use it when you already have a compatible web frontend project and want to add the desktop app layer without switching to the starter.

## 1. What you need first

Before you start, make sure the project already runs as a normal web app.

You should have:

- Node.js `22+`
- a working web project
- a root `package.json`

## 2. Fastest manual bootstrap

For the shortest retrofit setup, run:

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

If your web setup is standard, Frontron can infer common `web.dev` and `web.build` values.

If your project is custom, add them explicitly:

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

```bash
npm run app:dev
```

You should see a desktop window.

If you only run `npm run dev`, you only get the web preview.

## 7. Build the desktop app

```bash
npm run app:build
```

Frontron stages the runtime under `.frontron/` and writes packaged output under `output/` by default.

## 8. What you do not need to create by hand

With this flow, you do not need to add:

- Electron `main.ts`
- preload files
- direct IPC wiring
- Electron Builder config files

Frontron owns those parts.

## 9. What to do next

After the first run, the most useful next pages are:

1. [Run in Development](/guide/run-development)
2. [Use the Desktop Bridge](/guide/use-bridge)
3. [Build and Package](/guide/build-and-package)

::: tip
If you are starting a brand-new app, `npm create frontron@latest` is still the default recommendation.
:::
