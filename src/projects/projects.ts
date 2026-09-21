/**
 * Own projects registry: the ID table T3's projection database used to be.
 *
 * Projects live in `<storeRoot>/projects.json` (`{version, projects}`),
 * keyed by normalized workspace root with soft deletes. `list/resolve`
 * are reads; `ensure` with `create` policy inserts (title = basename,
 * null default model — the explicit-default decision lands at send
 * time, replacing the old version-dependent passthrough).
 * See DECOUPLE.md §10.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { CliError } from "../errors.js";
import type {
  EffectiveThreadEnvMode,
  ModelSelection,
  ProjectPolicy,
  T3Project,
} from "../types.js";

/**
 * A `type` (not interface) so values carry an implicit index signature and
 * stay assignable to `T3Project` for envelope projection.
 */
export type StoredProject = {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly defaultModelSelection: ModelSelection | null;
  readonly defaultThreadEnvMode?: EffectiveThreadEnvMode | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
};

export function registryFile(root: string): string {
  return path.join(root, "projects.json");
}

/**
 * Workspace-root equality: resolved + normalized, trailing separators
 * stripped, case-insensitive on win32 only. Same semantics as the former
 * `cli/infra/workspace.ts` `pathsEqual` (kept here so `src/projects`
 * never imports from `src/cli`).
 */
export function workspaceRootsEqual(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    let resolved = path.normalize(path.resolve(value));
    while (resolved.length > 1 && (resolved.endsWith(path.sep) || resolved.endsWith("/"))) {
      resolved = resolved.slice(0, -1);
    }
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function normalizeRoot(root: string): string {
  let resolved = path.normalize(path.resolve(root));
  while (resolved.length > 1 && (resolved.endsWith(path.sep) || resolved.endsWith("/"))) {
    resolved = resolved.slice(0, -1);
  }
  return resolved;
}

async function loadAll(root: string): Promise<StoredProject[]> {
  let text: string;
  try {
    text = await readFile(registryFile(root), "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw new CliError("STORE_READ_FAILED", `Could not read the projects registry at ${registryFile(root)}.`, {
      cause,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new CliError("STORE_CORRUPT", `Could not parse ${registryFile(root)}.`, { cause });
  }
  const projects = (parsed as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) {
    throw new CliError("STORE_CORRUPT", `Projects registry at ${registryFile(root)} has no projects array.`, {});
  }
  return projects.filter((entry): entry is StoredProject => {
    if (entry === null || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.workspaceRoot === "string";
  });
}

async function saveAll(root: string, projects: ReadonlyArray<StoredProject>): Promise<void> {
  try {
    await mkdir(root, { recursive: true });
    const file = registryFile(root);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, projects }, null, 2));
    await rename(tmp, file);
  } catch (cause) {
    throw new CliError("STORE_WRITE_FAILED", `Could not write the projects registry at ${registryFile(root)}.`, {
      cause,
    });
  }
}

export async function listStoredProjects(root: string): Promise<StoredProject[]> {
  return (await loadAll(root)).filter((project) => project.deletedAt == null);
}

export async function resolveStoredProject(root: string, workspaceRoot: string): Promise<StoredProject | null> {
  const projects = await listStoredProjects(root);
  return projects.find((project) => workspaceRootsEqual(project.workspaceRoot, workspaceRoot)) ?? null;
}

export interface EnsureProjectInput {
  /** Explicit id (imports/tests); generated when omitted. */
  readonly id?: string;
  readonly workspaceRoot: string;
  readonly policy?: ProjectPolicy;
  readonly title?: string;
  readonly defaultModelSelection?: ModelSelection | null;
  readonly defaultThreadEnvMode?: EffectiveThreadEnvMode | null;
  readonly now?: () => string;
}

export interface EnsureProjectResult {
  readonly project: StoredProject;
  readonly created: boolean;
  /**
   * Synthesized `project.create` command (envelope compat; applied
   * synchronously, so `dispatch` stays null). Null when the project
   * already existed, matching the old API behavior.
   */
  readonly command: {
    readonly type: "project.create";
    readonly commandId: string;
    readonly projectId: string;
    readonly title: string;
    readonly workspaceRoot: string;
    readonly createWorkspaceRootIfMissing: true;
    readonly defaultModelSelection: null;
    readonly createdAt: string;
  } | null;
}

export function projectTitle(workspaceRoot: string): string {
  return path.basename(workspaceRoot) || "project";
}

/** Non-deleted projects. Pure; kept for envelope assembly over T3Project rows. */
export function activeProjects(projects: readonly T3Project[]): T3Project[] {
  return projects.filter((project) => project.deletedAt == null);
}

/** First active project whose normalized root matches. Pure. */
export function projectForWorkspace(
  projects: readonly T3Project[],
  workspaceRoot: string,
): T3Project | null {
  return activeProjects(projects).find((project) => workspaceRootsEqual(project.workspaceRoot, workspaceRoot)) ?? null;
}

export async function ensureStoredProject(root: string, input: EnsureProjectInput): Promise<EnsureProjectResult> {
  const normalized = normalizeRoot(input.workspaceRoot);
  const existing = await resolveStoredProject(root, normalized);
  if (existing) return { project: existing, created: false, command: null };
  const policy = input.policy ?? "create";
  if (policy === "existing") {
    throw new CliError("PROJECT_NOT_FOUND", `No t3code project exists for ${normalized}.`, {
      details: { workspaceRoot: normalized, projectPolicy: policy },
    });
  }
  const now = input.now ?? (() => new Date().toISOString());
  const createdAt = now();
  const title = input.title?.trim() || projectTitle(normalized);
  const all = await loadAll(root);
  const id = input.id?.trim() || randomUUID();
  if (input.id?.trim() && all.some((entry) => entry.id === id)) {
    throw new CliError("PROJECT_ALREADY_EXISTS", `A project already exists with id ${id}.`, {
      exitCode: 4,
      details: { projectId: id },
    });
  }
  const project: StoredProject = {
    id,
    title,
    workspaceRoot: normalized,
    defaultModelSelection: input.defaultModelSelection ?? null,
    ...(input.defaultThreadEnvMode !== undefined ? { defaultThreadEnvMode: input.defaultThreadEnvMode } : {}),
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
  await saveAll(root, [...all, project]);
  return { project, created: true, command: buildProjectCreateCommand(normalized, title, createdAt, project.id) };
}

function buildProjectCreateCommand(
  workspaceRoot: string,
  title: string,
  createdAt: string,
  projectId: string,
) {
  return {
    type: "project.create" as const,
    commandId: randomUUID(),
    projectId,
    title,
    workspaceRoot,
    createWorkspaceRootIfMissing: true as const,
    defaultModelSelection: null,
    createdAt,
  };
}
