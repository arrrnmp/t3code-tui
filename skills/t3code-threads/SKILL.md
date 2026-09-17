---
name: t3code-threads
description: Work with T3 Code threads. Use when the task needs t3code threads create, list, inspect, read, send, settle, unsettle, snooze, unsnooze, interrupt, delegate, task-status, or task-cancel, or must identify the right thread id before messaging it.
---

# Work with T3 Code threads

Use `t3code` for all commands. For the normal hand-off flow, use the `t3code-handoff` skill
instead.

The commands below work on macOS, Linux, and Windows. Examples show bash for macOS/Linux and
PowerShell for Windows.

On Windows, prefer `--prompt-file` over a piped `--stdin`. PowerShell 5.1 silently turns
non-ASCII characters into `?` on a piped prompt, and still reports `ok: true`. PowerShell 5.1 runs
when something calls `powershell` instead of `pwsh`. `--prompt-file` skips the shell, so it works
the same on both platforms.

## Start a new thread explicitly

`handover` resolves and creates the project from `--cwd` in one call. Use `threads create` when
the project is already resolved, or when you must set policy and thread controls by hand.

Pass the prompt over stdin or `--prompt-file`. This avoids shell quoting and command-length
problems:

```bash
printf '%s' "$PROMPT" | t3code --json threads create --stdin
```

```powershell
t3code --json threads create --prompt-file <path-to-prompt.txt>
```

Give exactly one of `--prompt`, `--prompt-file`, or `--stdin`. Set thread controls with
`--provider`, `--model`, `--speed`, `--thinking-effort`, `--permission`, `--mode build|plan`, and
`--checkout current|worktree`, when needed.

By default, the thread inherits the T3 project's full saved model selection, including
provider-specific options. Flags and CLI config override this. If the project is missing, the CLI
uses the detected T3 version's default model: `gpt-5.4` on 0.0.28, `gpt-6-astra` on 0.0.29 and
later. The default permission is full access (`full-access`). Use `--project-policy existing` when
you cannot create a project. Use `--dry-run --open none` to inspect the proposed command without
changing T3 state.

## Discover and read existing threads

First find candidates in the right project. Then inspect the exact target id before you change it:

```bash
t3code --json threads list --cwd . --status all
t3code --json threads inspect --thread "$TARGET_THREAD_ID"
```

`--status` accepts `active`, `settled`, `snoozed`, or `all` (the default). A thread counts as
`snoozed` while it is unsettled and its `snoozedUntil` is in the future. An expired snooze reads
back as `active`. Use `--project <project-id>` instead of `--cwd` when you have the exact project
id. Do not pick a target by title alone — titles are not unique.

`inspect` gives a short preview: the 6 most recent messages, with each message capped at 2,000
characters. It also reports `snoozedUntil` (`null` when the thread is not snoozed). Use `read` for
the full conversation:

```bash
t3code --json threads read --thread "$TARGET_THREAD_ID"
t3code --json threads read --thread "$TARGET_THREAD_ID" --last-turn
t3code --json threads read --thread "$TARGET_THREAD_ID" --view turn-items
t3code --json threads read --thread "$TARGET_THREAD_ID" --view plans
t3code --json threads read --thread "$TARGET_THREAD_ID" --view checkpoints
t3code --json threads read --thread "$TARGET_THREAD_ID" --view transfers
```

`--view` defaults to `messages`. This returns every message, with no text truncated. Read
`data.thread.messages` in order. Each message keeps its `turnId`. A user message that is waiting to
start a turn can have a `null` turnId. `--last-turn` keeps only messages whose `turnId` matches
`data.thread.latestTurn.turnId` (this also filters the `turn-items` view; other views ignore it).
`turn-items` gives the thread's V1 activity log. `plans` gives its proposed plans. `checkpoints`
gives its checkpoint summaries. `transfers` is always empty, because V1 has no context-transfer
rows — this view only documents that fact.

## Message an existing thread

