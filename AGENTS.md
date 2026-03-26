# Frontron repository operating spec

This file is the single root instruction file for Codex.
The repo root was intentionally reset.
Assume older root markdown files may be deleted, stale, or intentionally removed.
Do not rely on `specs/` or on missing root docs.

## Read this first

- `specs/` has been intentionally removed from this repository.
- Do **not** recreate a `specs/` directory unless the user explicitly asks for it.
- Until root docs are restored, treat this file as the root source of truth.
- The current source-of-truth order is:
  1. `docs/guide/framework-first.md`
  2. `docs/ko/guide/framework-first.md`
  3. `docs/guide/support-matrix.md`
  4. `docs/guide/config.md`
  5. `docs/guide/use-bridge.md`
  6. `docs/guide/troubleshooting.md`
  7. `packages/frontron/README.md`
  8. `packages/frontron/package.json`
  9. `packages/create-frontron/package.json`
  10. existing tests and current implementation
- When these disagree:
  - package manifests win for executable facts such as scripts and engine constraints
  - guide pages win for product contract
  - support/config/bridge pages win for Electron surface claims
  - troubleshooting wins for first-run behavior
  - code/tests win over stale prose

## Product identity and non-negotiable rules

- Frontron is a **framework-first desktop app layer for existing web projects**.
- `frontron` is the real product.
- `create-frontron` is a thin starter generator only.
- The existing-project install path is first-class and must remain supported.
- The root `frontron.config.ts` is the official config entrypoint.
- `frontron/` is the app-layer expansion area.
- The public renderer API must remain `frontron/client`.
- Runtime ownership, preload wiring, main-process wiring, staging, and packaging belong to `frontron`, not to starter templates.
- Native integration is Rust-first and the official slot is `frontron/rust`.
- Do **not** reintroduce `window.electron`, preload globals as public API, or the old `src/electron/*` contract.
- Do **not** move Electron core behavior back into templates.
- Prefer typed/config-driven product surfaces over raw pass-through options.
- `docs/maintainer.md` and `docs/ko/maintainer.md` are real docs pages and must be preserved.
- Keep English and Korean user-facing docs aligned when mirrored pages exist.

## Strengths that must be preserved

Do not “improve” the project by weakening the things it already does well.
Preserve these strengths:

- existing-web-project bootstrap via `frontron init`
- `frontron check` as the first-run diagnostic surface
- framework-owned runtime/build/packaging flow
- safe renderer contract through `frontron/client`
- typed `frontron.config.ts` for normal product decisions
- support for existing web stacks through inference plus explicit `web.dev` / `web.build`
- bilingual docs structure and maintainer pages

## Current weak spots and blind spots

These are not optional. Treat them as explicit project concerns.
Do not hide them behind vague docs or broad claims.
Each one must end up as either:
- clearly documented support
- a safe first-class capability
- a guarded opt-in capability
- or an explicit non-goal

### 1) Contract drift after root reset and `specs/` removal

- stale references to removed `specs/` files may still exist
- older root docs may be missing or inconsistent
- the repo must become self-sufficient without `specs/`

### 2) Product and messaging drift

- product positioning must be consistent across docs, package descriptions, and restored root docs
- Node version guidance must be aligned with actual package engines
- root docs should not say one thing while package manifests enforce another

### 3) Electron capability blind spots

Frontron is strong at “web app -> desktop shell”, but weaker or more constrained at raw Electron-style app patterns.
The current blind spots to audit and document are:

- multi-window currently behaves like **named, route-based, lazy singleton windows**, not dynamic runtime window instances
- built-in window APIs are thin compared with raw Electron runtime control
- window content is route-oriented and app-origin oriented by default
- `windows.*.advanced` is intentionally limited and still blocks `webPreferences`, icon wiring, and common typed fields
- runtime-owned security boundaries stay closed by default (`preload`, `contextIsolation`, `nodeIntegration`, raw session ownership)
- overlay, click-through, utility-window, modal/parent-window, and dynamic multi-instance patterns are not clearly covered enough today
- raw Electron migration blockers are not surfaced clearly enough up front

