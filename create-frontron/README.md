<div align="center">

<a href="https://andongmin.com/frontron/">
<img src="https://andongmin.com/frontron/logo.svg" alt="logo" height="200" />
</a>

</div>

# create-frontron <a href="https://npmjs.com/package/create-frontron"><img src="https://img.shields.io/npm/v/create-frontron" alt="npm package"></a>

`create-frontron` scaffolds the default Electron + React + Vite starter.

It generates the default starter shape:

- `src/electron/` for main, preload, tray, splash, and window wiring
- `window.electron` preload bridge
- an `app` script for Electron development
- a `build` script for web build + Electron packaging
- a React + Vite starter with a small UI/component base

## Usage

```bash
npm create frontron@latest
npx create-frontron@latest my-app
```

## After generation

```bash
cd my-app
npm install
npm run app
```

- `npm run dev`: web preview only
- `npm run app`: Electron runtime + web dev server

## Output shape

```text
my-app/
  src/
    electron/
  public/
  package.json
  vite.config.ts
```

## License

MIT

Docs: https://andongmin.com/frontron/
