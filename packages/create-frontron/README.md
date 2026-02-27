<div align="center">
  <a href="https://frontron.andongmin.com">
    <img src="/docs/public/logo.svg" alt="Frontron" height="180" />
  </a>
</div>

# create-frontron

CLI to scaffold Electron desktop apps powered by the `frontron` runtime package.

## Quick Start

Node.js 22+ is required.

```bash
npm create frontron@latest
```

Non-interactive:

```bash
npm create frontron@latest my-app
npm create frontron@latest my-app --template react
npm create frontron@latest my-app --template next
```

Other package managers:

```bash
yarn create frontron
pnpm create frontron
bun create frontron
```

## Templates

- `react`: React + Vite + TypeScript
- `next`: Next.js App Router + TypeScript

Both templates include:

- Electron `main` + `preload` entrypoints
- `frontron` runtime integration (`core/window/tray/store/bootstrap/updater`)
- Tailwind + shadcn-style UI setup

## Generated App Scripts

```bash
npm run app    # Framework dev server + Electron
npm run build  # renderer build + electron compile + package
npm run lint
```

## License

MIT
