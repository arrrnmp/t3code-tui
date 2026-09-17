---
name: t3code-handoff
description: Hand the current conversation off to a fresh thread in T3 Code.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a summary of this conversation. A fresh thread will use it to continue the work. Then start
that thread with one `handover` call.

T3 Code must already be running — this skill hands off *to* it. Use the installed `t3code` command
directly: bash (or another POSIX shell) on macOS and Linux, PowerShell on Windows.

## Steps

### 1. Check that T3 is reachable

Do this before anything else.

```bash
t3code --json doctor
```

The envelope is `{ ok, data: { ok, checks } }`. Check `data.ok` and `data.checks.t3Server.ok`.

- If either is `false`: stop. Tell the user to start T3 Code. Write nothing. Create nothing.
- If `data.checks.t3Cli.ok` is `false`: the installed CLI's own connection to T3 is broken. Tell the
  user to reinstall or update `t3code`. Do not try to patch it in place.

### 2. Write the summary to a file

Write it to a text file in the OS temp directory, as UTF-8. Use `$env:TEMP` on Windows, or
`$TMPDIR` (or `/tmp`) on macOS and Linux.

This file becomes the new thread's first prompt, word for word. Redact API keys, passwords, bearer
tokens, and personal data before you write it.

### 3. Resolve the project

```bash
t3code --json projects resolve --cwd "<project folder>"
```

Pass the folder the work belongs to — not wherever the shell happens to sit. You may have changed
directory since the conversation started.

The default `workspaceMode: repo` walks up to the Git root. Use this in almost every case. Pass
`--workspace-mode folder` only when the exact subfolder must be its own project.

### 4. Ask which provider, model, and effort to use

Ask the user every time. Do not hardcode a provider. Do not infer the model or effort from this
session.

One command gives you what you need to build the question:

```bash
t3code --json providers list
```

This returns every provider instance, each with its `models[]`, and each model with its effort
descriptors and their choices. Narrow the result with `t3code --json models list --provider
<provider>` or `t3code --json efforts list --provider <provider> --model <model>`, if the full
payload is too large. All three commands accept `--refresh`; use it when a status looks stale.

Reading the output:

- Offer only providers with `enabled: true`. Selecting a disabled provider fails. A disabled
  provider can still list models — do not judge by the model count.
- Skip models with `isHidden: true` when suggesting choices to the user — they hid it from T3's
  own picker. It still works if the user names it explicitly.
- Not every effort descriptor is a reasoning effort. Only the descriptor with `id: "effort"` gives
  valid `--thinking-effort` values. A `contextWindow` descriptor has no handover flag. `fastMode`
  maps to `--speed`. `isDefault` marks the default choice.
- Some models have no `effort` descriptor. Omit `--thinking-effort` for those.

Provider and model are always required. Never accept a blank answer for either. If the chosen
provider differs from the project's default instance, and no model is given, the CLI fails with
`MODEL_REQUIRED_FOR_PROVIDER`.

### 5. Dispatch the handover

macOS/Linux (bash):

```bash
t3code --json handover \
  --cwd "<project folder>" \
  --prompt-file "<path to the summary file>" \
  --provider <provider> \
  --model <model> \
  --thinking-effort <thinking-effort> \
  --checkout current \
  --permission full-access
```

Windows (PowerShell):

```powershell
t3code --json handover `
  --cwd "<project folder>" `
  --prompt-file "<path to the summary file>" `
  --provider <provider> `
  --model <model> `
  --thinking-effort <thinking-effort> `
  --checkout current `
  --permission full-access
```

- Always pass `--cwd`, with the same folder you resolved in step 3. Without it, the CLI uses
  `process.cwd()` of wherever it runs, which may not be the project you mean.
- `--checkout current` uses the existing checkout in place. `--checkout worktree` creates a
  worktree and runs T3's setup script server-side. Use it only when you want isolation, on a repo
  with a current branch, and on T3 `>=0.0.28`.
- `--permission full-access` is the normal choice. For Claude or Codex, use `--permission auto`.
- Drop `--thinking-effort` only when the model has no `effort` descriptor.
- To validate without writing T3 state, add `--open none --dry-run`.

On Windows, use `--prompt-file`. Do not pipe a prompt over `--stdin`. Windows PowerShell 5.1 turns
every non-ASCII character in a piped prompt into `?`, and fails silently: the call still returns
`ok: true`, and the thread is still created. pwsh 7 does not have this bug, but a tool that shells
out to `powershell` instead of `pwsh` gets 5.1. `--prompt-file` skips the shell, so it avoids the
bug.

On macOS/Linux, a piped prompt is safe: `printf '%s' "$PROMPT" | t3code --json handover --stdin
...` keeps UTF-8 intact. `--prompt-file` still works there too, and keeps the command the same
across platforms.

After you dispatch, check the echoed prompt in the JSON response for a stray `?` where punctuation
should be. That is the only sign of this failure.

### 6. Read the result

Check the top-level `ok` field.

If `true`: report that the thread was created and started. Give `data.thread.id` and
`data.project.title`. Say T3 Code should now show it open (`data.opened`). Nothing needs polling.

If `false`: report the `error: { code, message, details }` envelope, word for word. Do not retry
silently.

| Code | Meaning |
|---|---|
| `T3_SERVER_UNAVAILABLE` | Tell the user to start T3 Code. |
| `T3_CLI_NOT_FOUND`, `T3_AUTH_FAILED` | Tell the user to reinstall or update `t3code`. |
| `WORKTREE_HANDOVER_UNSUPPORTED`, `WORKTREE_REQUIRES_BRANCH` | Version or branch precondition failed. |
| `THREAD_START_FAILED` | Check `details.cleanup`. |

## Writing the summary

Do not repeat content that already lives in another artifact — a spec, a plan, an issue, a commit,
or a diff. Reference it by path instead.

If the user gave arguments, treat them as the next thread's focus. Tailor the summary to it.
