# Starter-First Contract

## 1. Core definition

Frontron is no longer positioned as a desktop framework contract.

The repo now has two roles:

- `create-frontron` is the real product and the official starter/template entrypoint
- `frontron` is a placeholder/init shell reserved for the future existing-project retrofit path

## 2. Package roles

### `create-frontron`
- official starter generator
- primary onboarding path
- owns the starter template, `src/electron/*`, preload bridge, and first-run developer experience

### `frontron`
- placeholder/init package name for retrofit work
- not the main renderer/runtime contract
- future goal: `frontron init` copies the minimum Electron source and scripts into a compatible existing web frontend project

## 3. Primary user flow

The default flow is:

1. run `npm create frontron@latest`
2. enter the project
3. run `npm install`
4. run `npm run app`
5. later run `npm run build`

## 4. Official structure

Generated starter apps use template-owned Electron files:

```txt
my-app/
  src/
    electron/
  src/
    types/
  public/
  package.json
  tsconfig.electron.json
  vite.config.ts
```

The preload bridge is exposed on `window.electron`.

## 5. Retrofit direction

The existing-project path is intentionally incomplete right now.

The intended end state is:

1. install `frontron`
2. run `frontron init`
3. copy the minimum Electron source into the app
4. let the app own those files directly

Until that redesign lands, `frontron` should be treated as a placeholder package, not as a stable framework/runtime surface.

The v1 retrofit contract is defined in [init-retrofit-v1.md](./init-retrofit-v1.md).

## 6. Success criteria

The direction is correct when:

1. docs and package pages clearly start with `create-frontron`
2. generated apps own their Electron files directly
3. `window.electron` is again the starter bridge contract
4. `frontron` reads as a future init shell, not as the real product
