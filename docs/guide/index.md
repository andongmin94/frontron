# Quick Start

This page is the fastest way to understand how Frontron is meant to be used now.

The default path is the starter:

1. generate a project with `create-frontron`
2. run it with the `frontron` CLI support already wired in
3. customize the starter and ship it

If the desktop bridge feels abstract, read [Understand the Bridge Flow](/guide/understand-bridge-flow) before the API guide.

## 1. Prerequisites

- Node.js `22+`
- npm, yarn, pnpm, or bun

::: tip
Examples use `npm`, but the same flow works with other package managers.
:::

## 2. The shortest official start

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app:dev
```

Later:

```bash
npm run app:build
```

## 3. Official structure

```text
my-app/
  src/
  public/
  package.json
  vite.config.ts
  frontron.config.ts
  frontron/
```

This is the official starter output. Compatible manual installs can still use the same structure.

## 4. Pick your next guide

### If you want a new starter project

1. [Create a Project](/guide/create-project)
2. [Run in Development](/guide/run-development)
3. [Change App Name and Icon](/guide/customize-app)
4. [Understand the Generated Structure](/guide/understand-template)

### If you already have a compatible web app

1. [Install into an Existing Project](/guide/install-existing-project)
2. [Run in Development](/guide/run-development)
3. [Use the Desktop Bridge](/guide/use-bridge)
4. [Build and Package](/guide/build-and-package)

### If you want the mental model first

1. [Understand the Bridge Flow](/guide/understand-bridge-flow)
2. [Use the Desktop Bridge](/guide/use-bridge)

## 5. How the packages split now

- `create-frontron` is the official starter generator and the main onboarding path.
- `frontron` provides `defineConfig`, config discovery, `frontron dev`, `frontron build`, `frontron check`, and `frontron/client`.
- The starter depends on `frontron` for desktop runtime/build support instead of owning copied Electron runtime files itself.
- The official Rust slot remains `frontron/rust`.

## 6. Most-used manuals

- [Official Contract](/guide/framework-first)
- [Create a Project](/guide/create-project)
- [Run in Development](/guide/run-development)
- [Understand the Bridge Flow](/guide/understand-bridge-flow)
- [Support Matrix](/guide/support-matrix)
- [Troubleshooting](/guide/troubleshooting)

::: tip
The current contract starts with the starter flow, but the config entrypoint is still `frontron.config.ts`.
:::
