# AGENTS.md

`t3code-tui` is an interactive terminal UI plus CLI for T3 Code threads (Bun + TypeScript + React via `@opentui/react`).

## Layout

- `src/types.ts`, `src/errors.ts`, `src/config.ts` — shared kernel at the root, imported by both `cli/` and `tui/` (never the reverse).
- `src/cli/` — everything CLI/backend-only: `index.ts` (command definitions; thin dispatch over the modules below), `output.ts`, `doctor.ts`, and `catalog/`, `handover/`, `infra/`, `projects/`, `shared/`, `testing/`, `threads/` implementations against the live T3 server. Each has its own `tests/` subfolder.
- `src/tui/` — the interactive app:
  - `app/` — the root component: `app.tsx` wires hooks together and holds root identity/picker-orchestration state, `hooks/` for cross-cutting hooks used by `app.tsx` but not owned by one feature (`useThreadCreation`, `useThreadOps`, `useQuitConfirm`), plus `utils.ts` / `constants.ts`.
  - `features/` — one folder per feature pairing its component with its hook: `sidebar/`, `composer/`, `timeline/`, `diffpanel/`, `taskspanel/`, `answerpanel/`, `pickers/`.
  - `ui/` — generic presentational primitives with no feature-specific state: `hoverbutton.tsx`, `modalshell.tsx`, `renamemodal.tsx`, `contextusagecard.tsx`, `attachmentstrip.tsx`, `backdrop.tsx`, `theme.ts`.
  - `model/` — pure projection logic (`thread.ts`, `turns.ts`, `activity.ts`, …), genuinely cross-cutting across features.
  - `hooks/` — shared runtime hooks used across features (`useToasts`, `useClipboard`, `useHover`, `useAnimTick`).
  - `render-check/` — snapshot harness: `fixtures.ts` (mock client/builders), `helpers.ts`, `scenarios/*.ts` (one file per feature area); `render-check.tsx` at the top level is the slim orchestrator that runs them in sequence against a mock client with scripted input and captures char frames. No live terminal needed.
- `upstream/` — read-only T3 Code reference for behavior parity (banner triggers, compaction rules). Verify there before copying desktop behavior — never guess it.

## Workflow

1. Inspect `git status --short --branch` and the files being changed.
2. Keep CLI JSON envelopes backward compatible.
3. Run `bun run check` (typecheck + tests) before claiming completion.
4. Extend `render-check.tsx`'s scenarios and `model/*.test.ts` when changing TUI behavior.

## TUI conventions

- New feature-specific state goes in that feature's own hook under `src/tui/features/<feature>/`; cross-cutting state that a single feature can't own goes in `src/tui/app/hooks/`. Shared, stateless-ish runtime hooks live in `src/tui/hooks/`. Avoid adding more raw `useState` to `app.tsx` itself.
- Every modal renders inside `ModalShell`; notices go through `useToasts`.
- Interactive chrome gets `useHover()` feedback and `selectable={false}`; only readable text stays selectable.

## Boundaries

- Never print or persist T3 bearer tokens (mint via `t3 auth session`, revoke in `finally`).
- Keep local project discovery read-only; fall back to authenticated HTTP when the projection DB/schema is unavailable.
- Pass handover prompts as argv/stdin arrays, never concatenated into shell commands.

## Commands

- Install: `bun install`
- Typecheck and test: `bun run check`
- TUI snapshot harness: `bun src/tui/render-check.tsx`
- Diagnose live integration: `t3code --json doctor`
