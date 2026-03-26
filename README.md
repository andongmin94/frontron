# Frontron

`frontron` is the framework-first desktop app layer for existing web projects.

Frontron keeps the desktop runtime, preload wiring, staging, and packaging inside the framework while your web app keeps its own frontend code. The official config entrypoint is the root `frontron.config.ts`, and the public renderer API stays `frontron/client`.

## Requirements

- Node.js `22.15+`
- npm, yarn, pnpm, or bun

## Packages

- `frontron`: the real product and CLI
- `create-frontron`: the thin starter generator

## Official Flow

```bash
npx frontron init
npm run app:dev
npm run app:build
```

For an existing project, `frontron init` adds the root `frontron.config.ts` and the `app:dev` / `app:build` scripts.

## Docs

- [Framework-First Contract](./docs/guide/framework-first.md)
- [Quick Start](./docs/guide/index.md)
- [Support Matrix](./docs/guide/support-matrix.md)
- [Config](./docs/guide/config.md)
- [Use the Desktop Bridge](./docs/guide/use-bridge.md)
- [Korean Docs](./docs/ko/index.md)
- [Docs Site](https://frontron.andongmin.com)

## Repository Docs

- [Security Policy](./SECURITY.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

## Repository Shape

- `docs/`: user-facing documentation
- `packages/frontron/`: framework package
- `packages/create-frontron/`: thin starter generator

## License

[MIT](./LICENSE.md)
