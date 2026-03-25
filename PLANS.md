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
  - no remaining migration blockers inside the repo
  - future releases still need routine publish-time confirmation

## Next product slice: Official Config Surface Expansion
- Status: largely landed.
- Goal:
  - widen `frontron.config.ts` so normal product decisions do not require forking `frontron`
  - keep Electron runtime/preload/build orchestration framework-owned
  - expose stable, validated, high-signal options first instead of dumping raw Electron and raw electron-builder config into user space

### Design rules
- Keep `frontron` as the runtime/build owner.
- Only expose settings that represent normal app-product decisions.
- Prefer typed, validated config over free-form pass-through.
- Add a small escape hatch only after the common product surface is broad enough.
- Update docs and tests every time the public config surface changes.

### Phase A. Window surface expansion
- Status: landed.
- Purpose:
  - cover the common `BrowserWindow` decisions that users expect to configure directly.
- Add to `windows.*`:
  - `minWidth`, `minHeight`, `maxWidth`, `maxHeight`
  - `show`, `center`, `backgroundColor`
  - `alwaysOnTop`, `fullscreen`, `fullscreenable`, `maximizable`, `minimizable`, `closable`
  - `skipTaskbar`, `transparent`, `autoHideMenuBar`
  - title-bar options with a controlled subset such as `titleBarStyle`
- Runtime work:
  - update `packages/frontron/src/types.ts`
  - validate in `packages/frontron/src/config.ts`
  - wire the options in `packages/frontron/src/runtime/main.ts`
- Validation:
  - add config validation tests
  - add runtime smoke assertions for at least one advanced window option

### Phase B. Packaging surface expansion
- Status: landed.
- Purpose:
  - let users control installer/output behavior without owning `electron-builder` directly.
- Add to top-level `build`:
  - `asar`
  - `compression`
  - `extraResources`
  - `extraFiles`
  - `files` allowlist support
  - richer `build.windows` config:
    - `icon`
    - `publisherName`
    - `signAndEditExecutable`
    - `requestedExecutionLevel`
    - `artifactName` override at platform level if needed
  - richer `build.nsis` config:
    - `oneClick`
    - `perMachine`
    - `allowToChangeInstallationDirectory`
    - `deleteAppDataOnUninstall`
    - `installerIcon`
    - `uninstallerIcon`
- CLI work:
  - keep building `builder.json` in `packages/frontron/src/cli.ts`
  - map only the supported subset into the generated electron-builder config
- Validation:
  - add `stageBuildApp` assertions for generated builder config
  - add package smoke coverage for at least one non-default Windows target mix

### Phase C. Cross-platform and release metadata expansion
- Status: landed for the common config surface.
- Purpose:
  - stop treating advanced packaging as Windows-only.
- Add:
  - `build.mac.targets`
  - `build.linux.targets`
  - platform icons and category metadata
  - stronger app metadata surface where missing
  - publish-provider surface beyond the current `publish` mode enum when needed
- Guardrail:
  - keep signing/notarization/publish provider support typed and limited to the common fields first

### Phase D. Guarded advanced override
- Status: landed.
- Purpose:
  - support edge cases without collapsing back to template-owned raw Electron.
- Add a narrow advanced block such as:
  - `build.advanced.electronBuilder`
  - `windows.*.advanced`
- Rules:
  - document that the advanced block is best-effort and intentionally not fully abstracted
  - block obviously dangerous or conflicting overrides
  - treat this as the final layer, not the default user path

### Phase E. DX and migration support
- Status: landed for the current docs and diagnostics scope.
- Improve CLI failure messages when inference cannot determine the frontend command or output.
- Show candidate package scripts before telling the user to set `web.dev` or `web.build`.
- Landed a minimal `frontron doctor` command for first-run diagnostics and missing frontend wiring hints.
- Add docs tables for:
  - what `frontron.config.ts` currently supports
  - what still requires the advanced block
  - common setup recipes for Vite, VitePress, Next, monorepos, and custom scripts

### Suggested implementation order
1. Phase A window surface expansion
2. Phase B packaging surface expansion
3. Phase E DX/error-message improvements
4. Phase C cross-platform build surface
5. Phase D guarded advanced override

### Acceptance criteria
- Users can configure the common app-window and package-output decisions entirely from `frontron.config.ts`.
- The framework still owns runtime/main/preload/build orchestration.
- The public config surface is documented, validated, and covered by tests.
- Users only need an advanced override block for true edge cases, not for normal product decisions.

## Next product slice: Runtime Control, Diagnostics, and Operations
- Status: landed for the first typed surface scope.
- Goal:
  - finish the remaining edge-case escape hatch without giving runtime/build ownership back to app templates
  - expose a safe subset of Electron runtime controls that real products expect to tune
  - expand first-run diagnostics from config checks into actionable app-health checks
  - make the repo docs more recipe-oriented for common frontend stacks
  - keep the repository root lean while moving topic-specific docs under `docs/` or `specs/`

