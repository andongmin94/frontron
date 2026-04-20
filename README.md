<div align="center">

<a href="https://andongmin.com/frontron/">
<img src="https://andongmin.com/frontron/logo.svg" alt="Frontron logo" height="200" />
</a>

</div>

# Frontron

Electron starter generator plus a transitional init shell for retrofitting existing web frontend projects.

## Packages

- `create-frontron`: the primary starter generator. Use this first when you want a ready-to-run desktop starter.
- `frontron`: a transitional placeholder/init shell for the existing-project retrofit path.

## Quick Start

Start a new project with:

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app
```

Build the packaged desktop app with:

```bash
npm run build
```

If you already have a compatible web project, note that the retrofit path is being redesigned:

```bash
npm install frontron
npx frontron --help
```

## Product Shape

- `create-frontron` generates a template-owned Electron + React + Vite starter.
- The generated starter keeps its Electron files under `src/electron/` and exposes a preload bridge on `window.electron`.
- `frontron` is not the main product story anymore. Treat it as the placeholder/init package name reserved for the retrofit path while that flow is being redesigned.

## Requirements

- Node.js `22+`

## Repo Layout

```text
frontron/
  create-frontron/             # starter generator and template
  frontron/                    # placeholder/init package reserved for retrofit work
```

## Docs

- Docs site: [andongmin.com/frontron/](https://andongmin.com/frontron/)
- Guide: [andongmin.com/frontron/guide/](https://andongmin.com/frontron/guide/)
- The docs project now lives outside this repository.
- Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)

## License

MIT. See [`LICENSE.md`](LICENSE.md).
