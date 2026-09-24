/**
 * Projects CLI: `--json` envelopes over `ClientApi` project reads and
 * `project.ensure`. Writes apply synchronously, so `dispatch` is always
 * null and `verification` is folded into the result itself. Envelope keys
 * are unchanged.
 */
import type { CliConfig, ProjectPolicy, WorkspaceMode } from "../../core/types.js";
import { cliClient } from "../infra/client.js";
import { directAuth, directRuntime } from "../infra/direct.js";

export interface WorkspaceOptions {
  cwd?: string;
  workspaceMode?: WorkspaceMode;
}

export async function listProjects(config: CliConfig) {
  const { projects } = await (await cliClient(config)).query({ type: "projects.list" });
  return { runtime: directRuntime(), auth: directAuth(), projects };
}

export async function resolveProject(config: CliConfig, options: WorkspaceOptions) {
  const resolved = await (await cliClient(config)).query({
    type: "project.resolve",
    cwd: options.cwd ?? process.cwd(),
    ...(options.workspaceMode !== undefined ? { workspaceMode: options.workspaceMode } : {}),
  });
  return { runtime: directRuntime(), ...resolved };
}

export async function ensureProject(
  config: CliConfig,
  options: WorkspaceOptions & { projectPolicy?: ProjectPolicy; dryRun?: boolean },
) {
  const ensured = await (await cliClient(config)).dispatch({
    type: "project.ensure",
    cwd: options.cwd ?? process.cwd(),
    ...(options.workspaceMode !== undefined ? { workspaceMode: options.workspaceMode } : {}),
    ...(options.projectPolicy !== undefined ? { projectPolicy: options.projectPolicy } : {}),
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
  });
  return { runtime: directRuntime(), ...ensured, dispatch: null };
}
