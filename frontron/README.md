# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron` adds an app-owned Electron layer to an existing web frontend. Use `create-frontron` when starting a new app. Requires Node.js `22.15+`.

## Commands

```text
frontron init     detect the web runtime and add Electron
frontron doctor   inspect the managed layer without changing files
frontron update   refresh the managed layer from create-frontron
frontron clean    remove only Frontron-owned files and settings
```

## Setup

```bash
npm install -D frontron
npx frontron init --dry-run
npx frontron init
npm install
npm run frontron:dev
```

The generated scripts are:

```text
frontron:dev     run the existing web development server in Electron
frontron:build   build the web project and package the desktop app
```

There is no separate package command. Script names can be changed during init:

```bash
npx frontron init \
  --app-script desktop:dev \
  --build-script desktop:build
```

## Runtime adapters

| Adapter | Runtime |
| --- | --- |
| `generic-static` | Vite-style static output |
| `next-export` | Next.js static export |
| `next-standalone` | Next.js standalone server |
| `nuxt-node-server` | Nuxt/Nitro server |
| `remix-node-server` | Remix server |
| `sveltekit-static` | SvelteKit static adapter |
| `sveltekit-node` | SvelteKit Node adapter |
| `generic-node-server` | Explicit custom Node server |

Ambiguous detection stops instead of guessing. Override it when needed:

```bash
npx frontron init --adapter next-standalone
npx frontron init \
  --adapter generic-node-server \
  --server-root build \
  --server-entry server/index.js
```

## Monorepos

Run from a package or workspace root. A workspace with one compatible frontend is selected automatically; otherwise pass `--project`:

```bash
npx frontron init --project apps/web
npx frontron doctor --project apps/web
npx frontron update --project apps/web --dry-run
npx frontron clean --project apps/web --dry-run
```

A root package can persist the selection:

```json
{
  "frontron": {
    "project": "apps/web"
  }
}
```

Selections must be real directories inside the workspace and contain a regular `package.json`.

## Generated layer

```text
electron/
  main.ts
  window.ts
  preload.ts
  ipc.ts
  dev.ts
  serve.ts
  static-server.ts
  package.json
src/types/electron.d.ts
tsconfig.electron.json
.frontron/manifest.json
```

Common Electron files come from the exact matching `create-frontron` version. `serve.ts` is generated for the selected static or Node-server runtime. Existing web scripts and unrelated package fields remain intact. The native main window stays hidden until the renderer finishes loading, so the retrofit layer does not add a separate splash window.

Generated windows use the operating system title bar. Node integration is disabled; sandboxing and context isolation are enabled. The renderer bridge exposes only:

```ts
await window.electron?.getAppInfo()
await window.electron?.openTextFile()
await window.electron?.saveTextFile({ defaultPath: 'note.txt', content: 'Hello\n' })
await window.electron?.readClipboardText()
await window.electron?.writeClipboardText('Copied text')
await window.electron?.showNotification({ title: 'Done' })
```

File access uses native user-selected dialogs and is limited to 16 MiB. Arbitrary paths, shell execution, and unrestricted IPC are not exposed.

Production uses the stable `frontron://app` origin backed by a private loopback static server or packaged framework server. Navigation outside the app is blocked or sent to the system browser.

## Managed lifecycle

`.frontron/manifest.json` records the adapter, paths, scripts, exact template version, generated file hashes, package settings, and previous values used by `clean`.

```bash
npx frontron doctor
npx frontron update --dry-run
npx frontron update --yes
npx frontron clean --dry-run
npx frontron clean --yes
```

Managed local edits are preserved by default. `update --force` or `clean --force` is required to replace or remove them. Older manifest schemas are rejected rather than migrated.

`init`, `update`, and `clean` snapshot managed files before mutation and recover an interrupted operation on the next valid lifecycle command. Project escapes and symbolic-link paths are rejected.

npm, pnpm, Yarn, and Bun are supported. Installed pnpm packages may use their normal content-addressed hard links; Frontron treats those read-only package files as valid templates. Frontron records the small pnpm or Yarn settings needed for Electron installation and restores its own changes during `clean`.

## License

MIT. [Report issues](https://github.com/andongmin94/frontron/issues).
