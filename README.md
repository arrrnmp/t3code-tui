# t3code-tui

`t3code-tui` drives [T3 Code](https://github.com/pingdotgg/t3code) from your terminal: a full interactive TUI for working with threads, plus a scriptable CLI for handovers, thread inspection, messaging, and automation.

## Requirements

Bun (it manages packages and runs everything) and a running T3 Code instance.

## Install

```bash
git clone https://github.com/arrrnmp/t3code-tui.git
cd t3code-tui
bun install
```

There is no build step for daily use — Bun runs the TypeScript source directly, from any working
directory, with nothing to put on PATH. Point a `t3code` command at that instead of building a
`dist/` artifact and shimming it in.

macOS/Linux (bash/zsh) — add to your shell profile (`~/.bashrc`, `~/.zshrc`, ...):

```bash
t3code() { bun "/absolute/path/to/t3code-tui/src/cli/index.ts" "$@"; }
```

Windows (PowerShell) — add to your `$PROFILE`:

```powershell
function t3code { bun "C:\absolute\path\to\t3code-tui\src\cli\index.ts" @args }
```

Reload the shell, then verify:

```bash
t3code --json doctor
```

Every example below assumes `t3code` resolves that way. This package is not published
(`private: true`), so install it by cloning; `bun run check` (typecheck and tests) is optional
and only relevant if you're changing the code itself.

## Terminal UI

```bash
t3code tui
```

Opens the interactive client: sidebar with your threads, the live transcript with per-turn diffs,
and a composer with model/effort pickers, image attachments, and an external-editor shortcut.
Clicking a user prompt opens message actions (copy, revert); clicking a diff-turn header jumps
the transcript to that turn; the command palette covers copy/thread/jump actions.

| Keys | Action |
| --- | --- |
| `enter` | Send (composer) / confirm (close menu) |
| `shift+enter`, `ctrl+j` | Newline in the composer |
| `esc` | Unfocus composer / close diff / cancel menus |
| `ctrl+c` | Clear prompt → close menu → quit (empty prompt jumps straight to the menu) |
| `ctrl+t` | Toggle tasks panel |
| `ctrl+p` | Command palette |
| `ctrl+o`, `alt+e` | Edit the draft in `$VISUAL` / `$EDITOR` |
| `ctrl+v`, `cmd+v` | Paste an image from the clipboard |
| `i` | Focus the composer |
| `s`, `[`, `]` | Sidebar mode / cycle project |
| `arrows`, `pgup/pgdn` | Scroll the focused pane |

The UI needs at least a 90×20 terminal (btop-style): below that it shows a
resize notice instead of a broken layout, and resumes live when you grow it
back. Resizes are followed over SSH too. Without a terminal at all (piped
output, `ssh` without `-t`), `tui` exits with an error instead.

## CLI

The same binary scripts everything the TUI does, with stable `--json` envelopes
(`{ "ok": true, "data": ... }`) for automation.

### Handover

Hands the current folder or Git repository to a new thread. It connects to the running local T3
server, resolves the workspace against T3 projects, optionally creates the missing project,
creates a fresh thread, and starts its first prompt through T3's orchestration API:

```bash
t3code handover --prompt "Continue the implementation from this handover."
t3code handover --prompt-file handover.txt --open none
printf '%s' "$PROMPT" | t3code handover --stdin
```

| Flag | Values |
| --- | --- |
| `--prompt`, `--prompt-file`, `--stdin` | Exactly one is required |
| `--open` | `auto`, `desktop`, `browser`, `none` |
| `--provider` | A provider instance id supported by that T3 installation |
| `--model` | A model slug supported by that provider instance |
| `--speed`, `--speed-mode` | `standard`, `fast` |
| `--thinking-effort` | A model-supported value such as `low`, `medium`, `high`, `xhigh` or `max` |
| `--permission`, `--runtime-mode` | `approval-required`, `auto-accept-edits`, `auto`, `full-access` |
| `--mode`, `--interaction-mode` | `build`/`default`, `plan` |
| `--checkout`, `--env-mode` | `current`/`local`, `worktree`, or T3's configured default via `t3` |

Command flags override the CLI config, which overrides the T3 project's saved model selection. Without either override, the saved selection and its options are passed through unchanged. A newly-created project uses the detected T3 version's default (`gpt-5.4` on 0.0.28 and `gpt-6-astra` on 0.0.29 and later).

Speed and thinking effort are stored as model options. T3 applies the option ids supported by the selected provider/model. If `--provider` changes the project's default provider instance, also pass `--model` because provider instance ids can be user-defined and do not imply a model.

## Existing threads

List threads across projects, or restrict discovery by project id or workspace:

```bash
t3code threads list
t3code threads list --status active --cwd .
t3code threads list --status settled --project <project-id>
```

`--status` accepts `active`, `settled`, `snoozed`, or `all` (the default). A thread reads as `snoozed` while it is unsettled and its `snoozedUntil` lies in the future. Results include the exact thread id, project, title, model, and update time. Inspect the exact target before sending:

```bash
t3code threads inspect --thread <thread-id>
```

`inspect` returns a bounded preview in JSON: the 6 most recent messages, with message text limited to 2,000 characters, plus `snoozedUntil` when the thread is snoozed. Read a thread projection without truncation:

```bash
t3code threads read --thread <thread-id>
t3code --json threads read --thread <thread-id>
t3code --json threads read --thread <thread-id> --last-turn
t3code --json threads read --thread <thread-id> --view turn-items
t3code --json threads read --thread <thread-id> --view plans
t3code --json threads read --thread <thread-id> --view checkpoints
t3code --json threads read --thread <thread-id> --view transfers
```

`--view` defaults to `messages`: the JSON result stores the transcript in `data.thread.messages`. Messages remain in chronological order and retain their `turnId`. `--last-turn` keeps only messages assigned to `data.thread.latestTurn.turnId`. Neither mode truncates message text. The other views expose the thread's V1 activity projection (`turn-items`), proposed plans (`plans`), and checkpoint summaries (`checkpoints`); `transfers` is always empty because V1 exposes no context-transfer rows.

## Follow-up messages

Send to an existing thread instead of starting a new one. Use the **T3 thread ID** from a previous command's JSON `data.thread.id` (not a provider session ID). `--thread` and `--thread-id` are aliases:

```bash
t3code threads send --thread <thread-id> --prompt "Run the morning check."
t3code threads send --thread-id <thread-id> --stdin --open none < follow-up.txt
t3code threads send --thread-id <thread-id> --prompt-file follow-up.txt --dry-run
```

Exactly one of `--prompt`, `--prompt-file`, or `--stdin` is required. The message dispatches `thread.turn.start` against that thread. The send waits until the exact message is visible in T3's thread projection before reporting success. A failed send never deletes the thread. Archived threads are rejected — unarchive them in T3 Code first.

Choose how to handle active work (default `reject`):

```bash
t3code threads send --thread-id <thread-id> --if-busy inject \
  --prompt "Additional context for the work in progress…" --open none
```

- `--if-busy reject` (default) returns `THREAD_BUSY` without dispatching when the thread has an active or pending turn.
- `--if-busy inject` dispatches immediately even when busy, letting T3 and its provider incorporate the prompt into active work. It does not introduce a CLI queue or send an interrupt command.

The busy check is a snapshot preflight, not an atomic lock; concurrent callers must serialize requests when that matters. Success reports dispatch acceptance rather than agent completion.

Sending to a settled thread requires confirmation. Non-interactive and JSON callers must explicitly opt in with `--wake-settled`:

```bash
printf '%s' "New findings that require more work..." \
  | t3code --json threads send --thread <thread-id> --stdin --wake-settled
```

The turn keeps the thread's model, permission, and mode unless overridden. `--provider`, `--model`, `--speed`, and `--thinking-effort` override the model for that turn only (global `provider`/`model` config is ignored so a stale default cannot flip a scheduled thread's model). There is no `--permission`/`--mode` flag: set the thread's permission in T3 Code, since scheduled runs inherit it.

