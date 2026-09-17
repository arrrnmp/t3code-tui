---
name: t3code-config
description: View or change t3code CLI settings. Use when the task needs the config path, the current settings, or setting projectPolicy, workspaceMode, openMode, threadEnvMode, runtimeMode, interactionMode, provider, model, speedMode, or thinkingEffort defaults.
---

# Manage t3code settings

Use `t3code` for all commands.

```bash
t3code config path
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

Order of precedence for a new thread:

1. Command flags.
2. CLI config (this file's settings).
3. The T3 project's saved model selection.

`projectPolicy: "existing"` turns a missing project into an error.

`workspaceMode: "folder"` uses the exact current folder. It does not walk up to the Git root.
