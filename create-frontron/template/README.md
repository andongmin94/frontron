# Electron React Template

This project was generated from the default Electron + React + Vite starter.

## Stack

- Electron + React + TypeScript + Vite
- Tailwind CSS 4
- Base UI components under `src/components/ui`
- Template-owned Electron files under `src/electron/`
- A preload bridge exposed as `window.electron`

## Development

```bash
npm install
```

Use one of these commands depending on what you want to work on:

```bash
# Web preview only
npm run dev

# Electron desktop runtime
npm run app
```

- `npm run dev`: starts a browser-only preview.
- `npm run app`: starts the Electron dev runtime and its own Vite dev server. You do not need to run `npm run dev` separately.
- Renderer changes use Vite HMR.
- Files under `src/electron/` restart the Electron runtime during development, and launcher-side changes are picked up by the dev launcher itself.
- In Electron mode, a gear button in the lower-left corner opens desktop settings such as the title bar X button behavior.

## Build

```bash
npm run build
```

This builds the web app, compiles `src/electron/`, and packages the desktop app with `electron-builder`.

## Notes

- The title bar uses the template preload bridge exposed on `window.electron`.
- Production serves `dist/` from an internal `node:http` loopback server instead
  of Express.
- The default Electron source lives under `src/electron/`.
- The default packaging configuration targets Windows (`msi` and `portable`) because the bundled app icon asset is Windows-first (`public/icon.ico`).
- Before shipping a real app, replace the default metadata in `package.json` such as `name`, `productName`, `author`, and `build.appId`.
- You can build on top of the existing component base in `src/components/ui`.
