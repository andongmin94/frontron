# Quick Start

This page is the fastest way to understand how to start and which guide to read next.

Frontron is the framework-first desktop app layer for existing web projects.

Frontron supports two normal entry paths: install it into an existing web project, or generate a new starter.

If the desktop bridge feels abstract, read [Understand the Bridge Flow](/guide/understand-bridge-flow) before the API guide.

## 1. Prerequisites

You only need these two things to get started.

- Node.js `22.15+`
- npm, yarn, pnpm, or bun

::: tip
This guide uses `npm` in examples, but the same flow works with other package managers.
:::

## 2. The shortest valid setup

This is the smallest official flow for an existing project:

```bash
npx frontron init
```

`frontron init` installs `frontron` automatically when it is missing, then adds the basic files and scripts.

If you want to manage the dependency yourself, run `npx frontron init --skip-install` instead.

```bash
npm run app:dev
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

This is the official shape for both manual installs and starter users.

## 4. Pick your next guide

### If you want the mental model first

1. [Understand the Bridge Flow](/guide/understand-bridge-flow)
2. [Use the Desktop Bridge](/guide/use-bridge)

### If you already have a web app

1. [Install into an Existing Project](/guide/install-existing-project)
2. [Understand the Bridge Flow](/guide/understand-bridge-flow)
3. [Run in Development](/guide/run-development)
4. [Use the Desktop Bridge](/guide/use-bridge)
5. [Build and Package](/guide/build-and-package)

### If you want a new project

1. [Create a Project](/guide/create-project)
2. [Run in Development](/guide/run-development)
3. [Change App Name and Icon](/guide/customize-app)
4. [Understand the Generated Structure](/guide/understand-template)

## 5. What Frontron owns

- `frontron` provides `defineConfig`, config discovery, `frontron dev`, `frontron build`, and `frontron/client`.
- `create-frontron` generates `frontron.config.ts`, `frontron/`, `app:dev`, and `app:build`.
- `bridge`, `menu`, `tray`, `hooks`, and the runtime/build flow are owned by `frontron`.
- The official Rust slot is fixed at `frontron/rust`.
- `app:dev` and `app:build` already have smoke coverage in the repo.

## 6. Most-used manuals

- [Official Contract](/guide/framework-first)
- [Install into an Existing Project](/guide/install-existing-project)
- [Understand the Bridge Flow](/guide/understand-bridge-flow)
- [Use the Desktop Bridge](/guide/use-bridge)
- [Support Matrix](/guide/support-matrix)
- [Recipes](/guide/recipes)
- [Troubleshooting](/guide/troubleshooting)

::: tip
The official contract is always centered on `frontron.config.ts`.
:::
