# Features

This page is a reference for what the current Frontron starter and support package already give you.

If this is your first visit, start with the quick-start pages first. This page works better when you want to answer, “What do I already get by default?”

## Good pages to read first

::: tip
For first-time users, this order is easier:

1. Quick Start
2. Create a Project / Run in Development
3. Change App Name and Icon
4. Come back here for the feature overview
:::

## 1. Starter generation

Frontron starts new projects through `create-frontron`.

It:

- creates a new project folder
- copies the official starter shape
- seeds `frontron.config.ts` and `frontron/`
- wires `app:dev` and `app:build`

This means you do not need to write Electron `main`, preload, or packaging files yourself on day one.

## 2. Official starter structure

The default starter is React-based and centered on the starter/template path.

```text
src/
  components/
frontron.config.ts
frontron/
public/
package.json
```

This keeps the web app and desktop-side config easy to separate.

## 3. Desktop support from `frontron`

`frontron` provides the desktop support layer behind the starter:

- CLI commands
- primary window creation
- configured secondary window management
- preload bridge exposure
- window state reading and window controls
- desktop launch in development and staged files for build
- packaging flow

## 4. Development flow

`npm run app:dev` is the main development command.

It runs:

- the configured web dev command
- the Electron desktop app through Frontron support

It also generates `.frontron/types/frontron-client.d.ts` for bridge autocomplete.

## 5. UI and styling

The default starter includes:

- Tailwind CSS 4
- a small starter UI
- a custom title bar example

The starter stays intentionally smaller than the old heavy component dump.

## 6. Build and packaging

`npm run app:build` runs this flow:

1. renderer build
2. `.frontron/` runtime and build staging
3. packaged desktop output

On Windows, the default setup writes packaged output under `output/`.

## 7. Rust slot

The official Rust extension path is `frontron/rust/`.

- If `rust.enabled` is `true`, Frontron builds and loads the Rust artifact.
- `bridge.native.getStatus()` reports native runtime status.
- `bridge.native.isReady()` reports the built-in readiness symbol.
- The starter includes `bridge.system.cpuCount()` as a config-driven Rust example.

## 8. How to use this page

Come back here when you want to confirm:

- which features are already built in
- what the starter includes
- what `frontron` still owns behind the starter
