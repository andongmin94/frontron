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
- Publish only after all package smoke checks are green.