`--delivery` selects follow-up policy (default `auto`; V1 always dispatches `thread.turn.start`, so the mode governs preconditions and reporting): `queue` dispatches even when busy and reports `queued`, `steer` requires an active turn and reports `steered`, and `restart` interrupts the active turn first and reports `restarted` (`THREAD_NOT_STEERABLE` when idle, `THREAD_RESTART_FAILED` when the interrupt fails). `--handoff-note <text>` records provider-switch context as CLI-side metadata without changing the dispatched turn.

Use `--prompt-file` (or `--stdin`) for skill invocations and longer prompts, `--open none` for headless runs, and `--dry-run --json` to inspect the turn command without dispatching it.

Manage settlement explicitly without starting a new turn:

```bash
t3code threads settle --thread <thread-id>
t3code threads unsettle --thread <thread-id>
```

`settle` refuses a thread with a running/starting session or a pending approval or user-input request. `unsettle` marks the thread manually active but does not send a message or start its provider session. Both commands require the server to advertise the `threadSettlement` capability and wait for the requested lifecycle state to appear in T3's projection before succeeding.

Snooze an active thread until an ISO-8601 datetime, interrupt an active turn, or delegate a sub-agent task to a child thread in the same project:

```bash
t3code threads snooze --thread <thread-id> --until 2030-01-01T00:00:00.000Z
t3code threads unsnooze --thread <thread-id>
t3code threads interrupt --thread <thread-id> [--run <turn-id>]
t3code threads delegate --thread <parent-id> --prompt "Self-contained task" --open none
t3code threads task-status --thread <parent-id> --task <child-thread-id>
t3code threads task-cancel --thread <parent-id> --task <child-thread-id>
```

