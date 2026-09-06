# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron` adds an app-owned Electron layer to an existing web frontend. Use
`create-frontron` when starting a new app. Requires Node.js `22.15+`.

**npm releases and repository source are separate.** The setup commands install
the npm release, not the current Git checkout. Check
[release notes](https://github.com/andongmin94/frontron/blob/main/CHANGELOG.md)
and the [local-tarball guide](https://github.com/andongmin94/frontron/blob/main/docs/RELEASING.md)
for unpublished stabilization changes.

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

| Adapter | Runtime | Native validation |
| --- | --- | --- |
| `generic-static` | Vite-style static output | React/Vite with npm on Windows x64, Linux x64 and macOS 15 ARM64 |
| `next-export` | Next.js static export | Implemented; no real export consumer in the baseline |
| `next-standalone` | Next.js standalone server | Conditional Linux App Router fixture with application-owned nonce CSP |
| `nuxt-node-server` | Nuxt/Nitro server | Implemented; real native consumer not covered |
| `remix-node-server` | Remix server | Implemented; real native consumer not covered |
| `sveltekit-static` | SvelteKit static adapter | Implemented; real native consumer not covered |
| `sveltekit-node` | SvelteKit Node adapter | Implemented; real native consumer not covered |
| `generic-node-server` | Explicit custom Node server | Implemented; arbitrary server behavior not established |

See the [support matrix](https://github.com/andongmin94/frontron/blob/main/docs/SUPPORT.md)
for the exact evidence, distribution formats and exclusions. Linux headless
execution does not certify sandboxing. Next.js cookies/authentication, Server
Actions and arbitrary configurations are not covered; inline scripts need an
appropriate upstream nonce/hash CSP. Do not disable sandboxing or CSP to make a
framework work.

Ambiguous detection stops instead of guessing. Override it when needed:

```bash
npx frontron init --adapter next-standalone
npx frontron init \
  --adapter generic-node-server \
  --server-root build \
  --server-entry server/index.js
```

## Monorepos

Run from a package or workspace root. A workspace with one compatible frontend
is selected automatically; otherwise pass `--project`:

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

Selections must be real directories inside the workspace and contain a regular
`package.json`.

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
  icon.svg
  package.json
src/types/electron.d.ts
tsconfig.electron.json
.frontron/manifest.json
```

Common Electron files and the managed default SVG come from the exact matching
`create-frontron` version. Existing icon settings/resources remain user-owned;
the default is selected only when no explicit or discoverable icon exists.
`serve.ts` is generated for the selected static or Node-server runtime. Existing
web scripts and unrelated package fields remain intact. The main window stays
hidden until the renderer finishes loading; no separate splash is added.

Generated windows use the operating system title bar. Node integration is
disabled; sandboxing and context isolation are enabled. The bridge exposes only:

```ts
await window.electron?.getAppInfo()
await window.electron?.openTextFile()
await window.electron?.saveTextFile({ defaultPath: 'note.txt', content: 'Hello\n' })
await window.electron?.readClipboardText()
await window.electron?.writeClipboardText('Copied text')
await window.electron?.showNotification({ title: 'Done' })
```

File access uses native user-selected dialogs and is limited to 16 MiB.
Arbitrary paths, shell execution and unrestricted IPC are not exposed.
Production uses the stable `frontron://app` origin backed by a private loopback
static server or packaged framework server. Navigation outside the app is
blocked or sent to the system browser. The internal Node-fetch transport does
not implicitly share Chromium's cookie jar or proxy settings.

## Managed lifecycle

`.frontron/manifest.json` records the adapter, paths, scripts, exact template
version, file hashes, package settings and previous values used by `clean`.

```bash
npx frontron doctor
npx frontron update --dry-run
npx frontron update --yes
npx frontron clean --dry-run
npx frontron clean --yes
```

Managed local edits are preserved by default. `update --force` or `clean --force` is required to replace or remove them. Older manifest schemas are
rejected rather than migrated.

`init`, `update` and `clean` record original and intended file states before
mutation. If an operation is interrupted, help, doctor, previews and commands
without `--yes` do not recover or modify that pending transaction. An explicitly
authorized write (`--yes`, without `--dry-run`) can recover the selected project,
then exits 1 without applying the requested command. Inspect the restored
project and rerun it to create a fresh plan.

Recovery checks all affected files before changing them. Conflicting user
edits, unexpected directory contents, hard links, symbolic links and
unrecognized partial writes stop automatic recovery and preserve files and the
journal. `--force` does not bypass these checks. Old journals are preserved and
rejected without migration. Read the
[manual recovery contract](https://github.com/andongmin94/frontron/blob/main/docs/RECOVERY_AND_VALIDATION.md)
before intervening; do not delete a journal just to silence its warning.

npm is the completed native validation baseline. pnpm, Yarn and Bun handling is
implemented, not certification of every version/platform combination. Normal
read-only content-addressed package hard links are valid templates; mutable
recovery targets have stricter rules. Only settings needed for Electron are
recorded: pnpm build approvals, Yarn's node-modules linker or Bun trust entries.
`clean` restores the previous values.

`frontron` is a CLI package. Its JavaScript modules are internal implementation
details, not a public programmatic API.

## License

MIT. [Report issues](https://github.com/andongmin94/frontron/issues).
