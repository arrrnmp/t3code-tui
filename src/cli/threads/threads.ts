/**
 * Threads CLI: argument handling and `--json` envelopes over `ClientApi`.
 *
 * Every read is a `query` and every change a `dispatch`, through the same
 * contract the TUI uses (`../infra/client.ts`). What stays here is what
 * only the CLI has: its envelope keys (`runtime`, `auth`, `command`,
 * `dispatch`, `verification`, `opened` — kept byte-compatible for `--json`
 * consumers, pinned by `../tests/envelopes/`), flag-worded errors, the
 * interactive settled-thread prompt, dry-run previews, and blocking a
 * one-shot process until its turn settles.
 */
import { randomUUID } from "node:crypto";

import { defaultModelSelection, followUpSelection, type ModelRequest } from "../../core/catalog/selection.js";
import { CliError } from "../../core/errors.js";
import {
  isThreadActive,
  isThreadBusy,
  openQuestions,
  threadListStatus,
  type OpenRequest,
  type ThreadListStatus,
  type ThreadReadView,
} from "../../core/threads/views.js";
import type { CliConfig, OpenMode, ProjectEnvelope, SpeedMode, ThreadEnvelope } from "../../core/types.js";
import type { ClientApi } from "../../server/api.js";
import { awaitTurn, cliClient, type TurnDriverFactories } from "../infra/client.js";
import { directAuth, directRuntime } from "../infra/direct.js";
import type { WorkspaceOptions } from "../projects/projects.js";

export type {
  DelegatedTaskStatus,
  DelegatedTaskWorkState,
  ThreadListStatus,
  ThreadReadView,
} from "../../core/threads/views.js";

export interface ThreadSendOptions {
  threadId: string;
  prompt: string;
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
  openMode?: OpenMode;
  dryRun?: boolean;
  ifBusy?: "reject" | "inject";
  wakeSettled?: boolean;
  delivery?: ThreadSendDelivery;
  handoffNote?: string;
  confirmSettled?: (thread: ThreadEnvelope, project: ProjectEnvelope | null) => Promise<boolean>;
  drivers?: TurnDriverFactories;
  /** Return at acceptance; otherwise block until the turn settles. */
  noWait?: boolean;
}

export type ThreadSendDelivery = "auto" | "steer" | "restart" | "queue";

export type ThreadSendDeliveryResult = "started" | "queued" | "steered" | "restarted";

export interface ThreadListOptions extends WorkspaceOptions {
  project?: string;
  status?: ThreadListStatus;
}

export interface ThreadReadRequestOptions {
  lastTurn?: boolean;
  view?: ThreadReadView;
}

function requireThreadId(value: string): string {
  const threadId = value.trim();
  if (!threadId) {
    throw new CliError("THREAD_ID_REQUIRED", "A non-empty thread id is required.", { exitCode: 2 });
  }
  return threadId;
}

function normalizeDelivery(raw: ThreadSendDelivery | undefined): ThreadSendDelivery {
  const delivery = raw ?? "auto";
  if (delivery !== "auto" && delivery !== "steer" && delivery !== "restart" && delivery !== "queue") {
    throw new CliError("INVALID_THREAD_OPTION", "--delivery must be auto, steer, restart, or queue.", {
      exitCode: 2,
      details: { delivery: raw },
    });
  }
  return delivery;
}

function normalizeHandoffNote(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const note = raw.trim();
  if (!note) {
    throw new CliError("INVALID_THREAD_OPTION", "--handoff-note must be a non-empty string.", { exitCode: 2 });
  }
  return note;
}

function normalizeSnoozeUntil(raw: string): string {
  const trimmed = raw.trim();
  const parsed = Date.parse(trimmed);
  if (!trimmed || !Number.isFinite(parsed)) {
    throw new CliError("SNOOZE_UNTIL_INVALID", "Use --until with a valid ISO-8601 datetime.", {
      exitCode: 2,
      details: { until: raw },
    });
  }
  return new Date(parsed).toISOString();
}

