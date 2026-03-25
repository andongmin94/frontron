# Release Checklist

This checklist is for releasing the framework-first packages.

## Scope

- `packages/frontron`
- `packages/create-frontron`

## Contract checks

- Re-read `specs/framework-first.md`.
- Confirm the public renderer API is still only `frontron/client`.
- Confirm the starter still seeds `frontron.config.ts` and the `frontron/` app-layer shape.
- Confirm docs do not reintroduce `window.electron` or `src/electron`.

## Validation

- `cd packages/frontron && npm run build`
- `cd packages/frontron && npm run typecheck`
- `cd packages/frontron && npm test`
- `cd packages/create-frontron && npm run build`
- `cd packages/create-frontron && npm test`

## Release-only smoke

- `cd packages/frontron && npm run test:package-smoke`
- `cd packages/create-frontron && npm run test:release-smoke`
- `cd packages/create-frontron && npm run release:verify`

These smoke checks are intentionally separate from the default `npm test` commands because they build packed tarballs and real packaged apps.

## Long-running candidate matrix

- `cd packages/create-frontron && npm run release:matrix-smoke`

This is the wider representative-stack smoke job for the stable public-package paths we expect to keep green: packed starter generation, existing-project Vite install, and existing-project VitePress install.
It is intentionally separate from `npm run release` because it is slower and may hit external generators and package installs.
Treat Next static export, Nuxt generate, and other stack-specific paths as manual spot checks when touched, not as part of the default release matrix.

## Package checks

- Confirm `npm pack --dry-run` smoke tests pass in both packages.
- Confirm real `npm pack` tarball smoke tests pass in both packages.
- Confirm the packed `create-frontron` tarball can generate a project and the packed `frontron` tarball can pass `frontron dev --check` against that generated app.
- Confirm `frontron` tarballs ship only the public runtime surface: `index.js`, `dist/`, `package.json`, `README.md`.
- Confirm `create-frontron` tarballs ship the thin generator contract: `index.js`, `dist/`, `template/`, `package.json`, `README.md`.

## Manual spot checks

- Run one `create-frontron` generation smoke flow.
- Check the generated app still has `app:dev`, `app:build`, `frontron.config.ts`, and `frontron/rust`.
- Check one Rust-backed example works from the generated starter shape.

## Versioning

- Sync package versions before publish if needed.
- `npm version` in `packages/create-frontron` now only syncs the paired `frontron` version.
- Verify `packages/create-frontron/template/package.json` points to the intended `frontron` version.
- Use `npm run release` in `packages/create-frontron` for the publish order: `frontron` first, then `create-frontron`.
- `npm run release` now includes `npm run release:verify` before publish.
- Publish only after all package smoke checks are green.
