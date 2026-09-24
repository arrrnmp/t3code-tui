# moxen

`moxen` drives provider CLIs directly from your terminal: a full interactive TUI for working with threads, plus a scriptable CLI for handovers, thread inspection, messaging, and automation. No server — threads, projects, and orchestration live in a local store (`~/.moxen`), and turns run against `claude`, `codex`, `grok`, or `opencode serve` through their own logins.

## Requirements

Bun (it manages packages and runs everything) and at least one provider CLI: `claude` (`claude auth login`), `codex` (`codex login`), `grok` (`grok login`), or `opencode` (`opencode auth login` or provider API keys).

## Install

```bash
git clone https://github.com/arrrnmp/moxen.git
cd moxen
bun install
```

There is no build step for daily use — Bun runs the TypeScript source directly, from any working
directory, with nothing to put on PATH. Point a `moxen` command at that instead of building a
`dist/` artifact and shimming it in.

macOS/Linux (bash/zsh) — add to your shell profile (`~/.bashrc`, `~/.zshrc`, ...):

```bash
moxen() { bun "/absolute/path/to/moxen/src/cli/index.ts" "$@"; }
```

Windows (PowerShell) — add to your `$PROFILE`:

```powershell
function moxen { bun "C:\absolute\path\to\moxen\src\cli\index.ts" @args }
```

Reload the shell, then verify:

```bash
moxen --json doctor
```

Every example below assumes `moxen` resolves that way. This package is not published
(`private: true`), so install it by cloning; `bun run check` (typecheck and tests) is optional
and only relevant if you're changing the code itself.

## Terminal UI

```bash
moxen tui
```

Opens the interactive client: sidebar with your threads, the live transcript with per-turn diffs,
and a composer with model/effort pickers, image attachments, and an external-editor shortcut.
Image attachments reach every provider as native image input (Grok falls back to naming them
when its agent does not advertise image prompts). Clicking a user prompt opens message actions (copy, revert); clicking a diff-turn header jumps
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

The UI needs at least a 180×47 terminal (btop-style): below that it shows a
resize notice instead of a broken layout, and resumes live when you grow it
back. Resizes are followed over SSH too. Without a terminal at all (piped
output, `ssh` without `-t`), `tui` exits with an error instead.

## CLI

The same binary scripts everything the TUI does, with stable `--json` envelopes
(`{ "ok": true, "data": ... }`) for automation.

### Handover

Hands the current folder or Git repository to a new thread. It resolves the workspace against the local project registry, optionally creates the missing project, creates a fresh thread, and starts its first prompt against the selected provider driver:

```bash
moxen handover --prompt "Continue the implementation from this handover."
moxen handover --prompt-file handover.txt --open none
printf '%s' "$PROMPT" | moxen handover --stdin
```

| Flag | Values |
| --- | --- |
| `--prompt`, `--prompt-file`, `--stdin` | Exactly one is required |
| `--open` | `auto`, `desktop`, `browser`, `none` |
| `--provider` | A provider instance id from `providers list` (`claude`, `codex`, `grok`, `opencode/<provider>`) |
| `--model` | A model slug supported by that provider instance |
| `--speed`, `--speed-mode` | `standard`, `fast` |
| `--thinking-effort` | A model-supported value such as `low`, `medium`, `high`, `xhigh` or `max` |
| `--permission`, `--runtime-mode` | `approval-required`, `auto-accept-edits`, `auto`, `full-access` |
| `--mode`, `--interaction-mode` | `build`/`default`, `plan` |
| `--checkout`, `--env-mode` | `current`/`local`, `worktree`, or the resolved default via `auto` |

Command flags override the CLI config, which overrides the project's saved model selection. Without either override, the saved selection and its options are passed through unchanged. A newly-created project has no default; the fallback is the explicit installation default (`codex` / `gpt-5.4`).

Speed and thinking effort are stored as model options. The provider driver applies the option ids supported by the selected provider/model. If `--provider` changes the project's default provider instance, also pass `--model` because provider instance ids can be user-defined and do not imply a model.

## Existing threads

