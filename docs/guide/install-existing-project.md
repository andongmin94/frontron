# Install into an Existing Project

This page is for the main Frontron workflow.

Use it when you already have a web frontend project and want to add the desktop app layer without switching to the starter.

## 1. What you need first

Before you start, make sure the project already runs as a normal web app.

You should have:

- Node.js `22+`
- a working web project
- a root `package.json`

## 2. Install Frontron

Add `frontron` to the project:

```bash
npm install frontron
```

## 3. Bootstrap the basic files

If you want Frontron to add the minimum setup for you, run:

```bash
npx frontron init
```

That command adds these basics when they are missing:

- `app:dev` in `package.json`
- `app:build` in `package.json`
- a root `frontron.config.ts`

It does not overwrite existing scripts or config files.

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

For a standard Vite project, Frontron can infer these values from your project:

- the web dev command from `package.json`
- the web dev port from `vite.config.*`, `--port`, `PORT=`, or the Vite default
- the build command from `package.json`
- the build output folder from `vite.config.*` or the Vite default

It can also follow common frontend defaults such as React Scripts, Next, Nuxt, Astro, Angular CLI, and Vue CLI when the dev script makes the port obvious.

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

Frontron stages the runtime under `.frontron/` and writes packaged output under `output/`.

If `app.icon` is not set, Frontron uses its default icon automatically.

## 8. What you do not need to create by hand

With this flow, you do not need to add:

- Electron `main.ts`
- preload files
- direct IPC wiring
- Electron Builder config files

Frontron owns those parts.

## 9. What to do next

After the first run, the most useful next pages are:

1. [Understand the Bridge Flow](/guide/understand-bridge-flow)
2. [Run in Development](/guide/run-development)
3. [Use the Desktop Bridge](/guide/use-bridge)
4. [Build and Package](/guide/build-and-package)

::: tip
You can stay with only `frontron.config.ts` at first.

Create `frontron/` later when your app-layer code grows.
:::
