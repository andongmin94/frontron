# Understand the Bridge Flow

If Frontron feels confusing, start on this page.

The most important idea is simple: your web UI and the desktop side do not run in the same place.

Frontron connects them for you.

## 1. The three parts

```text
src/ React UI  ->  frontron/client  ->  desktop-side handlers
renderer           safe bridge          Electron runtime
```

- `src/` is your normal frontend code.
- `frontron/client` is the only API your frontend should call for desktop features.
- desktop-side handlers run in the Frontron desktop runtime, not in the browser.

## 2. Why there is a bridge

Browser code should not directly control desktop windows, system APIs, or native modules.

That is why Frontron keeps the desktop part on one side and gives the renderer a safe call point on the other side.

## 3. What Frontron owns

Frontron already owns these parts:

- Electron main process
- preload
- IPC wiring
- runtime boot
- packaging flow

You do not create those files yourself.

## 4. What you write

You usually write only these parts:

- pages and components in `src/`
- calls to `bridge.system`, `bridge.window`, or your own bridge namespace
- optional desktop-side handlers in `frontron/bridge/`

## 5. A small example

This example shows a full path from the UI to desktop-side code.

### Step 1. Register your bridge in config

```ts
// frontron.config.ts
import { defineConfig } from 'frontron'
import bridge from './frontron/bridge'

export default defineConfig({
  app: {
    name: 'My App',
    id: 'com.example.myapp',
  },
  bridge,
})
```

### Step 2. Add a desktop-side handler

```ts
// frontron/bridge/index.ts
import os from 'node:os'

const bridge = {
  app: {
    getComputerName: () => os.hostname(),
  },
}

export default bridge
```

This file runs on the desktop side.

That is why it can use `node:os`.

### Step 3. Call it from the frontend

```tsx
import { bridge } from 'frontron/client'

const computerName = await bridge.app.getComputerName()
```

This code runs in your frontend.

It does not touch Node APIs directly.

It only calls the bridge.

## 6. What happens when you click the button

Here is the flow in plain language:

1. Your React component calls `bridge.app.getComputerName()`.
2. Frontron sends that request to the desktop side.
3. The handler in `frontron/bridge/index.ts` runs there.
4. The return value comes back to the frontend.
5. Your UI renders the result.

## 7. Use the built-in bridge first

Before you add custom handlers, check the built-in APIs first.

- `bridge.window`: window actions like minimize and maximize
- `bridge.system`: app and platform helpers
- `bridge.native`: native runtime status helpers

Those methods already exist without extra project setup.

## 8. Add custom handlers only when needed

Add your own bridge namespace when the frontend needs desktop-only work such as:

- reading system information
- calling Node modules
- wrapping project-specific desktop logic

If you need Rust-backed native code, use `rust.bridge` in config.

## 9. Common mistakes

- running `npm run dev` instead of `npm run app:dev`
- importing something other than `frontron/client` in renderer code
- creating `frontron/bridge/index.ts` but forgetting to register it in config
- expecting a starter example method to exist in a manual-install project without adding it

## 10. Read next

- [Install into an Existing Project](/guide/install-existing-project)
- [Run in Development](/guide/run-development)
- [Use the Desktop Bridge](/guide/use-bridge)
