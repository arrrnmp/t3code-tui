---
name: mvx-doctor
description: Diagnose the local Monvex connection with mvx doctor. Use to check whether Monvex is running and reachable before any other mvx command, or when a mvx command fails with connection errors.
---

# Diagnose Monvex with mvx doctor

Use `mvx` for all commands. Do not read provider credentials. Do not build bearer tokens by hand.

Run this first:

```bash
mvx --json doctor
```

Check `data.ok`. If it is `false`, stop. Do not run a write command.

- `data.checks.t3Server.ok` is `false`: Monvex is not running. Ask the user to start it. Do not write or create anything.
- A `data.checks.*.ok` of `false` names the provider binary or login that is missing. Tell the user the setup step it reports.
- `data.checks.git.ok` is `false`: Git is missing. Repo-mode workspace resolution will not work.

## Capability notes for thread commands

| Capability or contract | Effect when missing |
| --- | --- |
| `threadSettlement`, advertised by the server | `threads settle` and `threads unsettle` fail with `THREAD_SETTLEMENT_UNSUPPORTED` (exit code 4). |
| V1 `thread.snooze` and `thread.unsnooze` commands | `threads snooze` and `threads unsnooze` fail to dispatch. A missing projection shows as `THREAD_SNOOZE_NOT_VERIFIED` or `THREAD_UNSNOOZE_NOT_VERIFIED` (exit code 5). |
| V1 `thread.turn.interrupt` command | `threads interrupt` fails with `THREAD_INTERRUPT_FAILED` (exit code 4). `threads task-cancel` reports `TASK_CANCEL_UNSUPPORTED` (exit code 4). |
| Sub-agent delegation | This always runs client-side on V1. `threads delegate` creates a normal child thread and polls it. There is no server capability to check. A wait timeout exits with code 0 and `data.task.waitTimedOut: true`. |
