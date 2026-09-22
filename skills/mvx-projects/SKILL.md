---
name: mvx-projects
description: Resolve folders to Monvex projects and ensure they exist. Use when the task needs mvx projects list, resolve, or ensure, or must confirm which project a folder belongs to before writing.
---

# Manage Monvex projects

Use `mvx` for all commands.

```bash
mvx --json projects list
mvx --json projects resolve --cwd .
mvx --json projects ensure --cwd . --project-policy create
```

- `list`: shows every active project, with its id, workspace root, and title.
- `resolve`: maps a folder to its existing project. It writes nothing. The default `workspaceMode` is `repo`; this resolves nested folders to their Git root. Use `--workspace-mode folder` only when the exact subfolder must be its own project.
- `ensure`: resolves the project and creates it if missing. Use `--project-policy existing` when you cannot create a project (the default policy is `create`). Add `--dry-run` to preview the `project.create` command without running it.

Run `resolve` before any write command, so the thread lands in the right project. Read `data.project`: `id`, `workspaceRoot`, `title`. A `null` project means no project covers that folder yet.
