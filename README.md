<div align="center">
  <a href="https://frontron.andongmin.com">
    <img src="https://frontron.andongmin.com/logo.svg" alt="Frontron" height="200" />
  </a>
</div>

# Frontron

Frontron is an Electron app scaffolding ecosystem.

- `create-frontron`: scaffolds production-ready Electron apps (`react` or `next` templates)
- `frontron`: reusable runtime package used by generated projects

## Packages

```
packages/
  create-frontron/   # CLI + template source
  frontron/          # runtime modules + migrate CLI
```

## Quick Start

```bash
npm create frontron@latest
npm create frontron@latest my-app --template react
npm create frontron@latest my-app --template next
```

## Runtime Architecture

`frontron` provides the shared runtime modules:

- `core`: typed preload bridge + IPC channel defaults
- `window`: BrowserWindow creation + window-control IPC handlers
- `tray`: tray lifecycle helper
- `store`: versioned JSON settings store
- `bootstrap`: app startup flow
- `updater`: updater integration helper

## Existing Project Migration

```bash
npx frontron migrate
```

Use `--dry-run` to preview changes.

## Requirements

- Node.js 22+
- Windows/macOS targets supported by Electron build config

## License

MIT