List threads across projects, or restrict discovery by project id or workspace:

```bash
moxen threads list
moxen threads list --status active --cwd .
moxen threads list --status settled --project <project-id>
```

`--status` accepts `active`, `settled`, `snoozed`, or `all` (the default). A thread reads as `snoozed` while it is unsettled and its `snoozedUntil` lies in the future. Results include the exact thread id, project, title, model, and update time. Inspect the exact target before sending:

```bash
moxen threads inspect --thread <thread-id>
```

`inspect` returns a bounded preview in JSON: the 6 most recent messages, with message text limited to 2,000 characters, plus `snoozedUntil` when the thread is snoozed. Read a thread projection without truncation:

```bash
moxen threads read --thread <thread-id>
moxen --json threads read --thread <thread-id>
moxen --json threads read --thread <thread-id> --last-turn
moxen --json threads read --thread <thread-id> --view turn-items
moxen --json threads read --thread <thread-id> --view plans
moxen --json threads read --thread <thread-id> --view checkpoints
moxen --json threads read --thread <thread-id> --view transfers
```

`--view` defaults to `messages`: the JSON result stores the transcript in `data.thread.messages`. Messages remain in chronological order and retain their `turnId`. `--last-turn` keeps only messages assigned to `data.thread.latestTurn.turnId`. Neither mode truncates message text. The other views expose the thread's activity ledger (`turn-items`), proposed plans (`plans`, currently always empty — no plan capture is wired yet), and checkpoint summaries (`checkpoints`, backed by git worktree snapshots around each turn); `transfers` is always empty because no transport exposes context-transfer rows.

## Follow-up messages

Send to an existing thread instead of starting a new one. Use the **thread ID** from a previous command's JSON `data.thread.id`. `--thread` and `--thread-id` are aliases:

```bash
moxen threads send --thread <thread-id> --prompt "Run the morning check."
moxen threads send --thread-id <thread-id> --stdin --open none < follow-up.txt
moxen threads send --thread-id <thread-id> --prompt-file follow-up.txt --dry-run
```

Exactly one of `--prompt`, `--prompt-file`, or `--stdin` is required. The message is recorded as a turn on that thread and the provider run continues in the background; success reports acceptance, not agent completion. A failed send never deletes the thread. Archived threads are rejected (there is no unarchive path).

Choose how to handle active work (default `reject`):

```bash
moxen threads send --thread-id <thread-id> --if-busy inject \
  --prompt "Additional context for the work in progress…" --open none
```

- `--if-busy reject` (default) returns `THREAD_BUSY` without recording when the thread has an active or pending turn.
- `--if-busy inject` records immediately even when busy, letting the provider incorporate the prompt into active work. It does not introduce a CLI queue or send an interrupt command.

The busy check holds the per-thread mutex instead of a snapshot preflight: one active turn per thread is enforced, not raced. Success reports acceptance rather than agent completion.

Sending to a settled thread requires confirmation. Non-interactive and JSON callers must explicitly opt in with `--wake-settled`:

```bash
printf '%s' "New findings that require more work..." \
  | moxen --json threads send --thread <thread-id> --stdin --wake-settled
```

The turn keeps the thread's model, permission, and mode unless overridden. `--provider`, `--model`, `--speed`, and `--thinking-effort` override the model for that turn only (global `provider`/`model` config is ignored so a stale default cannot flip a scheduled thread's model). There is no `--permission`/`--mode` flag: change the thread's modes in the TUI permission picker, since scheduled runs inherit them.

`--delivery` selects follow-up policy (default `auto`; every follow-up is recorded as a `thread.turn.start` turn, so the mode governs preconditions and reporting): `queue` records even when busy and reports `queued`, `steer` requires an active turn and reports `steered`, and `restart` interrupts the active turn first and reports `restarted` (`THREAD_NOT_STEERABLE` when idle). `--handoff-note <text>` records provider-switch context as CLI-side metadata without changing the recorded turn.

Use `--prompt-file` (or `--stdin`) for skill invocations and longer prompts, `--open none` for headless runs, and `--dry-run --json` to inspect the turn command without dispatching it.

