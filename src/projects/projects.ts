import { randomUUID } from "node:crypto";
import path from "node:path";

import { withT3Api, type T3Api } from "../infra/api.js";
import { CliError } from "../errors.js";
import { readLocalProjects } from "../infra/localProjects.js";
import { discoverRuntime } from "../infra/runtime.js";
import type {
  CliConfig,
  ProjectPolicy,
  T3Project,
  T3Thread,
  WorkspaceMode,
} from "../types.js";
import { pathsEqual, resolveWorkspace } from "../infra/workspace.js";

export interface WorkspaceOptions {
  cwd?: string;
  workspaceMode?: WorkspaceMode;
}

export function activeProjects(projects: readonly T3Project[]): T3Project[] {
  return projects.filter((project) => project.deletedAt == null);
}

export function projectForWorkspace(projects: readonly T3Project[], workspaceRoot: string): T3Project | null {
  return activeProjects(projects).find((project) => pathsEqual(project.workspaceRoot, workspaceRoot)) ?? null;
}

async function readOrchestrationState(api: T3Api): Promise<{ projects: T3Project[]; threads: T3Thread[] }> {
  const shell = await api.shellSnapshot().catch(() => null);
  if (shell) {
    return {
      projects: activeProjects(Array.isArray(shell.projects) ? shell.projects : []),
      threads: Array.isArray(shell.threads) ? shell.threads : [],
    };
  }
  const snapshot = await api.snapshot();
  if (!Array.isArray(snapshot.projects)) {
    throw new CliError("T3_INVALID_SNAPSHOT", "T3 returned a snapshot without projects.");
  }
  return {
    projects: activeProjects(snapshot.projects),
    threads: Array.isArray(snapshot.threads) ? snapshot.threads : [],
  };
}

export async function projectsFromApi(api: T3Api): Promise<T3Project[]> {
  return (await readOrchestrationState(api)).projects;
}

function buildProjectCreateCommand(
  workspaceRoot: string,
  title: string,
  createdAt: string,
) {
  const projectId = randomUUID();
  return {
    projectId,
    command: {
      type: "project.create",
      commandId: randomUUID(),
      projectId,
      title,
      workspaceRoot,
      // Match first-party clients: the server ignores a sent default (it always
      // persists null; explicit defaults use project.meta.update), and it is
      // allowed to create a missing workspace root.
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: null,
      createdAt,
    },
  } as const;
}

function projectTitle(workspaceRoot: string): string {
  return path.basename(workspaceRoot) || "project";
}

export async function ensureProjectWithApi(
  api: T3Api,
  initialProjects: readonly T3Project[] | null,
  workspaceRoot: string,
  policy: ProjectPolicy,
  dryRun: boolean,
): Promise<{ project: T3Project; created: boolean; command: unknown | null; dispatch: unknown | null }> {
  const projects = initialProjects ?? (await projectsFromApi(api));
  const existing = projectForWorkspace(projects, workspaceRoot);
  if (existing) return { project: existing, created: false, command: null, dispatch: null };
  if (policy === "existing") {
    throw new CliError("PROJECT_NOT_FOUND", `No T3 Code project exists for ${workspaceRoot}.`, {
      details: { workspaceRoot, projectPolicy: policy },
    });
  }

  const createdAt = new Date().toISOString();
  const create = buildProjectCreateCommand(
    workspaceRoot,
    projectTitle(workspaceRoot),
    createdAt,
  );
  const project: T3Project = {
    id: create.projectId,
    title: projectTitle(workspaceRoot),
    workspaceRoot,
    defaultModelSelection: null,
    deletedAt: null,
  };
  const dispatch = dryRun ? null : await api.dispatch(create.command);
  return { project, created: true, command: create.command, dispatch };
}

export async function listProjects(config: CliConfig) {
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: false });
  const localProjects = await readLocalProjects(runtime);
  if (localProjects) {
    return { runtime, auth: { source: "local-sqlite", version: runtime.serverVersion }, projects: localProjects };
  }
  return await withT3Api(runtime, config, async (api, invocation) => {
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      projects: await projectsFromApi(api),
    };
  });
}

export async function resolveProject(config: CliConfig, options: WorkspaceOptions) {
  const workspace = await resolveWorkspace(options.cwd ?? process.cwd(), options.workspaceMode ?? config.workspaceMode);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: false });
  const localProjects = await readLocalProjects(runtime);
  if (localProjects) {
    return { runtime, workspace, project: projectForWorkspace(localProjects, workspace.workspaceRoot) };
  }
  return await withT3Api(runtime, config, async (api) => {
    const projects = await projectsFromApi(api);
    return { runtime, workspace, project: projectForWorkspace(projects, workspace.workspaceRoot) };
  });
}

export async function ensureProject(config: CliConfig, options: WorkspaceOptions & { projectPolicy?: ProjectPolicy; dryRun?: boolean }) {
  const workspace = await resolveWorkspace(options.cwd ?? process.cwd(), options.workspaceMode ?? config.workspaceMode);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });
  const localProjects = await readLocalProjects(runtime);
  return await withT3Api(runtime, config, async (api) => ({
    runtime,
    workspace,
    ...(await ensureProjectWithApi(
      api,
      localProjects,
      workspace.workspaceRoot,
      options.projectPolicy ?? config.projectPolicy,
      options.dryRun ?? false,
    )),
  }));
}

export async function rawGet(config: CliConfig, requestPath: string) {
  if (!requestPath.startsWith("/") || requestPath.startsWith("//")) {
    throw new CliError("INVALID_REQUEST_PATH", "Request path must start with one slash.");
  }
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: false });
  return await withT3Api(runtime, config, async (api) => ({
    runtime,
    response: await api.request("GET", requestPath),
  }));
}
