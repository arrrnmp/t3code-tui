# Reorganize t3code-tui into cli/ and tui/, with per-feature test folders

## Context

The codebase grew as one flat `src/` tree: CLI-only modules (`catalog/`, `handover/`, `infra/`, `projects/`, `shared/`, `testing/`, `threads/`, `cli.ts`, `output.ts`, `doctor.ts`) sit beside the TUI (`tui/`), tests sit flat next to their source files, and `src/tui/app.tsx` (2935 lines) and `src/tui/render-check.tsx` (1323 lines) have grown into monoliths — the project's own `AGENTS.md` already says new stateful concerns should go into `src/tui/hooks/` rather than more `app.tsx` state, this plan is executing that stated direction rather than inventing a new one. Goal: a clean cli/tui split, tests grouped per feature, and the two monoliths broken into feature-scoped files — with **zero behavior change**. Everything here is a pure move/extract; nothing about what the app does should differ.

Decisions already locked in with the user:
- `types.ts`, `errors.ts`, `config.ts` stay at `src/` root as a small shared kernel (both `cli/` and `tui/` import from there) — confirmed nothing under `tui/` is ever imported back by the cli-side modules, so this really is a one-way dependency (cli/infra/catalog/etc. → kernel ← tui), not a cycle.
- Tests move into a `tests/` subfolder inside each feature directory (e.g. `src/cli/catalog/tests/catalog.test.ts`), not a parallel top-level `tests/` tree.
- `app.tsx` and `render-check.tsx` do get split, via **custom hook extraction** (app.tsx) and **scenario-function extraction** (render-check.tsx) — both are additive/mechanical moves, not rewrites.
- The `bun run build` script was deliberately removed (no build step needed) — `check` should stop calling it, and nothing in this plan reintroduces a build step or changes `bin` semantics for that reason.

## Phase A — Split `src/` into `src/cli/` and `src/tui/`

Move (git mv, preserving history) everything that's CLI/backend-only under `src/cli/`:

