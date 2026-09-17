---
name: use-t3code-cli
description: Route to the right t3code skill for the job at hand. Use when the task involves T3 Code but no function skill is loaded yet, or to recall the shared CLI conventions.
---

# Use T3 Code CLI

Use `t3code` for all commands. Do not read T3 credentials. Do not build bearer tokens by hand.

## Which skill to load

| Job | Skill |
| --- | --- |
| Hand the current conversation to a fresh thread | `t3code-handoff` |
| Check that T3 Code is running and reachable | `t3code-doctor` |
| View or change CLI settings | `t3code-config` |
| Resolve, ensure, or list projects | `t3code-projects` |
| Pick valid provider, model, or effort values | `t3code-providers` |
| Start a new thread; or discover, inspect, read, message, settle, unsettle, snooze, interrupt, or delegate sub-agent tasks | `t3code-threads` |
| Plan and run a task across the best model per sub-task, with fan-out, polling, merging, and cost-aware routing | `t3code-orchestrate` |

Load the function skill before you act. The rest of this page is shared conventions only.

## Shared conventions

- Prefer `--json`. Read the `{ "ok": true, "data": ... }` envelope. On `{ "ok": false }`, report `error.code` and `error.message`.
- Pass prompts over `--stdin` or `--prompt-file`, to avoid shell quoting and command-length problems. On macOS/Linux, `printf '%s' "$text" | t3code ... --stdin` works and keeps UTF-8 intact. On Windows PowerShell, prefer `--prompt-file` over a piped `--stdin`: PowerShell 5.1 (used when something shells out to `powershell` instead of `pwsh`) silently turns non-ASCII characters into `?`, and still reports `ok: true`. `--prompt-file` skips the shell, and is safe on both platforms.
- Use `--dry-run --open none` to inspect a proposed command without changing T3 state.
- Do not retry a write command blindly. On a handover, `THREAD_START_FAILED` already tries to delete the new thread. On a `threads send`, the existing thread is always left untouched.
- For a write to an existing thread, require `data.verification.accepted: true`. `THREAD_TURN_NOT_VERIFIED`, `THREAD_SETTLEMENT_NOT_VERIFIED`, `THREAD_SNOOZE_NOT_VERIFIED`, `THREAD_UNSNOOZE_NOT_VERIFIED`, and `THREAD_INTERRUPT_NOT_VERIFIED` all mean the dispatch returned, but projection verification timed out. Do not retry automatically — the first operation may still appear later.

## Optional front-end integration

You can call the CLI from a trusted application backend, to power a **Send to T3 Code** button. Keep the repository root server-owned. Pass CLI options as process arguments. Send the prompt over stdin. A browser should call the protected backend endpoint — it should not try to launch the local CLI itself.

## Compatibility boundary

T3 0.0.28 and later support new-worktree handovers, through the atomic bootstrap contract. Worktree creation follows the installation's explicit `newWorktreesStartFromOrigin` setting. When that setting is absent, use the installed version's default: `false` on 0.0.28, `true` on 0.0.29 and later. `WORKTREE_REQUIRES_BRANCH` means the selected folder is not a Git repository on a branch. Retry with `--checkout current` only with explicit user or caller authority.

Thread settlement commands need a T3 server that exposes the `threadSettlement` capability. A send to an existing thread keeps the target's saved model, runtime mode, and interaction mode.

Use `t3code --json request get <path>` only as a read-only escape hatch.
