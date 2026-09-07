# Changelog

## Unreleased

These changes describe repository source, not a newly published npm version.
The package manifests remain at `0.13.4` during stabilization; that number does
not identify this unpublished source on the registry. Select a fresh matching
version and complete [release preparation](docs/RELEASING.md) before publication.

### Fixed

- Recovery checks recorded before/after states and refuses to overwrite or
  delete conflicting user edits. Unsafe links and unrecognized partial writes
  preserve both files and the journal instead of forcing restoration.
- Transaction journal snapshot permissions are validated against the actual
  captured Unix permission-bit range before recovery. Invalid journal metadata
  is rejected without modifying the current files or discarding the journal.
- Help, doctor, dry-run and unapproved commands do not recover pending work.
  Explicit recovery exits before a new operation is planned.
- Windows path canonicalization and owned-process-tree shutdown are covered by
  real Electron consumer checks.
- The private renderer proxy streams request bodies using Node fetch with
  manual redirects. Only localhost/127.0.0.1 aliases of the exact runtime HTTP
  port are rewritten to the stable application origin.
- Iconless retrofits receive the managed canonical SVG packaging default.
  Custom icons/settings and edits to managed icons remain subject to ownership
  checks during update and clean.

### Maintainability

- High-branching CLI, doctor, init/package patching, clean planning/application,
  manifest validation and dry-run reporting paths are split into focused helpers.
  Safety-sensitive orchestration points include concise Korean comments so the
  recovery and ownership boundaries are visible without tracing every branch.
- The Frontron cyclomatic-complexity gate is reduced from the previous 50-point
  ceiling to 20 after the orchestration and parsing paths were decomposed.
  `frontron` and `create-frontron` now enforce the same 20-point ceiling.

### Validation and release process

- Real React/Vite starter and retrofit development and distribution checks on
  Windows x64, Linux x64 and macOS 15 ARM64; Windows MSI/portable and macOS
  ZIP/DMG are included. See the [support matrix](docs/SUPPORT.md) for exclusions.
- A real Linux Next.js 16.3.4 standalone fixture with application-owned nonce
  CSP checks hydration, APIs, assets, redirects and client-side navigation.
- CSP tests distinguish parser-inserted scripts and inline event handlers from
  scripts permitted by strict-dynamic; production security is not weakened.
- Explicit local verification and npm publication replace obsolete Actions-only
  publishing assumptions. CI now also verifies pushes to `main`.
- Active workflows use `actions/checkout@v7.0.1` and `actions/setup-node@v7.0.0`
  so repository checks do not rely on the deprecated Node 20 action runtime.

### Intentional compatibility boundaries

- Only current manifest/journal schemas are accepted; old state is rejected,
  not migrated. Preserve a full project/journal backup before intentional manual
  recovery or removing an old integration. Do not delete a journal merely to
  silence a warning. See [recovery](docs/RECOVERY_AND_VALIDATION.md).
- CLI commands are the supported interface; internal JavaScript modules are not
  a public API. No legacy publish command or transport fallback is restored.
- Real server-adapter support is limited to the stated Next.js fixture.
  Authentication/cookies, other real frameworks, signing/notarization and
  additional platform/package-manager combinations are not certified.
