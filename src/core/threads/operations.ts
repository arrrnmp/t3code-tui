/**
 * Thread operations: the store, the drivers, and the turn runner composed
 * into the things a client actually asks for — start a turn, hand over to
 * a new thread, delegate a task, list and read threads.
 *
 * The CLI used to own these, one copy per command, and the server had its
 * own thinner copy of some of them. That is how they drifted: the CLI
 * resolved model selections from config while the server hardcoded one,
 * the server's turn start left a turn `running` forever when its session
 * failed to start, and only the CLI knew about worktrees, project policy
 * or delegation. Every client now calls these; `server/connection.ts`
 * exposes them over `ClientApi`.
 *
 * Results are domain values, not CLI envelopes: the envelope keys the CLI
 * prints (`runtime`, `auth`, `dispatch`, `verification`, `opened`) are its
 * own compatibility surface and stay there.
 */
import * as Effect from "effect/Effect";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { decodeDataUrl, imageMention } from "../attachments.js";
import {
  defaultModelSelection,
  followUpSelection,
  resolveModelSelection,
  type ModelRequest,
} from "../catalog/selection.js";
import { APP_NAME } from "../config.js";
import { CliError } from "../errors.js";
import { resolveMcpServers, type McpServerEntry, type McpServerSpec } from "../mcp.js";
import { runProcess } from "../infra/process.js";
import {
  ensureStoredProject,
  listStoredProjects,
  projectForWorkspace,
  resolveStoredProject,
  type StoredProject,
} from "../projects/projects.js";
import { resolveWorkspace } from "../projects/workspace.js";
import type {
  CliConfig,
  EffectiveThreadEnvMode,
  InteractionMode,
  ModelSelection,
  ProjectPolicy,
  RuntimeMode,
  ThreadEnvelope,
  ThreadEnvMode,
  WorkspaceMode,
  WorkspaceResolution,
} from "../types.js";
import type { ProviderRuntimeEvent } from "../providers/spi.js";
import { driverKey, ensureDriverSession, executeTurn, imagesOf, type TurnDriver } from "./execute.js";
import { buildRuntimeInstructions, projectInstructions } from "./instructions.js";
import { toThreadEnvelope } from "./project.js";
import type { ThreadStore } from "./store.js";
import { readThread } from "./threads.js";
import {
  createThread,
  deleteThread,
  delegationForChild,
  failTurn,
  reconcileOrphanedTurn,
  inspectThread,
  interruptTurn,
  listThreads,
  sendTurn,
  type SendTurnResult,
} from "./threads.js";
import type { SendTurnInput, StoredThread, StoredTurn } from "./types.js";
import {
  delegatedStatusOf,
  delegatedWorkStateOf,
  isThreadActive,
  isVisibleThread,
  latestAssistantText,
  normalizeReadView,
  threadInspectionView,
  threadListStatus,
  threadReadView,
  type DelegatedTaskStatus,
  type DelegatedTaskWorkState,
  type ThreadInspection,
  type ThreadListStatus,
  type ThreadReadView,
  type ThreadReading,
} from "./views.js";

/** A thread with its full ledger projected — messages, activities, checkpoints. */
export async function threadWithLedger(store: ThreadStore, threadId: string): Promise<ThreadEnvelope> {
  const read = await readThread(store, threadId, { view: "messages" });
  return toThreadEnvelope(read.thread, read.turns, {
    messages: read.messages,
    activities: read.activities,
    checkpoints: read.checkpoints,
  });
}

/** What every operation runs against. One per connection (or CLI process). */
export interface OperationContext {
  readonly store: ThreadStore;
  readonly storeRoot: string;
  readonly config: CliConfig;
  /** The driver for a model-selection instance id, shared per context. */
  readonly driverFor: (instanceId: string) => TurnDriver;
  /**
   * MCP servers every top-level thread gets from moxen itself (the
   * `moxen` delegate tools). Config and the project's `moxen.json` layer
   * over them by name, so `"moxen": null` there removes them. Delegated
   * threads get none: a subagent does not spawn subagents.
   */
  readonly builtinMcpServers?: (threadId: string) => readonly McpServerSpec[];
}


/**
 * What a session on this thread starts with beyond its model: the MCP
 * servers and the runtime instructions. Both are read per session start,
 * like config, so an edit applies to the next session without a restart.
 */
async function sessionSetup(
  ctx: OperationContext,
  thread: StoredThread,
): Promise<{ mcpServers: McpServerSpec[]; instructions: string | null }> {
  const project = await projectById(ctx.storeRoot, thread.projectId);
  const workspaceRoot = project?.workspaceRoot ?? (thread.env.path.trim() || null);
  const delegation = await delegationOf(ctx.store, thread.id);
  const builtin = delegation ? [] : (ctx.builtinMcpServers?.(thread.id) ?? []);
  const base: Record<string, McpServerEntry> = {};
  for (const spec of builtin) {
    if (spec.type === "stdio") base[spec.name] = { type: "stdio", command: spec.command, args: spec.args, env: spec.env };
    else base[spec.name] = { type: "http", url: spec.url, headers: spec.headers };
  }
  const [mcpServers, fromProject] = await Promise.all([
    resolveMcpServers({ ...base, ...ctx.config.mcpServers }, workspaceRoot),
    projectInstructions(workspaceRoot),
  ]);
  const user = [ctx.config.instructions, fromProject].filter((entry): entry is string => Boolean(entry));
  return {
    mcpServers,
    instructions: buildRuntimeInstructions({ env: thread.env, delegation, userInstructions: user }),
  };
}

