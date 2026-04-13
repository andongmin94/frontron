# Frontron repository guidance

## Read this first
- Before architecture or implementation work, read `specs/framework-first.md`.

## Product direction
- `create-frontron` is the primary starter/template entrypoint for users.
- `frontron` is a placeholder/init-shell package reserved for the future existing-project retrofit flow.
- Keep the project starter-driven first. Treat retrofit work as planned, not as the main shipped story.

## Architecture rules
- Prefer the starter flow first: `npm create frontron@latest` -> `npm run app` / `npm run build`.
- Keep the starter template Electron-owned: `src/electron/*`, preload bridge on `window.electron`, and packaging in the template app itself.
- `frontron` should not present a stable runtime/build framework contract while it is in placeholder mode.
- Manual install into an existing project is currently a planned retrofit path, not the headline story.
- Do not add new framework-owned runtime surfaces to `frontron` while it is being reduced to an init shell.

## Native strategy
- Native integration for the shipped starter may stay Rust-first when it is part of starter-owned source.
- Keep web/native boundaries explicit in generated starter code.

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
