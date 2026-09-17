# AGENTS.md

`t3code-tui` is an interactive terminal UI plus CLI for T3 Code threads (Bun + TypeScript + React via `@opentui/react`).

## Layout

- `src/cli.ts` — command definitions; thin dispatch over the modules below.
- `src/tui/` — the interactive app: `app.tsx` wires state, `timeline.tsx` / `sidebar.tsx` / `composer.tsx` / `diffpanel.tsx` render panes, `model/` holds pure projection logic (`thread.ts`, `turns.ts`, `activity.ts`, …), `hooks/` shared runtime hooks.
- `src/threads/`, `src/catalog/`, `src/projects/`, `src/handover/` — CLI implementations against the live T3 server.
- `src/tui/render-check.tsx` — snapshot harness: drives the app with a mock client, scripts input, captures char frames. No live terminal needed.
- `upstream/` — read-only T3 Code reference for behavior parity (banner triggers, compaction rules). Verify there before copying desktop behavior — never guess it.

## Workflow

1. Inspect `git status --short --branch` and the files being changed.
2. Keep CLI JSON envelopes backward compatible.
3. Run `bun run check` (typecheck + tests + build) before claiming completion.
4. Extend `render-check.tsx` and `model/*.test.ts` when changing TUI behavior.

## TUI conventions

- New stateful concerns go in `src/tui/hooks/`, not more `useState` in `app.tsx`.
- Every modal renders inside `ModalShell`; notices go through `useToasts`.
- Interactive chrome gets `useHover()` feedback and `selectable={false}`; only readable text stays selectable.

## Boundaries

- Never print or persist T3 bearer tokens (mint via `t3 auth session`, revoke in `finally`).
- Keep local project discovery read-only; fall back to authenticated HTTP when the projection DB/schema is unavailable.
- Pass handover prompts as argv/stdin arrays, never concatenated into shell commands.

## Commands

- Install: `bun install`
- Typecheck, test, build: `bun run check`
- TUI snapshot harness: `bun src/tui/render-check.tsx`
- Diagnose live integration: `t3code --json doctor`
