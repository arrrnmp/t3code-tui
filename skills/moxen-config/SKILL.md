---
name: moxen-config
description: View or change moxen CLI settings. Use when the task needs the config path, the current settings, or setting projectPolicy, workspaceMode, openMode, threadEnvMode, runtimeMode, interactionMode, provider, model, speedMode, or thinkingEffort defaults.
---

# Manage moxen settings

Use `moxen` for all commands.

```bash
moxen config path
moxen config show
moxen config set projectPolicy existing
moxen config set workspaceMode folder
moxen config set openMode browser
moxen config set threadEnvMode local
moxen config set provider codex
moxen config set model gpt-6-astra
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
| `provider` | Configured provider instance id | project selection |
| `model` | Provider model slug | project selection |
| `speedMode` | `standard`, `fast` | project selection |
| `thinkingEffort` | Model-supported effort value | project selection |

Order of precedence for a new thread:

1. Command flags.
2. CLI config (this file's settings).
3. The project's saved model selection.

`projectPolicy: "existing"` turns a missing project into an error.

`workspaceMode: "folder"` uses the exact current folder. It does not walk up to the Git root.
