# Use the Desktop Bridge

This page explains the actual bridge API after you understand the basic flow.

If you are new to Electron-style apps, read [Understand the Bridge Flow](/guide/understand-bridge-flow) first.

The short rule is still simple: renderer code should use only `frontron/client`.

## 1. Import the bridge

```ts
import { bridge } from 'frontron/client'
```

Do not read preload globals directly.

Do not use `window.electron`.

## 2. Built-in bridge APIs

These namespaces are built into Frontron.

### `bridge.system`

- `getVersion()`
- `getPlatform()`
- `getNativeStatus()`
- `isNativeReady()`
- `openExternal(url | { url })`

### `bridge.window`

- `isVisible()`
- `isFocused()`
- `toggleVisibility()`
- `showInactive()`
- `minimize()`
- `toggleMaximize()`
- `hide()`
- `getBounds()`
- `setBounds({ x, y, width, height })`
- `getPosition()`
- `setPosition({ x, y })`
- `getAlwaysOnTop()`
- `setAlwaysOnTop({ value })`
- `getOpacity()`
- `setOpacity({ value })`
- `getState()`
- `onMaximizedChanged(listener)`

`bridge.window` is still the primary-window convenience API.

### `bridge.windows`

- `open({ name })`
- `isVisible({ name })`
- `isFocused({ name })`
- `show({ name })`
- `showInactive({ name })`
- `toggleVisibility({ name })`
- `hide({ name })`
- `focus({ name })`
- `close({ name })`
- `minimize({ name })`
- `toggleMaximize({ name })`
- `exists({ name })`
- `getBounds({ name })`
- `setBounds({ name, x, y, width, height })`
- `getPosition({ name })`
- `setPosition({ name, x, y })`
- `getAlwaysOnTop({ name })`
- `setAlwaysOnTop({ name, value })`
- `getOpacity({ name })`
- `setOpacity({ name, value })`
- `getState({ name })`
- `listConfigured()`
- `listOpen()`

Use this namespace when your config defines more than one named window.

The current window model is still named, route-based, and lazy-singleton. `bridge.windows` addresses configured window names only. It does not create arbitrary runtime window instances or parent/modal window graphs.

### `bridge.native`

- `getStatus()`
- `isReady()`
- `add(left, right)`

## 3. Example built-in calls

```ts
import { bridge } from 'frontron/client'

const version = await bridge.system.getVersion()
const state = await bridge.window.getState()
const bounds = await bridge.window.getBounds()
const mainVisible = await bridge.window.isVisible()
const mainFocused = await bridge.window.isFocused()
const nativeStatus = await bridge.native.getStatus()
await bridge.window.toggleVisibility()
const settingsVisible = await bridge.windows.isVisible({ name: 'settings' })
const settingsFocused = await bridge.windows.isFocused({ name: 'settings' })
await bridge.windows.toggleVisibility({ name: 'settings' })
await bridge.windows.setAlwaysOnTop({ name: 'settings', value: true })
```

These methods work without project-specific bridge code.

## 4. Add a custom bridge namespace

Custom bridge code has two parts:

1. register the bridge in config
2. export handlers from `frontron/bridge/`

### Register it in config

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

### Export handlers

```ts
// frontron/bridge/index.ts
const bridge = {
  app: {
    getGreeting: () => 'Hello from desktop code',
  },
}

export default bridge
```

### Call it from the renderer

```ts
import { bridge } from 'frontron/client'

const greeting = await bridge.app.getGreeting()
```

## 5. Add Rust-backed bridge methods

Use `rust.bridge` when the handler should come from `frontron/rust`.

```ts
import { defineConfig } from 'frontron'

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

Then the renderer can call:

```ts
import { bridge } from 'frontron/client'

const sum = await bridge.math.add(2, 3)
```

## 6. Built-ins versus starter examples

Some bridge methods shown in the starter are examples, not built-in framework APIs.

For example:

- `bridge.system.cpuCount()` comes from starter config
- `bridge.math.add()` comes from `rust.bridge`
- `bridge.file.hasTxtExtension()` comes from starter config

Those methods exist only if your project config registers them.

## 7. Generated types

Frontron writes `.frontron/types/frontron-client.d.ts` during:

- `frontron dev`
- `frontron build`
- `frontron dev --check`
- `frontron build --check`

That file gives autocomplete for custom namespaces and generated method signatures.

## 8. When the bridge looks missing

If the UI says `Desktop bridge unavailable` or `Missing bridge handler`, check these first:

1. run `npm run app:dev`, not `npm run dev`
2. import from `frontron/client`
3. register your custom bridge in config
4. check the terminal for preload or runtime errors

::: tip
Start with `bridge.system` and `bridge.window`.

Move to custom bridge namespaces only when the app needs project-specific desktop calls.
:::