```bash
printf '%s' "$MESSAGE" | t3code --json threads send --thread <thread-id> --stdin --open none
```

```powershell
t3code --json threads send --thread <thread-id> --prompt-file <path-to-message.txt> --open none
```

`--thread` and `--thread-id` are aliases. Give exactly one of `--prompt`, `--prompt-file`, or
`--stdin`. The send dispatches `thread.turn.start`, and waits until the message appears in T3's
projection before it reports success. A failed send never deletes the thread. `THREAD_NOT_FOUND`
and `THREAD_ARCHIVED` are explicit errors.

A busy thread rejects the send by default, with `THREAD_BUSY`. Pass `--if-busy inject` only when
you are authorized to interrupt active work. A settled thread needs interactive confirmation, or
`--wake-settled`. JSON and stdin workflows are non-interactive, so use `--wake-settled` only when
waking that thread is authorized. An archived thread cannot receive a turn.

The turn inherits the thread's model, permission, and mode. `--provider`, `--model`, `--speed`,
and `--thinking-effort` override the model for that one turn only — the global `provider`/`model`
config is ignored here. There is no `--permission` or `--mode` flag for a send. Validate scheduled
payloads with `--dry-run` first. T3 Code must be running when the scheduled command fires.

`--delivery` sets the client-side follow-up policy. The default is `auto`. V1 always dispatches
`thread.turn.start`; the delivery mode changes the preconditions and the report, not the wire
shape:

```bash
t3code --json threads send --thread <thread-id> --stdin --open none --delivery queue < follow-up.txt
t3code --json threads send --thread <thread-id> --prompt "Steer toward tests" --delivery steer --open none
t3code --json threads send --thread <thread-id> --prompt "Restart with logs" --delivery restart --open none
```

PowerShell has no `<` input-redirection operator; use `--prompt-file` there instead:

```powershell
t3code --json threads send --thread <thread-id> --prompt-file follow-up.txt --open none --delivery queue
t3code --json threads send --thread <thread-id> --prompt "Steer toward tests" --delivery steer --open none
t3code --json threads send --thread <thread-id> --prompt "Restart with logs" --delivery restart --open none
```

- `auto`: the default behavior. A busy thread rejects with `THREAD_BUSY`, unless you pass
  `--if-busy inject`.
- `queue`: dispatches even when busy. Reports `data.delivery: "queued"` (or `"started"` when idle).
- `steer`: needs an active turn (`THREAD_NOT_STEERABLE` otherwise). Reports `"steered"`.
- `restart`: needs an active turn. Dispatches `thread.turn.interrupt` first, then the new turn.
  Reports `"restarted"`. A failed interrupt aborts with `THREAD_RESTART_FAILED` and sends nothing.

`--handoff-note <text>` records provider-switch context as CLI-side metadata (`data.handoffNote`).
V1 sends no context-transfer row, so the dispatched turn does not change — confirm the note in the
JSON result, not in T3.

Require `data.verification.accepted: true`. Record `data.message.messageId`.
`THREAD_TURN_NOT_VERIFIED` means the dispatch returned, but verification timed out. Do not retry
automatically — the first message may still appear later. The same rule applies to
`THREAD_SNOOZE_NOT_VERIFIED`, `THREAD_UNSNOOZE_NOT_VERIFIED`, and `THREAD_INTERRUPT_NOT_VERIFIED`.

## Park or re-activate a thread

```bash
t3code --json threads settle --thread "$TARGET_THREAD_ID"
t3code --json threads unsettle --thread "$TARGET_THREAD_ID"
```

Settle a thread only after you are authorized to change its lifecycle. T3 refuses settlement while
a session is starting or running, or while the thread has a blocking approval or user-input request
(`THREAD_SETTLE_BLOCKED`). Unsettling marks the thread manually active. It does not send a message
or start its provider session.

