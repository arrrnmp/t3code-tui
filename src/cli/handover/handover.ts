/**
 * Handover CLI: `--json` envelopes over the server's `thread.handover`
 * command (`core/threads/operations.ts` does the work): it resolves the project, the
 * local/worktree choice and the model, provisions the worktree, and starts
 * the first turn.
 *
 * Envelope keys are the previous era's, with two documented replacements:
 * the worktree is reported in a top-level `worktree` field rather than in
 * the turn command, and `dispatch`/`createDispatch`/`projectDispatch` are
 * always null (writes apply synchronously; `verification` is folded into
 * acceptance).
 */
import { randomUUID } from "node:crypto";

import type {
  CliConfig,
  InteractionMode,
  OpenMode,
  ProjectPolicy,
  RuntimeMode,
  SpeedMode,
  ThreadEnvMode,
} from "../../core/types.js";
import { awaitTurn, cliClient, type TurnDriverFactories } from "../infra/client.js";
import { directAuth, directRuntime } from "../infra/direct.js";
import type { WorkspaceOptions } from "../projects/projects.js";

export interface ThreadCreateOptions extends WorkspaceOptions {
  prompt: string;
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
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

export async function createHandoverThread(config: CliConfig, options: ThreadCreateOptions) {
  const client = await cliClient(config, options.drivers);
  const result = await client.dispatch({
    type: "thread.handover",
    cwd: options.cwd ?? process.cwd(),
    prompt: options.prompt,
    ...(options.workspaceMode !== undefined ? { workspaceMode: options.workspaceMode } : {}),
    ...(options.projectPolicy !== undefined ? { projectPolicy: options.projectPolicy } : {}),
    ...(options.threadEnvMode !== undefined ? { threadEnvMode: options.threadEnvMode } : {}),
    ...(options.runtimeMode !== undefined ? { runtimeMode: options.runtimeMode } : {}),
    ...(options.interactionMode !== undefined ? { interactionMode: options.interactionMode } : {}),
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.speedMode !== undefined ? { speedMode: options.speedMode } : {}),
    ...(options.thinkingEffort !== undefined ? { thinkingEffort: options.thinkingEffort } : {}),
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
  });
  const { started } = result;
  // Ctrl-C interrupts the first turn but keeps the created thread.
  if (started && options.noWait !== true) await awaitTurn(client, result.threadId, started.turnId);

  const createdAt = new Date().toISOString();
  const { worktree } = result;
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    workspace: result.workspace,
    settings: result.settings,
    project: result.project,
    projectCreated: result.projectCreated,
    projectCommand: result.projectCommand,
    projectDispatch: null,
    thread: {
      id: result.threadId,
      title: result.title,
      createCommand: {
        type: "thread.create",
        commandId: randomUUID(),
        threadId: result.threadId,
        projectId: result.project.id,
        title: result.title,
        modelSelection: result.modelSelection,
        runtimeMode: result.runtimeMode,
        interactionMode: result.interactionMode,
        branch: result.branch,
        worktreePath: worktree?.path ?? null,
        createdAt,
      },
      createDispatch: null,
      command: {
        type: "thread.turn.start",
        commandId: randomUUID(),
        threadId: result.threadId,
        message: {
          messageId: started?.messageId ?? randomUUID(),
          role: "user",
          text: options.prompt.trim(),
          attachments: [],
        },
        modelSelection: result.modelSelection,
        titleSeed: result.title,
        runtimeMode: result.runtimeMode,
        interactionMode: result.interactionMode,
        createdAt,
      },
      dispatch: null,
    },
    worktree,
    opened: { mode: options.openMode ?? config.openMode, kind: "none" as const, url: null, exactThread: false },
    dryRun: options.dryRun === true,
  };
}