/**
 * Recover a thread whose running turn was orphaned — its process died
 * mid-turn, so nothing will ever settle it and every later send would
 * queue or steer into it forever. The orphan is interrupted; a queued turn
 * behind it is promoted and run here, on its own provider. Cheap when
 * there is nothing to do (one read of the turns ledger), so every entry
 * point that touches a thread can call it. Never throws.
 */
export async function recoverOrphanedTurn(ctx: OperationContext, threadId: string): Promise<boolean> {
  const result = await reconcileOrphanedTurn(ctx.store, threadId).catch(() => null);
  if (!result) return false;
  if (result.promoted) await runRecoveredTurn(ctx, threadId, result.promoted).catch(() => undefined);
  return true;
}

async function runRecoveredTurn(ctx: OperationContext, threadId: string, turn: StoredTurn): Promise<void> {
  const { store } = ctx;
  const thread = await store.readThreadRecord(threadId);
  if (!thread) return;
  const message = (await store.readMessages(threadId)).find((candidate) => candidate.id === turn.messageId);
  if (!message?.text) {
    await failTurn(store, threadId, turn.id, { error: "Its queued message is missing." }).catch(() => undefined);
    return;
  }
  const selection = turn.modelSelection ?? thread.modelSelection;
  let driver: TurnDriver;
  try {
    driver = ctx.driverFor(selection.instanceId);
    await ensureDriverSession(driver, thread, { modelSelection: selection, ...(await sessionSetup(ctx, thread)) });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    await failTurn(store, threadId, turn.id, { error: error.slice(0, 500) }).catch(() => undefined);
    return;
  }
  const images = await imagesOf(message.attachments ?? []);
  void executeTurn({
    store,
    driver,
    threadId,
    storeTurnId: turn.id,
    prompt: message.text,
    ...(images.length > 0 ? { images } : {}),
    modelSelection: selection,
    workingDirectory: thread.env.path,
  });
}

/** The delegation that created this thread, with its parent's title, if it is a delegated task. */
async function delegationOf(
  store: ThreadStore,
  threadId: string,
): Promise<{ parentTitle: string; baseBranch: string | null } | null> {
  const rows = await store.readDelegations().catch(() => []);
  const row = [...rows].reverse().find((candidate) => candidate.childThreadId === threadId);
  if (!row) return null;
  const parent = await store.readThreadRecord(row.parentThreadId).catch(() => null);
  return { parentTitle: parent?.title ?? row.parentThreadId, baseBranch: row.baseBranch ?? null };
}

async function projectById(storeRoot: string, projectId: string): Promise<StoredProject | null> {
  return (await listStoredProjects(storeRoot)).find((candidate) => candidate.id === projectId) ?? null;
}

function requireThreadId(value: string): string {
  const threadId = value.trim();
  if (!threadId) {
    throw new CliError("THREAD_ID_REQUIRED", "A non-empty thread id is required.", { exitCode: 2 });
  }
  return threadId;
}

// -- turns --------------------------------------------------------------------

export interface StartTurnInput extends SendTurnInput {
  readonly threadId: string;
  /** What the driver is sent, when it differs from the recorded prompt (attachment mentions). */
  readonly driverPrompt?: string;
  readonly onEvent?: (event: ProviderRuntimeEvent) => void;
}

export interface StartedTurn extends SendTurnResult {
  /**
   * The provider run, when this send opened a fresh turn. Null for a
   * queued turn (the runner of the turn ahead of it starts it once it is
   * promoted) and for a steer/inject, which lands on the turn already
   * running rather than starting a second provider run against it.
   */
  readonly run: Promise<void> | null;
  /**
   * For a steer/inject: whether the running provider turn received the
   * text. False when it could not — the provider has no mid-turn input
   * (Grok), or the turn runs in another process — and the message is only
   * recorded. Absent for other deliveries.
   */
  readonly steerDelivered?: boolean;
}

/**
 * Record a turn and, when it opens a fresh one, run it.
 *
 * The four entry points that used to do this each had their own copy, and
 * two of their bugs came from that: a steer or inject started a *second*
 * provider run against the turn already running (whose settle could then
 * complete or fail the original), and a failed session start left the
 * turn `running` with nothing to ever settle it.
 */
