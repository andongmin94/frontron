# Recovery and validation contract

## Product scope

The first stabilization target is the existing React/Vite desktop path, not new features or a research benchmark. Implemented adapters are not a claim that every real framework, installer and operating system has passed an end-to-end run.

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

`--help`, `doctor`, all `--dry-run` variants and commands without `--yes` never recover a pending transaction. Help succeeds without inspecting it; other commands report the pending transaction without changing it. With no pending transaction, interactive `init` keeps its usual behavior.

A write command explicitly supplied with `--yes` and without `--dry-run` may recover its selected project. After recovery it exits 1 with a message and does NOT also execute init/update/clean. Inspect the restored project and rerun the command to create a fresh plan. `--force` does not override recovery conflicts.

## Release

`node release.mjs verify` is verification, not publishing. Package prepublish hooks build locally; they do not require a removed GitHub Actions publishing workflow. Publish deliberately with npm only after verification, in order: `create-frontron`, then the matching `frontron` version. No publish or version bump is performed by Verify CI.

## Validation layers

`frontron/scripts/recovery-smoke.mjs` uses the actual source modules and Node filesystem operations, including real child-process termination. The Vitest wrapper additionally covers read-only CLI commands, authorization and workspace targeting. The PR/manual Verify workflow runs lint, types, tests, build and packed consumers on Linux and Windows. Read the actual run results; workflow presence alone is not a passed check.

Still required for a stable product release: real Windows installer/portable execution, real framework hydration/routing/API/cookie checks through the custom protocol, CSP compatibility, and a supported platform/package-manager matrix. The synthetic framework fixtures only check preparation contracts. They do not establish real framework compatibility. Do not globally disable the sandbox or CSP to make those tests pass.
