# create-frontron

Create a new Electron + React + Vite desktop app.

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app
```

Equivalent commands work with pnpm, Yarn, and Bun.

Requires Node.js `22.15+`.

## Directory contract

The target path must not already exist. `create-frontron` never merges into, replaces, or deletes an existing directory.

```bash
npm create frontron@latest my-app
```

When the project name is omitted, the target directory is `desktop-app`.

## Generated scripts

```bash
npm run dev       # browser-only Vite development
npm run app       # Vite development inside Electron
npm run typecheck
npm run lint
npm run build     # build and package the desktop app
```

## Desktop runtime

The generated app uses the operating system's native title bar and a sandboxed preload bridge. Node integration is disabled and context isolation is enabled.

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

Text-file access always goes through a native user-selected dialog and is limited to 16 MiB. The bridge does not expose arbitrary filesystem paths or Node.js APIs to the renderer.

## Generated structure

```text
src/
  electron/
    main.ts
    window.ts
    preload.ts
    ipc.ts
    serve.ts
    splash.ts
    tray.ts
  types/
    electron.d.ts
scripts/
  tasks.mjs
```

The project owns these files directly and can extend `preload.ts`, `ipc.ts`, and `electron.d.ts` for app-specific native features.

## Existing web projects

Use the separate `frontron` package to retrofit an existing compatible frontend without replacing its structure:

```bash
npm install -D frontron
npx frontron init --dry-run
npx frontron init
```

## License

MIT. See [`LICENSE`](LICENSE).
