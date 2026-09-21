/**
 * Projects CLI: list/resolve/ensure over the own registry
 * (`src/projects`). No server, no bearer tokens, no dispatch round-trip —
 * writes apply synchronously, so `dispatch` is always null and
 * `verification` is folded into the result itself. Envelope keys are
 * unchanged from the T3 era.
 */
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  ensureStoredProject,
  listStoredProjects,
  resolveStoredProject,
} from "../../projects/projects.js";
export { activeProjects, projectForWorkspace } from "../../projects/projects.js";
import { resolveStoreRoot } from "../../threads/store.js";
import type { CliConfig, ProjectPolicy, WorkspaceMode } from "../../types.js";
import { directAuth, directRuntime } from "../infra/direct.js";
import { resolveWorkspace } from "../infra/workspace.js";

export interface WorkspaceOptions {
  cwd?: string;
  workspaceMode?: WorkspaceMode;
}

export async function listProjects(_config: CliConfig) {
  const projects = await listStoredProjects(resolveStoreRoot());
  return { runtime: directRuntime(), auth: directAuth(), projects };
}

export async function resolveProject(config: CliConfig, options: WorkspaceOptions) {
  const workspace = await resolveWorkspace(options.cwd ?? process.cwd(), options.workspaceMode ?? config.workspaceMode);
  const project = await resolveStoredProject(resolveStoreRoot(), workspace.workspaceRoot);
  return { runtime: directRuntime(), workspace, project };
}

export async function ensureProject(
  config: CliConfig,
  options: WorkspaceOptions & { projectPolicy?: ProjectPolicy; dryRun?: boolean },
) {
  const workspace = await resolveWorkspace(options.cwd ?? process.cwd(), options.workspaceMode ?? config.workspaceMode);
  const policy = options.projectPolicy ?? config.projectPolicy;
  if (options.dryRun === true) {
    const root = resolveStoreRoot();
    const project = await resolveStoredProject(root, workspace.workspaceRoot);
    if (!project && policy === "existing") {
      // Always throws PROJECT_NOT_FOUND here; reuses the policy error path without writing.
      await ensureStoredProject(root, { workspaceRoot: workspace.workspaceRoot, policy });
    }
    if (project) return { runtime: directRuntime(), workspace, project, created: false, command: null, dispatch: null };
    const previewCreatedAt = new Date().toISOString();
    const preview = {
      id: randomUUID(),
      title: path.basename(workspace.workspaceRoot) || "project",
      workspaceRoot: workspace.workspaceRoot,
      defaultModelSelection: null,
      createdAt: previewCreatedAt,
      updatedAt: previewCreatedAt,
      deletedAt: null,
    };
    return {
      runtime: directRuntime(),
      workspace,
      project: preview,
      created: true,
      command: {
        type: "project.create" as const,
        commandId: randomUUID(),
        projectId: preview.id,
        title: preview.title,
        workspaceRoot: preview.workspaceRoot,
        createWorkspaceRootIfMissing: true as const,
        defaultModelSelection: null,
        createdAt: previewCreatedAt,
      },
      dispatch: null,
    };
  }
  const { project, created, command } = await ensureStoredProject(resolveStoreRoot(), {
    workspaceRoot: workspace.workspaceRoot,
    policy,
  });
  if (created) {
    // The old `createWorkspaceRootIfMissing` contract, honored locally.
    await mkdir(workspace.workspaceRoot, { recursive: true }).catch(() => undefined);
  }
  return { runtime: directRuntime(), workspace, project, created, command, dispatch: null };
}