export async function startTurn(ctx: OperationContext, input: StartTurnInput): Promise<StartedTurn> {
  const { store } = ctx;
  // A dead process's turn must not swallow this send as a steer.
  await recoverOrphanedTurn(ctx, input.threadId);
  const thread = await inspectThread(store, input.threadId);
  // Resolved before the ledger is touched: an unknown provider fails
  // without recording a turn.
  const driver = ctx.driverFor((input.modelSelection ?? thread.modelSelection).instanceId);
  const { threadId: _threadId, driverPrompt, onEvent, ...send } = input;
  const sent = await sendTurn(store, thread.id, send);
  const uploads = input.attachments ?? [];
  if (sent.delivery === "steered" || sent.delivery === "injected") {
    // Steering carries text only; images sent with a steer are named.
    const text = imageMention(input.driverPrompt ?? input.prompt.trim(), uploads.map((upload) => upload.name));
    return { ...sent, run: null, steerDelivered: await deliverSteer(driver, thread.id, text) };
  }
  const fresh = (sent.delivery === "started" || sent.delivery === "restarted") && sent.turn.status === "running";
  if (!fresh) return { ...sent, run: null };

  const turnModel = sent.turn.modelSelection ?? sent.thread.modelSelection;
  const startFailure = await sessionSetup(ctx, sent.thread)
    .then((setup) => ensureDriverSession(driver, sent.thread, { modelSelection: turnModel, ...setup }))
    .then(
    () => null,
    (cause: unknown) => cause,
  );
  if (startFailure !== null) {
    // Nothing will ever run this turn: settle it now, with the reason,
    // rather than leaving it `running` for the next send to trip over.
    const message = startFailure instanceof Error ? startFailure.message : String(startFailure);
    await failTurn(store, thread.id, sent.turn.id, { error: message.slice(0, 500) }).catch(() => undefined);
    return { ...sent, run: Promise.resolve() };
  }
  const images = uploads.flatMap((upload) => {
    const decoded = decodeDataUrl(upload.dataUrl);
    return decoded ? [{ name: upload.name, mimeType: decoded.mimeType, data: decoded.data }] : [];
  });
  const run = executeTurn({
    store,
    driver,
    threadId: thread.id,
    storeTurnId: sent.turn.id,
    prompt: driverPrompt ?? input.prompt.trim(),
    ...(images.length > 0 ? { images } : {}),
    // Always the turn's own model, so a live session switches when the
    // thread's model changed since it started.
    modelSelection: turnModel,
    workingDirectory: sent.thread.env.path,
    ...(onEvent ? { onEvent } : {}),
  }).catch(() => undefined);
  return { ...sent, run };
}

/**
 * Give the running provider turn the steer, when this process holds its
 * session. Never starts a session: a session opened just for this would be
 * a second, empty conversation, not the one doing the work.
 */
async function deliverSteer(driver: TurnDriver, threadId: string, text: string): Promise<boolean> {
  if (!driver.steerTurn) return false;
  const live = await Effect.runPromise(driver.hasSession(threadId)).catch(() => false);
  if (!live) return false;
  return await Effect.runPromise(driver.steerTurn(threadId, text)).then(
    () => true,
    () => false,
  );
}

// -- revert -------------------------------------------------------------------------

export interface RevertResult {
  readonly threadId: string;
  readonly keptTurns: number;
  readonly removedTurns: number;
  /** Drivers whose provider-side conversation was rolled back too. */
  readonly providers: readonly string[];
}

/**
 * Revert a thread's conversation so its first `keepTurns` turns remain.
 * Files are left as they are (the TUI's revert says "keeps files"); the
 * checkpoints stay available to diff against.
 *
 * The provider has to forget the dropped turns too, or the next turn
 * answers from a history the thread no longer shows. So every provider
 * that saw a dropped turn is rolled back first — by the prompts it
 * received, which a steer makes more than one per turn — and only then is
 * the ledger cut. A provider that cannot roll back (Grok) refuses the
 * whole revert before anything changes.
 */
