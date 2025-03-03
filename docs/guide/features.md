# Features

This page is a reference for the features that the current Frontron product surface and starter provide out of the box.

If this is your first visit, start with the quick-start pages first. This page is better when you want to answer, “What do I already get by default?”

## Good pages to read first

::: tip
For first-time users, this order is easier:

1. Quick Start
2. Create a Project / Run in Development
3. Change App Name and Icon
4. Come back here for the feature overview
:::

## 1. Project setup CLI

Frontron can start new projects through `create-frontron`.

It:

- creates a new project folder
- copies the official starter shape
- seeds `frontron.config.ts` and `frontron/`
- wires `app:dev` and `app:build`

This means you do not need to write Electron `main`, preload, or packaging files yourself.

## 2. Official starter structure

The starter is React-based and follows the framework-first contract.

```text
src/
  components/
frontron.config.ts
frontron/
public/
package.json
```

This keeps the web app and the app-layer configuration easy to separate.

## 3. Desktop features from the framework

`frontron` owns these core features:

- main window creation
- preload bridge exposure
- window state reading and window controls
- custom title bar wiring
- desktop launch in dev and staged files for build
- packaging flow

## 4. Development flow

`npm run app:dev` is the main development command.

It runs:

- the configured web dev command
- the Electron desktop app from Frontron

It also generates `.frontron/types/frontron-client.d.ts` for bridge autocomplete.

## 5. UI and styling

The default starter includes:

- Tailwind CSS 4
- a small starter UI
- a custom title bar example

The starter is intentionally small, so you do not get a large unused UI bundle by default.

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
- `rust.bridge.math.add` becomes `bridge.math.add(...)` in the renderer.
- Config-driven Rust bridge bindings validate argument count and primitive runtime types.

## 8. How to use this page

This page is meant as a reference, not a step-by-step tutorial.

Come back here when you want to confirm:

- which features are already built in
- what the starter includes
- how the runtime and packaging flow is split