- `src/cli.ts` → `src/cli/index.ts` (mirrors `src/tui/index.tsx` as the package's other entrypoint)
- `src/output.ts` → `src/cli/output.ts`
- `src/doctor.ts` → `src/cli/doctor.ts`
- `src/catalog/` → `src/cli/catalog/`
- `src/handover/` → `src/cli/handover/`
- `src/infra/` → `src/cli/infra/`
- `src/projects/` → `src/cli/projects/`
- `src/shared/` → `src/cli/shared/` (this is CLI-only selection-parsing logic today — confirmed via import graph, nothing in `tui/` touches it)
- `src/testing/` → `src/cli/testing/` (the `harness.ts` mock-process helper is only used by cli-side `*.test.ts` today)
- `src/threads/` → `src/cli/threads/`

Stays put: `src/types.ts`, `src/errors.ts`, `src/config.ts`, `src/tui/`.

Follow-up edits this move requires:
- Every relative import crossing the new boundary needs its path fixed (mechanical — `../errors.js` inside e.g. `src/cli/catalog/catalog.ts` still resolves correctly since it stays one level under `src/cli/`, but anything that used to say `../types.js` from directly under `src/` — i.e. old `src/cli.ts`, `src/output.ts`, `src/doctor.ts` — now needs `../../types.js` from `src/cli/index.ts` etc. since they moved one level deeper).
- `package.json`: `"bin": { "t3code": "dist/cli.js" }` → `"dist/cli/index.js"`; drop `"build"` from `scripts.check` (already gone per your last message — just don't reintroduce it).
- `README.md`: two literal path references to `src/cli.ts` (the shell alias example and the cron example) → `src/cli/index.ts`.
- `AGENTS.md`: rewrite the "Layout" section to describe the new tree (this is the most important doc to get right — it's the map future work will use).
- `tsconfig.json` / `tsconfig.test.json`: no change needed — `rootDir`/`outDir`/`include` globs are already recursive over `src/**`.
- `vitest.config.ts`: no change needed — `include: ["src/**/*.test.ts"]` already matches files at any depth.

## Phase B — Tests into per-feature `tests/` folders

For every directory (on both the cli and tui side) that has a flat `foo.test.ts` beside `foo.ts`, move it to `<dir>/tests/foo.test.ts`. This is a straight `git mv`, no import rewrites needed beyond the test file's own relative imports (which shift by one extra `../`).

Representative examples (apply the same pattern everywhere a `*.test.ts` exists):
- `src/cli/catalog/catalog.test.ts` → `src/cli/catalog/tests/catalog.test.ts` (same for `permissions.test.ts`)
- `src/cli/handover/handover.test.ts` → `src/cli/handover/tests/handover.test.ts`
- `src/cli/threads/threads.test.ts` → `src/cli/threads/tests/threads.test.ts`
- `src/cli/infra/{toolInputs,workspace}.test.ts` → `src/cli/infra/tests/`
- `src/config.test.ts` → `src/tests/config.test.ts` (root kernel gets its own root-level `tests/`)
- `src/tui/model/*.test.ts` (15 files: activity, attachments, clipboard, display, externalEditor, filecache, gitdiff, message, modalDismiss, patch, shell, sidebar, skills, terminalClipboard, thread, turns) → `src/tui/model/tests/*.test.ts`
- `src/tui/backdrop.test.ts` → moves alongside `backdrop.tsx` per Phase C's destination (see below)

No vitest/tsconfig config changes needed here either (same reasoning: globs are recursive).

## Phase C — Reorganize `src/tui/` internals into feature folders

`src/tui/model/`, `src/tui/hooks/`, `src/tui/client/` stay exactly where they are — they're genuinely cross-cutting (e.g. `model/turns.ts` and `model/thread.ts` are each used by 3-4 different components; `model/modalDismiss.ts` by 6). Splitting them apart would scatter shared domain logic for no benefit; they just gain `tests/` subfolders per Phase B.

New `src/tui/features/` groups the components that Phase D will pair with an extracted hook:
- `src/tui/features/sidebar/` — `sidebar.tsx`, new `useSidebar.ts` (from app.tsx)
- `src/tui/features/composer/` — `composer.tsx`, new `useComposer.ts`
- `src/tui/features/timeline/` — `timeline.tsx` (no dedicated hook; it's a read-only render of `groups`)
- `src/tui/features/diffpanel/` — `diffpanel.tsx`, new `useDiffPanel.ts`
- `src/tui/features/taskspanel/` — `taskspanel.tsx`, new `useTasksPanel.ts`
- `src/tui/features/answerpanel/` — `answerpanel.tsx`, new `useAnswerFlow.ts`
- `src/tui/features/pickers/` — `pickermodal.tsx`, new `useProviderCatalog.ts` + `usePickerOrchestration.ts`

`src/tui/ui/` for the generic presentational primitives with no feature-specific state: `hoverbutton.tsx`, `modalshell.tsx`, `renamemodal.tsx`, `contextusagecard.tsx`, `attachmentstrip.tsx`, `backdrop.tsx` (+ its `tests/backdrop.test.ts`), `theme.ts`.

`src/tui/app/` for the root component itself: `app.tsx` (slimmed by Phase D), new `hooks/` subfolder for the cross-cutting hooks that don't belong to one feature (see Phase D), `utils.ts` (`scrollPane`, `threadTitle`, `clock`), `constants.ts` (`SIDEBAR_WIDTH`, `CHAT_GUTTER`, etc.).

`src/tui/render-check/` replaces the flat 1323-line script (Phase E). `src/tui/index.tsx` and `src/tui/opentui-augment.d.ts` stay at the top level (entrypoint and ambient types respectively).

## Phase D — Split `app.tsx` via custom-hook extraction

Ran a full structural pass over `app.tsx` first (state/effects/handlers per feature, and — critically — what each feature reads from or writes into the others). Full map is in the session's working notes; the load-bearing findings that shape this phase:

- **Root identity** (`shell`, `threadState`, `now`, `selected`, `sessionRunning`, `threadResync`) is read by every other area and must stay owned by `App` itself (or a thin `useThreadSession` hook `App` calls first and threads through) — not extractable into a leaf feature hook.
- **`toasts`/`setError`** are used by nearly every handler in every area. Keep the existing `useToasts()` hook exactly as-is; every extracted feature hook takes `toasts`/`setError` as a parameter instead of owning its own.
- **`pickerBody`** (the picker modal's content) is the worst cross-cutting offender — its memo currently reaches into 5+ other feature areas to build one big switch statement. Fix: each feature hook that has picker rows (`useProviderCatalog`, `useDiffPanel`, `useThreadOps`, the creation flow) returns its own pre-built `PickerSection`/`PickerBody` fragment; `usePickerOrchestration` just assembles whichever fragment matches the current `picker` value. This keeps every feature hook self-contained instead of the reverse (one hook awkwardly reaching into six others).
- **`useDiffPanel`** gets a `closeDiff()` it exposes, because `app.tsx`'s revert flow (area 11) currently reaches in and resets `expandedTurn`/`patch` directly — that cross-write becomes a function call instead of a second owner of the same state.
- Thread-creation (`creating`, `creatingModelSelection`, `creatingRuntimeMode`, `creatingProjectId`, `createThread`, `startNewThread`) and thread-ops (`deleteThread`, `archiveThread`, `compactSession`, `revertMessageTurn`, `regenerateThreadTitle`, `toggleSettleThread`) both touch 4+ other areas each — they're cross-cutting like root identity, so they land in `src/tui/app/hooks/` (app-level, not inside one feature folder) rather than being forced into `sidebar/` or `diffpanel/`.

Target hook list and destination:
- `src/tui/app/hooks/useThreadSession.ts` — area 1 (shell/thread subscription, now-clock, selected, sessionRunning)
- `src/tui/app/hooks/useThreadCreation.ts` — area 3
- `src/tui/app/hooks/useThreadOps.ts` — area 11 (delete/archive/compact/revert/rename/regenerate-title)
- `src/tui/app/hooks/useQuitConfirm.ts` — area 10
- `src/tui/features/sidebar/useSidebar.ts` — area 2
- `src/tui/features/composer/useComposer.ts` — area 4 (drafts, attachments, external editor, submit/escape)
- `src/tui/features/pickers/useProviderCatalog.ts` — area 5 (providers, model/effort/permission)
- `src/tui/features/pickers/usePickerOrchestration.ts` — area 6 (picker/pickerFilter state, geometry, assembling sections from the other hooks)
- `src/tui/features/diffpanel/useDiffPanel.ts` — area 7
- `src/tui/features/taskspanel/useTasksPanel.ts` — area 8
- `src/tui/features/answerpanel/useAnswerFlow.ts` — area 9

Free functions/constants (area 13) go to `src/tui/app/utils.ts` / `src/tui/app/constants.ts`.

`app.tsx` itself shrinks to: call each hook in the same relative order the state used to appear, keep the JSX return (currently lines ~2447-2935) exactly as it is today but reading from hook return values instead of local closure variables. **Each hook is extracted and verified one at a time** (`bun run check` + `bun src/tui/render-check.tsx` green after each), not as one giant rewrite — this is the highest-risk part of the whole plan since it's real code surgery on a 2935-line stateful component, and staging it lets a regression get caught immediately against the hook that introduced it rather than somewhere in a 2000-line diff.

## Phase E — Split `render-check.tsx` via scenario-function extraction

`render-check.tsx` is one long sequential script against a single shared `setup`/`client` — every step depends on state left behind by the previous step (not independent test cases), so this is **not** turned into isolated per-file tests. Instead:

- `src/tui/render-check/fixtures.ts` — the mock `TuiClient`, thread/project/provider builders, `thread()` helper, `userInputRequestedFrame()`.
- `src/tui/render-check/scenarios/*.ts` — one file per feature area, matching the `--- section ---` checkpoints already in the script (sidebar, quitConfirm, permissions, diffPanel, timeline/work-folding, commandPalette, rename, deleteThread, modals/toasts, etc.). Each exports a function `(setup, fail) => Promise<void>` that runs its slice of `act(...)` calls in the original order and does its `fail(...)` assertions.
- `src/tui/render-check.tsx` (or `src/tui/render-check/index.ts`, keeping the `package.json` `check:tui` script path either way) shrinks to: build the client, `testRender`, then `await` each scenario function in the exact original sequence. Same execution order, same cumulative state — output should be byte-identical to today's run.

## Verification

- `bun run check` (typecheck + `vitest run`) green after every phase, not just at the end — same 238 tests should still pass (test *count* shouldn't change, only file location).
- `bun src/tui/render-check.tsx` green after every phase — diff its full output log against a pre-refactor baseline capture to catch any accidental behavior drift (the harness is deterministic enough for this: same mock client, same scripted input).
- After Phase A specifically: `bun src/cli/index.ts --help` (or whatever the equivalent smoke check is) to confirm the CLI entrypoint still resolves and dispatches.
- Final pass: `rg` for any leftover `src/cli.ts` or old flat paths in docs/scripts (`README.md`, `AGENTS.md`, `package.json`) to make sure nothing stale is left pointing at pre-move locations.
- Git history preserved via `git mv` for every move so `git log --follow` still works on relocated files.
