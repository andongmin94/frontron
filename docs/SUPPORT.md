# Support and validation matrix

This is the entry point for the repository's tested scope. **Implemented** means
code exists; **verified** means the named consumer actually ran on the specified
platform. Neither means every framework configuration, installer or package
manager is covered. Repository validation does not establish which code is in an
npm release; see [Unreleased](../CHANGELOG.md) and [releasing](RELEASING.md).

## Primary path: React/Vite with npm

Both a new `create-frontron` app and an initially iconless `frontron` retrofit are
included. The baseline uses Node 22; package metadata requires Node `22.15+`.
Dependency ranges are resolved during consumer installation. Exact resolved
versions are recorded in the workflow artifacts, not guaranteed by a version
range printed in a README.

| Environment | Development | Distributed application | Limits |
| --- | --- | --- | --- |
| Windows x64 hosted runner | Real Electron rendering and IPC | Unpacked executable; portable twice; MSI install, run and uninstall | No signing/SmartScreen, MSI upgrade, non-admin or interactive installer claim |
| Linux x64 Ubuntu hosted runner | Real Electron rendering and IPC | Unpacked executable | Xvfb and test-only no-sandbox flags; no Linux sandbox or AppImage/DEB/RPM claim |
| macOS 15 ARM64 hosted runner | Real Electron rendering, IPC and clipboard | ZIP twice; copy app from DMG, unmount, then run | Direct bundle executable; no Intel/universal, Finder, Developer ID, notarization or Gatekeeper claim |

The retrofit must pass init/doctor/update/clean and rebuild the original web app
without changing its source bytes or web scripts. Native distribution tests move
the source out of the original location and launch from unrelated directories.
macOS additionally checks close/activate window recreation and localStorage
across windows and process launches; `activate` is emitted by the test, not by a
physical Dock click.

## Existing-project adapters

| Adapter | Implementation | Native validation boundary |
| --- | --- | --- |
| `generic-static` | Static output server | The React/Vite path above, not every static framework |
| `next-standalone` | Packaged Node server | Conditional: Next.js 16.3.4 App Router on Linux, dynamic rendering and application-owned nonce CSP |
| `next-export` | Static export | Implemented; no real Next.js export consumer in this baseline |
| `nuxt-node-server` | Nuxt/Nitro server | Implemented; no real Nuxt native consumer in this baseline |
| `remix-node-server` | Remix server | Implemented; no real Remix native consumer in this baseline |
| `sveltekit-static` | SvelteKit static adapter | Implemented; no real SvelteKit native consumer in this baseline |
| `sveltekit-node` | SvelteKit Node adapter | Implemented; no real SvelteKit native consumer in this baseline |
| `generic-node-server` | Explicit custom Node server | Implemented; arbitrary user server behavior is not established by the fixtures |

The Next.js fixture checks hydration/clicks, CSS/public assets, GET query strings,
JSON POST, nonce changes, blocked inline handlers/parser scripts, redirects,
client-side Link navigation and IPC, followed by clean and the original web
build. Default inline scripts without an upstream nonce/hash policy remain
unsupported by the restrictive default CSP. Cookies/authentication, Server
Actions, image optimization, development-mode CSP, and Windows/macOS Next.js
are not covered. The private Node-fetch hop does not share Chromium's cookie
jar or proxy settings implicitly.

## Package managers

npm is the package manager in the completed native baseline above. pnpm build
approvals, Yarn's node-modules linker, and Bun trusted dependencies have
implementation and contract coverage. Do not extrapolate the npm native result
to those managers or every version. Any additional package-manager run must be
reported with its own command, resolved version and platform before expanding
this table.

## Evidence

The completed baseline is commit
[`032c0193ec96b1af8a8ca79856f44f5a50c983b0`](https://github.com/andongmin94/frontron/commit/032c0193ec96b1af8a8ca79856f44f5a50c983b0),
verified on 2026-09-06:

| Workflow | Completed jobs | Evidence |
| --- | --- | --- |
| Verify, run 19 | Ubuntu and Windows | [Run](https://github.com/andongmin94/frontron/actions/runs/34016940061) |
| Native consumers, run 10 | Windows distributions and Linux Next.js | [Run](https://github.com/andongmin94/frontron/actions/runs/34016940062) |
| macOS consumers, run 2 | Apple Silicon package and native checks | [Run](https://github.com/andongmin94/frontron/actions/runs/34016940074) |

This is a fixed historical baseline, not a moving badge for a later commit.
For a new release, require all five jobs on the chosen candidate and check the
`main` push results after merging. A skipped job is not a passing native check.
Native artifacts retain command logs, renderer JSON and resolved lockfiles for
seven days; copy release evidence before expiry. Do not archive credentials or
Chromium profile storage.

Detailed test contracts and commands:

- [Recovery and basic validation](RECOVERY_AND_VALIDATION.md)
- [Windows distributions and Linux Next.js](NATIVE_CONSUMERS.md)
- [macOS Apple Silicon](MACOS_CONSUMERS.md)

Recovery refuses unexpected edits and unsafe links; it does not promise repair
of torn writes, power-loss durability, hostile concurrent filesystem replacement
or simultaneous recovery. Application authors still own their app's security,
signing, packaging choices and validation outside this matrix.
