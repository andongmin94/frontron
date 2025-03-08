# Frontron repository guidance

## Read this first
- Before architecture or implementation work, read `specs/framework-first.md`.

## Product direction
- `frontron` is the real product.
- `create-frontron` is a thin starter generator only.
- Keep the project framework-first and config-driven.

## Architecture rules
- Users must be able to install `frontron` into an existing web project, add `frontron.config.ts`, and run/build the desktop app without `create-frontron`.
- Do not keep runtime/build ownership inside templates.
- Do not add new Electron core logic to starter templates.
- `frontron.config.ts` is the official config entrypoint.
- `frontron/` is the expansion area for app-layer modules.

## Native strategy
- Native integration is Rust-only.
- Treat `frontron/rust` as the first-class Rust slot.
- Web code must not directly load native modules; go through Frontron bridge APIs.

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