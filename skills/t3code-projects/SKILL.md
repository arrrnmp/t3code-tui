---
name: t3code-projects
description: Resolve folders to T3 Code projects and ensure they exist. Use when the task needs t3code projects list, resolve, or ensure, or must confirm which project a folder belongs to before writing.
---

# Manage T3 Code projects

Use `t3code` for all commands.

```bash
t3code --json projects list
t3code --json projects resolve --cwd .
t3code --json projects ensure --cwd . --project-policy create
```

- `list`: shows every active project, with its id, workspace root, and title.
- `resolve`: maps a folder to its existing project. It writes nothing. The default `workspaceMode` is `repo`; this resolves nested folders to their Git root. Use `--workspace-mode folder` only when the exact subfolder must be its own T3 project.
- `ensure`: resolves the project and creates it if missing. Use `--project-policy existing` when you cannot create a project (the default policy is `create`). Add `--dry-run` to preview the `project.create` command without running it.

Run `resolve` before any write command, so the thread lands in the right project. Read `data.project`: `id`, `workspaceRoot`, `title`. A `null` project means no project covers that folder yet.
