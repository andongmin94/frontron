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
npm create frontron@latest my-app
npx create-frontron@latest my-app
pnpm create frontron my-app
yarn create frontron my-app
bun create frontron my-app
```

Requires Node.js `22.15+`.
When no project name is passed, the default target directory is `desktop-app`.

Generation is transactional. The complete project is prepared beside the destination, existing entries are backed up before replacement, and a durable journal plus process lock protects merge and overwrite operations. If the process is interrupted, the next run restores the previous destination before scaffolding again. Symlinked destination ancestors and filesystem roots are rejected.

## After generation

```bash
cd my-app
npm install
npm run app
```

Use the equivalent `pnpm`, `yarn`, or `bun` install/run commands when you created the app with another package manager. The generator also prints package-manager-specific next steps.

- `npm run dev`: web preview only
- `npm run app`: Electron runtime + web dev server
- `npm run typecheck`: fast TypeScript verification without packaging
- `npm run build`: production web build + Electron packaging

The packaged renderer loads from the stable `frontron://app` origin. The Electron main process proxies that origin to a private loopback renderer server, preserves an app CSP or supplies a fallback policy, and restricts external navigation to explicit HTTP(S) URLs. The generated window uses context isolation with Node integration disabled.

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
