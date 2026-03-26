# Recipes

This page shows the smallest Frontron setups for common frontend stacks.

The goal is not to show every option.

The goal is to show when auto inference is enough and when you should write `web.dev` and `web.build` explicitly.

## Evidence levels

- `Verified`: backed by representative tests or smoke coverage in this repository
- `Conditional`: supported with clear constraints, but still depends on your project shape
- `Unsupported`: outside the current framework contract

## Vite

Vite is the simplest path.

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

For a normal Vite app, `frontron dev` and `frontron build` can usually infer everything.

## VitePress

VitePress works well when the docs app is your desktop renderer.

```json
{
  "scripts": {
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

Keep your root `frontron.config.ts` minimal unless your docs app uses a custom port or custom output path.

## Next.js static export

Current Frontron support is for static export flows.

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
}

export default nextConfig
```

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

If your app does not use static export, write `web.build` explicitly only if you have a safe static output path. Otherwise, Frontron is not the right fit for that build shape yet.

## Nuxt generate

Current Nuxt support is for static generate or prerender flows.

```json
{
  "scripts": {
    "dev": "nuxt dev",
    "generate": "nuxt generate",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

If your project uses a different static output command, set it explicitly:

```ts
web: {
  build: {
    command: 'npm run generate',
    outDir: '.output/public',
  },
}
```

## Monorepo frontend app

When more than one frontend lives in the repo, be explicit.

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  web: {
    dev: {
      command: 'pnpm --filter web dev',
      url: 'http://127.0.0.1:5173',
    },
    build: {
      command: 'pnpm --filter web build',
      outDir: 'apps/web/dist',
    },
  },
})
```

This is usually clearer than relying on inference in a workspace.

## Named windows example

Support level: `Verified`

This is the representative Frontron multi-window pattern today: one primary window plus one named settings window, both loaded from app routes and reused as named singletons.

```ts
// frontron/windows/index.ts
const windows = {
  main: {
    route: '/',
    width: 1280,
    height: 800,
  },
  settings: {
    route: '/settings',
    width: 960,
    height: 720,
    show: false,
  },
}

export default windows
```

Open the settings window later from tray, menu, hooks, or the renderer bridge:

```ts
// frontron/tray.ts
const tray = {
  onClick: ({ windows }) => windows.toggleVisibility('settings'),
}

export default tray
```

```ts
// renderer
import { bridge } from 'frontron/client'

await bridge.windows.toggleVisibility({ name: 'settings' })
```

This pattern is route-based, named, and lazy-singleton. It is not a dynamic multi-instance window model.

## Custom wrapper scripts

If your team uses custom names, write them directly.

```json
{
  "scripts": {
    "frontend:start": "turbo run dev --filter web",
    "frontend:bundle": "turbo run build --filter web",
    "app:dev": "frontron dev",
    "app:build": "frontron build"
  }
}
```

```ts
import { defineConfig } from 'frontron'

export default defineConfig({
  web: {
    dev: {
      command: 'npm run frontend:start',
      url: 'http://127.0.0.1:5173',
    },
    build: {
      command: 'npm run frontend:bundle',
      outDir: 'apps/web/dist',
    },
  },
})
```

## When to use `frontron check`

Use `npx frontron check` when:

- inference picks the wrong script
- the dev URL port looks wrong
- the build output folder is unclear
- you are wiring a workspace or wrapper script

The check output is the fastest way to see what Frontron inferred and which values should become explicit.
