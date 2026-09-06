# Recovery and validation contract

## Product scope

The primary stabilization target is the React/Vite desktop path, not new
features or a research benchmark. The [support matrix](SUPPORT.md) distinguishes
implemented adapters from completed native checks and records exact evidence.

## Recovery

The journal records the original snapshot plus a checked before/after state for every file mutation. Mutation intents are flushed before writes. Recovery preflights all affected files and new directories before modifying any of them, and checks targets again at restoration time.

- Untouched planned files are not restored.
- A modified existing file or generated file is not overwritten/deleted when its current content or permissions differ from the original snapshot and the last recorded mutation states.
- Hard links, symbolic links, unexpected file types and unexpected content inside a newly created directory block automatic recovery.
- A partial/torn file write is conservatively treated as a conflict. This is safe refusal, not a claim of automatic repair.
- On conflict, preserve both current files and `.frontron-transaction-journal.json`. Copy the project and journal before any manual recovery. Inspect each snapshot's `contentBase64`, path and hash; do not execute journal paths as commands or delete the journal merely to suppress the warning. Reconcile or restore the affected files intentionally, then retry recovery. Keep independent copies of user work.
- Only journal schema 3 is accepted. Older journals remain untouched and require manual recovery; there is no migration or fallback.
- Power-loss durability, hostile concurrent filesystem replacement and simultaneous recovery processes are not guaranteed by this implementation.

## CLI reads and writes

`--help`, `doctor`, all `--dry-run` variants and commands without `--yes` never recover a pending transaction. Help succeeds without inspecting it; doctor retains its read-only diagnostic report; other commands report the pending transaction without changing it. With no pending transaction, interactive `init` keeps its usual behavior.

A write command explicitly supplied with `--yes` and without `--dry-run` may recover its selected project. After recovery it exits 1 with a message and does NOT also execute init/update/clean. Inspect the restored project and rerun the command to create a fresh plan. `--force` does not override recovery conflicts.

## Release

`node release.mjs verify` is verification, not publishing. It first installs both locked dependency trees, then checks dependencies, audits, lint, types, coverage, builds and packed consumers. Package prepublish hooks build locally; they do not require a removed GitHub Actions publishing workflow. No publish or version bump is performed by CI. The [release guide](RELEASING.md) defines the source gates, tarball review and separate explicit npm publication, in order: `create-frontron`, then the matching `frontron` version.

## Validation layers

`frontron/scripts/recovery-smoke.mjs` uses the actual source modules and Node filesystem operations, including real child-process termination. Its 20 scenarios are included as one Vitest test, not 20 additional Vitest entries. The Vitest wrapper additionally covers read-only CLI commands, authorization and workspace targeting.

`create-frontron/__tests__/release-rehearsal.spec.ts` builds and installs local tarballs into temporary consumers. It uses real React, Vite, Electron and electron-builder rather than synthetic build outputs. With `FRONTRON_TEST_ELECTRON_RUNTIME=1`, it checks:

- A freshly generated starter in development and as a packaged, unpacked executable.
- A real Vite/React app before retrofit, after init, after update, and after clean.
- Actual React rendering and click-state updates, IPC app information, absence of renderer Node globals, and the production `frontron://app` origin.
- Restoration of web scripts and byte-identical web source after clean, followed by a successful web rebuild.

Renderer instrumentation exists only in the test's temporary app copy and is removed before the retrofit clean check. Tests read each app's explicit builder output directory; starter and retrofit output paths need not match.

Verify runs the canonical verifier with real desktop checks enabled on Windows
and Linux, on PRs, pushes to main and manual dispatch. Windows uses the default
Electron sandbox. Linux uses Xvfb and test-only no-sandbox flags; Linux results
are NOT sandbox certification. Read the exact commit's run results: a workflow
or test being present is not evidence that it passed.

The [native consumer gate](NATIVE_CONSUMERS.md) adds real Windows MSI/portable
and conditional Linux Next.js standalone checks. The
[macOS gate](MACOS_CONSUMERS.md) adds native ARM64 development and ZIP/DMG checks.
These are completed for the baseline recorded in [SUPPORT.md](SUPPORT.md), not
unconditionally for every later commit.

Authentication/cookies, other real server frameworks, signing/notarization and
the broader platform/package-manager matrix remain outside that baseline.
Synthetic framework fixtures check preparation contracts; they do not establish
arbitrary Next/Nuxt/Remix/SvelteKit compatibility. Never globally disable the
production sandbox or CSP to make a test pass.
