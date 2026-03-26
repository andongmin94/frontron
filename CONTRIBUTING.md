# Contributing

Frontron is a framework-first desktop app layer for existing web projects. `frontron` is the product. `create-frontron` is the thin starter generator.

## Before You Change Anything

Read these first:

- [Framework-First Contract](./docs/guide/framework-first.md)
- [Support Matrix](./docs/guide/support-matrix.md)
- [Config Reference](./docs/guide/config.md)
- [Desktop Bridge Reference](./docs/guide/use-bridge.md)

Keep these project rules intact:

- preserve the existing-project install path
- keep the official config entrypoint at the root `frontron.config.ts`
- keep the public renderer API at `frontron/client`
- keep runtime, preload, staging, and packaging inside `frontron`
- do not recreate `specs/`
- do not reintroduce `window.electron` or old preload globals as public API
- keep mirrored English and Korean user-facing docs aligned when both exist

## Local Setup

Requirements:

- Node.js `22.15+`

Install dependencies from the repo root with your package manager of choice, then work in the relevant package or docs folder.

## Validation

Run the smallest relevant validation set for the change.

Docs or navigation changes:

```bash
cd docs
npm run docs-build
```

`packages/frontron` changes:

```bash
cd packages/frontron
npm run build
npm run typecheck
npm test
```

`packages/create-frontron` changes:

```bash
cd packages/create-frontron
npm run build
npm run typecheck
npm test
```

Release or packaging-facing changes may require the extra smoke commands already defined in each package manifest.

## Pull Request Guidance

Prefer small, reviewable changes.

- explain the user-facing contract change clearly
- update tests when behavior changes
- update docs in the same pass when the public surface changes
- avoid widening raw Electron pass-through options without an explicit product reason
- document limitations honestly instead of implying unsupported coverage

## Issues and Discussions

- use GitHub issues for bugs, regressions, docs problems, and feature proposals
- use [docs/maintainer.md](./docs/maintainer.md) for the maintainer reference page
- use [docs/ko/maintainer.md](./docs/ko/maintainer.md) for the Korean maintainer page

Security problems should follow [SECURITY.md](./SECURITY.md), not the public issue tracker.
