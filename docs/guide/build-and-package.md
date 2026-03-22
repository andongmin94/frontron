# Build and Package

If development mode works, the next step is to create distributable output.

The goal of this page is to explain what `npm run build` does and where the results appear.

## 1. Command

```bash
npm run build
```

In the starter, that command forwards to:

```bash
npm run app:build
```

That runs `frontron build`.

## 2. What happens during the build?

The build flow is:

1. build the renderer output
2. stage runtime files under `.frontron/`
3. package the desktop app

The runtime and packaging logic are owned by `frontron`, not by copied template files.

## 3. Good checks before you build

- confirm that `npm run app:dev` worked at least once
- save any changes to the icon or app metadata
- make sure the terminal does not already show a runtime error

## 4. What outputs should you expect on Windows?

With the current default setup, the main outputs are usually created under `output/`.

Typical Windows output includes:

- `win-unpacked/`
- an installer `.exe`

The exact file names can change with the app name and version.

## 5. What should you inspect after the build?

Start with these folders:

```text
dist/
.frontron/
output/
```

- `dist/`: the built web frontend
- `.frontron/`: Frontron staging and generated files
- `output/`: packaged desktop output

::: tip
If the build succeeds but the output folders are confusing, read the next page and check each folder one by one.
:::

::: warning
On Windows, very deep project paths can still break packaging steps. If you see file-not-found errors inside long packaging paths, try building from a shorter path such as `C:\dev\my-app`.
:::
