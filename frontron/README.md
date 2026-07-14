# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron` is the init-focused retrofit CLI for existing web frontend projects.

Use `create-frontron` for new apps. Use `frontron init` when you already have a compatible frontend project and want to add an app-owned Electron layer without replacing the app's existing structure.

## Current state

- new apps should start with `create-frontron`
- `frontron init` is the active command in this package
- `frontron doctor` checks the generated Electron layer after init
- `frontron clean` removes manifest-owned generated files, package scripts, and package metadata when you want to back out the retrofit layer
- `frontron update` refreshes manifest-owned generated files, package scripts, and package metadata through a guarded manifest-based plan
- `init` always seeds its Electron layer from the exact-version `create-frontron` template
- the generated Electron files stay app-owned instead of introducing a starter-owned runtime contract
- the current CLI surface is intentionally narrow: `init`, `doctor`, `clean`, and `update` are supported
- the retrofit flow is still starter-derived and intentionally conservative

## Recommended start path

```bash
npm create frontron@latest
pnpm create frontron
yarn create frontron
bun create frontron
```

That starter owns its Electron files directly under `src/electron/` and uses `window.electron` for its preload bridge.

Requires Node.js `22.15+`.

## Retrofit path

If you already have a compatible web frontend project, start with:

```bash
npm install -D frontron
npx frontron init
# or: npm exec -- frontron init
npm install
npm run frontron:dev
```

`frontron init` is the active retrofit command today.
Use `npx frontron init --dry-run` first when you want to inspect the detected adapter, planned files, and package.json changes without applying the new plan. If a previous lifecycle command was interrupted, Frontron restores that transaction before creating the preview.
After `init`, run your package manager install command again because the retrofit adds Electron-related dependencies to `package.json`.
Use `npm run frontron:package` when you are ready to create the packaged desktop app; `npm run frontron:build` only prepares the desktop build output.
When using `npm exec` directly, keep the `--` separator: `npm exec -- frontron init`.
For pnpm, yarn, or bun projects, use the equivalent package-manager commands; after `init`, Frontron prints next steps for the package manager detected from your lockfile.

For Yarn Berry projects, `init` safely sets the nearest `.yarnrc.yml` `nodeLinker` to `node-modules`, which Electron Builder requires. The previous scalar, comments, quoting, and line endings are recorded in the manifest so `doctor` can verify them and `clean` can restore the original file. Complex or ambiguous YAML is left untouched and reported as a blocker.

It auto-detects the current runtime adapter when possible:

- `generic-static` for Vite-style static frontend builds
- `next-export` for Next.js static export projects
- `next-standalone` for Next.js standalone server builds (`output: 'standalone'`)
- `nuxt-node-server` for Nuxt server builds
- `remix-node-server` for Remix node server builds
- `sveltekit-static` for SvelteKit static exports
- `sveltekit-node` for SvelteKit node adapter builds
- `generic-node-server` when you want to wire a custom Node runtime manually

The generated dev runner prints the local URL it waits for. If your frontend dev server uses a custom host or port, pass it through your existing dev script, for example `vite --host 127.0.0.1 --port 4200` or `next dev --port 3300`.

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
- resolve the `create-frontron` package whose version exactly matches `frontron`
- copy its Electron template files into the project as app-owned files
- record generated files, scripts, and package metadata ownership in `.frontron/manifest.json`
- expose the template preload bridge on `window.electron`
- keep existing web scripts intact unless the user explicitly chooses otherwise

## How `create-frontron` feeds the retrofit

`frontron` declares the exact same `create-frontron` version as a runtime dependency. Every `init` and `update` resolves that package's `template/` directory, validates all required Electron files, verifies that both package versions are identical, and records the source package version in `.frontron/manifest.json`. It does not keep a second Electron template inside `frontron` and it has no built-in fallback preset.

All TypeScript modules under `template/src/electron/` are discovered on each run, so newly added Electron modules are copied without maintaining a second file list. The template's Vite-specific `serve.ts` is the one deliberate exception: Frontron generates its own adapter-specific `serve.ts` so Vite, Next.js, Nuxt, Remix, SvelteKit, and custom Node runtimes keep their existing build behavior.