### Design rules
- Keep `frontron` as the only runtime/build owner.
- Keep root `frontron.config.ts` as the official config entrypoint.
- Do not reintroduce `window.electron`, `src/electron/*`, or template-owned Electron internals.
- Prefer typed, validated, high-signal config over raw pass-through.
- Treat advanced override as the exception path, not the default user path.
- Every new public surface must land with docs and tests in the same pass.
- Keep the repo root doc set small: `README.md`, `LICENSE.md`, `PLANS.md`, `RELEASE.md`, and `AGENTS.md` only. New topic docs belong under `docs/` or `specs/`.

### Workstream 1. Guarded advanced override
- Purpose:
  - cover the real packaging edge cases that still require forking `frontron`.
- Add:
  - `build.advanced.electronBuilder`
  - `windows.*.advanced`
- Guardrails:
  - block overrides for framework-owned runtime paths, preload entrypoints, manifest wiring, staged web path ownership, and other fields that would break the framework contract
  - document that this layer is best-effort and intentionally incomplete
- Validation:
  - config validation tests for allowed and blocked keys
  - builder-config tests proving allowed keys pass through and blocked keys fail fast

### Workstream 2. Safe webPreferences surface
- Purpose:
  - let users tune a few common renderer/runtime behaviors without exposing unsafe Electron defaults.
- Add a controlled subset under `windows.*` such as:
  - `zoomFactor`
  - `sandbox`
  - `spellcheck`
  - `webSecurity`
- Keep framework-owned and closed:
  - `preload`
  - `contextIsolation`
  - `nodeIntegration`
  - raw `session` ownership
- Validation:
  - config validation coverage
  - runtime smoke coverage for at least one non-default web preference

### Workstream 3. Doctor expansion
- Purpose:
  - move `frontron doctor` from minimal contract checks to real first-run diagnostics.
- Add:
  - dev-port conflict detection
  - built-output checks for `dist/`, `.frontron/`, and packaged output expectations when relevant
  - Rust toolchain presence checks when `rust.enabled` is true
  - richer monorepo and custom-script hints
- Validation:
  - CLI tests for each failure class
  - at least one fixture proving the doctor output stays actionable and concise

### Workstream 4. Operations surface
- Purpose:
  - expose the most common product-operations features without collapsing back to raw Electron ownership.
- Investigate and stage in this order:
  - code-signing config surface
  - auto-update integration surface
  - deep-link support
  - file associations
  - explicit permission/security policy knobs where they represent normal product decisions
- Guardrails:
  - do not expose provider-specific complexity until the common shape is clear
  - keep platform-specific details typed and incremental

### Workstream 5. Docs recipes and support matrix
- Purpose:
  - make it obvious where Frontron works out of the box, where it needs config, and where the boundary still is.
- Add docs tables for:
  - supported `frontron.config.ts` surface
  - advanced-override-only fields
  - runtime-owned fields that are intentionally closed
  - recipe pages for Vite, VitePress, Next static export, Nuxt generate, monorepos, and custom scripts
- Also:
  - keep the docs path-based for first-time users
  - avoid adding more loose root-level markdown files for topic-specific guidance

### Suggested implementation order
1. Workstream 1. Guarded advanced override
2. Workstream 2. Safe webPreferences surface
3. Workstream 3. Doctor expansion
4. Workstream 4. Operations surface
5. Workstream 5. Docs recipes and support matrix

### Acceptance criteria
- Users can cover normal product packaging and common renderer/runtime tuning from `frontron.config.ts`.
- Edge-case builder overrides exist, but they do not let templates reclaim runtime/build ownership.
- `frontron doctor` can explain the most common first-run failures without sending users straight into source code.
- Operational product features begin moving into typed config without exposing raw Electron internals all at once.
- The repo root stays intentionally lean, and deeper guidance lives under `docs/` or `specs/`.

## Next product slice: Scale, Transparency, and Developer Ergonomics
- Status: proposed.
- Goal:
  - reduce the cost of Frontron's current opinionated constraints without giving runtime/build ownership back to app templates
  - make larger desktop apps practical while keeping the existing-project path small
  - lower the debugging cost of framework-owned staging and runtime behavior
  - reduce the mismatch between the thin framework story and the current starter/template weight

### Design rules
- Keep `frontron` as the only runtime/build owner.
- Keep root `frontron.config.ts` as the official config entrypoint.
- Prefer typed config, framework modules, and lifecycle hooks over raw Electron pass-through.
- The default path must stay simpler than the advanced path.
- Every new escape hatch must land with diagnostics, docs, and tests in the same pass.
- Preserve the manual-install contract first; starter behavior should follow the same structure.

