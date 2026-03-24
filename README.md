<div align="center">

<a href="https://frontron.andongmin.com">
<img src="https://frontron.andongmin.com/logo.svg" alt="Frontron logo" height="200" />
</a>

</div>

# Frontron

Framework-first desktop app layer for existing web projects.

## Packages

- `frontron`: the real product. It owns config loading, the CLI, runtime/build staging, bridge APIs, and app-layer expansion.
- `create-frontron`: a thin starter generator. It produces the same official structure as the manual install path.

The architecture contract lives in [`specs/framework-first.md`](specs/framework-first.md).

## Quick Start

Use the one-step bootstrap for an existing web project:

```bash
npx frontron init
npm run app:dev
```

If you want manual dependency control:

```bash
npm install frontron
npx frontron init --skip-install
npm run app:dev
```

Create a new starter app with:

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app:dev
```

## Official Shape

- Root `frontron.config.ts` is the official config entrypoint.
- `frontron/` is the app-layer expansion area for bridge, windows, hooks, menu, tray, and Rust.
- `create-frontron` should stay thin. Runtime and build ownership belong to `frontron`.
- Normal product decisions such as app metadata, output folder, artifact naming, and Windows targets are user-configurable in `frontron.config.ts`.

## Requirements

- Node.js `22+`

## Repo Layout

```text
frontron/
  docs/                        # VitePress docs site
  specs/                       # architecture contract and fixtures
  packages/
    create-frontron/           # thin starter generator
    frontron/                  # real product package
```

## Docs

- Docs: [frontron.andongmin.com](https://frontron.andongmin.com)
- Guide: [frontron.andongmin.com/guide/](https://frontron.andongmin.com/guide/)
- Spec: [`specs/framework-first.md`](specs/framework-first.md)
- Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)

## License

MIT. See [`LICENSE.md`](LICENSE.md).