export async function revertThread(ctx: OperationContext, rawThreadId: string, keepTurns: number): Promise<RevertResult> {
  const { store } = ctx;
  const threadId = requireThreadId(rawThreadId);
  if (!Number.isInteger(keepTurns) || keepTurns < 0) {
    throw new CliError("INVALID_THREAD_OPTION", "The number of turns to keep must be a whole number, 0 or more.", {
      exitCode: 2,
      details: { keepTurns },
    });
  }
  const thread = await inspectThread(store, threadId);
  if (thread.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot be reverted.`, {
      exitCode: 4,
      details: { threadId, archivedAt: thread.archivedAt },
    });
  }
  const busy = (turns: readonly StoredTurn[]) => turns.some((turn) => turn.status === "running" || turn.status === "queued");
  const turns = await store.readTurns(threadId);
  if (busy(turns)) {
    throw new CliError("THREAD_BUSY", `Thread ${threadId} has a turn in progress; revert once it settles.`, {
      exitCode: 4,
      details: { threadId },
    });
  }
  const removed = turns.slice(keepTurns);
  if (removed.length === 0) return { threadId, keptTurns: turns.length, removedTurns: 0, providers: [] };

  // What each provider saw of the dropped turns, in prompts.
  const messages = await store.readMessages(threadId);
  const byDriver = new Map<string, { instanceId: string; selection: ModelSelection; prompts: number }>();
  for (const turn of removed) {
    const selection = turn.modelSelection ?? thread.modelSelection;
    const key = driverKey(selection.instanceId);
    const prompts = messages.filter((message) => message.turnId === turn.id && message.role === "user").length || 1;
    const entry = byDriver.get(key) ?? { instanceId: selection.instanceId, selection, prompts: 0 };
    entry.prompts += prompts;
    byDriver.set(key, entry);
  }
  if (byDriver.has("grok")) {
    throw new CliError(
      "REVERT_UNSUPPORTED",
      "Grok cannot roll back its side of the conversation, so a revert would leave it remembering turns the thread no longer shows.",
      { exitCode: 4, details: { threadId, provider: "grok" } },
    );
  }

  const rolledBack: string[] = [];
  for (const [key, entry] of byDriver) {
    const driver = ctx.driverFor(entry.instanceId);
    const live = await Effect.runPromise(driver.hasSession(threadId)).catch(() => false);
    // No live session and nothing to resume: no provider remembers these turns.
    if (!live && !thread.providerSessions?.[key]) continue;
    if (!driver.rollbackThread) {
      throw new CliError("REVERT_UNSUPPORTED", `The ${key} driver cannot roll back a conversation.`, {
        exitCode: 4,
        details: { threadId, provider: key },
      });
    }
    await ensureDriverSession(driver, thread, {
      modelSelection: entry.selection,
      ...(await sessionSetup(ctx, thread)),
    });
    await Effect.runPromise(driver.rollbackThread(threadId, entry.prompts));
    rolledBack.push(key);
    // A rollback can move the resume handle (Claude and OpenCode fork).
    const cursor = driver.resumeCursor?.(threadId) ?? null;
    await store.withThreadLock(threadId, async () => {
      const current = await store.readThreadRecord(threadId);
      if (!current) return;
      const sessions = { ...current.providerSessions };
      if (cursor) sessions[key] = cursor;
      else delete sessions[key];
      await store.writeThreadRecord({ ...current, providerSessions: sessions });
    });
  }

  const dropped = new Set(removed.map((turn) => turn.id));
  const keep = <T extends { turnId?: string | null }>(rows: readonly T[]) =>
    rows.filter((row) => row.turnId == null || !dropped.has(row.turnId));
  await store.withThreadLock(threadId, async () => {
    const latest = await store.readTurns(threadId);
    if (busy(latest)) {
      throw new CliError("THREAD_BUSY", `Thread ${threadId} started a turn during the revert; revert again once it settles.`, {
        exitCode: 4,
        details: { threadId },
      });
    }
    const [activities, checkpoints, currentMessages] = await Promise.all([
      store.readActivities(threadId),
      store.readCheckpoints(threadId),
      store.readMessages(threadId),
    ]);
    await store.rewriteLedger(threadId, "turns", latest.filter((turn) => !dropped.has(turn.id)));
    await store.rewriteLedger(threadId, "messages", keep(currentMessages));
    await store.rewriteLedger(threadId, "activity", keep(activities));
    await store.rewriteLedger(threadId, "checkpoints", keep(checkpoints));
    const record = await store.readThreadRecord(threadId);
    if (record) await store.writeThreadRecord({ ...record, updatedAt: store.nowIso() });
  });
  store.emit(threadId, "reverted");
  return { threadId, keptTurns: keepTurns, removedTurns: removed.length, providers: rolledBack };
}

/** Resolves true when `run` settles first, false on timeout. */
async function settlesWithin(run: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([run.then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// -- reads --------------------------------------------------------------------

export interface ThreadListQuery {
  readonly projectId?: string;
  readonly cwd?: string;
  readonly workspaceMode?: WorkspaceMode;
  readonly status?: ThreadListStatus;
}

export async function listThreadsView(ctx: OperationContext, query: ThreadListQuery = {}) {
  const requestedProjectId = query.projectId?.trim();
  if (query.projectId !== undefined && !requestedProjectId) {
    throw new CliError("PROJECT_ID_REQUIRED", "--project requires a non-empty project id.", { exitCode: 2 });
  }
  if (requestedProjectId && query.cwd) {
    throw new CliError("THREAD_FILTER_CONFLICT", "Use either --project or --cwd, not both.", { exitCode: 2 });
  }
  const projects = (await listStoredProjects(ctx.storeRoot)).filter((candidate) => candidate.deletedAt == null);
  let project: StoredProject | null = null;
  let workspace: WorkspaceResolution | null = null;
  if (requestedProjectId) {
    project = projects.find((candidate) => candidate.id === requestedProjectId) ?? null;
  } else if (query.cwd) {
    workspace = await resolveWorkspace(query.cwd, query.workspaceMode ?? ctx.config.workspaceMode);
    project = projectForWorkspace(projects, workspace.workspaceRoot);
  }
  if ((requestedProjectId || query.cwd) && !project) {
    throw new CliError(
      "PROJECT_NOT_FOUND",
      requestedProjectId
        ? `No active Moxen project exists with id ${requestedProjectId}.`
        : `No Moxen project exists for ${workspace!.workspaceRoot}.`,
      { exitCode: 3 },
    );
  }
  const status = query.status ?? "all";
  const stored = await listThreads(ctx.store, { status, ...(project ? { projectId: project.id } : {}) });
  const threads = await Promise.all(
    stored.map(async (entry) => toThreadEnvelope(entry, await ctx.store.readTurns(entry.id))),
  );
  return {
    filter: { status, projectId: project?.id ?? null, workspaceRoot: workspace?.workspaceRoot ?? null },
    projects,
    threads: threads
      .filter(isVisibleThread)
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
      .map((thread) => ({ ...thread, status: threadListStatus(thread) })),
  };
}

export type ThreadList = Awaited<ReturnType<typeof listThreadsView>>;

export async function inspectThreadView(
  ctx: OperationContext,
  rawThreadId: string,
): Promise<{ project: StoredProject | null; thread: ThreadInspection }> {
  const thread = await threadWithLedger(ctx.store, requireThreadId(rawThreadId));
  return { project: await projectById(ctx.storeRoot, thread.projectId), thread: threadInspectionView(thread) };
}

export async function readThreadView(
  ctx: OperationContext,
  rawThreadId: string,
  options: { readonly lastTurn?: boolean; readonly view?: ThreadReadView } = {},
): Promise<{ project: StoredProject | null; thread: ThreadReading }> {
  const threadId = requireThreadId(rawThreadId);
  const view = normalizeReadView(options.view);
  const thread = await threadWithLedger(ctx.store, threadId);
  return {
    project: await projectById(ctx.storeRoot, thread.projectId),
    thread: threadReadView(thread, { lastTurn: options.lastTurn ?? false, view }),
  };
}

// -- projects -----------------------------------------------------------------

export interface WorkspaceQuery {
  readonly cwd: string;
  readonly workspaceMode?: WorkspaceMode;
}

export async function resolveProjectView(ctx: OperationContext, query: WorkspaceQuery) {
  const workspace = await resolveWorkspace(query.cwd, query.workspaceMode ?? ctx.config.workspaceMode);
  return { workspace, project: await resolveStoredProject(ctx.storeRoot, workspace.workspaceRoot) };
}

/** The `project.create` command a project write corresponds to (envelope compat). */
export type ProjectCommand = NonNullable<Awaited<ReturnType<typeof ensureStoredProject>>["command"]>;

export interface EnsureProjectRequest extends WorkspaceQuery {
  readonly projectPolicy?: ProjectPolicy;
  readonly dryRun?: boolean;
}

export interface EnsuredProject {
  readonly workspace: WorkspaceResolution;
  readonly project: StoredProject;
  readonly created: boolean;
  readonly command: ProjectCommand | null;
}

function previewProject(workspaceRoot: string): { project: StoredProject; command: ProjectCommand } {
  const createdAt = new Date().toISOString();
  const project: StoredProject = {
    id: randomUUID(),
    title: path.basename(workspaceRoot) || "project",
    workspaceRoot,
    defaultModelSelection: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
  return {
    project,
    command: {
      type: "project.create" as const,
      commandId: randomUUID(),
      projectId: project.id,
      title: project.title,
      workspaceRoot,
      createWorkspaceRootIfMissing: true as const,
      defaultModelSelection: null,
      createdAt,
    },
  };
}

/**
 * The project for a workspace, created under the `create` policy. A dry
 * run resolves the same way and reports what it would create, without
 * writing; `existing` fails identically either way.
 */
async function ensureProjectFor(
  ctx: OperationContext,
  workspace: WorkspaceResolution,
  policy: ProjectPolicy,
  dryRun: boolean,
): Promise<{ project: StoredProject; created: boolean; command: ProjectCommand | null }> {
  if (!dryRun) {
    const ensured = await ensureStoredProject(ctx.storeRoot, { workspaceRoot: workspace.workspaceRoot, policy });
    return { project: ensured.project, created: ensured.created, command: ensured.command };
  }
  const existing = await resolveStoredProject(ctx.storeRoot, workspace.workspaceRoot);
  if (existing) return { project: existing, created: false, command: null };
  if (policy === "existing") {
    // Throws PROJECT_NOT_FOUND through the same path a real run takes.
    await ensureStoredProject(ctx.storeRoot, { workspaceRoot: workspace.workspaceRoot, policy });
  }
  // Key order is printed by `--json`: project, created, command.
  const preview = previewProject(workspace.workspaceRoot);
  return { project: preview.project, created: true, command: preview.command };
}

export async function ensureProject(ctx: OperationContext, request: EnsureProjectRequest): Promise<EnsuredProject> {
  const workspace = await resolveWorkspace(request.cwd, request.workspaceMode ?? ctx.config.workspaceMode);
  const policy = request.projectPolicy ?? ctx.config.projectPolicy;
  const ensured = await ensureProjectFor(ctx, workspace, policy, request.dryRun === true);
  if (ensured.created && request.dryRun !== true) {
    // The old `createWorkspaceRootIfMissing` contract, honored locally.
    await mkdir(workspace.workspaceRoot, { recursive: true }).catch(() => undefined);
  }
  return { workspace, ...ensured };
}

// -- handover: a new thread with its first turn --------------------------------

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
 * Provision `moxen/<thread-short>` off the base branch (or its origin
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
    const branch = attempt === 0 ? `moxen/${short}` : `moxen/${short}-${attempt + 1}`;
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

/** Per-project settings file, read from the workspace root. */
export const PROJECT_FILE = `${APP_NAME}.json` as const;

function asEffectiveThreadEnvMode(value: unknown): EffectiveThreadEnvMode | null {
  return value === "local" || value === "worktree" ? value : null;
}

async function projectFileEnvMode(workspaceRoot: string): Promise<EffectiveThreadEnvMode | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(workspaceRoot, PROJECT_FILE), "utf8")) as Record<string, unknown>;
    return asEffectiveThreadEnvMode(raw.defaultThreadEnvMode);
  } catch {
    return null;
  }
}

function firstLineTitle(prompt: string, fallback: string): string {
  const title = prompt.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, " ").trim() || fallback;
  return title.length <= 80 ? title : `${title.slice(0, 79)}…`;
}

export interface HandoverRequest extends WorkspaceQuery, ModelRequest {
  readonly prompt: string;
  readonly projectPolicy?: ProjectPolicy;
  readonly threadEnvMode?: ThreadEnvMode;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: InteractionMode;
  readonly dryRun?: boolean;
}

export interface HandoverSettings {
  readonly defaultThreadEnvMode: EffectiveThreadEnvMode;
  readonly newWorktreesStartFromOrigin: true;
  readonly projectDefaultThreadEnvMode: EffectiveThreadEnvMode | null;
  readonly projectFileDefaultThreadEnvMode: EffectiveThreadEnvMode | null;
  readonly effectiveThreadEnvMode: EffectiveThreadEnvMode;
  readonly threadEnvModeSource: "request" | "project" | typeof PROJECT_FILE | "global";
}

export interface Handover {
  readonly workspace: WorkspaceResolution;
  readonly settings: HandoverSettings;
  readonly project: StoredProject;
  readonly projectCreated: boolean;
  readonly projectCommand: ProjectCommand | null;
  readonly threadId: string;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly branch: string | null;
  /** Provisioned worktree; on a dry run only the plan (no path or branch yet). */
  readonly worktree:
    | WorktreeProvision
    | { readonly path: null; readonly branch: null; readonly baseBranch: string | null; readonly startFromOrigin: true }
    | null;
  /** The first turn; absent on a dry run. */
  readonly started: StartedTurn | null;
}

/**
 * Hand a prompt to a new thread: resolve the workspace to a project
 * (under the project policy), pick local vs worktree (request → project →
 * `moxen.json` → global config), resolve the model from config and flags,
 * provision the worktree, then create the thread and start its first turn
 * — unwinding the thread and worktree if that turn cannot be recorded.
 */
export async function handover(ctx: OperationContext, request: HandoverRequest): Promise<Handover> {
  const prompt = request.prompt.trim();
  if (!prompt) throw new CliError("PROMPT_REQUIRED", "A non-empty handover prompt is required.");
  const { config } = ctx;
  const dryRun = request.dryRun === true;
  const workspace = await resolveWorkspace(request.cwd, request.workspaceMode ?? config.workspaceMode);
  const fileMode = await projectFileEnvMode(workspace.workspaceRoot);
  const ensured = await ensureProjectFor(ctx, workspace, request.projectPolicy ?? config.projectPolicy, dryRun);
  const { project } = ensured;

  const globalDefault: EffectiveThreadEnvMode = config.threadEnvMode === "auto" ? "local" : config.threadEnvMode;
  const projectMode = asEffectiveThreadEnvMode(project.defaultThreadEnvMode);
  const requestMode =
    request.threadEnvMode !== undefined && request.threadEnvMode !== "auto" ? request.threadEnvMode : undefined;
  const envResolution =
    requestMode !== undefined
      ? { mode: requestMode, source: "request" as const }
      : projectMode
        ? { mode: projectMode, source: "project" as const }
        : fileMode
          ? { mode: fileMode, source: PROJECT_FILE }
          : { mode: globalDefault, source: "global" as const };
  const envMode = envResolution.mode;
  if (envMode === "worktree" && (!workspace.isGitRepository || workspace.branch === null)) {
    throw new CliError(
      "WORKTREE_REQUIRES_BRANCH",
      "A new worktree requires a Git repository with a current branch. Use --checkout current for this handover.",
      { details: { isGitRepository: workspace.isGitRepository, currentBranch: workspace.branch } },
    );
  }
  const settings: HandoverSettings = {
    defaultThreadEnvMode: globalDefault,
    newWorktreesStartFromOrigin: true,
    projectDefaultThreadEnvMode: projectMode,
    projectFileDefaultThreadEnvMode: fileMode,
    effectiveThreadEnvMode: envMode,
    threadEnvModeSource: envResolution.source,
  };

  const threadId = randomUUID();
  const modelSelection = resolveModelSelection(project.defaultModelSelection ?? defaultModelSelection(), config, {
    prompt,
    ...(request.provider !== undefined ? { provider: request.provider } : {}),
    ...(request.model !== undefined ? { model: request.model } : {}),
    ...(request.speedMode !== undefined ? { speedMode: request.speedMode } : {}),
    ...(request.thinkingEffort !== undefined ? { thinkingEffort: request.thinkingEffort } : {}),
  });
  const title = firstLineTitle(prompt, "New thread");
  const runtimeMode = request.runtimeMode ?? config.runtimeMode;
  const interactionMode = request.interactionMode ?? config.interactionMode;
  const plan = {
    workspace,
    settings,
    project,
    projectCreated: ensured.created,
    projectCommand: ensured.command,
    threadId,
    title,
    modelSelection,
    runtimeMode,
    interactionMode,
  };
  if (dryRun) {
    return {
      ...plan,
      branch: workspace.branch,
      worktree:
        envMode === "worktree"
          ? { path: null, branch: null, baseBranch: workspace.branch, startFromOrigin: true as const }
          : null,
      started: null,
    };
  }

  const worktree =
    envMode === "worktree"
      ? await provisionWorktree({
          projectCwd: workspace.workspaceRoot,
          baseBranch: workspace.branch!,
          startFromOrigin: true,
          threadId,
          storeRoot: ctx.storeRoot,
        })
      : null;
  const removeWorktree = async (): Promise<void> => {
    if (worktree) {
      await runProcess("git", ["worktree", "remove", "--force", worktree.path], { cwd: workspace.workspaceRoot }).catch(
        () => undefined,
      );
    }
  };
  try {
    // Resolved before writing: an unknown provider fails clean.
    ctx.driverFor(modelSelection.instanceId);
  } catch (cause) {
    await removeWorktree();
    throw cause;
  }
  const created = await createThread(ctx.store, {
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
  let started: StartedTurn;
  try {
    started = await startTurn(ctx, { threadId: created.id, prompt });
  } catch (cause) {
    await deleteThread(ctx.store, created.id).catch(() => undefined);
    await removeWorktree();
    throw new CliError("THREAD_START_FAILED", "Created the thread but could not start its handover prompt.", {
      cause,
      details: { threadId, cleanup: "deleted" },
    });
  }
  return { ...plan, title: created.title, branch: worktree?.branch ?? workspace.branch, worktree, started };
}

// -- delegation ---------------------------------------------------------------

const DELEGATE_DEFAULT_TIMEOUT_MS = 600_000;

export interface DelegateRequest extends ModelRequest {
  readonly parentThreadId: string;
  readonly task: string;
  readonly title?: string;
  /** Block until the child's turn settles (default), up to `timeoutMs`. */
  readonly wait?: boolean;
  readonly timeoutMs?: number;
  readonly dryRun?: boolean;
  /**
   * `shared` (the default) runs the child in the parent's checkout.
   * `worktree` gives it its own git worktree on a new branch cut from the
   * parent's, so two agents never edit the same files at once.
   */
  readonly isolation?: DelegateIsolation;
}

export type DelegateIsolation = "shared" | "worktree";

export interface TaskView {
  readonly taskId: string;
  readonly childThreadId: string;
  readonly childRunId: string | null;
  readonly status: DelegatedTaskStatus;
  readonly workState: DelegatedTaskWorkState;
  readonly summary: string | null;
}

export interface Delegation {
  readonly project: StoredProject | null;
  readonly parent: ThreadEnvelope;
  /** The child as it stands after the wait; on a dry run, a plan with a fresh id. */
  readonly child: { readonly id: string; readonly projectId: string; readonly title: string };
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly branch: string | null;
  readonly task: TaskView & { readonly waitTimedOut: boolean };
  /** The child's first user message; null on a dry run. */
  readonly messageId: string | null;
  /** The child's own worktree under `isolation: "worktree"`; on a dry run, the plan (no path yet). */
  readonly worktree?: { readonly path: string | null; readonly branch: string | null; readonly baseBranch: string };
}

function delegateTitle(task: string, explicit: string | undefined): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 79)}…`;
  return firstLineTitle(task, "Delegated task");
}

function requireParentModes(thread: ThreadEnvelope): { runtimeMode: RuntimeMode; interactionMode: InteractionMode } {
  const { runtimeMode, interactionMode } = thread;
  if (
    !["approval-required", "auto", "auto-accept-edits", "full-access"].includes(runtimeMode ?? "") ||
    !["default", "plan"].includes(interactionMode ?? "")
  ) {
    throw new CliError("INVALID_THREAD", `Thread ${thread.id} is missing its runtime or interaction mode.`, {
      details: { threadId: thread.id },
    });
  }
  return { runtimeMode: runtimeMode as RuntimeMode, interactionMode: interactionMode as InteractionMode };
}

function taskOf(child: ThreadEnvelope, taskId = child.id): TaskView {
  const status = delegatedStatusOf(child);
  return {
    taskId,
    childThreadId: child.id,
    childRunId: child.latestTurn?.turnId ?? null,
    status,
    workState: delegatedWorkStateOf(status),
    summary: latestAssistantText(child),
  };
}

/**
 * Run a task in a new child thread of the same project — same env, same
 * modes, the parent's model unless the request overrides it — and by
 * default wait for its turn to settle. The task id is the child thread id.
 *
 * Waiting awaits the run itself; this used to be a 200ms ledger poll.
 */
export async function delegate(ctx: OperationContext, request: DelegateRequest): Promise<Delegation> {
  const parentThreadId = requireThreadId(request.parentThreadId);
  const task = request.task.trim();
  if (!task) throw new CliError("PROMPT_REQUIRED", "A non-empty delegated task is required.", { exitCode: 2 });
  const timeoutMs = request.timeoutMs ?? DELEGATE_DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CliError("INVALID_THREAD_OPTION", "--timeout-ms must be a positive integer.", {
      exitCode: 2,
      details: { timeoutMs: request.timeoutMs },
    });
  }
  const title = delegateTitle(task, request.title);
  const parent = await threadWithLedger(ctx.store, parentThreadId);
  if (parent.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${parentThreadId} is archived and cannot delegate work.`, {
      exitCode: 4,
      details: { threadId: parentThreadId, archivedAt: parent.archivedAt },
    });
  }
  const project = await projectById(ctx.storeRoot, parent.projectId);
  const base = parent.modelSelection ?? project?.defaultModelSelection ?? defaultModelSelection();
  const modelSelection = followUpSelection(base, ctx.config, request, task) ?? base;
  const { runtimeMode, interactionMode } = requireParentModes(parent);
  const parentEnv = (await inspectThread(ctx.store, parentThreadId)).env;
  const isolated = request.isolation === "worktree";
  if (isolated && !parentEnv.branch) {
    throw new CliError(
      "WORKTREE_UNAVAILABLE",
      `Thread ${parentThreadId} is not on a git branch, so its task cannot get its own worktree. Delegate with isolation "shared".`,
      { exitCode: 4, details: { threadId: parentThreadId } },
    );
  }
  const shape = { project, parent, modelSelection, runtimeMode, interactionMode, branch: parent.branch ?? null };

  if (request.dryRun === true) {
    const childThreadId = randomUUID();
    return {
      ...shape,
      ...(isolated ? { worktree: { path: null, branch: null, baseBranch: parentEnv.branch! } } : {}),
      child: { id: childThreadId, projectId: parent.projectId, title },
      task: {
        taskId: childThreadId,
        childThreadId,
        childRunId: null,
        status: "running",
        workState: "working",
        summary: null,
        waitTimedOut: false,
      },
      messageId: null,
    };
  }

  const childThreadId = randomUUID();
  // Cut from the parent's branch as the parent's checkout has it — not from
  // origin: the task builds on what the parent has committed so far.
  const worktree = isolated
    ? await provisionWorktree({
        projectCwd: parentEnv.path,
        baseBranch: parentEnv.branch!,
        startFromOrigin: false,
        threadId: childThreadId,
        storeRoot: ctx.storeRoot,
      })
    : null;
  let created: StoredThread;
  try {
    created = await createThread(ctx.store, {
      id: childThreadId,
      projectId: parent.projectId,
      title,
      modelSelection,
      runtimeMode,
      interactionMode,
      env: worktree ? { mode: "worktree", path: worktree.path, branch: worktree.branch } : { ...parentEnv },
    });
  } catch (cause) {
    if (worktree) {
      await runProcess("git", ["worktree", "remove", "--force", worktree.path], { cwd: parentEnv.path }).catch(() => undefined);
    }
    throw cause;
  }
  // Recorded before the child's session starts: that start reads it to tell
  // the child it is a delegated task (`core/threads/instructions.ts`).
  const now = new Date().toISOString();
  await ctx.store
    .appendDelegation({
      id: randomUUID(),
      parentThreadId,
      childThreadId: created.id,
      prompt: task,
      status: "running",
      ...(worktree ? { baseBranch: worktree.baseBranch } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .catch(() => undefined);
  const started = await startTurn(ctx, { threadId: created.id, prompt: task }).catch((cause: unknown) => {
    throw new CliError(
      "THREAD_START_FAILED",
      `Created delegated thread ${created.id} but could not start its task turn. The child thread was left untouched.`,
      { cause, details: { threadId: created.id } },
    );
  });

  let waitTimedOut = false;
  if (request.wait ?? true) {
    waitTimedOut = started.run === null ? true : !(await settlesWithin(started.run, timeoutMs));
  }
  const child = await threadWithLedger(ctx.store, created.id);
  if (!waitTimedOut && (request.wait ?? true) && delegatedStatusOf(child) === "running") waitTimedOut = true;
  return {
    ...shape,
    child: { id: child.id, projectId: child.projectId, title: child.title },
    task: { ...taskOf(child), waitTimedOut },
    messageId: started.messageId,
    ...(worktree ? { worktree: { path: worktree.path, branch: worktree.branch, baseBranch: worktree.baseBranch } } : {}),
  };
}

export interface DescribedTask {
  readonly project: StoredProject | null;
  readonly parent: ThreadEnvelope;
  readonly child: ThreadEnvelope;
  readonly task: TaskView;
}

/** A delegated task by parent + task id; the task id is the child thread id. */
export async function describeTask(ctx: OperationContext, rawParentThreadId: string, rawTaskId: string): Promise<DescribedTask> {
  const parentThreadId = requireThreadId(rawParentThreadId);
  const taskId = requireThreadId(rawTaskId);
  const parent = await threadWithLedger(ctx.store, parentThreadId);
  const delegation = await delegationForChild(ctx.store, parentThreadId, taskId);
  const child = await threadWithLedger(ctx.store, delegation?.childThreadId ?? taskId).catch(() => null);
  if (!child || child.projectId !== parent.projectId) {
    throw new CliError("TASK_NOT_FOUND", `No delegated task exists with id ${taskId} for thread ${parentThreadId}.`, {
      exitCode: 3,
      details: { taskId, parentThreadId },
    });
  }
  return {
    project: await projectById(ctx.storeRoot, parent.projectId),
    parent,
    child,
    task: taskOf(child, taskId),
  };
}

export type CancelledTaskStatus = DelegatedTaskStatus | "cancelled" | "cancel_requested";

export interface CancelledTask extends Omit<DescribedTask, "task"> {
  readonly task: Omit<TaskView, "status"> & { readonly status: CancelledTaskStatus };
  /** Whether an interrupt was sent; false when the task had already ended. */
  readonly interruptRequested: boolean;
  /** The child's latest turn state after the interrupt. */
  readonly stateAfter: string | null;
}

/** Interrupt a running task. Cancelling one that already ended is a no-op that reports how it ended. */
export async function cancelTask(ctx: OperationContext, rawParentThreadId: string, rawTaskId: string): Promise<CancelledTask> {
  const described = await describeTask(ctx, rawParentThreadId, rawTaskId);
  const { child } = described;
  if (!isThreadActive(child)) {
    const terminal = child.latestTurn?.state;
    const status: CancelledTaskStatus =
      terminal === "completed" ? "completed"
      : terminal === "error" ? "failed"
      : terminal === "interrupted" ? "interrupted"
      : "cancelled";
    return { ...described, task: { ...described.task, status }, interruptRequested: false, stateAfter: terminal ?? null };
  }
  try {
    await interruptTurn(ctx.store, child.id);
  } catch (cause) {
    throw new CliError(
      "TASK_CANCEL_UNSUPPORTED",
      `Could not interrupt delegated task ${described.task.taskId}; cancellation is unsupported for this thread.`,
      { exitCode: 4, cause, details: { taskId: described.task.taskId, childThreadId: child.id } },
    );
  }
  const delegation = await delegationForChild(ctx.store, described.parent.id, child.id);
  if (delegation && delegation.status !== "cancelled") {
    await ctx.store.updateDelegation(delegation.id, { status: "cancelled" }).catch(() => null);
  }
  const after = await threadWithLedger(ctx.store, child.id);
  const state = after.latestTurn?.state ?? null;
  return {
    ...described,
    task: { ...described.task, status: state === "interrupted" ? "interrupted" : "cancel_requested" },
    interruptRequested: true,
    stateAfter: state,
  };
}

