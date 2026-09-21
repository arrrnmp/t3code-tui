/**
 * Handover/thread-create over the own store. Same envelope keys as the T3
 * era, with two documented replacements:
 * - The server-side `bootstrap.prepareWorktree` round-trip is gone: the
 *   worktree is provisioned locally with git (`t3code/<short>` branch off
 *   the base or its origin) and reported in a top-level `worktree` field
 *   instead of inside the turn command. There is no setup-script step —
 *   no config source names one.
 * - `dispatch`/`createDispatch`/`projectDispatch` are always null (writes
 *   apply synchronously); `verification` is folded into acceptance.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import * as Effect from "effect/Effect";

import { CliError } from "../../errors.js";
import { ensureStoredProject, resolveStoredProject } from "../../projects/projects.js";
import { openThreadStore, resolveStoreRoot } from "../../threads/store.js";
import {
  createThread as createStoredThread,
  deleteThread as deleteStoredThread,
  interruptTurn as interruptStoredTurn,
  sendTurn as sendStoredTurn,
} from "../../threads/threads.js";
import { driverForInstance, executeTurn, waitForTurnTerminal, type TurnDriverFactories } from "../../threads/execute.js";
import { runProcess } from "../infra/process.js";
import { resolveWorkspace } from "../infra/workspace.js";
import { directAuth, directRuntime } from "../infra/direct.js";
import { defaultModelSelection, resolveModelSelection, type ModelSelectionRequest } from "../shared/selection.js";
import type { WorkspaceOptions } from "../projects/projects.js";
import type {
  CliConfig,
  EffectiveThreadEnvMode,
  InteractionMode,
  ModelSelection,
  OpenMode,
  ProjectPolicy,
  RuntimeMode,
  ThreadEnvMode,
} from "../../types.js";

export interface ThreadCreateOptions extends WorkspaceOptions, ModelSelectionRequest {
  prompt: string;
  projectPolicy?: ProjectPolicy;
  openMode?: OpenMode;
  threadEnvMode?: ThreadEnvMode;
  runtimeMode?: RuntimeMode;
  interactionMode?: InteractionMode;
  dryRun?: boolean;
  drivers?: TurnDriverFactories;
  /** Return at acceptance; otherwise block until the first turn settles. */
  noWait?: boolean;
}

interface ProjectFileSettings {
  defaultThreadEnvMode: EffectiveThreadEnvMode | null;
}

function asEffectiveThreadEnvMode(value: unknown): EffectiveThreadEnvMode | null {
  return value === "local" || value === "worktree" ? value : null;
}

async function readProjectFile(workspaceRoot: string): Promise<ProjectFileSettings> {
  try {
    const raw = JSON.parse(await readFile(path.join(workspaceRoot, "t3.json"), "utf8")) as Record<string, unknown>;
    return { defaultThreadEnvMode: asEffectiveThreadEnvMode(raw.defaultThreadEnvMode) };
  } catch {
    return { defaultThreadEnvMode: null };
  }
}

function threadTitle(prompt: string): string {
  const title = prompt.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, " ").trim() || "New thread";
  return title.length <= 80 ? title : `${title.slice(0, 79)}…`;
}

export interface WorktreeProvision {
  readonly path: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly startFromOrigin: boolean;
}

