# Config

This page is a reference for the settings people change most often in a Frontron project.

You do not need to understand every value at once. Start with the values that have the biggest visible effect.

## Good first places to change

For most people, this order is enough:

1. `public/icon.ico`
2. `frontron/config.ts` → `app.name`
3. `frontron/config.ts` → `app.id`
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
    "app": "npm run app:dev",
    "app:dev": "frontron dev",
    "app:build": "frontron build",
    "build": "npm run app:build"
  }
}
```

For a standard Vite project, `frontron dev` and `frontron build` can infer the web command and target from `package.json` and `vite.config.*`.

In development mode, Frontron can also read common script hints such as `--port 3001`, `PORT=3001`, and several common frontend defaults.

Add `web.dev` and `web.build` only when your project needs explicit custom values that Frontron cannot infer safely.

## 2. App metadata

The main metadata values live in `frontron/config.ts`.

The first values most people edit are:

- `app.name`
- `app.id`
- `app.icon`

If `app.icon` is omitted, Frontron uses its default packaged icon.

## 3. Window config

Window definitions live in `frontron/windows/index.ts`.

The starter uses a route-based window shape:

```ts
const windows = {
  main: {
    route: '/',
    width: 1280,
    height: 800,
    frame: false,
  },
}
```

## 4. Development server alignment

If you set `web.dev.url` explicitly, the development server port in `vite.config.ts` must match it.

If they do not match, the desktop window can open with a blank page.

## 5. The desktop bridge

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

```ts
import { bridge } from 'frontron/client'

const greeting = await bridge.app.getGreeting()
```

`frontron dev`, `frontron build`, `frontron dev --check`, and `frontron build --check` generate `.frontron/types/frontron-client.d.ts`.

That file gives TypeScript autocomplete for custom bridge namespaces and generated method signatures.

## 6. Output paths

The main generated paths are:

```text
dist/
output/
.frontron/
```

- `dist/`: built web output
- `output/`: packaged desktop output
- `.frontron/`: Frontron staging, manifests, and generated types

## 7. Menu, tray, and hooks

App-layer desktop extensions live under `frontron/`.

```ts
import menu from './frontron/menu'
import tray from './frontron/tray'
import hooks from './frontron/hooks'
```

- `frontron/menu.ts`: application menu definition
- `frontron/tray.ts`: system tray definition
- `frontron/hooks/`: `beforeDev`, `beforeBuild`, `afterPack`

## 8. Rust slot

The official Rust slot is enabled from `frontron/config.ts`.

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

```ts
import { bridge } from 'frontron/client'

const nativeStatus = await bridge.native.getStatus()
const isReady = await bridge.native.isReady()
```

The starter scaffold also includes config-driven Rust bridge examples.

Those example methods are not built-in framework APIs. They come from `rust.bridge` in `frontron/config.ts`.

```ts
export default defineConfig({
  rust: {
    enabled: true,
    bridge: {
      math: {
        add: {
          symbol: 'frontron_native_add',
          args: ['int', 'int'] as const,
          returns: 'int' as const,
        },
      },
    },
  },
})
```

```ts
import { bridge } from 'frontron/client'

const sum = await bridge.math.add(2, 3)
const cpuCount = await bridge.system.cpuCount()
```

These bindings are validated both in TypeScript and at runtime.

## 9. How to use this page

This page is a reference page, not a tutorial.

::: tip
If you want a slower walkthrough before changing values, start with the “Change App Name and Icon” guide first.
:::