### 4) Trust and operations surface is thin

- root operating docs are missing or incomplete
- security policy, contributing guide, and changelog should exist as durable repo documents
- public trust signals should be stronger and more consistent with the project’s technical maturity

### 5) Proof is weaker than claims in some areas

- support claims should be tied to representative examples or smoke coverage when practical
- docs should distinguish between `Verified`, `Conditional`, and `Experimental`
- support should be described honestly, especially for stacks, multi-window behavior, and advanced Electron use cases

### 6) First-run UX is important enough to treat as product surface

- `frontron check` should stay central
- generic errors should become actionable errors
- the tool should reduce confusion around blank pages, dev server mismatches, ambiguous scripts, and migration blockers

### 7) Internal maintainability matters, but only after contract stability

- large CLI/config/runtime modules should be split gradually
- refactors must preserve behavior unless the task explicitly changes product behavior

## Repository shape policy

- Keep the repo root minimal.
- Root markdown files should generally be limited to:
  - `AGENTS.md`
  - `README.md`
  - `LICENSE.md`
  - `SECURITY.md`
  - `CONTRIBUTING.md`
  - `CHANGELOG.md`
- Do not add new top-level throwaway markdown files for temporary plans or status logs.
- Put user-facing documentation in `docs/`.
- Prefer updating existing docs pages over creating new standalone root markdown files.
- If the contract must grow, extend the framework-first/support/config docs instead of reviving `specs/`.
- Keep docs navigation valid whenever pages move or are renamed.

## Priority order for improvements

Work in this order unless the user explicitly changes it.
Do not start a lower-priority workstream while a higher-priority one is incomplete.
Risky capability expansion must come **after** capability documentation and contract recovery.

### Priority 0 — recover the contract after root reset and `specs/` removal

- remove stale `specs/` references from docs, package READMEs, comments, and internal instructions
- repair dead links caused by deleted root docs or removed `specs/`
- make docs and package docs self-sufficient without deleted files
- restore a minimal root `README.md` that reflects the current product truth
- if `LICENSE.md` is missing, restore the previous MIT license text instead of inventing a new license
- keep the root minimal after restoration

Acceptance criteria:
- no dead `specs/` links remain in maintained docs or root docs
- the root `README.md` does not depend on deleted files
- the docs site still builds
- this file remains the only architecture/operating spec at the root

### Priority 1 — produce an honest Electron capability map

Create or expand docs so a user can answer:
- what Frontron covers today
- what it only partly covers
- what requires guarded extension
- what it intentionally does not support

This workstream must explicitly document:
- the current multi-window model: **named, route-based, lazy singleton windows**
- the current built-in bridge surface for windows
- the current typed window config surface
- the current closed/runtime-owned areas
- the migration fit of raw Electron app patterns

Required output:
- a clear capability matrix or equivalent docs section
- a migration-fit section such as:
  - Good fit
  - Conditional fit
  - Poor fit / currently unsupported
- a plain-language “When Frontron is the wrong tool” section if needed

Must classify at least these app patterns:
- main window + settings/about/help windows
- tray-driven hidden windows
- route-based named extra windows
- child/modal window graphs
- dynamic document windows or multiple instances of the same window kind
- overlay or click-through windows
- remote-content viewer windows
- apps relying on `webviewTag`, `nodeIntegration`, custom `webPreferences`, or direct preload globals

Acceptance criteria:
- the docs no longer overstate Electron coverage
- users can tell whether their app is a good fit before migrating
- multi-window semantics are impossible to misread

### Priority 2 — align product contract and messaging

- use one consistent product sentence across restored root docs, guide docs, and package descriptions
- keep `frontron` positioned as the product and `create-frontron` as a thin generator
- align Node version guidance across docs and package engines, or intentionally raise/lower the manifests together
- make the official contract easy to find from docs landing pages and the restored root README
- preserve bilingual docs structure

