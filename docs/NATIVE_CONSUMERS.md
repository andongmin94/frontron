# Native consumer validation

These checks extend the React/Vite `node release.mjs verify` gate. The separate
**Native consumers** workflow runs on pull requests. A successful workflow run
is evidence only for the tested operating system, dependency resolution and
application configuration; it is not certification of every adapter.

## Windows x64 distributions

On a **disposable Windows runner**, install the locked repository dependencies,
then run `node scripts/windows-distribution-smoke.mjs`. This command installs
and uninstalls temporary MSI applications. It is deliberately not an implicit
side effect of the ordinary local `verify` command.

The check packs both repository packages, generates a starter and retrofits a
real React/Vite app. It uses the consumer's installed electron-builder API to
build MSI and portable targets, retaining artifact names reported by the builder.
It copies the distributions away from the build output and moves the original
consumer directory out of the way before launching them from an unrelated
working directory.

For each app it runs the portable executable twice, silently installs the MSI,
runs the exact installed product executable, and uninstalls the MSI. It checks
React mounting, IPC, renderer Node-global isolation and rejection of an injected
untrusted inline script. A test-only preload reports the documented
`process.sandboxed` and `process.contextIsolated` properties. The test does not
modify production BrowserWindow security options or add a production test hook.
An unrelated sentinel and a user-created file must survive uninstall.

Code signing, SmartScreen reputation, interactive installer UI, MSI upgrades,
restricted non-administrator sessions, Windows ARM64 and other Windows releases
are not covered by this runner.

## Next.js standalone / Linux

Run `NEXT_TELEMETRY_DISABLED=1 node scripts/next-standalone-smoke.mjs` after
installing the repository's locked dependencies. Xvfb and Electron system
libraries are required. The fixed direct Next.js version is 16.3.4; the actual
resolved consumer dependency lockfile is retained with reports.

The fixture is an actual App Router application with `output: 'standalone'`,
dynamic rendering and an **application-owned nonce CSP**, following Next.js's
CSP guidance. The request and response contain the nonce policy so Next.js can
nonce its framework/hydration scripts. Frontron must preserve that policy,
including a different nonce per response, while a script without a nonce stays
blocked. The fixture does not loosen Frontron's default script policy.

It builds the original web app, performs init/update and desktop packaging,
moves the packaged application away from its source, then tests real React
hydration/clicks, CSS and public files, GET query strings, JSON POST bodies,
same-origin redirects, client-side Link navigation and IPC. The clean operation
must restore the original source files and scripts, followed by another web
build. Exit uses the actual before-quit shutdown path.

Linux CI uses Xvfb with `--no-sandbox` for its headless test environment. Its
result **does not certify Linux sandboxing**. Windows distribution tests do not
use this switch. Cookies/authentication, Server Actions, image optimization,
static export, Windows Next.js, development-mode CSP and arbitrary application
configurations are not covered. In particular, a default Next.js app emitting
inline scripts **without an upstream nonce/hash CSP is not claimed supported**:
Frontron's fallback `script-src 'self'` intentionally remains restrictive.

## Evidence

`FRONTRON_SMOKE_REPORT_DIR` sets the output directory. Each command writes a log;
renderer reports and resolved consumer lockfiles are also retained. CI uploads
logs and JSON for seven days on success and failure, not executables or app
source. A report from one passed substep does not mean the full job passed.
Consult the final workflow conclusion for the exact tested commit.

References:
- https://www.electronjs.org/docs/latest/api/process
- https://www.electron.build/msi.html
- https://nextjs.org/docs/app/guides/content-security-policy
