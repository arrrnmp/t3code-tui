# AGENTS.md

`moxen` (command: `moxen`) is an interactive terminal UI plus CLI for coding-agent threads, running `claude`, `codex`, `grok` and `opencode` directly (Bun + TypeScript + React via `@opentui/react`). See `ARCHITECTURE.md` for the runtime rules (who owns a provider session, in-process vs shared server, what a turn records) and what is not built yet.

## Layout

The tree is **one core, several clients**.

`core/` imports no client — that invariant holds and is worth keeping
(a contract test asserting a client can read core's output belongs on
the client side, as `tui/model/tests/toolactivity.test.ts` does).

The shared kernel (`core/types.ts`, `core/errors.ts`, `core/config.ts`,
`core/mcp.ts`, and pure rules like `catalog/selection.ts` and
`threads/views.ts`) is common vocabulary and imported freely.
The reverse now holds too, apart from the shared kernel: both clients go
through `server/` (`ClientApi`) for every operation, `doctor` included
(it is a server query). `src/tests/layering.test.ts` pins this, with no
exceptions.

- `src/core/` — the domain, with no opinion about how it is driven:
  `providers/` (the four driver implementations + `spi.ts`), `threads/`
  (store, lifecycle, turn runner, tool-activity mapping, read views, and
  `operations.ts` — handover, delegation, send policies — that every
  client calls), `projects/` (registry + workspace resolution),
  `checkpoints/`, `usage/`, `events/`, `catalog/`, plus the shared kernel
  `types.ts` / `errors.ts` / `config.ts`. Each area keeps its own `tests/`.
- `src/server/` — the boundary: `api.ts` is `ClientApi`, the typed
  contract every frontend talks through (`dispatch` for commands, `query`
  for reads, `subscribeShell`, `subscribeThread`, `turnDiff`,
  `getConfig`); `protocol.ts` holds the command/query/frame shapes and
  their runtime decoders; `connection.ts` is the in-process implementation
  over `core/`; `transport/` serves it over a named pipe / unix socket
  (`serve.ts`) and implements it remotely (`remote.ts`); `client.ts` picks
  one per `MOXEN_SERVER` (`direct` | `auto` | `daemon`); `main.ts` is the
  server process; `mcp/` is the `moxen` MCP server every top-level provider
  session gets (`delegate` / `task_status` / `task_cancel`, over `ClientApi`).
  **New frontend surface goes here, not into a client.**
- `src/cli/` — a client: `index.ts` (command definitions; thin dispatch
  over the modules below), `output.ts`, `doctor.ts`, and `catalog/`,
  `handover/`, `infra/` (`client.ts` — the CLI's `ClientApi`), `projects/`,
  `threads/` — flags, prompts and `--json` envelopes over `ClientApi`;
  `tests/envelopes/` pins every envelope byte-for-byte.
  Each has its own `tests/` subfolder.
- `src/tui/` — a client, the interactive app:
  - `app/` — the root component: `app.tsx` wires hooks together and holds root identity/picker-orchestration state, `hooks/` for cross-cutting hooks used by `app.tsx` but not owned by one feature (`useThreadCreation`, `useThreadOps`, `useQuitConfirm`), plus `utils.ts` / `constants.ts`.
  - `features/` — one folder per feature pairing its component with its hook: `sidebar/`, `composer/`, `timeline/`, `diffpanel/`, `taskspanel/`, `answerpanel/`, `pickers/`.
  - `ui/` — generic presentational primitives with no feature-specific state: `hoverbutton.tsx`, `modalshell.tsx`, `renamemodal.tsx`, `contextusagecard.tsx`, `attachmentstrip.tsx`, `backdrop.tsx`, `theme.ts`.
  - `model/` — pure projection logic (`thread.ts`, `turns.ts`, `activity.ts`, …), genuinely cross-cutting across features.
  - `hooks/` — shared runtime hooks used across features (`useToasts`, `useClipboard`, `useHover`, `useAnimTick`).
  - `render-check/` — snapshot harness: `fixtures.ts` (mock client/builders), `helpers.ts`, `scenarios/*.ts` (one file per feature area); `render-check.tsx` at the top level is the slim orchestrator that runs them in sequence against a mock client with scripted input and captures char frames. No live terminal needed.
- `upstream/` — read-only depth-1 clones of the reference implementations we check behavior against (OpenCode's plugin/loader contracts, compaction rules). Gitignored. Verify there before copying upstream behavior — never guess it.

## Workflow

1. Inspect `git status --short --branch` and the files being changed.
2. Keep CLI JSON envelopes backward compatible. `src/cli/tests/envelopes/` pins every one byte-for-byte, in-process and over the wire; update a golden only for an intended change, and say so.
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
- Diagnose live integration: `moxen --json doctor`
- Shared server (every client reaches every live session; turns outlive the client): `moxen server start|status|stop`, or `MOXEN_SERVER=daemon` to autostart
