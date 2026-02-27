<div align="center">
  <a href="https://frontron.andongmin.com">
    <img src="/docs/public/logo.svg" alt="Frontron" height="180" />
  </a>
</div>

# create-frontron

CLI to scaffold an Electron + React + TypeScript desktop app powered by the `frontron` runtime package.

## Quick Start

Node.js 22+ is required.

```bash
npm create frontron@latest
```

Non-interactive:

```bash
npm create frontron@latest my-app
npm create frontron@latest my-app --template react
```

Other package managers:

```bash
yarn create frontron
pnpm create frontron
bun create frontron
```

## What Gets Generated

- React + Vite + TypeScript app
- Electron `main` + `preload` entrypoints
- `frontron` runtime integration (`core/window/tray/store/bootstrap/updater`)
- Tailwind + shadcn-style UI setup

## Generated App Scripts

```bash
npm run app    # Vite + Electron
npm run build  # renderer build + electron compile + package
npm run lint
```

## Template Status

Only the `react` template is available in the current release.

## License

MIT