Acceptance criteria:
- no visible contradiction between root README, docs, and package descriptions
- Node requirement messaging is consistent with package manifests
- the contract is easy to find without `specs/`

### Priority 3 — decide safe window/runtime expansions

Do **not** blindly widen Frontron into raw Electron.
Start with the smallest high-value additions that still fit the framework-first model.

Safe or likely-safe candidates to evaluate first:
- `getBounds` / `setBounds`
- `getPosition` / `setPosition`
- richer window state reporting
- `setAlwaysOnTop` / `getAlwaysOnTop`
- `setOpacity` / `getOpacity`
- `showInactive`
- better typed helpers for hidden/tray-driven windows

Higher-risk candidates that require explicit design discussion first:
- dynamic runtime-created window instances instead of name-based singletons only
- content source modes beyond `route` such as `url`, `file`, or inline HTML
- click-through APIs such as `setIgnoreMouseEvents`
- parent/modal relationships
- broader runtime lifecycle hooks
- any relaxation involving `webviewTag`, `nodeIntegration`, custom preload exposure, or unsafe defaults

Decision rule:
- add first-class support only when it fits the framework-first contract and benefits more than one migration case
- add guarded opt-in support only when the risk is understood and clearly documented
- reject or explicitly mark as non-goal when the change would mainly turn Frontron into raw Electron pass-through

Acceptance criteria:
- any new window/runtime surface is documented before or alongside code changes
- risky capability expansion never ships silently
- default security boundaries remain intact

### Priority 4 — trust and operations surface

- add `SECURITY.md`
- add `CONTRIBUTING.md`
- add `CHANGELOG.md`
- add or improve issue templates and pull request templates if needed
- replace historical or one-off root files with durable operating docs

Acceptance criteria:
- the root contains durable operating docs instead of temporary planning files
- the repository communicates how to report vulnerabilities, contribute, and read changes

### Priority 5 — proof over claims

- strengthen representative examples and smoke coverage
- reflect support levels honestly in docs
- prefer language like `Verified`, `Conditional`, and `Experimental`
- connect support statements to actual examples or tests where practical
- add at least one representative example for the current multi-window model
- if overlay/click-through support is not truly supported, document that honestly instead of implying coverage

Acceptance criteria:
- examples and tests support the strongest claims in docs
- weakly-supported areas are labeled honestly

### Priority 6 — first-run UX and diagnostics

- improve `frontron check` as the first-run diagnostic surface
- make errors actionable
- prefer “what failed + how to fix it + where to read more” over generic failures
- reduce blank-page and misconfigured-dev-server confusion
- when feasible, surface migration blockers earlier for projects that rely on unsupported Electron patterns

Acceptance criteria:
- common first-run failures point to a concrete fix
- migration blockers are easier to detect before users do heavy manual work

### Priority 7 — CI and release confidence

- move manual release confidence checks into CI where possible
- keep package smoke and release smoke meaningful
- keep the generated starter and packed tarball paths green
- add docs validation and dead-link/stale-reference checks where practical
- do not widen the public package surface unnecessarily

Acceptance criteria:
- important docs and smoke checks can be run automatically
- release confidence relies less on manual memory

### Priority 8 — internal maintainability

- only after the user-facing contract and trust surface are stable
- split oversized CLI/config/runtime modules gradually
- keep refactors behavior-preserving unless the task explicitly includes product changes
- add or extend tests during refactors

Acceptance criteria:
- internal splits improve maintainability without changing the public contract accidentally

## Required documentation additions

These additions are strongly preferred unless equivalent content already exists in a better place:

