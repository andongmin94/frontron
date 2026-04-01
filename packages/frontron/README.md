# Frontron <a href="https://npmjs.com/package/frontron"><img src="https://img.shields.io/npm/v/frontron" alt="npm package"></a>

`frontron` is the CLI and runtime support package used by Frontron starters and compatible manual setups.

## What It Provides

- `defineConfig`
- `frontron init`
- `frontron check`
- `frontron dev`
- `frontron build`
- config discovery for root `frontron.config.ts`
- `frontron/client`
- runtime and build support
- bridge registration
- the official `frontron/rust` slot

## Recommended start path

Most users should start with the starter:

```bash
npm create frontron@latest
```

That generated project already depends on `frontron` and uses this package for desktop support.

## Manual path

Compatible existing web projects can still install `frontron` directly:

```bash
npm install frontron
npx frontron init --skip-install
```

Then run:

```bash
npm run app:dev
npm run app:build
```

## Notes

- `create-frontron` is the primary starter generator.
- `frontron` is the support layer behind that starter.
- The current contract lives in [`../../specs/framework-first.md`](../../specs/framework-first.md).

Docs: [frontron.andongmin.com](https://frontron.andongmin.com)

## License

MIT. Issues: [github.com/andongmin94/frontron/issues](https://github.com/andongmin94/frontron/issues)
