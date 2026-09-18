import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { withT3Api } from "../infra/api.js";
import { CliError } from "../../errors.js";
import { readLocalProjects } from "../infra/localProjects.js";
import { openThread } from "../infra/open.js";
import { discoverRuntime } from "../infra/runtime.js";
import { resolveWorkspace } from "../infra/workspace.js";
import {
  defaultModelSelectionForVersion,
  defaultStartFromOriginForVersion,
  resolveModelSelection,
  versionAtLeast,
  type ModelSelectionRequest,
} from "../shared/selection.js";
import { ensureProjectWithApi } from "../projects/projects.js";
import type { WorkspaceOptions } from "../projects/projects.js";
import type {
  CliConfig,
  EffectiveThreadEnvMode,
  InteractionMode,
  ModelSelection,
  OpenMode,
  ProjectPolicy,
  RuntimeMode,
  T3Project,
  ThreadEnvMode,
} from "../../types.js";

const MINIMUM_WORKTREE_BOOTSTRAP_VERSION = "0.0.28";

export interface ThreadCreateOptions extends WorkspaceOptions, ModelSelectionRequest {
  prompt: string;
  projectPolicy?: ProjectPolicy;
  openMode?: OpenMode;
  threadEnvMode?: ThreadEnvMode;
  runtimeMode?: RuntimeMode;
  interactionMode?: InteractionMode;
  dryRun?: boolean;
}

interface EffectiveT3Settings {
  defaultThreadEnvMode: EffectiveThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}

interface T3ProjectFileSettings {
  defaultThreadEnvMode: EffectiveThreadEnvMode | null;
}

function asEffectiveThreadEnvMode(value: unknown): EffectiveThreadEnvMode | null {
  return value === "local" || value === "worktree" ? value : null;
}

async function readT3Settings(
  settingsPath: string | null,
  serverVersion: string,
): Promise<EffectiveT3Settings> {
  const defaults: EffectiveT3Settings = {
    defaultThreadEnvMode: "local",
    newWorktreesStartFromOrigin: defaultStartFromOriginForVersion(serverVersion),
  };
  if (!settingsPath) return defaults;
  try {
    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    return {
      defaultThreadEnvMode: asEffectiveThreadEnvMode(raw.defaultThreadEnvMode) ?? defaults.defaultThreadEnvMode,
      newWorktreesStartFromOrigin:
        typeof raw.newWorktreesStartFromOrigin === "boolean"
          ? raw.newWorktreesStartFromOrigin
          : defaults.newWorktreesStartFromOrigin,
    };
  } catch {
    return defaults;
  }
}

async function readT3ProjectFile(workspaceRoot: string): Promise<T3ProjectFileSettings> {
  try {
    const raw = JSON.parse(await readFile(path.join(workspaceRoot, "t3.json"), "utf8")) as Record<string, unknown>;
    return { defaultThreadEnvMode: asEffectiveThreadEnvMode(raw.defaultThreadEnvMode) };
  } catch {
    return { defaultThreadEnvMode: null };
  }
}

function projectTitle(workspaceRoot: string): string {
  return path.basename(workspaceRoot) || "project";
}

function threadTitle(prompt: string): string {
  const title = prompt.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, " ").trim() || "New thread";
  return title.length <= 80 ? title : `${title.slice(0, 79)}…`;
}

function effectiveEnvMode(
  requested: ThreadEnvMode,
  project: T3Project,
  projectFile: T3ProjectFileSettings,
  settings: EffectiveT3Settings,
): { mode: EffectiveThreadEnvMode; source: "request" | "project" | "t3.json" | "global" } {
  if (requested !== "t3") return { mode: requested, source: "request" };
  const projectMode = asEffectiveThreadEnvMode(project.defaultThreadEnvMode);
  if (projectMode) return { mode: projectMode, source: "project" };
  if (projectFile.defaultThreadEnvMode) {
    return { mode: projectFile.defaultThreadEnvMode, source: "t3.json" };
  }
  return { mode: settings.defaultThreadEnvMode, source: "global" };
}

function supportsWorktreeBootstrap(version: string): boolean {
  return versionAtLeast(version, MINIMUM_WORKTREE_BOOTSTRAP_VERSION);
}

