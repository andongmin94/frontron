# Recipes

This page shows the smallest `frontron` setups for common frontend stacks.

Use it when you start from a generated starter and want to compare script shapes, or when you are retrofitting an existing frontend and want a minimal explicit example.

The goal is not to show every option.

The goal is to show when auto inference is enough and when you should write `web.dev` and `web.build` explicitly.

## Vite

Vite is the simplest path and the closest match to the default starter layout.

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

This is usually clearer than relying on inference in a workspace retrofit.

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

The check output is the fastest way to see what `frontron` inferred and which values should become explicit.
