# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron` is the init-focused retrofit CLI for existing web frontend projects.

Use `create-frontron` for new apps. Use `frontron init` when you already have a compatible frontend project and want to add an app-owned Electron layer without replacing the app's existing structure.

## Current state

- new apps should start with `create-frontron`
- `frontron init` is the active command in this package
- `frontron doctor` checks the generated Electron layer after init
- `frontron clean` removes manifest-owned generated files, package scripts, and package metadata when you want to back out the retrofit layer
- `frontron update` refreshes manifest-owned generated files, package scripts, and package metadata through the same guarded plan as `init --force`
- `init` can now seed a conservative `minimal` or `starter-like` Electron layer into a compatible existing web frontend project
- the generated Electron files stay app-owned instead of introducing a starter-owned runtime contract
- the current CLI surface is intentionally narrow: `init`, `doctor`, `clean`, and `update` are supported
- the retrofit flow is still starter-derived and intentionally conservative

## Recommended start path

```bash
npm create frontron@latest
```

That starter owns its Electron files directly under `src/electron/` and uses `window.electron` for its preload bridge.

## Retrofit path

If you already have a compatible web frontend project, start with:

```bash
npm install -D frontron
npx frontron init
```

`frontron init` is the active retrofit command today.
Use `npx frontron init --dry-run` first when you want to inspect the detected adapter, planned files, and package.json changes without writing anything.

It auto-detects the current runtime adapter when possible:

- `generic-static` for Vite-style static frontend builds
- `next-export` for Next.js static export projects
- `next-standalone` for Next.js standalone server builds (`output: 'standalone'`)
- `nuxt-node-server` for Nuxt server builds
- `remix-node-server` for Remix node server builds
- `sveltekit-static` for SvelteKit static exports
- `sveltekit-node` for SvelteKit node adapter builds
- `generic-node-server` when you want to wire a custom Node runtime manually

You can override that detection when needed:

```bash
npx frontron init --adapter next-export
npx frontron init --adapter next-standalone
npx frontron init --adapter nuxt-node-server
npx frontron init --adapter remix-node-server
npx frontron init --adapter sveltekit-static
npx frontron init --adapter sveltekit-node
npx frontron init --adapter generic-node-server --server-root build --server-entry server/index.js
```

It currently walks through:

- infer the current web frontend scripts first
- ask where the Electron files should live
  - default: `electron/`
- ask which desktop script names to add
  - defaults: `frontron:dev`, `frontron:build`, and `frontron:package`
- ask which preset to use
  - defaults: `minimal`
- copy a minimal, app-owned Electron layer into the project
- record generated files, scripts, and package metadata ownership in `.frontron/manifest.json`
- optionally copy a starter-like preload bridge on `window.electron`
- keep existing web scripts intact unless the user explicitly chooses otherwise

The default preset is `minimal`. `starter-like` adds `preload.ts`, `ipc.ts`, and `src/types/electron.d.ts` without replacing the app's existing frontend structure.

## Doctor

After init, check the generated Electron layer with:

```bash
npx frontron doctor
```

`doctor` verifies the manifest, generated files, package scripts, Electron build entry, and required dependencies. It reports blockers when the initialized layer is incomplete. If the project has not been initialized yet, it reports that state directly and points you to `frontron init`.

## Clean

Preview cleanup before removing generated files:

```bash
npx frontron clean --dry-run
```

Run `npx frontron clean --yes` to remove only files, package scripts, dependencies, and Electron build metadata recorded in `.frontron/manifest.json`. Generated file hashes, script commands, and package metadata ownership are checked first, so local edits are preserved unless you pass `--force`.

## Update

Preview a guarded refresh of manifest-owned generated files, scripts, and package metadata:

```bash
npx frontron update --dry-run
```

Run `npx frontron update --yes` to apply the refresh. Internally this uses the same conflict rules as `frontron init --force`, so only manifest-owned files are overwritten.

## License

MIT. Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)
