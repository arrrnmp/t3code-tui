---
name: t3code-doctor
description: Diagnose the local T3 Code connection with t3code doctor. Use to check whether T3 Code is running and reachable before any other t3code command, or when a t3code command fails with connection errors.
---

# Diagnose T3 Code with t3code doctor

Use `t3code` for all commands. Do not read T3 credentials. Do not build bearer tokens by hand.

Run this first:

```bash
t3code --json doctor
```

Check `data.ok`. If it is `false`, stop. Do not run a write command.

- `data.checks.t3Server.ok` is `false`: T3 Code is not running. Ask the user to start it. Do not write or create anything.
- `data.checks.t3Cli.ok` is `false`: the CLI's own connection to T3 is broken. Tell the user to reinstall or update `t3code`.
- `data.checks.git.ok` is `false`: Git is missing. Repo-mode workspace resolution will not work.

## Capability notes for thread commands

| Capability or contract | Effect when missing |
| --- | --- |
| `threadSettlement`, advertised by the server | `threads settle` and `threads unsettle` fail with `THREAD_SETTLEMENT_UNSUPPORTED` (exit code 4). |
| V1 `thread.snooze` and `thread.unsnooze` commands | `threads snooze` and `threads unsnooze` fail to dispatch. A missing projection shows as `THREAD_SNOOZE_NOT_VERIFIED` or `THREAD_UNSNOOZE_NOT_VERIFIED` (exit code 5). |
| V1 `thread.turn.interrupt` command | `threads interrupt` fails with `THREAD_INTERRUPT_FAILED` (exit code 4). `threads task-cancel` reports `TASK_CANCEL_UNSUPPORTED` (exit code 4). |
| Sub-agent delegation | This always runs client-side on V1. `threads delegate` creates a normal child thread and polls it. There is no server capability to check. A wait timeout exits with code 0 and `data.task.waitTimedOut: true`. |
