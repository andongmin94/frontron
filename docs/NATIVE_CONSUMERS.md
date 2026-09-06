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

The retrofit fixture deliberately starts without an icon. Frontron supplies the
canonical template SVG in the managed desktop directory and uses it as the
packaging default when there is no explicit icon or discoverable icon resource.
Existing icon settings and files remain user-owned. The generated icon and its
package setting participate in ordinary update/clean ownership checks; edited
icons are not silently overwritten. Electron-builder performs image conversion.

For each app it runs the portable executable twice, silently installs the MSI,
runs the exact installed product executable, and uninstalls the MSI. It checks
React mounting, IPC, renderer Node-global isolation and rejection of an injected
untrusted inline script. A test-only preload reports the documented
`process.sandboxed` and `process.contextIsolated` properties. The test does not
modify production BrowserWindow security options or add a production test hook.
An unrelated sentinel and a user-created file must survive uninstall. MSI
arguments retain spaces and use the documented `PROPERTY="value"` syntax through
Node's explicit `windowsVerbatimArguments` option; no command shell is used.

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

The protocol bridge talks to the app-owned HTTP loopback server with Node's
built-in fetch, not Electron's browser-session fetch. Requests retain streaming
bodies with `duplex: 'half'` and `redirect: 'manual'`; redirects are returned to
the renderer after same-origin Location rewriting, never followed inside the
proxy. Next.js may normalize 127.0.0.1 to localhost in absolute redirects. Those
two HTTP host spellings are rewritten only for the exact runtime port, without
credentials. Other ports, protocols, hosts and IPv6 addresses are not treated as
aliases. A real local HTTP regression checks internal and external redirect
responses without contacting either destination. There is no browser-session
transport fallback or implicit Chromium cookie-jar/proxy behavior on this
internal hop. End-to-end cookies/authentication are not yet certified.

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
- https://www.electron.build/docs/features/icons-and-images/
- https://learn.microsoft.com/en-us/windows/win32/msi/command-line-options
- https://nodejs.org/api/child_process.html
- https://nodejs.org/api/globals.html#fetch
- https://nextjs.org/docs/app/guides/content-security-policy
