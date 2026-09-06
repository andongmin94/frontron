# create-frontron

Create a new Electron + React + Vite desktop app. Requires Node.js `22.15+`.

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app
```

These commands use the npm release, not an unpublished Git checkout. See the
[release notes](https://github.com/andongmin94/frontron/blob/main/CHANGELOG.md)
and [local-tarball guide](https://github.com/andongmin94/frontron/blob/main/docs/RELEASING.md)
when trying repository changes before publication.

## Validated scope

The completed npm consumer baseline covers Windows x64 development, MSI and
portable; Linux x64 development and unpacked execution; and macOS 15 ARM64
development, ZIP and DMG. Linux headless checks use test-only no-sandbox flags.
Signing, notarization, Gatekeeper/SmartScreen and other architectures are not
implied. See the [support matrix](https://github.com/andongmin94/frontron/blob/main/docs/SUPPORT.md)
for exact evidence and exclusions.

The generator also implements pnpm build approvals, Yarn's `node-modules`
linker and Bun trusted dependencies. Those settings are not evidence that every
package-manager/version/platform combination passed the npm native checks.

## Directory contract

The target path must not already exist. `create-frontron` never merges into,
replaces or deletes an existing directory. When the project name is omitted,
the target directory is `desktop-app`.

## Generated scripts

```bash
npm run dev       # browser-only Vite development
npm run app       # Vite development inside Electron
npm run typecheck
npm run lint
npm run format
npm run format:check
npm run build     # build and package the desktop app
```

## Desktop runtime

The generated app uses the operating system's native title bar and a sandboxed
preload bridge. Node integration is disabled and context isolation is enabled.
The bridge is available as `window.electron` in Electron mode:

```ts
const info = await window.electron?.getAppInfo()
const file = await window.electron?.openTextFile()
await window.electron?.saveTextFile({
  defaultPath: 'note.txt',
  content: 'Hello from Electron\n',
})
await window.electron?.writeClipboardText('Copied text')
const clipboardText = await window.electron?.readClipboardText()
await window.electron?.showNotification({
  title: 'My app',
  body: 'Done',
})
```

Text-file access goes through a native user-selected dialog and is limited to
16 MiB. The bridge does not expose arbitrary filesystem paths or Node.js APIs
to the renderer.

## Generated structure

```text
src/
  electron/
    main.ts
    window.ts
    preload.ts
    ipc.ts
    serve.ts
    static-server.ts
  types/
    electron.d.ts
scripts/
  tasks.mjs
```

The main window stays hidden until its renderer finishes loading; a separate
splash window is not generated. The project owns these files directly and can
extend `preload.ts`, `ipc.ts` and `electron.d.ts` for app-specific native features.

## Existing web projects

Use `frontron` to retrofit a compatible frontend without replacing its structure:

```bash
npm install -D frontron
npx frontron init --dry-run
npx frontron init
```

## License

MIT. See [`LICENSE`](LICENSE).
