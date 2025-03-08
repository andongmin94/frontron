# Run in Development

Once the project is created, the next step is to make sure the app actually opens.

At this stage, the goal is simple: learn which command starts the desktop app and how to tell desktop mode from web-only preview mode.

## 1. Move into the project folder

```bash
cd my-app
```

## 2. Install dependencies

```bash
npm install
```

This installs the packages used by the project.

## 3. Start development mode

```bash
npm run app:dev
```

This runs `frontron dev`.

It connects:

- the web dev command from `frontron.config.ts`
- the Electron desktop app from Frontron

You should see a desktop window, not only a browser tab.

By contrast, `npm run dev` is web preview only. It does not attach the desktop bridge.

## 4. What should you look for?

On the first run, check these things:

- the desktop window opens
- the custom title bar is visible
- the starter screen renders

## 5. Normal edit loop

In development, the usual loop is:

1. Change a file
2. Save it
3. Check the result in the app window

React updates are usually fast. Runtime-side changes may require a restart, depending on what changed.

If the app opens but the desktop bridge still feels abstract, read [Understand the Bridge Flow](/guide/understand-bridge-flow) first.

Then read [Use the Desktop Bridge](/guide/use-bridge).

## 6. First things to check when it fails

### If the window does not open

- Run `npx frontron check` first
- Make sure `npm install` finished successfully
- Check the terminal for runtime errors
- Check that no other process is already using the same port

### If you get a blank page

Run `npx frontron check` first.

Start by checking that `vite.config.ts` and the root `frontron.config.ts` use the same development port and URL.

### If bridge-related UI looks wrong

If you see `Web preview` in the title bar, or a message such as `Desktop bridge unavailable`, check:

- that you ran `npm run app:dev`, not `npm run dev`
- that your renderer code imports `frontron/client`
- that the terminal does not show runtime or preload errors

::: tip
It is better to get the app opening once before you start heavy customization.
:::
