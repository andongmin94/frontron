# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron` is now an experimental init shell for the existing-project retrofit path.

It is not the main product anymore, and it still does not ship a stable desktop runtime contract.

## Current state

- new apps should start with `create-frontron`
- `frontron` keeps the retrofit package name and CLI entrypoint reserved
- `init` can now seed a conservative `minimal` or `starter-like` Electron layer into a compatible existing web frontend project
- `check`, `dev`, and `build` still report the placeholder transition
- the retrofit flow is still starter-derived and intentionally conservative

## Recommended start path

```bash
npm create frontron@latest
```

That starter owns its Electron files directly under `src/electron/` and uses `window.electron` for its preload bridge.

## Retrofit path

The retrofit path is still being redesigned.

Today, `frontron init` is the only active retrofit command.

Its current shape is:

- infer the current web frontend scripts first
- ask where the Electron files should live
  - default: `electron/`
- ask which desktop script names to add
  - defaults: `app` and `app:build`
- ask which preset to use
  - defaults: `minimal`
- copy a minimal, app-owned Electron layer into the project
- optionally copy a starter-like preload bridge on `window.electron`
- keep existing web scripts intact unless the user explicitly chooses otherwise

The default preset is `minimal`. `starter-like` adds `preload.ts`, `ipc.ts`, and `src/types/electron.d.ts` without replacing the app's existing frontend structure.

## License

MIT. Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)
