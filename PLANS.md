# Framework-First Migration Plan

> This file is a living plan for the framework-first migration.
> Keep the changes small, reviewable, and aligned with `specs/framework-first.md`.

## Goal
- Make `packages/frontron` the real product surface.
- Reduce `packages/create-frontron` to a thin starter generator.
- Standardize the public contract around `frontron.config.ts`, `app:dev`, `app:build`, and the optional `frontron/` app-layer folder.

## Gap analysis
- Current state:
  - `create-frontron` owns the runnable app template and the copied Electron runtime/build files.
  - `frontron` is documented as a placeholder and has no implementation.
  - Public docs still teach `src/electron`, `window.electron`, and template-owned packaging as the main model.
- Target state:
  - Users can install `frontron` into an existing web app, add `frontron.config.ts`, and run/build without `create-frontron`.
  - `create-frontron` only seeds the official framework-first structure.
  - The web side talks to desktop capabilities through `frontron/client`, not direct preload internals.
- Main blockers:
  - No config surface yet: no `defineConfig`, no config loader, no CLI, no client bridge package.
  - Runtime/build ownership still lives in the starter template.
  - Tests and docs encode the old template-first contract.

## Phases
1. Contract freeze
   - Status: completed.
   - Landed `PLANS.md`, README/docs contract updates, framework-first fixtures, and parity checks.
2. Product surface bootstrap
   - Status: completed.
   - `packages/frontron` now provides `defineConfig`, config discovery, `frontron dev`, `frontron build`, and `frontron/client`.
3. Runtime/build ownership move
   - Status: completed.
   - Electron main/preload/build staging moved behind `packages/frontron`.
   - Config-driven bridge registration now loads custom namespaces from `frontron.config.ts`.
   - Build staging now carries the official app-layer files needed for bridge runtime loading.
   - Menu, tray, and lifecycle hooks now load from the same official config surface.
   - The temporary renderer-only compatibility adapter was removed, so the public renderer API is now only `frontron/client`.
4. Starter thinning
   - Status: completed.
   - `create-frontron` now emits `frontron.config.ts`, `frontron/`, `app:dev`, and `app:build`.
   - Copied `src/electron/*` runtime files were removed from the starter template.
   - The starter now includes config-driven `frontron/bridge`, `frontron/menu`, `frontron/tray`, and `frontron/hooks` examples.
5. Documentation and expansion
   - Status: completed for the implementation scope.
   - Main onboarding docs and starter docs now teach the framework-first flow.
   - The official `frontron/rust` slot is now fixed in config, fixtures, starter scaffolding, CLI build orchestration, first runtime loading, and the first built-in Rust-backed bridge API.
   - Bridge type generation now lands in `.frontron/types/frontron-client.d.ts`, maps signatures from the source config module, and now covers the first config-driven Rust bridge example.
   - Broader Rust bridge examples, stronger native coverage, package smoke coverage, and release hardening have now landed in the repo.

## Current slice
- Status: framework-first migration and release hardening are complete. Docs localization and docs-site i18n are in place, and docs usability is now the active cleanup slice.
- Keep `frontron` as the only runtime/build owner.
- Keep `frontron/client` as the only public renderer API.
- Keep guard tests so `window.electron` and `src/electron` do not re-enter the framework or starter path.
- `frontron dev` now builds the official Rust slot with `cargo build`, `frontron build` now uses `cargo build --release`, and the framework runtime now loads the official native artifact when `rust.enabled` is turned on.
- `frontron` CLI now also generates `.frontron/types/frontron-client.d.ts` so custom bridge namespaces and method signatures appear in TypeScript autocomplete.
- The first built-in Rust-backed bridge API is now available through `bridge.native`, and the first config-driven Rust bridge example now flows from `rust.bridge.math.add` to `bridge.math.add`.
- Config-driven Rust bridge handlers now also validate argument count and primitive runtime types before calling the native symbol.
- The starter Rust scaffold now demonstrates a slightly broader real surface with `bridge.math.add`, `bridge.math.average`, `bridge.health.isReady`, `bridge.file.hasTxtExtension`, and `bridge.system.cpuCount`.
- Both published packages now have `npm pack --dry-run` smoke coverage and real `npm pack` tarball smoke coverage so release checks validate the actual shipped file surface.
- Release rehearsal now also covers packed `create-frontron` generation plus packed `frontron dev --check`, and the publish script order is hardened to publish `frontron` before `create-frontron`.
- Implementation roadmap work is complete.
- Active docs work:
  - convert the default docs site content to English
  - add a Korean locale under `/ko/` with the same documentation structure
  - make the docs landing pages more scannable and less text-heavy
  - add clearer step-by-step manuals for the highest-traffic user flows
  - make guide navigation more path-based for first-time users
  - landed new manuals for existing-project install and desktop bridge usage
  - smooth manual-install DX by inferring standard Vite web commands and targets, and use the default Frontron icon when `app.icon` is omitted

## Risks / assumptions
- Docs and tests are tightly coupled to the old starter-owned structure, so they must move with the runtime migration.
- Existing generated apps that still depend on `window.electron` must migrate their renderer code to `frontron/client`.
- Rust remains a later phase and stays in one official slot: `frontron/rust`.
- The current Rust slice adds first-class native artifact loading, status reporting, built-in and config-driven Rust bridge APIs, runtime argument validation, and several broader domain examples in the starter scaffold.
- The current type-generation slice reads signatures from the source config module and the first Rust bridge descriptors, but it still does not generate dedicated runtime-safe bridge contracts or richer native API scaffolds yet.
- v1 should avoid a generic native plugin system and prioritize the official structure and DX consistency.

## Validation
- Tests to run:
  - `npm run build` in `packages/frontron`
  - `npm run typecheck` in `packages/frontron`
  - `npm test` in `packages/frontron`
  - `npm run build` in `packages/create-frontron`
  - `npm test` in `packages/create-frontron`
- Package smoke checks:
  - `npm pack --dry-run` coverage in `packages/frontron`
  - `npm pack --dry-run` coverage in `packages/create-frontron`
  - packed-generator rehearsal coverage in `packages/create-frontron`
- Manual checks:
  - Confirm the starter output matches the framework-first fixtures and official shape.
  - Confirm `frontron build` stages `web/`, runtime files, config files, and manifest paths under `.frontron/`.
  - Confirm docs and README files no longer teach `src/electron` or `window.electron` as supported renderer APIs.

## Remaining work
- Estimated remaining scope: about 0-1% of the original migration plan.
- Effectively complete:
  - framework-first contract
  - config discovery and CLI
  - runtime/build ownership move
  - starter thinning
  - modern renderer API enforcement
  - dev/build smoke coverage
  - official `frontron/rust` slot contract, starter scaffold, CLI task orchestration, runtime loading, bridge type generation, broader config-driven Rust bridge examples, and release/package smoke coverage
- Still open:
  - manual release execution and final publish-time confirmation
