# Create a Project

This page covers the default Frontron start path.

Most users should begin here, not with manual setup.

If you already have a compatible web app and want to retrofit desktop support into it, use [Install into an Existing Project](/guide/install-existing-project) instead.

## 1. Requirements

- Node.js `22+`
- npm, yarn, pnpm, or bun

## 2. The default create command

```bash
npm create frontron@latest my-app
```

You can also run:

```bash
npx create-frontron@latest my-app
```

This creates a new `my-app` folder and fills it with the official Frontron starter.

The generator takes care of:

- copying the React + Vite starter
- setting the `package.json` name from your project name
- creating the root `frontron.config.ts`
- preparing the `frontron/` app-layer structure
- wiring `app:dev` and `app:build`

## 3. Interactive mode

If you have not picked a name yet, you can run:

```bash
npm create frontron@latest
```

That mode asks for the project name interactively.

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
- `src/`: the starter web frontend you will customize
- `frontron.config.ts`: the official config entrypoint
- `frontron/`: the desktop-side app-layer area
- `package.json`: scripts such as `app:dev` and `app:build`

## 5. The easiest first workflow

1. Create the starter project
2. Run `npm install`
3. Run `npm run app:dev`
4. Change something visible
5. Run `npm run app:build`

::: tip
This path is the fastest way to see Frontron working end to end.
:::
