---
name: use-moxen
description: Route to the right moxen skill for the job at hand. Use when the task involves Moxen but no function skill is loaded yet, or to recall the shared CLI conventions.
---

# Use Moxen CLI

Use `moxen` for all commands. Do not read provider credentials. Do not build bearer tokens by hand.

## Which skill to load

| Job | Skill |
| --- | --- |
| Hand the current conversation to a fresh thread | `moxen-handoff` |
| Check that Moxen is running and reachable | `moxen-doctor` |
| View or change CLI settings | `moxen-config` |
| Resolve, ensure, or list projects | `moxen-projects` |
| Pick valid provider, model, or effort values | `moxen-providers` |
| Start a new thread; or discover, inspect, read, message, settle, unsettle, snooze, interrupt, or delegate sub-agent tasks | `moxen-threads` |
| Plan and run a task across the best model per sub-task, with fan-out, polling, merging, and cost-aware routing | `moxen-orchestrate` |

Load the function skill before you act. The rest of this page is shared conventions only.

## Shared conventions

- Prefer `--json`. Read the `{ "ok": true, "data": ... }` envelope. On `{ "ok": false }`, report `error.code` and `error.message`.
- Pass prompts over `--stdin` or `--prompt-file`, to avoid shell quoting and command-length problems. On macOS/Linux, `printf '%s' "$text" | moxen ... --stdin` works and keeps UTF-8 intact. On Windows PowerShell, prefer `--prompt-file` over a piped `--stdin`: PowerShell 5.1 (used when something shells out to `powershell` instead of `pwsh`) silently turns non-ASCII characters into `?`, and still reports `ok: true`. `--prompt-file` skips the shell, and is safe on both platforms.
- Use `--dry-run --open none` to inspect a proposed command without changing any state.
- Do not retry a write command blindly. On a handover, `THREAD_START_FAILED` already tries to delete the new thread. On a `threads send`, the existing thread is always left untouched.
- For a write to an existing thread, require `data.verification.accepted: true`. `THREAD_TURN_NOT_VERIFIED`, `THREAD_SETTLEMENT_NOT_VERIFIED`, `THREAD_SNOOZE_NOT_VERIFIED`, `THREAD_UNSNOOZE_NOT_VERIFIED`, and `THREAD_INTERRUPT_NOT_VERIFIED` all mean the dispatch returned, but projection verification timed out. Do not retry automatically — the first operation may still appear later.

## Optional front-end integration

You can call the CLI from a trusted application backend, to power a **Send to Moxen** button. Keep the repository root server-owned. Pass CLI options as process arguments. Send the prompt over stdin. A browser should call the protected backend endpoint — it should not try to launch the local CLI itself.

## Compatibility boundary

Worktree handovers follow the installation's `newWorktreesStartFromOrigin` setting. `WORKTREE_REQUIRES_BRANCH` means the selected folder is not a Git repository on a branch. Retry with `--checkout current` only with explicit user or caller authority.

A send to an existing thread keeps the target's saved model, runtime mode, and interaction mode.

Use `moxen --json request get <path>` only as a read-only escape hatch.
