# AGENTS.md

`monvex` (command: `mvx`) is an interactive terminal UI plus CLI for coding-agent threads, running `claude`, `codex`, `grok` and `opencode` directly (Bun + TypeScript + React via `@opentui/react`). There is no T3 Code server; see `DECOUPLE.md`.

## Layout

The tree is **one core, several clients**.

`core/` imports no client — that invariant holds and is worth keeping
(a contract test asserting a client can read core's output belongs on
the client side, as `tui/model/tests/toolactivity.test.ts` does).

The reverse is partial, honestly: the shared kernel (`core/types.ts`,
`core/errors.ts`, `core/config.ts`) is common vocabulary and imported
freely. Beyond it, the TUI goes through `server/` — but **the CLI still
drives `core/` directly**, ~56 imports' worth. Routing it through
`ClientApi` too is the next step, not a thing this layout already did.

- `src/core/` — the domain, with no opinion about how it is driven:
  `providers/` (the four driver implementations + `spi.ts`), `threads/`
  (store, lifecycle, turn runner, tool-activity mapping), `projects/`,
  `checkpoints/`, `usage/`, `events/`, `catalog/`, plus the shared kernel
  `types.ts` / `errors.ts` / `config.ts`. Each area keeps its own `tests/`.
- `src/server/` — the boundary: `api.ts` is `ClientApi`, the five-method
  contract every frontend talks through (`dispatch`, `subscribeShell`,
  `subscribeThread`, `turnDiff`, `getConfig`); `connection.ts` is the
  in-process implementation over `core/`. A transport-backed one (socket
  or stdio, for an out-of-process app) implements the same interface.
  **New frontend surface goes here, not into a client.**
- `src/cli/` — a client: `index.ts` (command definitions; thin dispatch
  over the modules below), `output.ts`, `doctor.ts`, and `catalog/`,
  `handover/`, `infra/`, `projects/`, `shared/`, `testing/`, `threads/`.
  Each has its own `tests/` subfolder.
- `src/tui/` — a client, the interactive app:
  - `app/` — the root component: `app.tsx` wires hooks together and holds root identity/picker-orchestration state, `hooks/` for cross-cutting hooks used by `app.tsx` but not owned by one feature (`useThreadCreation`, `useThreadOps`, `useQuitConfirm`), plus `utils.ts` / `constants.ts`.
  - `features/` — one folder per feature pairing its component with its hook: `sidebar/`, `composer/`, `timeline/`, `diffpanel/`, `taskspanel/`, `answerpanel/`, `pickers/`.
  - `ui/` — generic presentational primitives with no feature-specific state: `hoverbutton.tsx`, `modalshell.tsx`, `renamemodal.tsx`, `contextusagecard.tsx`, `attachmentstrip.tsx`, `backdrop.tsx`, `theme.ts`.
  - `model/` — pure projection logic (`thread.ts`, `turns.ts`, `activity.ts`, …), genuinely cross-cutting across features.
  - `hooks/` — shared runtime hooks used across features (`useToasts`, `useClipboard`, `useHover`, `useAnimTick`).
  - `render-check/` — snapshot harness: `fixtures.ts` (mock client/builders), `helpers.ts`, `scenarios/*.ts` (one file per feature area); `render-check.tsx` at the top level is the slim orchestrator that runs them in sequence against a mock client with scripted input and captures char frames. No live terminal needed.
- `upstream/` — read-only depth-1 clones of T3 Code and OpenCode, kept for behavior parity (banner triggers, compaction rules, plugin/loader contracts). Gitignored. Verify there before copying upstream behavior — never guess it.

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

- Never print or persist provider credentials. Provider CLIs own their own logins; we only ever observe credential *presence*.
- Keep local project discovery read-only; fall back to authenticated HTTP when the projection DB/schema is unavailable.
- Pass handover prompts as argv/stdin arrays, never concatenated into shell commands.

## Commands

- Install: `bun install`
- Typecheck and test: `bun run check`
- TUI snapshot harness: `bun src/tui/render-check.tsx`
- Diagnose live integration: `mvx --json doctor`
