<div align="center">

<a href="https://bio.andongmin.com/frontron/">
<img src="https://bio.andongmin.com/frontron/logo.svg" alt="Frontron logo" height="200" />
</a>

</div>

# Frontron

Electron tooling for two paths:

- `create-frontron` creates a new Electron + React + Vite app in a new directory.
- `frontron` adds an app-owned Electron layer to an existing compatible web frontend.

## New app

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app
```

Use `npm run build` to build and package the desktop app. The generator writes the pnpm Electron build approvals or Yarn node-modules linker setting when invoked through that package manager.

## Existing frontend

```bash
npm install -D frontron
npx frontron init --dry-run
npx frontron init
npm install
npm run frontron:dev
```

Use `npm run frontron:build` to build the frontend and package the desktop app. Frontron detects Vite-style static apps, Next.js export and standalone builds, Nuxt, Remix, SvelteKit static and Node builds, and explicit custom Node servers.

These are implemented adapters, not a guarantee for every framework configuration. Applications emitting inline scripts need an appropriate application-owned CSP; for example, the real Next.js standalone fixture uses dynamic rendering with a per-request nonce. See [native consumer validation and limits](docs/NATIVE_CONSUMERS.md).

`.frontron/manifest.json` records generated files and package changes for guarded `doctor`, `update`, and `clean` commands. Generated windows use native operating-system title bars. The sandboxed `window.electron` bridge exposes app information, text-file dialogs, clipboard text, and notifications.

## Monorepos

A workspace root with one compatible frontend is selected automatically. Select explicitly when there is more than one:

```bash
npx frontron init --project apps/web
```

The root `package.json` can persist that selection:

```json
{
  "frontron": {
    "project": "apps/web"
  }
}
```

## Requirements

- Node.js `22.15+`

## Repository

```text
create-frontron/   starter generator and canonical Electron template
frontron/          retrofit CLI for existing web projects
release.mjs        shared release-candidate verification
```

Release-candidate verification:

```bash
node release.mjs check-metadata
node release.mjs verify
```

The separate **Native consumers** CI checks Windows MSI/portable distributions and a real Linux Next.js standalone app. Its Windows script installs and removes test applications and should run on a disposable runner. See [commands, evidence and boundaries](docs/NATIVE_CONSUMERS.md).

Package publication is performed explicitly with npm after local verification.

## Links

- [Documentation](https://andongmin.com/frontron/)
- [Guide](https://andongmin.com/frontron/guide/)
- [Issues](https://github.com/andongmin94/frontron/issues)

MIT. See [`LICENSE.md`](LICENSE.md).