### Workstream 1. Multi-window runtime
- Purpose:
  - remove the current single-main-window bias so Frontron can scale beyond one primary shell window.
- Add:
  - a named window registry owned by the runtime
  - explicit window lifecycle support for create, show, focus, hide, and close
  - singleton and lazy-create semantics for common secondary windows such as settings, auth, and utility panels
  - a typed desktop context surface for opening and managing configured windows
- Runtime work:
  - evolve the runtime manifest and main-process runtime to manage more than one `BrowserWindow`
  - keep route-based window definitions, but support runtime creation instead of treating only `main` as real
- Validation:
  - config tests for named-window behavior
  - runtime smoke coverage for at least two configured windows and one lazy-created window

### Workstream 2. Explicit-mode and inference transparency
- Purpose:
  - keep the convenience of inference while reducing ambiguity and surprising behavior in real projects.
- Add:
  - richer CLI output that always shows the source of inferred dev/build commands and targets
  - a clearer explicit-mode path for projects that want to pin `web.dev` and `web.build` early
  - stronger diagnostics for monorepos, wrapper scripts, and repos with multiple candidate frontends
- CLI work:
  - expand `frontron check` so it can explain not just what was inferred, but why
  - add recommendation paths that make it obvious when users should stop relying on inference
- Validation:
  - CLI fixtures for monorepo, wrapper-script, and multi-frontend ambiguity cases
  - docs updates for explicit vs inferred setup guidance

### Workstream 3. Runtime diagnostics and inspectability
- Purpose:
  - reduce the debugging penalty of framework-owned runtime and build staging.
- Add:
  - a first-class way to inspect staged runtime state, generated manifest values, and packaged file layout
  - clearer dev/build logging around manifest paths, staged runtime paths, and loaded config sources
  - stronger packaged-runtime self-checks for missing staged files and mismatched output state
- Guardrails:
  - avoid exposing raw Electron internals as the debugging story
  - keep `.frontron/` as the inspectable framework-owned staging area
- Validation:
  - CLI tests for manifest and staging summaries
  - docs updates that explain how to read `.frontron/` and staged runtime output

### Workstream 4. Runtime extension surface
- Purpose:
  - cover common advanced product needs without collapsing back to template-owned Electron code.
- Add:
  - typed runtime lifecycle hooks such as app-ready, second-instance, deep-link arrival, and window-created hooks
  - a small event-oriented bridge layer for state-change and subscription use cases that do not fit pure request-response calls
  - typed runtime modules for common shell-level behaviors before considering broader raw overrides
- Guardrails:
  - keep raw `preload`, `ipcMain`, `session`, and `webContents` ownership closed by default
  - add module-level surfaces only for recurring product needs, not one-off Electron parity
- Validation:
  - runtime hook tests
  - bridge tests for event subscription and cleanup behavior
  - smoke coverage for at least one lifecycle-driven runtime feature

### Workstream 5. Rust slot DX hardening
- Purpose:
  - reduce the downside of the Rust-only native strategy without changing the strategy itself.
- Add:
  - clearer CLI diagnostics for missing toolchains, missing artifacts, and missing exported symbols
  - better starter docs and examples for apps that stay purely web and apps that opt into Rust later
  - richer native status reporting so users can tell whether failure happened at build time, load time, or binding time
- Validation:
  - CLI tests for each Rust failure class
  - docs guidance for "no Rust", "Rust later", and "Rust enabled" paths

### Workstream 6. Starter diet and migration support
- Purpose:
  - align the starter more closely with the thin framework-first story and reduce perceived lock-in.
- Add:
  - a dependency and file-surface review for the default starter
  - a smaller default starter baseline where richer UI examples move into docs or optional recipes
  - clearer migration guidance for teams that start from manual install and only adopt starter pieces selectively
- Guardrails:
  - do not move runtime/build ownership back into the starter
  - keep the starter output compatible with the same manual-install contract and fixture shape
- Validation:
  - starter contract tests
  - package smoke coverage
  - a documented starter dependency budget and file-surface budget

### Suggested implementation order
1. Workstream 1. Multi-window runtime
2. Workstream 2. Explicit-mode and inference transparency
3. Workstream 3. Runtime diagnostics and inspectability
4. Workstream 4. Runtime extension surface
5. Workstream 5. Rust slot DX hardening
6. Workstream 6. Starter diet and migration support

### Acceptance criteria
- Frontron still supports the current minimal existing-project path with `frontron.config.ts`, `app:dev`, and `app:build`.
- Users can ship more than one meaningful desktop window without forking the framework runtime.
- Inference remains available, but its decisions are inspectable, explainable, and easy to override.
- Framework-owned staging and runtime behavior become easier to debug from Frontron CLI output and docs.
- The Rust-first native path stays optional, diagnosable, and better documented.
- The starter becomes visibly closer to the thin framework-first contract instead of feeling heavier than the product story.