export async function createHandoverThread(config: CliConfig, options: ThreadCreateOptions) {
  const prompt = options.prompt.trim();
  if (!prompt) throw new CliError("PROMPT_REQUIRED", "A non-empty handover prompt is required.");

  const workspace = await resolveWorkspace(options.cwd ?? process.cwd(), options.workspaceMode ?? config.workspaceMode);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });
  const localProjects = await readLocalProjects(runtime);
  const settings = await readT3Settings(runtime.settingsPath, runtime.serverVersion);
  const projectFile = await readT3ProjectFile(workspace.workspaceRoot);
  const installedDefaultModelSelection = defaultModelSelectionForVersion(runtime.serverVersion);

  const result = await withT3Api(runtime, config, async (api, invocation) => {
    const projectResult = await ensureProjectWithApi(
      api,
      localProjects,
      workspace.workspaceRoot,
      options.projectPolicy ?? config.projectPolicy,
      true,
    );
    const envModeResolution = effectiveEnvMode(
      options.threadEnvMode ?? config.threadEnvMode,
      projectResult.project,
      projectFile,
      settings,
    );
    const envMode = envModeResolution.mode;
    if (envMode === "worktree" && !supportsWorktreeBootstrap(runtime.serverVersion)) {
      throw new CliError(
        "WORKTREE_HANDOVER_UNSUPPORTED",
        `New-worktree handovers require T3 ${MINIMUM_WORKTREE_BOOTSTRAP_VERSION} or later.`,
        {
          details: {
            serverVersion: runtime.serverVersion,
            minimumServerVersion: MINIMUM_WORKTREE_BOOTSTRAP_VERSION,
          },
        },
      );
    }
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
      projectResult.project.defaultModelSelection ?? installedDefaultModelSelection,
      config,
      options,
    );
    const title = threadTitle(prompt);
    const runtimeMode = options.runtimeMode ?? config.runtimeMode;
    const interactionMode = options.interactionMode ?? config.interactionMode;
    const projectDispatch = projectResult.created && !options.dryRun
      ? await api.dispatch(projectResult.command)
      : projectResult.dispatch;
    const createThread = {
      type: "thread.create",
      commandId: randomUUID(),
      threadId,
      projectId: projectResult.project.id,
      title,
      modelSelection,
      runtimeMode,
      interactionMode,
      branch: workspace.branch,
      worktreePath: null,
      createdAt,
    };
    const bootstrap = envMode === "worktree"
      ? {
          createThread: {
            projectId: projectResult.project.id,
            title,
            modelSelection,
            runtimeMode,
            interactionMode,
            branch: workspace.branch,
            worktreePath: null,
            createdAt,
          },
          prepareWorktree: {
            projectCwd: workspace.workspaceRoot,
            baseBranch: workspace.branch!,
            startFromOrigin: settings.newWorktreesStartFromOrigin,
          },
          runSetupScript: true,
        }
      : undefined;
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
      ...(bootstrap ? { bootstrap } : {}),
      createdAt,
    };
    let createDispatch: unknown = null;
    let dispatch: unknown = null;
    if (!options.dryRun) {
      if (envMode === "worktree") {
        try {
          dispatch = await api.dispatch(command);
        } catch (cause) {
          throw new CliError("THREAD_START_FAILED", "T3 could not prepare the worktree and start its handover prompt.", {
            cause,
            details: { threadId, cleanup: "server-managed" },
          });
        }
      } else {
        createDispatch = await api.dispatch(createThread);
        try {
          dispatch = await api.dispatch(command);
        } catch (cause) {
          const cleanup = await api
            .dispatch({ type: "thread.delete", commandId: randomUUID(), threadId })
            .then(() => "deleted" as const)
            .catch(() => "failed" as const);
          throw new CliError("THREAD_START_FAILED", "T3 created the thread but could not start its handover prompt.", {
            cause,
            details: { threadId, cleanup },
          });
        }
      }
    }
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      workspace,
      settings: {
        ...settings,
        projectDefaultThreadEnvMode:
          asEffectiveThreadEnvMode(projectResult.project.defaultThreadEnvMode),
        projectFileDefaultThreadEnvMode: projectFile.defaultThreadEnvMode,
        effectiveThreadEnvMode: envMode,
        threadEnvModeSource: envModeResolution.source,
      },
      project: projectResult.project,
      projectCreated: projectResult.created,
      projectCommand: projectResult.command,
      projectDispatch,
      thread: { id: threadId, title, createCommand: createThread, createDispatch, command, dispatch },
    };
  });

  const opened = options.dryRun
    ? { mode: options.openMode ?? config.openMode, kind: "none" as const, url: null, exactThread: false }
    : await openThread(options.openMode ?? config.openMode, runtime, result.thread.id);
  return { ...result, opened, dryRun: options.dryRun ?? false };
}
