<div align="center">

<a href="https://andongmin.com/frontron/">
<img src="https://andongmin.com/frontron/logo.svg" alt="Frontron logo" height="200" />
</a>

</div>

# Frontron

Electron tooling for two paths: a starter generator for new apps and an init-focused retrofit CLI for existing web frontend projects.

## Packages

- `create-frontron`: the primary starter generator for new Electron desktop apps.
- `frontron`: the init-focused retrofit CLI for compatible existing web frontend projects.

## Quick Start

Start a new project with:

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app
```

For starter apps, build the packaged desktop app with:

```bash
npm run build
```

Retrofit an existing compatible web project with:

```bash
npm install -D frontron
npx frontron init
npm install
npm run frontron:dev
```

`frontron init` is the active retrofit flow today. It adds a conservative, app-owned Electron layer without replacing the app's existing frontend structure unless you explicitly choose starter-like additions.
Use `npm run frontron:package` when you are ready to create a packaged desktop build from a retrofit project.
After init, `npx frontron doctor` checks the generated Electron layer and reports missing files, scripts, and packaging metadata. Before init, it reports the project as not initialized instead of listing generated Electron files as missing.
Use `npx frontron clean --dry-run` to preview removal of manifest-owned files, scripts, dependencies, and Electron build metadata; generated file hashes and ownership records guard local edits by default.
Use `npx frontron update --dry-run` to preview a manifest-owned refresh before applying it.

## Product Shape

- `create-frontron` generates a template-owned Electron + React + Vite starter.
- The generated starter keeps its Electron files under `src/electron/` and exposes a preload bridge on `window.electron`.
- `frontron init` retrofits compatible existing web frontend projects with an app-owned Electron layer while preserving existing web scripts by default.
- The current `frontron` CLI surface is intentionally narrow: `init`, `doctor`, `clean`, and `update` are supported commands.

## Requirements

- Node.js `22.15+`

## Repo Layout

```text
frontron/
  create-frontron/             # starter generator and template
  frontron/                    # init-focused retrofit CLI for existing web projects
  release.mjs                  # shared release tooling for both packages
```

## Release

Run shared release tasks from the repo root:

```bash
node release.mjs sync-version
node release.mjs verify
node release.mjs matrix-smoke
node release.mjs publish
```

## Docs

- Docs site: [andongmin.com/frontron/](https://andongmin.com/frontron/)
- Guide: [andongmin.com/frontron/guide/](https://andongmin.com/frontron/guide/)
- The docs project now lives outside this repository.
- Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)

## License

MIT. See [`LICENSE.md`](LICENSE.md).
