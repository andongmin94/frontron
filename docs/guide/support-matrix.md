# Support Matrix

This page is the support reference for the `frontron` CLI/runtime package.

Use it after generating a starter with `create-frontron`, or when retrofitting a compatible existing web app with `frontron init`.

The goal here is simple: show which desktop surfaces `frontron` owns for you, which ones it exposes as normal config, and which ones still stay guarded.

## 1. Normal `frontron.config.ts` surface

These are the normal desktop settings most starter-based or retrofitted apps can rely on:

| Area | Main fields | Notes |
| --- | --- | --- |
| App metadata | `app.name`, `app.id`, `app.icon`, `app.description`, `app.author`, `app.copyright` | Desktop app identity |
| Web wiring | `web.dev.command`, `web.dev.url`, `web.build.command`, `web.build.outDir` | Add these when inference is not enough |
| Build policy | `build.outputDir`, `build.artifactName`, `build.publish`, `build.asar`, `build.compression`, `build.files`, `build.extraResources`, `build.extraFiles` | Common packaged-app decisions |
| Platform packaging | `build.windows.*`, `build.nsis.*`, `build.mac.*`, `build.linux.*` | Normal platform packaging choices |
| File associations | `build.fileAssociations[]` | Packaged document/file registration |
| Window config | `windows.*` common window fields | Starter/manual apps share this same window config entrypoint |
| Safe runtime tuning | `windows.*.zoomFactor`, `windows.*.sandbox`, `windows.*.spellcheck`, `windows.*.webSecurity` | Small safe subset only |
| Updates | `updates.enabled`, `updates.provider`, `updates.url`, `updates.checkOnLaunch` | Deliberately small support slice |
| Deep links | `deepLinks.enabled`, `deepLinks.name`, `deepLinks.schemes` | Registers schemes and captures incoming URLs |
| Security policy | `security.externalNavigation`, `security.newWindow` | External navigation policy only |
| App-layer modules | `bridge`, `menu`, `tray`, `hooks`, `rust` | Configured from `frontron/`, but still runtime-owned by `frontron` |

## 2. Guarded advanced-only fields

Use these only when the normal starter/manual config surface is not enough:

| Surface | Intended use | Still blocked |
| --- | --- | --- |
| `build.advanced.electronBuilder` | Last-mile packaging exceptions | Frontron-owned paths, package entry wiring, typed packaging fields, raw `protocols`, raw `fileAssociations` |
| `windows.*.advanced` | Last-mile `BrowserWindow` exceptions | `webPreferences`, icon wiring, typed window fields |

`advanced` is a best-effort escape hatch, not the main product path.

Prefer the typed `build.*` and `windows.*` fields first.

## 3. Runtime-owned closed fields

These stay intentionally closed because `frontron` owns runtime wiring, preload wiring, staging, and packaging:

| Closed area | Why it stays closed |
| --- | --- |
| `preload` path | Frontron owns preload wiring |
| `contextIsolation` | Frontron keeps the bridge security boundary stable |
| `nodeIntegration` | Frontron keeps renderer security defaults stable |
| Raw `session` / `partition` | Still outside the typed surface |
| Staged app paths and generated runtime layout | Frontron owns build staging |
| Template-level Electron core logic | `create-frontron` stays a template generator, not the runtime owner |
| `window.electron` style renderer globals | Public renderer contract stays `frontron/client` only |

## 4. Frontend stack support matrix

Current practical support for starter projects and compatible retrofits looks like this:

| Stack | Dev inference | Build inference | Notes |
| --- | --- | --- | --- |
| Vite | Yes | Yes | Best-supported path and the default starter shape |
| React with Vite | Yes | Yes | Same Vite path |
| Vue with Vite | Yes | Yes | Same Vite path |
| VitePress | Yes | Yes | `docs:dev` / `docs:build` style support |
| Astro | Yes | Yes | Static output path support |
| Angular CLI | Yes | Yes | Current Angular `dist/<app>/browser` output support |
| Next.js | Yes | Conditional | Build support is for static export flows |
| Nuxt | Yes | Conditional | Build support is for generate / prerender flows |
| Monorepo custom app | Sometimes | Sometimes | Usually needs explicit `web.dev` / `web.build` |
| Wrapper scripts | Sometimes | Sometimes | Prefer explicit `web.*` when inference is unclear |

## 5. When to stop relying on inference

Add explicit `web.dev` and `web.build` when:

- your project uses wrapper scripts like `turbo run dev --filter web`
- multiple frontend apps live in one repo
- your static output path is not obvious
- your team wants fully explicit desktop wiring

If you started from `create-frontron`, you can usually stay on the inferred path for a while.

If you are retrofitting an existing frontend and are unsure, run:

```bash
npx frontron check
```

Then move to the recipes page for a concrete stack setup.