Manage settlement explicitly without starting a new turn:

```bash
moxen threads settle --thread <thread-id>
moxen threads unsettle --thread <thread-id>
```

`settle` refuses a thread with a running session or a pending approval or user-input request. `unsettle` marks the thread manually active but does not send a message or start its provider session. Both apply synchronously to the ledger.

Snooze an active thread until an ISO-8601 datetime, interrupt an active turn, or delegate a sub-agent task to a child thread in the same project:

```bash
moxen threads snooze --thread <thread-id> --until 2030-01-01T00:00:00.000Z
moxen threads unsnooze --thread <thread-id>
moxen threads interrupt --thread <thread-id> [--run <turn-id>]
moxen threads delegate --thread <parent-id> --prompt "Self-contained task" --open none
moxen threads task-status --thread <parent-id> --task <child-thread-id>
moxen threads task-cancel --thread <parent-id> --task <child-thread-id>
```

`delegate` sends only the task prompt as the child's first turn and waits for its latest turn to reach `completed`, `interrupted`, or `error` (default budget 600000ms via `--timeout-ms`; `--no-wait` returns after acceptance). A wait timeout exits 0 with `data.task.waitTimedOut: true` and never cancels the child — re-poll with `task-status`. `task-cancel` interrupts the live provider run through the store and marks the turn interrupted.

Thread targeting uses exit code `3` for a missing target and `4` for a lifecycle/confirmation refusal.

To run a message on a schedule (for example daily at 05:01), pair it with the OS scheduler. The provider CLIs must be installed and authenticated, and the machine awake. The scheduler doesn't load your shell profile, so point it at `bun` and the script path directly rather than at the `moxen` function/alias. PowerShell example:

```powershell
$action = New-ScheduledTaskAction -Execute "bun.exe" `
  -Argument '"C:\absolute\path\to\moxen\src\cli\index.ts" --json threads send --thread <thread-id> --prompt-file "<path-to-prompt.txt>" --open none'
