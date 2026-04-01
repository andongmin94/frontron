<div align="center">

<a href="https://frontron.andongmin.com">
<img src="https://frontron.andongmin.com/logo.svg" alt="Frontron logo" height="200" />
</a>

</div>

# Frontron

CLI-assisted Electron starter workflow for web frontend projects.

## Packages

- `create-frontron`: the primary starter generator. Use this first when you want a ready-to-run desktop starter.
- `frontron`: the support package behind that starter. It provides the CLI, runtime/build support, config loading, and the `frontron/client` bridge used by generated apps.

The current contract lives in [`specs/framework-first.md`](specs/framework-first.md). The file path stays, but the contract now centers on the starter-first workflow.

## Quick Start

Start a new project with:

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app:dev
```

Build the packaged desktop app with:

```bash
npm run app:build
```

If you already have a compatible web project and want the manual path, `frontron` can still be installed directly:

```bash
npm install frontron
npx frontron init --skip-install
npm run app:dev
```

## Product Shape

- `create-frontron` generates the starter project and its first-run UI/base files.
- `frontron` owns the CLI/runtime/build support used by that starter.
- Root `frontron.config.ts` stays the official config entrypoint.
- `frontron/` stays the app-layer expansion area for bridge, windows, hooks, menu, tray, and Rust.

## Requirements

- Node.js `22+`

## Repo Layout

```text
frontron/
  docs/                        # VitePress docs site
  specs/                       # contract and planning specs
  packages/
    create-frontron/           # starter generator and template
    frontron/                  # CLI/runtime support package
```

## Docs

- Docs: [frontron.andongmin.com](https://frontron.andongmin.com)
- Guide: [frontron.andongmin.com/guide/](https://frontron.andongmin.com/guide/)
- Contract: [`specs/framework-first.md`](specs/framework-first.md)
- Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)

## License

MIT. See [`LICENSE.md`](LICENSE.md).
