# Support Matrix

This page shows which Frontron surfaces are officially typed, which cases still need guarded overrides, and which runtime fields are intentionally owned by the framework.

## 1. Typed `frontron.config.ts` surface

These areas are first-class product config:

| Area | Main fields | Notes |
| --- | --- | --- |
| App metadata | `app.name`, `app.id`, `app.icon`, `app.description`, `app.author`, `app.copyright` | Normal product identity |
| Web wiring | `web.dev.command`, `web.dev.url`, `web.build.command`, `web.build.outDir` | Use when auto inference is not enough |
| Build policy | `build.outputDir`, `build.artifactName`, `build.publish`, `build.asar`, `build.compression`, `build.files`, `build.extraResources`, `build.extraFiles` | Typed packaging defaults |
| Platform packaging | `build.windows.*`, `build.nsis.*`, `build.mac.*`, `build.linux.*` | Common platform decisions |
| File associations | `build.fileAssociations[]` | Typed packaged file registration |
| Window config | `windows.*` common window fields | Includes size, frame, visibility, title, and safe web-preference subset |
| Safe runtime tuning | `windows.*.zoomFactor`, `windows.*.sandbox`, `windows.*.spellcheck`, `windows.*.webSecurity` | Small safe subset only |
| Updates | `updates.enabled`, `updates.provider`, `updates.url`, `updates.checkOnLaunch` | Current typed slice is intentionally small |
| Deep links | `deepLinks.enabled`, `deepLinks.name`, `deepLinks.schemes` | Registers schemes and captures incoming URLs |
| Security policy | `security.externalNavigation`, `security.newWindow` | External navigation policy only |
| App-layer modules | `bridge`, `menu`, `tray`, `hooks`, `rust` | Still owned by `frontron`, configured from app layer |

## 2. Guarded advanced-only fields

Use these only when the typed surface is not enough:

| Surface | Intended use | Still blocked |
| --- | --- | --- |
| `build.advanced.electronBuilder` | Last-mile packaging exceptions | Framework-owned paths, package entry wiring, typed packaging fields, raw `protocols`, raw `fileAssociations` |
| `windows.*.advanced` | Last-mile `BrowserWindow` exceptions | `webPreferences`, icon wiring, typed window fields |

`advanced` is a best-effort escape hatch, not the normal path.

Prefer the typed `build.*` and `windows.*` fields first.

## 3. Runtime-owned closed fields

These stay intentionally closed because Frontron owns runtime and build orchestration:

| Closed area | Why it stays closed |
| --- | --- |
| `preload` path | Frontron owns preload wiring |
| `contextIsolation` | Frontron keeps the bridge security boundary stable |
| `nodeIntegration` | Frontron keeps renderer security defaults stable |
| Raw `session` / `partition` | Still outside the typed surface |
| Staged app paths and generated runtime layout | Frontron owns build staging |
| Template-level Electron core logic | `create-frontron` must stay thin |
| `window.electron` style renderer globals | Public renderer contract stays `frontron/client` only |

## 4. Frontend stack support matrix

Current practical support looks like this:

| Stack | Dev inference | Build inference | Notes |
| --- | --- | --- | --- |
| Vite | Yes | Yes | Best-supported path |
| React with Vite | Yes | Yes | Same Vite path |
| Vue with Vite | Yes | Yes | Same Vite path |
| VitePress | Yes | Yes | `docs:dev` / `docs:build` style support |
| Astro | Yes | Yes | Static output path support |
| Angular CLI | Yes | Yes | Current Angular `dist/<app>/browser` output support |
| Next.js | Yes | Conditional | Build support is for static export flows |
| Nuxt | Yes | Conditional | Build support is for generate / prerender flows |
| Monorepo custom app | Sometimes | Sometimes | Often needs explicit `web.dev` / `web.build` |
| Wrapper scripts | Sometimes | Sometimes | Prefer explicit `web.*` when inference is unclear |

## 5. When to stop relying on inference

Add explicit `web.dev` and `web.build` when:

- your project uses wrapper scripts like `turbo run dev --filter web`
- multiple frontend apps live in one repo
- your static output path is not obvious
- your team wants fully explicit desktop wiring

If you are unsure, run:

```bash
npx frontron check
```

Then move to the recipes page for a concrete stack setup.
