# Understand the Generated Structure

At the beginning, you do not need to read every file.

When you first open a generated Frontron starter, it is enough to understand which folders own which responsibilities.

## 1. The first files to look at

```text
src/
  components/
frontron.config.ts
frontron/
public/
package.json
```

## 2. `frontron.config.ts`

This file is the official config entrypoint.

At first, it is enough to know that it can be a thin entrypoint that re-exports `./frontron/config`.

## 3. `frontron/`

This folder is the app-layer area that the starter prepares for desktop-side code.

Start by learning these names:

- `config.ts`: app-wide desktop configuration
- `bridge/`: custom bridge namespaces
- `hooks/`: lifecycle hooks for dev and build
- `menu.ts`: application menu definition
- `tray.ts`: system tray definition
- `windows/`: route-based window definitions
- `rust/`: official Rust slot

## 4. `src/components/`

This folder contains visible React UI.

For example:

- `TitleBar.tsx`: the custom window title bar
- `App.tsx`: the starter screen that shows bridge and runtime status

The starter intentionally keeps the UI small, so `TitleBar.tsx` and `App.tsx` are good first files to read.

## 5. `public/`

This folder stores static files.

The most important starter file here is usually `icon.ico`.

## 6. `package.json`

This file matters for two reasons:

- it shows how the starter app is started and built
- it shows which scripts wire the project to `frontron`

For most people, the important scripts are:

- `npm run app:dev`
- `npm run app:build`
- `npm run dev`

## 7. What you do not need yet

At the first stage, you do not need to know:

- every Electron lifecycle event
- every internal build option
- every detail of the UI implementation

The useful skill right now is knowing which folder to check first when something changes.