$trigger = New-ScheduledTaskTrigger -Daily -At 05:01
Register-ScheduledTask -TaskName "Moxen 5am thread ping" -Action $action -Trigger $trigger
```

macOS/Linux equivalent (cron):

```bash
1 5 * * * bun /absolute/path/to/moxen/src/cli/index.ts --json threads send --thread <thread-id> --prompt-file "<path-to-prompt.txt>" --open none
```

## Settings

```bash
moxen config show
moxen config set projectPolicy existing
moxen config set workspaceMode folder
moxen config set openMode browser
moxen config set threadEnvMode local
moxen config set provider codex
moxen config set model gpt-5.4
moxen config set speedMode fast
moxen config set thinkingEffort xhigh
```

| Setting | Values | Default |
| --- | --- | --- |
| `projectPolicy` | `create`, `existing` | `create` |
| `workspaceMode` | `repo`, `folder` | `repo` |
| `openMode` | `auto`, `desktop`, `browser`, `none` | `auto` |
| `threadEnvMode` | `auto`, `local`, `worktree` | `auto` |
| `runtimeMode` | `approval-required`, `auto-accept-edits`, `auto`, `full-access` | `full-access` |
| `interactionMode` | `default`, `plan` | `default` |
| `provider` | Provider instance id for model overrides | Unset (inherits thread/project) |
| `model` | Model slug for overrides | Unset (inherits thread/project) |
| `speedMode` | `standard`, `fast` | Unset (inherits thread/project) |
| `thinkingEffort` | Model-supported effort value | Unset (inherits thread/project) |

`projectPolicy: "existing"` makes a missing project a hard error. `workspaceMode: "folder"` uses the exact current folder instead of walking up to the Git root. `threadEnvMode: "auto"` follows project → `moxen.json` → global local/worktree preference. Explicit CLI config values remain overrides.

`--checkout worktree` provisions a local worktree for the new thread: a `moxen/<id>` branch off the current branch (or its origin — new worktrees always start from origin), placed under the store's `worktrees` directory, with the thread rooted there. A repository without a current branch returns `WORKTREE_REQUIRES_BRANCH` instead of silently falling back to the current checkout.

### MCP servers

MCP servers declared under `mcpServers` are added to every provider session, alongside whatever
the provider's own config already loads. The shape is the one `.mcp.json` uses; edit the config
file directly (`moxen config path`):

```json
{
  "mcpServers": {
    "fs": { "command": "npx", "args": ["-y", "some-mcp"], "env": { "ROOT": "/work" } },
    "docs": { "type": "http", "url": "https://docs.example/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}
```

A project's `moxen.json` can declare `mcpServers` too: an entry replaces the global one of the
same name, and `null` removes it for that project. Servers are read when a session starts, so an
edit applies to the next session. Names may use letters, digits, `-` and `_`. Grok gets `http`
servers only when its agent advertises HTTP MCP support. `config show` redacts `env` and `headers`
values.

## Commands

```text
moxen tui
moxen --json doctor
moxen config path|show|set
moxen projects list
moxen projects resolve --cwd .
moxen projects ensure --cwd . --project-policy create
moxen providers list
moxen models list --provider claudeAgent
moxen models hide --provider opencode --model opencode/muse-spark-1.3-contributor-free
moxen models show --provider opencode --model opencode/muse-spark-1.3-contributor-free
moxen efforts list --provider claudeAgent --model claude-sonnet-5
moxen threads create --stdin
moxen threads list --status active --cwd .
moxen threads inspect --thread <thread-id>
moxen threads read --thread <thread-id>
moxen threads send --thread <thread-id> --stdin
moxen threads settle --thread <thread-id>
moxen threads unsettle --thread <thread-id>
moxen threads snooze --thread <thread-id> --until <ISO-datetime>
moxen threads unsnooze --thread <thread-id>
moxen threads interrupt --thread <thread-id>
moxen threads delegate --thread <parent-id> --stdin
moxen threads task-status --thread <parent-id> --task <child-thread-id>
moxen threads task-cancel --thread <parent-id> --task <child-thread-id>
moxen handover --stdin
```

Every command supports human-readable output. `--json` produces `{ "ok": true, "data": ... }` on success and a stable error envelope on failure.

## Providers, models, and efforts

`providers list`, `models list`, and `efforts list` probe live sources on every call with no server in the loop: native surfaces (`claudeAgent`, `codex`, `grok`) through ephemeral driver sessions (failures degrade into each entry's `status` instead of failing the listing), and one `opencode` instance carrying the whole models.dev catalog (slugs are `provider/model`, matching migrated threads) plus local API-key presence and stored OAuth state. Use them to pick valid `--provider`, `--model`, and `--thinking-effort` values before a handover instead of guessing — unknown ids fail with `PROVIDER_NOT_FOUND` / `MODEL_NOT_FOUND` and list what exists. Choices marked `*` in human output are the model's defaults.

`models hide` / `models show` curate the pickers: hidden models stay usable when named explicitly and stay visible on threads already running them — they only leave the model picker lists.

`models list` never reports `hidden` on this backend — there is no picker-preference store yet, so everything reads visible.

`providers list` reports each instance's `usageLimits` as `null`: subscription-quota windows are session-live in every native driver and there is no session to probe at listing time. Per-turn token totals are recorded in the turn ledger as runs settle and feed the TUI usage display.

## Opening threads

`--open` is accepted everywhere for script compatibility, but there is no desktop app to deep-link into: `opened.kind` is always `none`. The TUI (`moxen tui`) is the interactive interface; use `--open none` for headless runs.

## Security

There are no bearer tokens anywhere in this stack: provider CLIs own their own logins (`claude auth login`, `codex login`, `grok login`, `opencode auth login`), and this CLI never reads their secrets — it only observes credential *presence* (env vars, stored-auth file) for status display. Threads live as local JSONL under `~/.moxen` (override with `MOXEN_STORE_ROOT`); `doctor` reports store writability alongside binary and auth status.

## License

AGPL-3.0-only. See [LICENSE](LICENSE). Vendored third-party files are
recorded in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES); contributions use
DCO sign-off (`Signed-off-by:` trailer).
