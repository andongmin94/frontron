# Beginner-Focused Docs Expansion Design

Date: 2026-03-19
Status: Approved for planning

## Summary

Expand the `docs/` site so a first-time Frontron user can go from zero to a generated build and packaged output without reading source code first. The docs should use a tutorial-first structure, explain why each step matters, and stay aligned with the actual generated template.

This work includes limited code consistency fixes in the template where current documentation and runtime behavior diverge enough to confuse a beginner.

## User And Goal

### Primary user

A first-time Frontron user who wants to:

1. install prerequisites,
2. create a new project,
3. run it locally,
4. customize visible app basics such as name and icon,
5. build it, and
6. understand the generated packaging output.

### Success outcome

After reading the docs, the user can produce a packaged output from a newly created project and understand which files they changed to get there.

## Problems In The Current State

### Docs problems

- The docs are too small for a first-time user journey.
- The current guide explains features and settings, but not a complete beginner path.
- Important beginner tasks such as app renaming, icon replacement, build output inspection, and packaging expectations are underexplained.
- The existing information is not structured as a guided tutorial sequence.

### Product-doc alignment problems

- The docs reference `window.electron.invoke`, but the current preload bridge does not expose a matching `invoke` helper.
- The current `TitleBar` component expects an `invoke` API and an unsubscribe-style `on` contract that the preload bridge does not provide.
- The sample `App.tsx` currently emphasizes direct `process` access, which conflicts with the docs' security explanation and is not the best beginner mental model.
- The template `vite.config.ts` contains rough syntax that should be stabilized before docs encourage users to build and package the template confidently.

## In scope

- Rewrite the docs around a tutorial-first path for beginners.
- Add a short quick-start page that gets users to their first successful build output.
- Add detailed step-by-step tutorial pages for the same journey.
- Restructure the VitePress sidebar so tutorial flow is obvious.
- Improve the tone so each step explains both what to do and why it matters.
- Fix template/documentation mismatches that block or confuse the beginner flow.
- Verify the docs build, CLI tests pass, and a generated template can build successfully.

## Out of scope

- Contributor documentation for repository development workflows.
- Deep API reference for advanced Electron customization.
- Adding new end-user product features unrelated to docs clarity.
- Reworking the visual identity of the docs site.

## Information Architecture

The docs should move from a thin reference structure to a guided learning structure.

### Top-level structure

- Home
- Quick Start
- Step-by-step Tutorials
- Reference
- Project Info

### Planned pages

#### Home

Keep the home page short and promise the outcome clearly:

- what Frontron is,
- who it is for,
- what stack it generates,
- how quickly a user can get to a working packaged desktop app.

Primary call to action should point to `Quick Start`.

#### Quick Start

One compact tutorial that covers the full happy path:

1. prerequisite check,
2. project creation,
3. install dependencies,
4. local run,
5. basic customization,
6. build,
7. packaged output inspection.

This page is the first-time user's shortest route to success.

#### Step-by-step Tutorials

Break the same flow into readable pages:

- Create a project
- Run in development
- Change app name and icon
- Understand the generated Electron pieces
- Build and package
- Inspect packaged output
- Troubleshooting

Each page should include:

- what the step changes,
- which file or command to use,
- what the user should expect to see,
- common mistakes for that step.

#### Reference

Retain and tighten the current feature/config material, but make it secondary to tutorials. The reference should answer targeted questions after the user completes the guided path.

## Writing Style

The docs should explicitly optimize for reader care.

### Tone requirements

- Assume the reader is capable but unfamiliar with Frontron.
- Prefer plain Korean explanations over terse shorthand.
- Explain why a file matters before telling the user to edit it.
- Avoid unexplained jargon where a beginner would stop reading.
- Use reassuring but concrete phrasing such as:
  - what you are changing,
  - why the project uses this file,
  - what happens after you save or run the command.

### Tutorial content requirements

- Commands should be copy-pasteable.
- File paths should be concrete.
- Explanations should connect UI-visible results to source files.
- Packaging sections should explain what `dist/`, `dist/electron/`, and `output/` mean.
- Customization sections should explain why `public/icon.ico`, `build.productName`, and `build.appId` matter separately.
- App naming sections should distinguish between packaging metadata and visible UI text, including the template title bar text where relevant.
- Packaging sections should explain that generated outputs can differ by operating system and build target.

## Template Consistency Fixes

These fixes are part of the work because the docs otherwise risk teaching behavior that the template does not actually support.

### Preload bridge

Update the preload bridge to expose a clean beginner-facing API shape that matches the docs:

- `send(channel, data?)`
- `invoke(channel, ...args)`
- `on(channel, listener)` returning an unsubscribe function

The public contract must be simple enough to document once and reuse across tutorial pages.

### TitleBar

Update `TitleBar` so it uses the actual preload contract and remains a correct example of window control wiring.

The beginner docs for renaming the app should treat `TitleBar.tsx` as part of visible UI customization when appropriate, instead of implying that `package.json` metadata alone changes all visible names.

### App sample

Replace the current `process`-centric sample with an example that reinforces the intended bridge model. The starter app should help users understand that Electron capabilities are reached through the preload-exposed API, not direct renderer-side Node access.

### Vite config stabilization

Clean up the template Vite config so the default generated app is dependable for the documented build path.

## Detailed Doc Changes

### Existing files to rewrite

- `docs/index.md`
- `docs/guide/index.md`
- `docs/guide/features.md`
- `docs/guide/config.md`
- `docs/.vitepress/config.ts`

### New tutorial files to add

Planned as a tutorial sequence under `docs/guide/`:

- project creation
- development run
- customization basics
- build and package
- output inspection
- troubleshooting

Exact filenames can be finalized during implementation, but they should support a clear linear sidebar order.

## Verification Requirements

Do not call the work complete unless all of the following are checked:

1. Docs build succeeds with VitePress.
2. CLI tests pass in `packages/create-frontron`.
3. A project can be generated from the CLI locally.
4. The generated project can run its build successfully.
5. The documented packaging/output paths match the actual generated output.
6. The docs correctly describe platform-specific packaging expectations for the environment used during verification.

## Risks And Mitigations

### Risk: docs become more polished than the template

Mitigation:
Bundle the minimal consistency fixes into the same change set so the beginner journey matches reality.

### Risk: too much information on the first page

Mitigation:
Use a short quick-start for immediate success, then place deeper explanations into later tutorial pages.

### Risk: tutorial flow drifts from actual commands

Mitigation:
Verify by generating a fresh project during completion checks and using that run as the source of truth.

## Non-Goals For This Round

- Full contributor guide for this repository
- Advanced multi-window architecture guide
- Auto-update integration guide
- Cross-platform release process beyond explaining the default generated outputs

## Acceptance Criteria

The design is satisfied when:

- the docs clearly support a first-time user through build and packaged output generation,
- the sidebar reflects a guided tutorial flow,
- the template APIs shown in docs match the generated code,
- the sample app reinforces the documented mental model,
- verification proves the documented beginner path works end to end.
