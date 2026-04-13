# Release Checklist

This checklist covers the two publishable packages at the repo root.

## Scope

- `frontron`
- `create-frontron`

## Contract checks

- Re-read `specs/framework-first.md`.
- Confirm `create-frontron` is still the primary starter story.
- Confirm `frontron` still reads as an init shell for existing-project retrofit.
- Confirm generated starters still own `src/electron/*` and the preload bridge on `window.electron`.

## Validation

- `cd frontron && npm run build`
- `cd frontron && npm run typecheck`
- `cd frontron && npm test`
- `cd create-frontron && npm run build`
- `cd create-frontron && npm run typecheck`
- `cd create-frontron && npm test`

## Release-only smoke

- `cd frontron && npm run test:package-smoke`
- `cd create-frontron && npm run test:release-smoke`
- `cd create-frontron && npm run release:verify`

These checks intentionally stay outside the default `npm test` flow because they build packed tarballs and real packaged apps.

## Long-running candidate matrix

- `cd create-frontron && npm run release:matrix-smoke`

This is the wider representative-stack smoke job for the package paths we expect to keep green: packed starter generation and retrofit/init package flows.

## Package checks

- Confirm `npm pack --dry-run` smoke tests pass in both packages.
- Confirm real `npm pack` tarball smoke tests pass in both packages.
- Confirm the packed `create-frontron` tarball can generate a project.
- Confirm the packed `frontron` tarball can run `frontron init` against a compatible app fixture.
- Confirm `frontron` tarballs ship only `index.js`, `dist/`, `package.json`, and `README.md`.
- Confirm `create-frontron` tarballs ship only `index.js`, `dist/`, `template/`, `package.json`, and `README.md`.

## Manual spot checks

- Run one `create-frontron` generation smoke flow.
- Check the generated app still has `src/electron/*`, `window.electron`, `npm run app`, and `npm run build`.
- Run one `frontron init` flow against a compatible Vite app and verify the minimal Electron files are app-owned.

## Versioning

- Sync package versions before publish if needed.
- `npm version` in `create-frontron` syncs the paired `frontron` version.
- Verify `create-frontron/template/package.json` points to the intended `frontron` version.
- Use `npm run release` in `create-frontron` for the publish order: `frontron` first, then `create-frontron`.
- `npm run release` includes `npm run release:verify` before publish.
- Publish only after all package smoke checks are green.
