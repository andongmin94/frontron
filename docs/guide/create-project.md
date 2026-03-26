# Create a Project

This page walks through the first project setup with Frontron.

At the beginning, you do not need to understand every file. The goal is to learn which command creates the project and which official structure appears.

If you already have a web app, skip this page and start with [Install into an Existing Project](/guide/install-existing-project).

## 1. Requirements

Before you start, make sure you have:

- Node.js `22.15+`
- npm, yarn, pnpm, or bun

## 2. The simplest create command

```bash
npx create-frontron@latest my-app
```

This command creates a new `my-app` folder and fills it with the official Frontron starter.

The CLI takes care of:

- copying the React + Vite starter
- setting the `package.json` name from your project name
- creating the root `frontron.config.ts`
- preparing the `frontron/` app-layer structure
- wiring `app:dev` and `app:build`

## 3. Interactive mode

If you have not picked a name yet, you can also run:

```bash
npm create frontron@latest
```

That mode asks you for the project name interactively.

## 4. What gets created?

At first, it is enough to know this shape:

```text
my-app/
  public/
  src/
  frontron.config.ts
  frontron/
    config.ts
    bridge/
    windows/
  package.json
  vite.config.ts
```

- `public/`: static files such as the app icon
- `src/`: your existing web frontend code
- `frontron.config.ts`: the official config entrypoint
- `frontron/`: the app-layer expansion area
- `package.json`: scripts such as `app:dev` and `app:build`

## 5. The easiest first workflow

It is much easier to move in this order:

1. Create the project
2. Run `npm install`
3. Run `npm run app:dev`
4. Change something visible
5. Run `npm run app:build`

::: tip
The next page shows how to install dependencies and launch the desktop window in development mode.
:::