- a clear capability matrix for Electron/window coverage
- a migration-fit guide for raw Electron apps
- an explicit note that the current multi-window slice is named-singleton-based
- a “known limitations” or “not currently supported” section for advanced Electron cases
- root `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `CHANGELOG.md`

## ChatView-style migration rule

Treat overlay-controller apps as an archetype when assessing blind spots.
Do not hard-code the external project into the public contract, but make sure the docs and capability audit account for apps that need:

- transparent frameless windows
- always-on-top utility windows
- click-through behavior
- bounds persistence and restoration
- more than one window of the same kind
- remote content or embedded viewer-style content
- modal/parent relationships
- webview-dependent or custom-webPreferences behavior

If Frontron cannot support one of these safely today, say so clearly.
Do not imply support by silence.

## What not to do

- do not recreate `specs/`
- do not create a second architecture source of truth outside docs + this file
- do not move runtime/build responsibility into starter templates
- do not reintroduce legacy renderer globals
- do not silently widen raw Electron or raw electron-builder escape hatches
- do not ship unsafe defaults just to satisfy a single migration case
- do not claim overlay/dynamic multi-window support unless it is actually implemented and documented
- do not delete maintainer docs
- do not leave English and Korean docs mismatched when a mirrored page exists and the change is user-facing
- do not add new top-level temporary markdown files
- do not change the project license text unless the user explicitly asks
- do not update GitHub About text from inside the repo and pretend it is handled; call it out as a manual follow-up if needed

## Working style

- Start with the highest-priority unfinished workstream.
- Make small, reviewable changes.
- Stay inside the requested workstream.
- Prefer finishing one coherent slice over partially touching many areas.
- Update docs and tests in the same pass when behavior changes.
- Prefer extending existing tests over adding disconnected tests.
- When a public guide page changes and a Korean counterpart exists, update both in the same pass.
- If a manual follow-up is needed outside the repo, call it out explicitly instead of pretending it was handled.
- If a capability is not ready to ship, document the limitation instead of stretching the implementation.

## Validation policy

Run the smallest relevant validation set that still proves the change.
When package code changes, do not stop at docs-only validation.

### Global hygiene

When contract/docs cleanup work is involved, also check for stale references to removed files:

- search for `specs/` references and remove or replace them
- search for dead links to deleted root files
- keep docs navigation valid

### Docs

Run when docs or navigation change:

- `cd docs && npm run docs-build`

### `packages/frontron`

Run these when CLI, runtime, config, bridge, packaging, or public API behavior changes:

- `cd packages/frontron && npm run build`
- `cd packages/frontron && npm run typecheck`
- `cd packages/frontron && npm test`

Also run this when packaging or release-facing behavior changes:

- `cd packages/frontron && npm run test:package-smoke`

### `packages/create-frontron`

Run these when the generator, template, starter contract, or release flow changes:

- `cd packages/create-frontron && npm run build`
- `cd packages/create-frontron && npm run typecheck`
- `cd packages/create-frontron && npm test`

Also run these when release/starter smoke behavior is affected:

- `cd packages/create-frontron && npm run test:release-smoke`
- `cd packages/create-frontron && npm run release:verify`

Run the broader matrix only when support claims, representative stacks, or generator/release behavior materially change:

- `cd packages/create-frontron && npm run release:matrix-smoke`

Do **not** run publish commands unless the user explicitly asks for a release.

## Default first task from the current state

If no narrower task is given, start here:

1. remove stale `specs/` references and repair dead links caused by root reset
2. restore a minimal root `README.md` and `LICENSE.md`
3. make docs and package docs self-sufficient without deleted files
4. add or expand a capability matrix for Electron/window coverage
5. document current multi-window semantics and raw Electron migration blockers honestly
6. then move to `SECURITY.md`, `CONTRIBUTING.md`, and `CHANGELOG.md`

Do **not** jump straight into risky multi-window or overlay implementation before the capability map exists.

## Required completion format

At the end of every non-trivial task, report:

- summary of what changed
- files changed
- commands run
- results of those commands
- remaining risks or manual follow-ups
- the next recommended step based on the priority order above
