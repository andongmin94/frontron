# Frontron repository guidance

## Read this first
- Before architecture or implementation work, read `specs/framework-first.md`.

## Product direction
- `create-frontron` is the primary starter/template entrypoint for users.
- `frontron` is the CLI/runtime support package used by generated starters and compatible manual setups.
- Keep the project starter-driven, CLI-assisted, and config-driven.

## Architecture rules
- Prefer the starter flow first: `npm create frontron@latest` -> `npm run app:dev` / `npm run app:build`.
- Keep `frontron.config.ts` as the official config entrypoint.
- Keep `frontron/` as the expansion area for app-layer modules.
- Manual install into an existing project may stay supported, but it is no longer the headline story.
- Do not move raw Electron core back into copied template files unless the task explicitly requires it.
- Do not reintroduce public `window.electron` style renderer globals as the main contract.
- Keep `frontron/client` as the supported renderer-facing desktop API.

## Native strategy
- Native integration stays Rust-first.
- Treat `frontron/rust` as the first-class Rust slot.
- Web code must not directly load native modules; go through the Frontron bridge.

## Working style
- Keep changes small and reviewable.
- Update docs when user-facing behavior changes.
- Add tests or fixtures when behavior changes.
- For large refactors, create or update `PLANS.md` before implementation.
- Summarize changed files, validation steps, and follow-up tasks at the end.

## Execution plans

When a task references `PLANS.md`, read it before making changes.

For any multi-file, multi-step, or architecture-affecting task:
- follow the priority order in `PLANS.md`
- do not start a lower-priority workstream while a higher-priority one is incomplete
- make small, reviewable changes
- when behavior changes, update docs and tests in the same pass
- run relevant validation commands before finishing
- end with: files changed, commands run, results, remaining risks, and the next recommended step
