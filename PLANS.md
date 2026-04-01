# CLI And Starter Restoration Plan

> This file is the active plan for restoring the 0.8.4 / 0.8.5 product feel.
> Keep the changes small, reviewable, and aligned with `specs/framework-first.md`.

## Goal
- Make `create-frontron` the main product story again.
- Reposition `frontron` as the CLI/runtime support package behind the starter and compatible manual setups.
- Restore the repo tone from "framework-first product" to "starter/template plus CLI support" without blindly hard-resetting the codebase.
- Restore the generated starter structure toward the 0.8.4 / 0.8.5 shape when the user explicitly asks for template-owned Electron files again.

## Target product shape
- `create-frontron`
  - official starter generator
  - primary onboarding path
  - owns the first-run template UX and starter defaults
- `frontron`
  - support CLI and runtime/build helper package
  - provides `frontron dev`, `frontron build`, `frontron check`, `defineConfig`, and `frontron/client`
  - stays installable for compatible manual setups, but manual install is now a secondary path

## Current mismatch
- README, docs landing pages, and package descriptions still sell Frontron as the real framework product.
- Specs and plans still assume the framework-first migration is the direction to keep expanding.
- Starter docs still present `create-frontron` as secondary.
- Contract tests still assert framework-first wording.

## Phases
1. Contract reset
   - update `AGENTS.md`, `specs/framework-first.md`, and `PLANS.md`
   - define the new positioning clearly before broader edits
2. Product messaging reset
   - update root README, docs landing pages, guide landing pages, and package descriptions
   - make `create-frontron` the default entrypoint again
3. Starter and package docs reset
   - rewrite package READMEs and starter README text
   - keep `frontron` described as support CLI/runtime, not the headline framework
4. Test alignment
   - update contract tests and starter-readme assertions to match the restored direction
5. Optional deeper cleanup
   - evaluate whether any implementation surface should later be pruned or renamed
   - do this only after the messaging and contract are stable
6. Structural restoration when requested
   - move generated starter ownership back toward `src/electron/*`, template-local preload/main wiring, and template-owned packaging scripts
   - strip hardcoded Frontron branding from generated template metadata where feasible
   - keep this as an explicit follow-on step, not an accidental side effect of messaging work

## Current slice
- Status: in progress.
- Focus:
  - restore the repo-level product story
  - keep visible docs and package metadata consistent
  - avoid a destructive git reset while the worktree is already dirty

## Validation
- `cd docs && npm run docs-build`
- `cd packages/frontron && npm run build`
- `cd packages/frontron && npm run typecheck`
- `cd packages/frontron && npm test`
- `cd packages/create-frontron && npm run build`
- `cd packages/create-frontron && npm run typecheck`
- `cd packages/create-frontron && npm test`

## Acceptance criteria
- `create-frontron` is clearly the main onboarding product again.
- `frontron` is described consistently as the support CLI/runtime package.
- Root docs, guide docs, package READMEs, package metadata, and contract tests no longer contradict that direction.
- The repo feels closer to 0.8.5 in messaging and starter emphasis, without requiring a hard reset.
