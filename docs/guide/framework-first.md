# CLI And Starter Contract

This page describes the current Frontron contract after restoring the 0.8.4 / 0.8.5 style product story.

## Goal

Frontron now centers on this split:

- `create-frontron` is the main starter/template entrypoint
- `frontron` is the support CLI/runtime package behind that starter

## Official start flow

The default supported flow is:

1. run `npm create frontron@latest`
2. install dependencies
3. run `npm run app:dev`
4. later run `npm run app:build`

## Official structure

The generated starter still uses the same official shape:

```text
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
  frontron/
```

`frontron/` stays the dedicated app-layer area.

## Responsibility split

`create-frontron` owns:

- starter generation
- starter defaults and template files
- the first-run developer experience

`frontron` owns:

- config discovery
- CLI commands
- runtime/build support
- bridge/runtime helpers
- `frontron/client`
- Rust slot support

## Current state

The repository already implements this split.

- starter users begin with `create-frontron`
- generated projects depend on `frontron`
- `frontron` still provides `frontron dev`, `frontron build`, `frontron check`, and `defineConfig`
- compatible manual installs can still use the same config structure

## Manual path

Manual setup is still valid, but it is now secondary:

1. install `frontron`
2. add `frontron.config.ts`
3. add `app:dev` and `app:build`
4. run through the CLI

## Renderer contract

Renderer code should still use only `frontron/client`.

The product direction changed, but the renderer-facing API did not.
