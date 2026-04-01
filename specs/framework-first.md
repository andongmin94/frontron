# CLI And Starter Contract

## 1. Core definition

Frontron is no longer positioned as a broad framework-first product.

The current product story is:

- `create-frontron` is the primary starter/template entrypoint
- `frontron` is the support CLI/runtime package behind that starter

The file path stays `specs/framework-first.md` for continuity, but the contract it describes is now starter-first.

## 2. Package roles

### `create-frontron`
- official starter generator
- primary onboarding path
- owns starter defaults, template files, and first-run app structure

### `frontron`
- support package used by starters and compatible manual setups
- owns the CLI commands such as `frontron dev`, `frontron build`, and `frontron check`
- owns config loading, runtime/build support, and `frontron/client`

## 3. Primary user flow

The default flow should feel like this:

1. run `npm create frontron@latest`
2. enter the project
3. run `npm install`
4. run `npm run app:dev`
5. later run `npm run app:build`

The starter experience is first-class again.

## 4. Secondary manual flow

Manual install is still allowed for compatible projects, but it is a secondary path:

1. install `frontron`
2. create `frontron.config.ts`
3. add `app:dev` and `app:build`
4. run the app through the CLI

This path should stay compatible, but it no longer defines the main product story.

## 5. Official structure

Generated starter apps still use the official Frontron structure:

```txt
my-app/
  src/
  public/
  package.json
  frontron.config.ts
  frontron/
```

The starter may include a richer frontend base, but the desktop support layer still comes from `frontron`.

## 6. Responsibility split

### `create-frontron` owns
- project generation
- starter template files
- example UI/base files
- first-run developer experience

### `frontron` owns
- CLI commands
- config loading
- runtime/build support
- `frontron/client`
- desktop bridge/runtime helpers
- Rust integration slot

## 7. Renderer contract

Renderer code should continue to use:

```ts
import { bridge } from 'frontron/client'
```

The project direction changed, but the supported renderer API did not.

## 8. Native strategy

- Rust stays the official native extension path
- the slot remains `frontron/rust`
- web code should still access native features through the bridge

## 9. Success criteria

The direction is correct when:

1. docs and package pages clearly start with `create-frontron`
2. `frontron` reads as the support CLI/runtime package, not the headline framework
3. starter users can run the app immediately
4. manual install still works for compatible projects
5. repo messaging feels close to the 0.8.4 / 0.8.5 era again