This means Electron fixes in a new `create-frontron` release reach retrofit projects through the matching `frontron` release and a guarded refresh:

```bash
npm install -D frontron@latest
npx frontron update --dry-run
npx frontron update --yes
```

Only manifest-owned files and values are refreshed. Files removed from the matching template are removed from the project only after their recorded ownership and current contents are verified. Local edits are reported as conflicts unless `--force` is explicitly used; forced updates also replace edited manifest-owned package fields with the matching template values. If the template is missing, incomplete, or from a different version, Frontron stops with a diagnostic instead of generating from stale internal sources.

## Runtime and recovery

- Production windows use the stable `frontron://app` origin while a private loopback server handles static or Node-rendered output behind the protocol handler.
- The protocol proxy accepts only the registered app origin, rewrites internal origin headers, preserves an app-provided CSP, and adds a conservative fallback CSP when one is missing.
- Navigation stays inside the app origin. Only explicit `http:` and `https:` links can be handed to the system browser.
- Generated windows keep Node integration disabled and context isolation enabled.
- `init`, `update`, and `clean` snapshot every owned file before mutation. Each write or removal revalidates the same single-link file through an open descriptor, and rollback restores only files the active process actually began mutating. A durable journal is published before the first write, and the next valid `init`, `update`, or `clean` invocation automatically restores an interrupted operation.
- Project paths, manifest paths, pnpm workspace edits, symlink ancestors, and transaction journals are validated before use. An invalid recovery journal stops the command instead of guessing.
- Help, argument errors, unknown commands, and `doctor` never trigger recovery. `doctor` reports pending journal or lock state without modifying it.

## Doctor

After init, check the generated Electron layer with:

```bash
npx frontron doctor
```

`doctor` verifies the manifest, generated files, package scripts, Electron build entry, required dependencies, and exact `create-frontron` template version. It reports blockers when the initialized layer is incomplete. If the project has not been initialized yet, it reports that state directly and points you to `frontron init`.

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

Run `npx frontron update --yes` to apply the refresh. Use `npx frontron update --yes --force` only when locally edited manifest-owned files or scripts should be overwritten.

`update` always reuses the adapter, paths, script names, product name, and app id recorded by `init`; migration override options are intentionally not accepted. Older manifests that used a preset are migrated to the single exact-version template flow. The public `init --force` flow has been removed in favor of `update --yes` and `update --yes --force`.

## Compatibility verification

The repository tests the minimum Node.js `22.15.0` runtime, active LTS Node.js 24, and current Node.js 26 on Windows, macOS, and Linux. The compatibility workflow creates public Vite, VitePress, Next.js export/standalone, Nuxt, Remix v2, and SvelteKit static/node projects on Linux, repeats representative projects on Windows and macOS, exercises development and packaged Electron lifecycles, and runs pnpm, Yarn, Bun, and nested pnpm workspace retrofit checks. The npm release workflow cannot publish until this reusable compatibility gate succeeds.

Detection is intentionally evidence-based rather than magical. Custom monorepos or build pipelines should start with `frontron init --dry-run`, use an explicit adapter when necessary, and run `frontron doctor` before packaging. `generic-node-server` remains the escape hatch for a custom server root and entry.

For repository release verification:

```bash
node release.mjs verify
node release.mjs matrix-smoke vite
node release.mjs package-manager-smoke pnpm
```

The release command additionally requires aligned package metadata, a clean Git worktree, coverage thresholds, dependency audits, real package tarballs, framework smoke tests, and npm publish dry-runs before it can publish.

Official npm releases run through `.github/workflows/frontron-release.yml`. Configure both npm packages' trusted publisher to that workflow and the `npm` GitHub environment. The job uses short-lived GitHub OIDC credentials and publishes provenance attestations without storing an npm token. A retry after a partial registry publish is accepted only when the already published tarball integrity exactly matches the local candidate. Local token-based publishing is blocked by default; `FRONTRON_ALLOW_LOCAL_PUBLISH=1` exists only as an explicit emergency override.

## License

MIT. Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)
