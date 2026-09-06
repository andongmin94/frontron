<div align="center">

<a href="https://bio.andongmin.com/frontron/">
<img src="https://bio.andongmin.com/frontron/logo.svg" alt="Frontron logo" height="200" />
</a>

</div>

# Frontron

Electron tooling for two paths:

- `create-frontron` creates a new Electron + React + Vite app in a new directory.
- `frontron` adds an app-owned Electron layer to an existing compatible web frontend.

**Repository code and npm releases are separate.** The stabilization changes in
[Unreleased](CHANGELOG.md) are not published by merging this repository. The
commands below install the npm release, not the current Git checkout. Use the
[release guide](docs/RELEASING.md) to test a checkout with local tarballs.

## New app

```bash
npm create frontron@latest my-app
cd my-app
npm install
npm run app
```

Use `npm run build` to build and package the desktop app.

## Existing frontend

```bash
npm install -D frontron
npx frontron init --dry-run
npx frontron init
npm install
npm run frontron:dev
```

Use `npm run frontron:build` to build the frontend and package the desktop app.
`doctor`, `update` and `clean` manage the generated layer without taking ownership
of unrelated web source. Review [recovery rules](docs/RECOVERY_AND_VALIDATION.md)
before repairing an interrupted operation.

## Validated scope

| Path | Completed native checks |
| --- | --- |
| New React/Vite app and existing React/Vite retrofit | Windows x64 development, unpacked app, MSI and portable; Linux x64 development and unpacked app; macOS 15 ARM64 development, ZIP and DMG |
| Next.js standalone | Linux packaged App Router fixture with dynamic rendering and an application-owned nonce CSP |
| Other implemented adapters and package managers | Not established by these native checks; consult the support matrix |

See the [support matrix](docs/SUPPORT.md) for the exact configurations, evidence
and exclusions. Linux headless checks disable the sandbox only in the test
runner; Windows/macOS native checks retain it. Signing, notarization, installer
reputation and authentication are not implied by successful packaging.

Applications emitting inline scripts need an appropriate application-owned CSP.
The tested Next.js setup is not a claim that arbitrary Next.js apps work unchanged.
Frontron does not disable CSP or renderer isolation to make an adapter work.

Generated windows use native operating-system title bars. The sandboxed
`window.electron` bridge exposes app information, text-file dialogs, clipboard
text and notifications. Generated source belongs to the application.

## Monorepos

A workspace root with one compatible frontend is selected automatically. Select
explicitly when there is more than one:

```bash
npx frontron init --project apps/web
```

The root `package.json` can persist that selection:

```json
{
  "frontron": {
    "project": "apps/web"
  }
}
```

## Requirements and development

Node.js `22.15+` is required. The native baseline uses Node 22 and npm; pnpm,
Yarn and Bun configuration handling is implemented but is not the same as a
completed native platform/package-manager matrix.

```text
create-frontron/   starter generator and canonical Electron template
frontron/          retrofit CLI for existing web projects
release.mjs        shared verification, never publication
```

```bash
node release.mjs check-metadata
node release.mjs verify
```

The local verifier builds real consumers. Windows/Linux desktop execution is
explicitly enabled with `FRONTRON_TEST_ELECTRON_RUNTIME=1`; macOS has its own
native check. CI runs Verify, Native consumers and macOS consumers on pull
requests, pushes to `main`, and manual dispatch. Native installer checks belong
on disposable runners. See [release preparation](docs/RELEASING.md) for the
required gates and the separate, explicit npm publication step.

## Links

- [Support and evidence](docs/SUPPORT.md)
- [Release notes](CHANGELOG.md)
- [Documentation](https://andongmin.com/frontron/)
- [Guide](https://andongmin.com/frontron/guide/)
- [Issues](https://github.com/andongmin94/frontron/issues)

MIT. See [`LICENSE.md`](LICENSE.md).