Both commands need the server to advertise the `threadSettlement` capability
(`THREAD_SETTLEMENT_UNSUPPORTED` otherwise). Both wait for the new lifecycle state to appear in
T3's projection before they succeed. Require `data.verification.accepted: true`.
`THREAD_SETTLEMENT_NOT_VERIFIED` means dispatch returned, but verification timed out — do not
retry automatically.

## Snooze a thread, then wake it

```bash
t3code --json threads snooze --thread "$TARGET_THREAD_ID" --until 2030-01-01T00:00:00.000Z
t3code --json threads unsnooze --thread "$TARGET_THREAD_ID"
```

Snooze sits on top of the active lifecycle. The thread stays active in T3's model. It is only
hidden from the inbox until `--until` (a valid ISO-8601 datetime) passes. Both commands verify the
projection before they succeed. Require `data.verification.accepted: true`.
`THREAD_SNOOZE_NOT_VERIFIED` and `THREAD_UNSNOOZE_NOT_VERIFIED` mean dispatch returned, but the
change never appeared — do not retry automatically. Archived threads are rejected.

## Interrupt an active turn

```bash
t3code --json threads interrupt --thread "$TARGET_THREAD_ID"
t3code --json threads interrupt --thread "$TARGET_THREAD_ID" --run "$TURN_ID"
```

This dispatches V1 `thread.turn.interrupt` (with a `turnId` only when you pass `--run`), and waits
for the interruption to appear in the projection. A thread with no active turn returns
`data.result: "no_active_run"` and dispatches nothing. Require `data.verification.accepted: true`
when an interrupt dispatches. `THREAD_INTERRUPT_NOT_VERIFIED` and `THREAD_INTERRUPT_FAILED` both
mean the turn was left alone — do not retry automatically.

## Delegate a sub-agent task, poll it, cancel it

V1 has no server-side sub-agent primitive. Delegation is emulated on the client: the child is a
new thread in the parent's project. It receives only the task prompt, with no parent history. The
CLI polls the child until its latest turn is `completed`, `interrupted`, or `error`.

```bash
printf '%s' "$TASK" | t3code --json threads delegate --thread "$PARENT_THREAD_ID" --stdin --open none
t3code --json threads task-status --thread "$PARENT_THREAD_ID" --task "$CHILD_THREAD_ID"
t3code --json threads task-cancel --thread "$PARENT_THREAD_ID" --task "$CHILD_THREAD_ID"
```

```powershell
t3code --json threads delegate --thread "$PARENT_THREAD_ID" --prompt-file <path-to-task.txt> --open none
t3code --json threads task-status --thread "$PARENT_THREAD_ID" --task "$CHILD_THREAD_ID"
t3code --json threads task-cancel --thread "$PARENT_THREAD_ID" --task "$CHILD_THREAD_ID"
```

`delegate` waits by default, up to `--timeout-ms` (default 600000). A wait timeout ends the wait,
but does not cancel the child: the command still exits 0, with `data.task.waitTimedOut: true`.
Keep `data.task.taskId` (the child thread id) and poll again with `task-status`. Pass `--no-wait`
to return right after dispatch. Pass `--dry-run` to preview the `thread.create` and
`thread.turn.start` pair without running them. The child inherits the parent's project, model
selection, runtime mode, and interaction mode, unless `--provider`, `--model`, `--speed`, or
`--thinking-effort` override them.

`task-status` reports `status` (`running`, `completed`, `failed`, `interrupted`), `workState`
(`working` or `result_available`), and `summary` (the child's latest assistant text, if any). A
task id from another project is rejected with `TASK_NOT_FOUND`.

`task-cancel` interrupts the child's active turn through the real `thread.turn.interrupt` path.
Cancelling a terminal task is a no-op: it dispatches nothing. When no interrupt can dispatch, it
returns `TASK_CANCEL_UNSUPPORTED` (exit code 4), instead of faking a cancellation.

When one delegation grows into a planned multi-task effort — per-task model selection, fan-out
with merging, adversarial checks, cost-aware routing — load the `t3code-orchestrate` skill instead.
Do not build that by hand from these primitives.
