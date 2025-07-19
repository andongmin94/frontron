# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron` is an Electron retrofit CLI for existing web frontend projects.

Use `create-frontron` for a new app. Use `frontron` when an existing Vite, Next.js, Nuxt, Remix, SvelteKit, or custom Node frontend should become an app-owned desktop project without replacing its web structure.

Requires Node.js `22.15+`.

## Commands

The public CLI surface is intentionally narrow:

```text
frontron init
frontron doctor
frontron update
frontron clean
```

- `init` detects the frontend runtime and adds the Electron layer.
- `doctor` checks every manifest-owned file and package setting.
- `update` refreshes the Electron layer from the exact matching `create-frontron` template.
- `clean` removes only the files and settings recorded as Frontron-owned.

## Retrofit an existing frontend

```bash
npm install -D frontron
npx frontron init --dry-run
npx frontron init
npm install
npm run frontron:dev
```

The generated project has two desktop scripts:

```text
frontron:dev     start the existing web dev server inside Electron
frontron:build   build the web project and create the packaged desktop app
```

There is no separate `frontron:package` script. `frontron:build` runs the existing web build, compiles Electron, prepares the selected runtime, and invokes Electron Builder.

Script names can be changed during init:

```bash
npx frontron init \
  --app-script desktop:dev \
  --build-script desktop:build
```

## Runtime adapters

Frontron detects the runtime from package dependencies, scripts, and framework configuration:

| Adapter | Runtime |
| --- | --- |
| `generic-static` | Vite-style static output |
| `next-export` | Next.js static export |
| `next-standalone` | Next.js standalone Node server |
| `nuxt-node-server` | Nuxt/Nitro Node server |
| `remix-node-server` | Remix Node server |
| `sveltekit-static` | SvelteKit static adapter |
| `sveltekit-node` | SvelteKit node adapter |
| `generic-node-server` | Explicit custom Node server |

Ambiguous detection stops instead of choosing an arbitrary runtime. Override it explicitly when required:

```bash
npx frontron init --adapter next-standalone
npx frontron init \
  --adapter generic-node-server \
  --server-root build \
  --server-entry server/index.js
```

## Monorepos

Frontron can run from a package root or a workspace root.

When a package.json workspace or `pnpm-workspace.yaml` contains exactly one compatible frontend package, the CLI selects it automatically. Lifecycle commands prefer the only package containing `.frontron/manifest.json`.

Select a package explicitly when the workspace has multiple frontends:

```bash
npx frontron init --project apps/web
npx frontron doctor --project apps/web
npx frontron update --project apps/web --dry-run
npx frontron clean --project apps/web --dry-run
```

A workspace root can persist the selection:

```json
{
  "frontron": {
    "project": "apps/web"
  }
}
```

Project selections must be relative real directories inside the workspace root and must contain a regular `package.json`. Symlinked or escaping paths are rejected.

## Generated Electron layer

The default output is:

```text
electron/
  main.ts
  window.ts
  preload.ts
  ipc.ts
  dev.ts
  serve.ts
  splash.ts
  tray.ts
  package.json
src/types/electron.d.ts
tsconfig.electron.json
.frontron/manifest.json
```

Common Electron files come from the exact-version `create-frontron` dependency. `serve.ts` is generated for the selected static or Node-server adapter.

The existing web `dev` and `build` scripts remain intact. Frontron adds Electron dependencies and Electron Builder metadata without replacing unrelated package fields.

## Native window and renderer API

Generated windows use the operating system's native title bar. The shared BrowserWindow keeps Node integration disabled, sandboxing enabled, and context isolation enabled.

The sandboxed renderer bridge is available as `window.electron`:

```ts
await window.electron?.getAppInfo()
await window.electron?.openTextFile()
await window.electron?.saveTextFile({
  defaultPath: 'note.txt',
  content: 'Hello\n',
})
await window.electron?.readClipboardText()
await window.electron?.writeClipboardText('Copied text')
await window.electron?.showNotification({ title: 'Done' })
```

Text files are opened and saved only through native user-selected dialogs and are limited to 16 MiB. IPC validates the originating renderer and arguments. The bridge intentionally does not expose arbitrary filesystem paths, shell execution, or unrestricted IPC.

The generated `preload.ts`, `ipc.ts`, and `electron.d.ts` are app-owned, so an application can add narrowly scoped native methods when needed.

## Production renderer

Production windows use the stable `frontron://app` origin. A private loopback server hosts static output or the packaged framework server behind the protocol handler.

The protocol layer:

- accepts only the registered app origin,
- rewrites internal origin and redirect headers,
- preserves an application-provided CSP,
- adds a fallback CSP when one is absent,
- blocks unapproved navigation,
- sends explicit HTTP and HTTPS links to the system browser.

## Manifest-owned lifecycle

`.frontron/manifest.json` records:

- selected adapter, paths, scripts, product name, and app ID,
- exact `create-frontron` version,
- generated file paths and SHA-256 hashes,
- generated script commands,
- package.json, tsconfig, pnpm, and Yarn ownership claims,
- previous values needed by `clean`.

### Doctor

```bash
npx frontron doctor
```

`doctor` reports missing files, local edits, dependency mismatches, invalid metadata, and pending transaction state without changing the project.

### Update

```bash
npx frontron update --dry-run
npx frontron update --yes
```

`update` reuses the adapter and paths recorded by init. Locally edited managed files are not overwritten unless `--force` is explicit:

```bash
npx frontron update --yes --force
```

### Clean

```bash
npx frontron clean --dry-run
npx frontron clean --yes
```

`clean` removes or restores only manifest-owned values. User modifications are preserved unless `--force` is explicit.

Older manifest schemas are rejected instead of migrated. Remove the old retrofit layer and initialize again with the current release.

## Transaction recovery

`init`, `update`, and `clean` create snapshots and publish a durable journal before modifying managed files. A later valid lifecycle command restores an interrupted operation before proceeding.

Project paths, manifest paths, symlink ancestors, hard-link counts, package-manager settings, and transaction state are validated before mutation. `doctor`, help, and argument errors never trigger recovery.

## Package-manager support

npm, pnpm, Yarn, and Bun are supported. Frontron detects the nearest lockfile while walking from a selected workspace package to its root.

For Yarn Berry, Frontron sets the nearest `.yarnrc.yml` `nodeLinker` to `node-modules` when it can do so safely. For pnpm workspaces, required Electron build allowances are recorded as managed claims. Ambiguous configuration is reported as a blocker instead of being reformatted speculatively.

## Compatibility verification

The repository exercises Node.js 22.15, 24, and 26, Windows, macOS, Linux, framework fixtures, packed npm artifacts, Electron development and package flows, and npm, pnpm, Yarn, and Bun projects before release.

## License

MIT. Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)