function modelRequestOf(options: {
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
}): ModelRequest {
  return {
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.speedMode !== undefined ? { speedMode: options.speedMode } : {}),
    ...(options.thinkingEffort !== undefined ? { thinkingEffort: options.thinkingEffort } : {}),
  };
}

function requireNotArchived(thread: ThreadEnvelope, action: string): void {
  if (thread.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${thread.id} is archived and cannot ${action}.`, {
      exitCode: 4,
      details: { threadId: thread.id, archivedAt: thread.archivedAt },
    });
  }
}

function openedNone(openMode: OpenMode | undefined, config: CliConfig) {
  return { mode: openMode ?? config.openMode, kind: "none" as const, url: null, exactThread: false };
}

/** The thread and its project, as the server sees them now. */
async function inspect(client: ClientApi, threadId: string) {
  return await client.query({ type: "thread.inspect", threadId });
}

export async function listThreads(config: CliConfig, options: ThreadListOptions = {}) {
  const listed = await (await cliClient(config)).query({
    type: "threads.list",
    ...(options.project !== undefined ? { projectId: options.project } : {}),
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.workspaceMode !== undefined ? { workspaceMode: options.workspaceMode } : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
  });
  return { runtime: directRuntime(), auth: directAuth(), snapshotSequence: 0, ...listed };
}

export async function inspectThread(config: CliConfig, rawThreadId: string) {
  const view = await inspect(await cliClient(config), requireThreadId(rawThreadId));
  return { runtime: directRuntime(), auth: directAuth(), snapshotSequence: 0, ...view };
}

export async function readThread(config: CliConfig, rawThreadId: string, options: ThreadReadRequestOptions = {}) {
  const view = await (await cliClient(config)).query({
    type: "thread.read",
    threadId: requireThreadId(rawThreadId),
    ...(options.view !== undefined ? { view: options.view } : {}),
    ...(options.lastTurn !== undefined ? { lastTurn: options.lastTurn } : {}),
  });
  return { runtime: directRuntime(), auth: directAuth(), snapshotSequence: 0, ...view };
}

async function changeSnooze(config: CliConfig, rawThreadId: string, rawUntil: string | null) {
  const threadId = requireThreadId(rawThreadId);
  const snoozedUntil = rawUntil === null ? null : normalizeSnoozeUntil(rawUntil);
  const client = await cliClient(config);
  const { project, thread: before } = await inspect(client, threadId);
  requireNotArchived(before, snoozedUntil === null ? "be unsnoozed" : "be snoozed");
  const command =
    snoozedUntil === null
      ? { type: "thread.unsnooze" as const, commandId: randomUUID(), threadId, reason: "user" as const }
      : { type: "thread.snooze" as const, commandId: randomUUID(), threadId, snoozedUntil };
  if (snoozedUntil === null) await client.dispatch({ type: "thread.unsnooze", threadId });
  else await client.dispatch({ type: "thread.snooze", threadId, snoozedUntil });
  const { thread: after } = await inspect(client, threadId);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: { id: before.id, projectId: before.projectId, title: before.title, snoozedUntil: after.snoozedUntil },
    command,
    dispatch: null,
    verification: {
      accepted: true as const,
      snoozedUntil: after.snoozedUntil,
      snoozedAt: after.snoozedAt ?? null,
      snapshotSequence: 0,
    },
  };
}

export async function snoozeThread(config: CliConfig, rawThreadId: string, rawUntil: string) {
  return await changeSnooze(config, rawThreadId, rawUntil);
}

export async function unsnoozeThread(config: CliConfig, rawThreadId: string) {
  return await changeSnooze(config, rawThreadId, null);
}

export async function interruptThread(config: CliConfig, rawThreadId: string, options: { run?: string } = {}) {
  const threadId = requireThreadId(rawThreadId);
  const rawRun = options.run?.trim() ?? "";
  if (options.run !== undefined && !rawRun) {
    throw new CliError("INVALID_THREAD_OPTION", "--run requires a non-empty turn id.", { exitCode: 2 });
  }
  const turnId = rawRun || undefined;
  const client = await cliClient(config);
  const { project, thread } = await inspect(client, threadId);
  requireNotArchived(thread, "be interrupted");
  const base = {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: { id: thread.id, projectId: thread.projectId, title: thread.title, latestTurn: thread.latestTurn ?? null },
  };
  if (!isThreadActive(thread)) {
    return {
      ...base,
      run: thread.latestTurn?.turnId ?? turnId ?? null,
      result: "no_active_run" as const,
      command: null,
      dispatch: null,
      verification: null,
    };
  }
  const command = {
    type: "thread.turn.interrupt" as const,
    commandId: randomUUID(),
    threadId,
    ...(turnId ? { turnId } : {}),
    createdAt: new Date().toISOString(),
  };
  await client.dispatch({ type: "thread.turn.interrupt", threadId, ...(turnId ? { turnId } : {}) });
  const { thread: after } = await inspect(client, threadId);
  return {
    ...base,
    run: after.latestTurn?.turnId ?? turnId ?? null,
    result: "interrupt_requested" as const,
    command,
    dispatch: null,
    verification: {
      accepted: true as const,
      method: "interrupt" as const,
      snapshotSequence: 0,
      state: after.latestTurn?.state ?? null,
    },
  };
}

async function changeThreadSettlement(config: CliConfig, rawThreadId: string, state: "settled" | "active") {
  const threadId = requireThreadId(rawThreadId);
  const client = await cliClient(config);
  const { project, thread: before } = await inspect(client, threadId);
  requireNotArchived(before, "change settlement state");
  if (
    state === "settled" &&
    (before.session?.status === "starting" ||
      before.session?.status === "running" ||
      before.hasPendingApprovals === true ||
      before.hasPendingUserInput === true)
  ) {
    throw new CliError("THREAD_SETTLE_BLOCKED", `Thread ${threadId} still has active or blocked work.`, {
      exitCode: 4,
      details: {
        threadId,
        sessionStatus: before.session?.status ?? null,
        hasPendingApprovals: before.hasPendingApprovals === true,
        hasPendingUserInput: before.hasPendingUserInput === true,
      },
    });
  }
  const command =
    state === "settled"
      ? { type: "thread.settle" as const, commandId: randomUUID(), threadId }
      : { type: "thread.unsettle" as const, commandId: randomUUID(), threadId, reason: "user" as const };
  if (state === "settled") await client.dispatch({ type: "thread.settle", threadId });
  else await client.dispatch({ type: "thread.unsettle", threadId, reason: "user" });
  const { thread: after } = await inspect(client, threadId);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: {
      id: before.id,
      projectId: before.projectId,
      title: before.title,
      statusBefore: threadListStatus(before),
      statusAfter: threadListStatus(after),
    },
    command,
    dispatch: null,
    verification: {
      accepted: true as const,
      state,
      snapshotSequence: 0,
      settledAt: after.settledAt ?? null,
      unsettledAt: after.unsettledAt ?? null,
    },
  };
}

export async function settleThread(config: CliConfig, threadId: string) {
  return await changeThreadSettlement(config, threadId, "settled");
}

export async function unsettleThread(config: CliConfig, threadId: string) {
  return await changeThreadSettlement(config, threadId, "active");
}

export interface ThreadDelegateOptions {
  parentThreadId: string;
  task: string;
  title?: string;
  provider?: string;
  model?: string;
  speedMode?: SpeedMode;
  thinkingEffort?: string;
  wait?: boolean;
  timeoutMs?: number;
  openMode?: OpenMode;
  dryRun?: boolean;
  isolation?: "shared" | "worktree";
  drivers?: TurnDriverFactories;
}

export async function delegateTask(config: CliConfig, options: ThreadDelegateOptions) {
  const result = await (await cliClient(config, options.drivers)).dispatch({
    type: "thread.delegate",
    parentThreadId: options.parentThreadId,
    task: options.task,
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.wait !== undefined ? { wait: options.wait } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    ...(options.isolation !== undefined ? { isolation: options.isolation } : {}),
    ...modelRequestOf(options),
  });
  const createdAt = new Date().toISOString();
  const { parent, child, modelSelection, runtimeMode, interactionMode } = result;
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project: result.project,
    parent: { id: parent.id, projectId: parent.projectId, title: parent.title },
    child,
    createCommand: {
      type: "thread.create" as const,
      commandId: randomUUID(),
      threadId: child.id,
      projectId: parent.projectId,
      title: child.title,
      modelSelection,
      runtimeMode,
      interactionMode,
      branch: result.worktree?.branch ?? result.branch,
      worktreePath: result.worktree?.path ?? null,
      createdAt,
    },
    turnCommand: {
      type: "thread.turn.start" as const,
      commandId: randomUUID(),
      threadId: child.id,
      message: {
        messageId: result.messageId ?? randomUUID(),
        role: "user" as const,
        text: options.task.trim(),
        attachments: [] as [],
      },
      modelSelection,
      titleSeed: child.title,
      runtimeMode,
      interactionMode,
      createdAt,
    },
    task: result.task,
    dispatch: null,
    verification:
      result.messageId === null
        ? null
        : {
            accepted: true as const,
            method: "message-id" as const,
            snapshotSequence: 0,
            messageId: result.messageId,
          },
    opened: openedNone(options.openMode, config),
    dryRun: options.dryRun === true,
  };
}

export async function taskStatus(config: CliConfig, rawParentThreadId: string, rawTaskId: string) {
  const described = await (await cliClient(config)).query({
    type: "thread.task.status",
    parentThreadId: requireThreadId(rawParentThreadId),
    taskId: requireThreadId(rawTaskId),
  });
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project: described.project,
    parent: { id: described.parent.id, projectId: described.parent.projectId, title: described.parent.title },
    task: { ...described.task, hasPendingChildRuns: false, waitTimedOut: false },
  };
}

export async function cancelTask(config: CliConfig, rawParentThreadId: string, rawTaskId: string) {
  const cancelled = await (await cliClient(config)).dispatch({
    type: "thread.task.cancel",
    parentThreadId: requireThreadId(rawParentThreadId),
    taskId: requireThreadId(rawTaskId),
  });
  const base = {
    runtime: directRuntime(),
    auth: directAuth(),
    project: cancelled.project,
    parent: { id: cancelled.parent.id, projectId: cancelled.parent.projectId, title: cancelled.parent.title },
    task: cancelled.task,
  };
  if (!cancelled.interruptRequested) return { ...base, command: null, dispatch: null, verification: null };
  return {
    ...base,
    command: {
      type: "thread.turn.interrupt" as const,
      commandId: randomUUID(),
      threadId: cancelled.child.id,
      createdAt: new Date().toISOString(),
    },
    dispatch: null,
    verification: {
      accepted: true as const,
      method: "interrupt" as const,
      snapshotSequence: 0,
      state: cancelled.stateAfter,
    },
  };
}

/** Codes a failed send reports as-is rather than as a failed start. */
const SEND_PASSTHROUGH_CODES = new Set(["THREAD_BUSY", "PROVIDER_UNKNOWN"]);

export async function sendThreadMessage(config: CliConfig, options: ThreadSendOptions) {
  const threadId = requireThreadId(options.threadId);
  const prompt = options.prompt.trim();
  if (!prompt) {
    throw new CliError("PROMPT_REQUIRED", "A non-empty thread message is required.", { exitCode: 2 });
  }
  const ifBusy = options.ifBusy ?? "reject";
  if (ifBusy !== "reject" && ifBusy !== "inject") {
    throw new CliError("INVALID_THREAD_OPTION", "ifBusy must be reject or inject.");
  }
  const delivery = normalizeDelivery(options.delivery);
  const handoffNote = normalizeHandoffNote(options.handoffNote);

  const client = await cliClient(config, options.drivers);
  const { project, thread } = await inspect(client, threadId);
  requireNotArchived(thread, "receive a new turn");
  // Checked here, ahead of the server's own guards, because only the CLI
  // can ask: the settled prompt is interactive and the errors name flags.
  if (threadListStatus(thread) === "settled" && !options.wakeSettled) {
    if (!options.confirmSettled) {
      throw new CliError(
        "SETTLED_THREAD_CONFIRMATION_REQUIRED",
        `Thread ${threadId} is settled. Re-run with --wake-settled to send and wake it.`,
        { exitCode: 4, details: { threadId, settledAt: thread.settledAt } },
      );
    }
    if (!(await options.confirmSettled(thread, project))) {
      throw new CliError("SETTLED_THREAD_DECLINED", `Did not send a message to settled thread ${threadId}.`, {
        exitCode: 4,
        details: { threadId },
      });
    }
  }
  const busy = isThreadBusy(thread);
  if (delivery === "auto" && busy && ifBusy === "reject") {
    throw new CliError("THREAD_BUSY", "The thread has an active or pending turn. Retry when idle or use --if-busy inject.", {
      details: { threadId },
    });
  }
  if ((delivery === "steer" || delivery === "restart") && !busy) {
    throw new CliError(
      "THREAD_NOT_STEERABLE",
      `Thread ${threadId} has no active turn to ${delivery}. Send without --delivery or with --delivery queue.`,
      { exitCode: 4, details: { threadId, delivery } },
    );
  }
  const deliveryResult: ThreadSendDeliveryResult =
    delivery === "queue" ? (busy ? "queued" : "started")
    : delivery === "steer" ? "steered"
    : delivery === "restart" ? "restarted"
    : "started";

  const base = thread.modelSelection ?? project?.defaultModelSelection ?? defaultModelSelection();
  const modelSelection = followUpSelection(base, config, modelRequestOf(options), prompt);
  const createdAt = new Date().toISOString();
  const envelope = (messageId: string) => ({
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: { id: thread.id, projectId: thread.projectId, title: thread.title, statusBeforeSend: threadListStatus(thread) },
    message: { messageId, textLength: prompt.length },
    command: {
      type: "thread.turn.start" as const,
      commandId: randomUUID(),
      threadId,
      runtimeMode: thread.runtimeMode ?? "full-access",
      interactionMode: thread.interactionMode ?? "default",
      ...(modelSelection ? { modelSelection } : {}),
      createdAt,
    },
    delivery: deliveryResult,
    handoffNote,
  });

  if (options.dryRun) {
    return {
      ...envelope(randomUUID()),
      ...(delivery === "restart" ? { interruptPreview: { type: "thread.turn.interrupt", threadId: thread.id } } : {}),
      dispatch: null,
      verification: null,
      opened: openedNone(options.openMode, config),
      dryRun: true as const,
    };
  }

  const sent = await client
    .dispatch({
      type: "thread.turn.start",
      threadId,
      message: { text: prompt },
      ...(options.ifBusy ? { ifBusy: options.ifBusy } : {}),
      ...(options.delivery ? { delivery: options.delivery } : {}),
      ...(options.wakeSettled !== undefined ? { wakeSettled: options.wakeSettled } : {}),
      ...(modelSelection ? { modelSelection } : {}),
      ...(options.handoffNote !== undefined ? { handoffNote: options.handoffNote } : {}),
    })
    .catch((cause: unknown) => {
      if (cause instanceof CliError && SEND_PASSTHROUGH_CODES.has(cause.code)) throw cause;
      throw new CliError("THREAD_START_FAILED", `Could not start a turn on thread ${thread.id}. The thread was left untouched.`, {
        cause,
        details: { threadId: thread.id },
      });
    });
  if (options.noWait !== true) await awaitTurn(client, threadId, sent.turnId);
  return {
    ...envelope(sent.messageId),
    dispatch: null,
    verification: {
      accepted: true as const,
      method: "message-id" as const,
      snapshotSequence: 0,
      messageId: sent.messageId,
    },
    ...(modelSelection ? { modelSelection } : {}),
    opened: openedNone(options.openMode, config),
    dryRun: false as const,
  };
}

export async function sendThreadPrompt(config: CliConfig, options: ThreadSendOptions) {
  return await sendThreadMessage(config, options);
}

/**
 * Archive, delete, rename: thread-record changes that need no running
 * turn, so they work from any process. (Answering or dismissing a parked
 * question does not: the question lives in the driver of the process
 * running the turn, which a separate CLI invocation cannot reach until
 * the server runs out of process.)
 */
async function changeThreadRecord(
  config: CliConfig,
  rawThreadId: string,
  change: "archive" | "delete" | { title: string },
) {
  const threadId = requireThreadId(rawThreadId);
  const client = await cliClient(config);
  const { project, thread: before } = await inspect(client, threadId);
  const command =
    change === "archive"
      ? { type: "thread.archive" as const, commandId: randomUUID(), threadId }
      : change === "delete"
        ? { type: "thread.delete" as const, commandId: randomUUID(), threadId }
        : { type: "thread.meta.update" as const, commandId: randomUUID(), threadId, title: change.title };
  if (change === "archive") await client.dispatch({ type: "thread.archive", threadId });
  else if (change === "delete") await client.dispatch({ type: "thread.delete", threadId });
  else await client.dispatch({ type: "thread.meta.update", threadId, title: change.title });
  const { thread: after } = await inspect(client, threadId);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: {
      id: before.id,
      projectId: before.projectId,
      titleBefore: before.title,
      title: after.title,
      archivedAt: after.archivedAt ?? null,
      deletedAt: after.deletedAt ?? null,
    },
    command,
    dispatch: null,
    verification: { accepted: true as const, snapshotSequence: 0 },
  };
}

export async function archiveThread(config: CliConfig, threadId: string) {
  return await changeThreadRecord(config, threadId, "archive");
}

export async function deleteThread(config: CliConfig, threadId: string) {
  return await changeThreadRecord(config, threadId, "delete");
}

export async function renameThread(config: CliConfig, threadId: string, rawTitle: string) {
  const title = rawTitle.trim().replace(/\s+/gu, " ");
  if (!title) throw new CliError("INVALID_THREAD_OPTION", "--title must be a non-empty string.", { exitCode: 2 });
  return await changeThreadRecord(config, threadId, { title });
}

/**
 * Parked questions: list them, answer them, dismiss them. The answer
 * reaches the provider only from the process running the turn — which,
 * with a shared server (`moxen server start`), is every client; without
 * one the server refuses with `REQUEST_NOT_OWNED` rather than pretending.
 */
async function parked(client: ClientApi, threadId: string) {
  const { project, thread } = await client.query({ type: "thread.read", threadId, view: "turn-items" });
  const items = "items" in thread ? thread.items : [];
  return { project, thread, requests: openQuestions({ ...thread, activities: items }) };
}

export async function listQuestions(config: CliConfig, rawThreadId: string) {
  const threadId = requireThreadId(rawThreadId);
  const { project, thread, requests } = await parked(await cliClient(config), threadId);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: { id: thread.id, projectId: thread.projectId, title: thread.title },
    requests,
  };
}

function pickRequest(requests: readonly OpenRequest[], threadId: string, requestId: string | undefined): OpenRequest {
  if (requests.length === 0) {
    throw new CliError("NO_OPEN_QUESTION", `Thread ${threadId} is not waiting on a question.`, {
      exitCode: 4,
      details: { threadId },
    });
  }
  if (requestId !== undefined) {
    const match = requests.find((request) => request.requestId === requestId);
    if (!match) {
      throw new CliError("QUESTION_NOT_FOUND", `Thread ${threadId} has no open question ${requestId}.`, {
        exitCode: 3,
        details: { threadId, requestId, open: requests.map((request) => request.requestId) },
      });
    }
    return match;
  }
  if (requests.length > 1) {
    throw new CliError("QUESTION_AMBIGUOUS", `Thread ${threadId} has ${requests.length} open questions; pick one with --request.`, {
      exitCode: 2,
      details: { threadId, open: requests.map((request) => request.requestId) },
    });
  }
  return requests[0]!;
}

/** One `--answer` per question, in order; a multi-select answer is comma-separated. */
function answersFor(request: OpenRequest, raw: readonly string[]): Record<string, string | string[]> {
  if (raw.length !== request.questions.length) {
    throw new CliError(
      "INVALID_THREAD_OPTION",
      `Question ${request.requestId} asks ${request.questions.length} question(s); pass one --answer for each, in order.`,
      { exitCode: 2, details: { expected: request.questions.length, received: raw.length } },
    );
  }
  const answers: Record<string, string | string[]> = {};
  request.questions.forEach((question, index) => {
    const value = raw[index]!.trim();
    const picked = question.multiSelect ? value.split(",").map((part) => part.trim()).filter(Boolean) : [value];
    const labels = question.options.map((option) => option.label);
    const unknown = picked.filter((choice) => !labels.includes(choice));
    if (picked.length === 0 || picked[0] === "" || (!question.allowCustomAnswer && unknown.length > 0)) {
      throw new CliError("INVALID_THREAD_OPTION", `"${value}" is not an option for "${question.question}".`, {
        exitCode: 2,
        details: { question: question.question, options: labels },
      });
    }
    answers[question.id] = question.multiSelect ? picked : picked[0]!;
  });
  return answers;
}

export async function answerQuestion(
  config: CliConfig,
  rawThreadId: string,
  options: { requestId?: string; answers: readonly string[] },
) {
  const threadId = requireThreadId(rawThreadId);
  const client = await cliClient(config);
  const { project, thread, requests } = await parked(client, threadId);
  const request = pickRequest(requests, threadId, options.requestId);
  const answers = answersFor(request, options.answers);
  await client.dispatch({ type: "thread.user-input.respond", threadId, requestId: request.requestId, answers });
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: { id: thread.id, projectId: thread.projectId, title: thread.title },
    request: { requestId: request.requestId, questions: request.questions.map((question) => question.question) },
    answers,
    command: { type: "thread.user-input.respond" as const, commandId: randomUUID(), threadId, requestId: request.requestId },
    dispatch: null,
    verification: { accepted: true as const, snapshotSequence: 0 },
  };
}

export async function dismissQuestion(config: CliConfig, rawThreadId: string, options: { requestId?: string } = {}) {
  const threadId = requireThreadId(rawThreadId);
  const client = await cliClient(config);
  const { project, thread, requests } = await parked(client, threadId);
  const request = pickRequest(requests, threadId, options.requestId);
  await client.dispatch({ type: "thread.user-input.dismiss", threadId, requestId: request.requestId });
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: { id: thread.id, projectId: thread.projectId, title: thread.title },
    request: { requestId: request.requestId, questions: request.questions.map((question) => question.question) },
    command: { type: "thread.user-input.dismiss" as const, commandId: randomUUID(), threadId, requestId: request.requestId },
    dispatch: null,
    verification: { accepted: true as const, snapshotSequence: 0 },
  };
}

/**
 * Revert the conversation so its first `keep` turns remain. Files are left
 * as they are; the provider forgets the dropped turns too.
 */
export async function revertConversation(
  config: CliConfig,
  rawThreadId: string,
  rawKeep: string | number,
  options: { drivers?: TurnDriverFactories } = {},
) {
  const threadId = requireThreadId(rawThreadId);
  const keep = typeof rawKeep === "number" ? rawKeep : Number(String(rawKeep).trim());
  if (!Number.isInteger(keep) || keep < 0) {
    throw new CliError("INVALID_THREAD_OPTION", "--keep must be a whole number of turns, 0 or more.", {
      exitCode: 2,
      details: { keep: rawKeep },
    });
  }
  // Rolling the provider back may mean resuming its session: drivers matter.
  const client = await cliClient(config, options.drivers);
  const { project, thread } = await inspect(client, threadId);
  const result = await client.dispatch({ type: "thread.conversation.revert", threadId, turnCount: keep });
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: { id: thread.id, projectId: thread.projectId, title: thread.title },
    keptTurns: result.keptTurns,
    removedTurns: result.removedTurns,
    providers: result.providers,
    command: { type: "thread.conversation.revert" as const, commandId: randomUUID(), threadId, turnCount: keep },
    dispatch: null,
    verification: { accepted: true as const, snapshotSequence: 0 },
  };
}
