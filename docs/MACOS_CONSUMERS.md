# macOS Apple Silicon validation

The **macOS consumers** workflow is the next bounded gate after Windows/Linux
Verify and Native consumers. It uses a disposable `macos-15` ARM64 runner and
Node 22. It does not widen the claims of a previous successful commit: check
this workflow's final result for the exact candidate being evaluated.

## Commands

```sh
node release.mjs verify
node --test scripts/consumer-smoke/macos-probe.test.mjs
node scripts/macos-consumer-smoke.mjs
```

The first command runs the existing package, source, coverage and consumer-build
checks on macOS. Its optional Windows/Linux desktop rehearsal is not used here;
the last command explicitly tests real macOS development launchers and packaged
applications. No Electron runtime test is counted as passed merely because an
optional check was not run.

Use a disposable Mac: the native check mounts and unmounts temporary DMGs and
round-trips clipboard text, restoring its prior text. It never writes to the
system `/Applications` directory, installs certificates, removes quarantine, or
alters Gatekeeper. Both repository packages are packed locally; no npm packages
are published. Signing identity auto-discovery is disabled in CI, which has no
Developer ID credentials; the application's own packaging settings are not
rewritten by the check.

## What the native check exercises

For both a new starter and an initially iconless React/Vite retrofit:

- Install dependencies, audit them, launch the real development command, and
  check React rendering, IPC, native clipboard round-trip, renderer Node-global
  isolation, sandbox and context isolation.
- Close the actual last BrowserWindow, verify its release, emit Electron's
  `activate` event, and require a different window with working React and IPC.
  Exit via the real `before-quit` cleanup. This tests the production handler,
  not a physical mouse click on the Dock.
- Build the app and then ZIP/DMG using the consumer's installed electron-builder
  API. Read `CFBundleExecutable` and `CFBundleIdentifier` from `Info.plist`;
  inspect the binary with `lipo` instead of guessing the executable or arch.
- Copy distributions away, move the source tree out of the way, extract the ZIP
  with `ditto` and run its app twice from an unrelated directory. Mount the DMG
  read-only, copy out its app, unmount it, and run that copy. Do not depend on the
  source tree or mounted image for application resources.
- Require CSP rejection of an inline event attribute, a sandboxed preload and
  context isolation in production. Require localStorage to persist across the
  recreated window and a second process launch. Native security preferences
  and Electron sandbox flags are never weakened by this script.

The retrofit additionally runs init/doctor/update, then clean and a fresh web
build. Original web source bytes and scripts must remain intact. Success is
written to `summary.json` only after all these operations and cleanup complete.

## Evidence and limits

`FRONTRON_SMOKE_REPORT_DIR` selects the report directory. Logs, actual renderer
JSON (first/reopened windows), artifact manifests and resolved consumer lockfiles
are retained by CI for seven days on success and failure. A successful substep
is not a successful full job. Each application's profile is isolated from the
other application's profile inside this temporary report directory.

This validates native ARM64 on the selected macOS runner, not Intel or universal
builds, other macOS versions, Developer ID signing, notarization, Gatekeeper or
App Store acceptance. The app's bundle executable is launched directly: Finder,
LaunchServices, drag-and-drop installer UI, Dock mouse input and keyboard menu
shortcuts are not certified. Next.js or other server adapters are not included
in this macOS fixture. The Windows/Linux and Linux Next.js gates remain separate.

References:
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/
- https://www.electron.build/mac/
- https://www.electronjs.org/docs/latest/api/app