`delegate` sends only the task prompt as the child's first turn and waits for its latest turn to reach `completed`, `interrupted`, or `error` (default budget 600000ms via `--timeout-ms`; `--no-wait` returns after dispatch). A wait timeout exits 0 with `data.task.waitTimedOut: true` and never cancels the child — re-poll with `task-status`. `task-cancel` interrupts through the real `thread.turn.interrupt` path and returns `TASK_CANCEL_UNSUPPORTED` when no interrupt can be dispatched.

Thread targeting uses exit code `3` for a missing target, `4` for a lifecycle/confirmation refusal, and `5` when dispatch returned but projection acceptance could not be verified.

To run a message on a schedule (for example daily at 05:01), pair it with the OS scheduler. T3 Code must be running and the machine awake. The scheduler doesn't load your shell profile, so point it at `bun` and the script path directly rather than at the `t3code` function/alias. PowerShell example:

```powershell
$action = New-ScheduledTaskAction -Execute "bun.exe" `
  -Argument '"C:\absolute\path\to\t3code-tui\src\cli\index.ts" --json threads send --thread <thread-id> --prompt-file "<path-to-prompt.txt>" --open none'
$trigger = New-ScheduledTaskTrigger -Daily -At 05:01
Register-ScheduledTask -TaskName "T3 5am thread ping" -Action $action -Trigger $trigger
```

macOS/Linux equivalent (cron):

```bash
1 5 * * * bun /absolute/path/to/t3code-tui/src/cli/index.ts --json threads send --thread <thread-id> --prompt-file "<path-to-prompt.txt>" --open none
```

## Settings

```bash
t3code config show
t3code config set projectPolicy existing
t3code config set workspaceMode folder
t3code config set openMode browser
t3code config set threadEnvMode local
t3code config set provider codex
t3code config set model gpt-6-astra
t3code config set speedMode fast
t3code config set thinkingEffort xhigh
```

| Setting | Values | Default |
| --- | --- | --- |
| `projectPolicy` | `create`, `existing` | `create` |
| `workspaceMode` | `repo`, `folder` | `repo` |
| `openMode` | `auto`, `desktop`, `browser`, `none` | `auto` |
| `threadEnvMode` | `t3`, `local`, `worktree` | `t3` |
| `runtimeMode` | `approval-required`, `auto-accept-edits`, `auto`, `full-access` | `full-access` |
| `interactionMode` | `default`, `plan` | `default` |
| `provider` | Configured T3 provider instance id | T3 project selection |
| `model` | Provider model slug | T3 project selection |
| `speedMode` | `standard`, `fast` | T3 project selection |
| `thinkingEffort` | Model-supported effort value | T3 project selection |

`projectPolicy: "existing"` makes a missing project a hard error. `workspaceMode: "folder"` uses the exact current folder instead of walking up to the Git root. `threadEnvMode: "t3"` follows T3's project → `t3.json` → global local/worktree preference. Explicit CLI config values remain overrides.

T3 0.0.28 and later expose an atomic thread bootstrap contract for new worktrees. `--checkout worktree` uses it to create the thread, prepare the worktree from the current branch, run the matching setup script, and start the prompt. Worktree creation honors the current installation's explicit `newWorktreesStartFromOrigin` value; when that value is absent, it uses the installed version's default (`false` on 0.0.28, `true` on 0.0.29 and later). A repository without a current branch returns `WORKTREE_REQUIRES_BRANCH` instead of silently falling back to the current checkout.

## Commands

```text
t3code tui
t3code --json doctor
t3code config path|show|set
t3code projects list
t3code projects resolve --cwd .
t3code projects ensure --cwd . --project-policy create
t3code providers list
t3code models list --provider claudeAgent
t3code efforts list --provider claudeAgent --model claude-sonnet-5
t3code threads create --stdin
t3code threads list --status active --cwd .
t3code threads inspect --thread <thread-id>
t3code threads read --thread <thread-id>
t3code threads send --thread <thread-id> --stdin
t3code threads settle --thread <thread-id>
t3code threads unsettle --thread <thread-id>
t3code threads snooze --thread <thread-id> --until <ISO-datetime>
t3code threads unsnooze --thread <thread-id>
t3code threads interrupt --thread <thread-id>
t3code threads delegate --thread <parent-id> --stdin
t3code threads task-status --thread <parent-id> --task <child-thread-id>
t3code threads task-cancel --thread <parent-id> --task <child-thread-id>
t3code handover --stdin
t3code request get /api/orchestration/snapshot
```

Every command supports human-readable output. `--json` produces `{ "ok": true, "data": ... }` on success and a stable error envelope on failure.

## Providers, models, and efforts

`providers list`, `models list`, and `efforts list` read the live provider snapshots from the running T3 server over its websocket RPC (`server.getConfig`), using the same short-lived session mechanism as every other command. Use them to pick valid `--provider`, `--model`, and `--thinking-effort` values before a handover instead of guessing — unknown ids fail with `PROVIDER_NOT_FOUND` / `MODEL_NOT_FOUND` and list what exists. Pass `--refresh` to probe providers for fresh status first (slower; without it the cached snapshots are returned). Choices marked `*` in human output are the model's defaults.

`models list` also reports whether each model is `hidden` — the user removed it from T3's own model picker (`providerModelPreferences`). This is a display preference, not an entitlement check: a hidden model still dispatches normally if you name it explicitly, and a model that isn't hidden isn't guaranteed to work — T3 has no field for whether a model matches the account's actual plan or subscription tier.

`providers list` reports each instance's `usageLimits` — the same subscription-quota windows (a five-hour session, a weekly allowance, and so on) behind T3's own usage panel: `checkedAt`, a `usedPercent` and optional `resetsAt` per window, and an `unavailable` reason when the account has no usage data or a probe failed. It is `null` for drivers with no notion of usage at all, such as an API-key account. Usage is scoped to the whole provider instance, not to one model.

## Desktop navigation

Current stable T3 Code registers `t3code://` but only uses a second launch to reveal its window. The CLI therefore creates the exact thread first and reports `opened.exactThread: false` when it can only reveal today's desktop app. If a T3 build registers the proposed `t3://thread/<threadId>` protocol, `openMode: "auto"` uses it and reports `exactThread: true`. `openMode: "browser"` opens the exact local web route immediately.

## Security

The CLI uses T3's own `auth session issue` control plane to mint an administrative bearer token, keeps it only in memory, and revokes it in a `finally` block. Tokens are never included in JSON output or logs.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