async function gitOk(cwd: string, args: ReadonlyArray<string>): Promise<boolean> {
  try {
    await runProcess("git", [...args], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Provision `t3code/<thread-short>` off the base branch (or its origin
 * when `startFromOrigin`) under the store worktrees dir. Throws
 * WORKTREE_PROVISION_FAILED with best-effort cleanup; callers create the
 * thread only after this resolves, so failures leave nothing behind.
 */
export async function provisionWorktree(input: {
  projectCwd: string;
  baseBranch: string;
  startFromOrigin: boolean;
  threadId: string;
  storeRoot: string;
}): Promise<WorktreeProvision> {
  const short = input.threadId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "thread";
  // Inside the store root so store cleanup owns the checkout too.
  const dir = path.join(input.storeRoot, "worktrees", input.threadId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const branch = attempt === 0 ? `t3code/${short}` : `t3code/${short}-${attempt + 1}`;
    try {
      let startPoint = input.baseBranch;
      if (input.startFromOrigin) {
        await gitOk(input.projectCwd, ["fetch", "origin", input.baseBranch]);
        if (await gitOk(input.projectCwd, ["rev-parse", "--verify", `origin/${input.baseBranch}`])) {
          startPoint = `origin/${input.baseBranch}`;
        }
      }
      await runProcess("git", ["worktree", "add", "-b", branch, dir, startPoint], { cwd: input.projectCwd });
      return { path: dir, branch, baseBranch: input.baseBranch, startFromOrigin: input.startFromOrigin };
    } catch (cause) {
      await runProcess("git", ["worktree", "remove", "--force", dir], { cwd: input.projectCwd }).catch(() => undefined);
      if (attempt === 2) {
        throw new CliError("WORKTREE_PROVISION_FAILED", `Could not provision a worktree for ${input.baseBranch}.`, {
          cause,
          details: { baseBranch: input.baseBranch, startFromOrigin: input.startFromOrigin },
        });
      }
    }
  }
  throw new CliError("WORKTREE_PROVISION_FAILED", `Could not provision a worktree for ${input.baseBranch}.`, {
    details: { baseBranch: input.baseBranch },
  });
}

const driverOwner = {};

export async function createHandoverThread(config: CliConfig, options: ThreadCreateOptions) {
  const prompt = options.prompt.trim();
  if (!prompt) throw new CliError("PROMPT_REQUIRED", "A non-empty handover prompt is required.");

  const storeRoot = resolveStoreRoot();
  const store = await openThreadStore(storeRoot);
  const workspace = await resolveWorkspace(options.cwd ?? process.cwd(), options.workspaceMode ?? config.workspaceMode);
  const projectFile = await readProjectFile(workspace.workspaceRoot);

  // Env-mode precedence: request → project → t3.json → global config.
  // The installation default for new worktrees is to start from origin.
  const requested = options.threadEnvMode;
  const requestMode = requested !== undefined && requested !== "t3" ? requested : undefined;
  const policy = options.projectPolicy ?? config.projectPolicy;
  const dryRun = options.dryRun === true;

  let project;
  let projectCreated;
  let projectCommand;
  if (dryRun) {
    const existing = await resolveStoredProject(storeRoot, workspace.workspaceRoot);
    if (existing) {
      project = existing;
      projectCreated = false;
      projectCommand = null;
    } else {
      if (policy === "existing") {
        // Throws PROJECT_NOT_FOUND without writing anything.
        await ensureStoredProject(storeRoot, { workspaceRoot: workspace.workspaceRoot, policy });
        throw new Error("unreachable");
      }
      const previewCreatedAt = new Date().toISOString();
      project = {
        id: randomUUID(),
        title: path.basename(workspace.workspaceRoot) || "project",
        workspaceRoot: workspace.workspaceRoot,
        defaultModelSelection: null,
        createdAt: previewCreatedAt,
        updatedAt: previewCreatedAt,
        deletedAt: null,
      };
      projectCreated = true;
      projectCommand = {
        type: "project.create" as const,
        commandId: randomUUID(),
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        createWorkspaceRootIfMissing: true as const,
        defaultModelSelection: null,
        createdAt: previewCreatedAt,
      };
    }
  } else {
    const ensured = await ensureStoredProject(storeRoot, {
      workspaceRoot: workspace.workspaceRoot,
      policy,
    });
    project = ensured.project;
    projectCreated = ensured.created;
    projectCommand = ensured.command;
  }

  const globalDefault: EffectiveThreadEnvMode = config.threadEnvMode === "t3" ? "local" : config.threadEnvMode;
  const projectMode = asEffectiveThreadEnvMode(project.defaultThreadEnvMode);
  const envResolution = requestMode !== undefined
    ? { mode: requestMode, source: "request" as const }
    : projectMode
      ? { mode: projectMode, source: "project" as const }
      : projectFile.defaultThreadEnvMode
        ? { mode: projectFile.defaultThreadEnvMode, source: "t3.json" as const }
        : { mode: globalDefault, source: "global" as const };
  const envMode = envResolution.mode;
  if (envMode === "worktree" && (!workspace.isGitRepository || workspace.branch === null)) {
    throw new CliError(
      "WORKTREE_REQUIRES_BRANCH",
      "A new worktree requires a Git repository with a current branch. Use --checkout current for this handover.",
      { details: { isGitRepository: workspace.isGitRepository, currentBranch: workspace.branch } },
    );
  }

  const createdAt = new Date().toISOString();
  const threadId = randomUUID();
  const modelSelection: ModelSelection = resolveModelSelection(
    project.defaultModelSelection ?? defaultModelSelection(),
    config,
    options,
  );
  const title = threadTitle(prompt);
  const runtimeMode = options.runtimeMode ?? config.runtimeMode;
  const interactionMode = options.interactionMode ?? config.interactionMode;

  let worktree: WorktreeProvision | null = null;
  if (envMode === "worktree" && options.dryRun !== true) {
    worktree = await provisionWorktree({
      projectCwd: workspace.workspaceRoot,
      baseBranch: workspace.branch!,
      startFromOrigin: true,
      threadId,
      storeRoot,
    });
  }

  const createThreadCommand = {
    type: "thread.create",
    commandId: randomUUID(),
    threadId,
    projectId: project.id,
    title,
    modelSelection,
    runtimeMode,
    interactionMode,
    branch: worktree?.branch ?? workspace.branch,
    worktreePath: worktree?.path ?? null,
    createdAt,
  };
  const command = {
    type: "thread.turn.start",
    commandId: randomUUID(),
    threadId,
    message: {
      messageId: randomUUID(),
      role: "user",
      text: prompt,
      attachments: [],
    },
    modelSelection,
    titleSeed: title,
    runtimeMode,
    interactionMode,
    createdAt,
  };

  if (options.dryRun === true) {
    return {
      runtime: directRuntime(),
      auth: directAuth(),
      workspace,
      settings: {
        defaultThreadEnvMode: globalDefault,
        newWorktreesStartFromOrigin: true,
        projectDefaultThreadEnvMode: asEffectiveThreadEnvMode(project.defaultThreadEnvMode),
        projectFileDefaultThreadEnvMode: projectFile.defaultThreadEnvMode,
        effectiveThreadEnvMode: envMode,
        threadEnvModeSource: envResolution.source,
      },
      project,
      projectCreated,
      projectCommand,
      projectDispatch: null,
      thread: {
        id: threadId,
        title,
        createCommand: createThreadCommand,
        createDispatch: null,
        command,
        dispatch: null,
      },
      worktree: envMode === "worktree"
        ? { path: null, branch: null, baseBranch: workspace.branch, startFromOrigin: true }
        : null,
      opened: { mode: options.openMode ?? config.openMode, kind: "none" as const, url: null, exactThread: false },
      dryRun: true as const,
    };
  }

  // Resolve the driver before writing: unknown providers fail clean, and
  // the worktree is already provisioned, so unwind it on early failure.
  let driver;
  try {
    driver = driverForInstance(driverOwner, modelSelection.instanceId, options.drivers);
  } catch (cause) {
    if (worktree) await runProcess("git", ["worktree", "remove", "--force", worktree.path], { cwd: workspace.workspaceRoot }).catch(() => undefined);
    throw cause;
  }
  const created = await createStoredThread(store, {
    id: threadId,
    projectId: project.id,
    title,
    modelSelection,
    runtimeMode,
    interactionMode,
    env: worktree
      ? { mode: "worktree", path: worktree.path, branch: worktree.branch }
      : { mode: "local", path: workspace.workspaceRoot, branch: workspace.branch },
  });
  let sent;
  try {
    sent = await sendStoredTurn(store, created.id, { prompt });
  } catch (cause) {
    await deleteStoredThread(store, created.id).catch(() => undefined);
    if (worktree) await runProcess("git", ["worktree", "remove", "--force", worktree.path], { cwd: workspace.workspaceRoot }).catch(() => undefined);
    throw new CliError("THREAD_START_FAILED", "Created the thread but could not start its handover prompt.", {
      cause,
      details: { threadId, cleanup: "deleted" },
    });
  }
  const hasSession = await Effect.runPromise(driver.hasSession(created.id)).catch(() => false);
  if (!hasSession) {
    await Effect.runPromise(driver.startSession({
      threadId: created.id,
      workingDirectory: worktree?.path ?? workspace.workspaceRoot,
      modelSelection,
      runtimeMode,
      interactionMode,
    })).catch(() => undefined);
  }
  void executeTurn({
    store,
    driver,
    threadId: created.id,
    storeTurnId: sent.turn.id,
    prompt,
    modelSelection,
    workingDirectory: worktree?.path ?? workspace.workspaceRoot,
  }).catch(() => undefined);
  if (options.noWait !== true) {
    // One-shot CLI: the process is the only runner (see sendThreadMessage).
    // Ctrl-C interrupts the first turn but keeps the created thread.
    await waitForTurnTerminal(store, created.id, sent.turn.id, () =>
      interruptStoredTurn(store, created.id).catch(() => undefined),
    );
  }

  return {
    runtime: directRuntime(),
    auth: directAuth(),
    workspace,
    settings: {
      defaultThreadEnvMode: globalDefault,
      newWorktreesStartFromOrigin: true,
      projectDefaultThreadEnvMode: asEffectiveThreadEnvMode(project.defaultThreadEnvMode),
      projectFileDefaultThreadEnvMode: projectFile.defaultThreadEnvMode,
      effectiveThreadEnvMode: envMode,
      threadEnvModeSource: envResolution.source,
    },
    project,
    projectCreated,
    projectCommand,
    projectDispatch: null,
    thread: {
      id: created.id,
      title: created.title,
      createCommand: createThreadCommand,
      createDispatch: null,
      command: { ...command, message: { ...command.message, messageId: sent.messageId } },
      dispatch: null,
    },
    worktree,
    opened: { mode: options.openMode ?? config.openMode, kind: "none" as const, url: null, exactThread: false },
    dryRun: false as const,
  };
}
