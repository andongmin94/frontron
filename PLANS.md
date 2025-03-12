# Starter-First Placeholder Cutover Plan

> This file is the active plan for restoring the 0.8.4 / 0.8.5 product feel.
> Keep the changes small, reviewable, and aligned with `specs/framework-first.md`.

## Goal
- Make `create-frontron` the only real product story again.
- Reduce `frontron` to an actual placeholder/init shell package, not just a messaging change.
- Restore the generated starter structure toward the 0.8.4 / 0.8.5 shape with template-owned Electron files.
- Prepare a later pass where `frontron init` copies the minimum Electron source into an existing frontend project.

## Target product shape
- `create-frontron`
  - official starter generator
  - primary onboarding path
  - owns the first-run template UX and starter defaults
- `frontron`
  - actual placeholder/init shell for retrofit work
  - no stable runtime/config/bridge contract
  - long-term role: `frontron init` seeds the minimum Electron source and scripts into a compatible existing web frontend project

## Current mismatch
- README, docs pages, and package descriptions must stop presenting `frontron` as a runtime/framework surface.
- Existing retrofit docs must stop documenting framework-owned runtime/build/config behavior as if it were stable.
- Starter docs and retrofit docs must clearly separate "real starter" from "future retrofit shell".
- Contract tests must stop asserting legacy `frontron` runtime/config/bridge behavior.

## Phases
1. Starter restoration
   - keep `create-frontron` as the real shipped starter story
   - keep generated apps template-owned with `src/electron/*`
2. `frontron` placeholder cutover
   - reduce package exports, build entries, CLI behavior, and tests to placeholder level
   - stop shipping runtime/client/config surface as the public package story
3. Retrofit contract rewrite
   - define what `frontron init` should eventually copy into an existing project
   - lock the interactive prompt flow and the safe default values
   - decide which starter files belong to the default `minimal` preset
   - define `package.json` mutation and conflict rules before implementation
4. Implementation follow-up
   - implement the future `init` copy flow only after the placeholder cutover is stable

## Current slice
- Status: in progress.
- Focus:
  - keep `create-frontron` as the real starter
  - keep `frontron` as a real placeholder/init shell package
  - write down the v1 retrofit contract before shipping any real `init` behavior

## Approved v1 defaults
- supported target:
  - Vite-family projects and compatible web frontends with explicit dev/build scripts
- default Electron directory:
  - `electron/`
- default desktop scripts:
  - `app`
  - `app:build`
- default preset:
  - `minimal`
- default conflict policy:
  - infer first, ask on ambiguity, never overwrite existing scripts or files automatically

## v1 contract summary
- `frontron init` should copy app-owned Electron source into an existing project.
- It should derive those files from the starter, but use trimmed retrofit variants instead of copying the whole starter Electron folder verbatim.
- The default `minimal` preset should focus on:
  - `main.ts`
  - `window.ts`
  - `serve.ts`
  - `tsconfig.electron.json`
  - package metadata and scripts
- The preload bridge remains optional and belongs to a `starter-like` preset, not the default retrofit path.
- `frontron init` must preserve existing web scripts and ask for custom script names when needed.

## Validation
- `cd frontron && npm run build`
- `cd frontron && npm run typecheck`
- `cd frontron && npm test`
- `cd create-frontron && npm run build`
- `cd create-frontron && npm run typecheck`
- `cd create-frontron && npm test`

## Acceptance criteria
- `create-frontron` is clearly the main onboarding product again.
- `frontron` is both described and shipped as a placeholder/init shell, not as a runtime/framework product.
- Root docs, guide docs, package READMEs, package metadata, and contract tests no longer contradict that direction.
- The repo feels like a starter-plus-future-init model, not a framework package with a starter attached.
- The future `frontron init` contract is documented clearly enough that implementation can start from the agreed file set, prompt flow, and conflict policy.
