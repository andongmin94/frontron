<div align="center">

<a href="https://andongmin.com/frontron/">
<img src="https://andongmin.com/frontron/logo.svg" alt="Frontron logo" height="200" />
</a>

</div>

# Frontron

Electron tooling for two paths:

- `create-frontron` creates a new Electron + React + Vite app in a new directory.
- `frontron` adds an app-owned Electron layer to an existing compatible web frontend.

## Start a new app

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app
```

Use `npm run build` to create the packaged desktop app.

## Retrofit an existing frontend

```bash
npm install -D frontron
npx frontron init --dry-run
npx frontron init
npm install
npm run frontron:dev
```

Use `npm run frontron:build` to build the frontend and create the packaged desktop app. There is no separate package script.

The retrofit CLI detects Vite-style static apps, Next.js export and standalone builds, Nuxt, Remix, SvelteKit static and node builds, and explicit custom Node servers. It records every generated file and package change in `.frontron/manifest.json`, which powers guarded `doctor`, `update`, and `clean` commands.

Generated Electron windows use native operating-system title bars. The sandboxed `window.electron` bridge provides a small set of native capabilities: app information, text-file open/save dialogs, clipboard text, and notifications.

## Monorepos

Run Frontron from a workspace root when it contains exactly one compatible frontend package. Select a package explicitly when the workspace contains more than one:

```bash
npx frontron init --project apps/web
```

The root `package.json` can make that selection permanent:

```json
{
  "frontron": {
    "project": "apps/web"
  }
}
```

## Requirements

- Node.js `22.15+`

## Repository layout

```text
frontron/
  create-frontron/             # starter generator and canonical Electron template
  frontron/                    # retrofit CLI for existing web projects
  release.mjs                  # shared release tooling
```

## Release

Run shared release tasks from the repository root:

```bash
node release.mjs sync-version
node release.mjs verify
node release.mjs matrix-smoke
node release.mjs publish-dry-run
node release.mjs publish
```

## Docs

- Docs site: [andongmin.com/frontron/](https://andongmin.com/frontron/)
- Guide: [andongmin.com/frontron/guide/](https://andongmin.com/frontron/guide/)
- Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)

## License

MIT. See [`LICENSE.md`](LICENSE.md).
