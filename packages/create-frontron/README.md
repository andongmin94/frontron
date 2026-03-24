<div align="center">

<a href="https://frontron.andongmin.com">
<img src="/docs/public/logo.svg" alt="logo" height="200" />
</a>

</div>

# create-frontron <a href="https://npmjs.com/package/create-frontron"><img src="https://img.shields.io/npm/v/create-frontron" alt="npm package"></a>

`create-frontron` is the thin starter generator for `frontron`.

It generates the official framework-first app shape:

- root `frontron.config.ts`
- `frontron/` app-layer modules
- `app:dev` and `app:build` scripts that call the `frontron` CLI
- the official `frontron/rust` slot scaffold
- a React + Vite starter with a prewired component base under `src/components/ui`

`create-frontron` does not own desktop runtime or packaging behavior.

Those responsibilities stay in `frontron`:

- Electron runtime logic
- packaging and build ownership
- bridge runtime
- copied `main` or preload boilerplate
- template-only special desktop structure

## Current Starter

The generated starter keeps the framework-first contract and adds a richer web base:

- `frontron.config.ts` re-exports the app-layer config
- `frontron/bridge`, `frontron/menu`, `frontron/tray`, and `frontron/hooks` are scaffolded
- `frontron/rust` is scaffolded with `enabled: false`
- `.frontron/types/frontron-client.d.ts` is prepared for generated bridge types
- desktop UI uses `frontron/client` instead of a custom Electron preload API
- `src/components/ui` ships with the component base from the starter template

## Requirements

- Node.js `22+`

## Usage

```bash
npm create frontron@latest
npx create-frontron@latest my-app
```

Options:

- `--overwrite <yes|no|ignore>`

## After Generation

```bash
cd my-app
npm install
npm run app:dev
```

- `npm run dev`: web preview only
- `npm run app:dev`: Frontron desktop runtime + web dev server

## Output Shape

Starter output shares the same official Frontron structure as manual install, while adding the starter web files and component base.

```text
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
  frontron/
```

## License

MIT

Docs: https://frontron.andongmin.com
