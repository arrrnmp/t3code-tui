/**
 * Threads CLI over the own store. Same envelopes, same guards, same error
 * codes as the T3 era — only the transport changed: ledger reads replace
 * snapshot GETs, store ops replace dispatch-then-poll (acceptance is
 * synchronous, so `dispatch` is always null and `verification` is
 * synthesized with `accepted: true`), and provider runs continue in the
 * background through `executeTurn`.
 */
import { randomUUID } from "node:crypto";

import * as Effect from "effect/Effect";

import { CliError } from "../../errors.js";
import { listStoredProjects } from "../../projects/projects.js";
import { openThreadStore, resolveStoreRoot, ThreadStore } from "../../threads/store.js";
import {
  archiveThread as archiveStoredThread,
  createThread as createStoredThread,
  inspectThread as inspectStoredThread,
  interruptTurn as interruptStoredTurn,
  listThreads as listStoredThreads,
  readThread as readStoredThread,
  sendTurn as sendStoredTurn,
  settleThread as settleStoredThread,
  snoozeThread as snoozeStoredThread,
  unsettleThread as unsettleStoredThread,
  unsnoozeThread as unsnoozeStoredThread,
} from "../../threads/threads.js";
import { delegationForChild } from "../../threads/threads.js";
import { driverForInstance, executeTurn, waitForTurnTerminal, type TurnDriverFactories } from "../../threads/execute.js";
import { toT3Thread } from "../../threads/project.js";
import type {
  CliConfig,
  InteractionMode,
  ModelSelection,
  OpenMode,
  RuntimeMode,
  SpeedMode,
  T3Project,
  T3Thread,
} from "../../types.js";
import { directAuth, directRuntime } from "../infra/direct.js";
import { resolveWorkspace } from "../infra/workspace.js";
import { projectForWorkspace, type WorkspaceOptions } from "../projects/projects.js";
import {
  asModelSelection,
  defaultModelSelection,
  resolveModelSelection,
} from "../shared/selection.js";

const INSPECT_RECENT_MESSAGE_LIMIT = 6;
const INSPECT_MESSAGE_TEXT_LIMIT = 2_000;

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
  confirmSettled?: (thread: T3Thread, project: T3Project | null) => Promise<boolean>;
  drivers?: TurnDriverFactories;
  /** Return at acceptance; otherwise block until the turn settles. */
  noWait?: boolean;
}

export type ThreadListStatus = "active" | "settled" | "snoozed" | "all";

export type ThreadReadView = "messages" | "turn-items" | "plans" | "checkpoints" | "transfers";

export type ThreadSendDelivery = "auto" | "steer" | "restart" | "queue";

export type ThreadSendDeliveryResult = "started" | "queued" | "steered" | "restarted";

export type DelegatedTaskStatus = "running" | "completed" | "failed" | "interrupted";

export type DelegatedTaskWorkState = "working" | "result_available";

const DELEGATE_DEFAULT_TIMEOUT_MS = 600_000;
const DELEGATE_POLL_INTERVAL_MS = 200;

export interface ThreadListOptions extends WorkspaceOptions {
  project?: string;
  status?: ThreadListStatus;
}

function nonArchivedThread(thread: T3Thread): boolean {
  return thread.archivedAt == null && thread.deletedAt == null;
}

function threadStatus(thread: T3Thread): Exclude<ThreadListStatus, "all"> {
  if (thread.settledAt != null) return "settled";
  return isSnoozedThread(thread) ? "snoozed" : "active";
}

function isSnoozedThread(thread: T3Thread, now = Date.now()): boolean {
  if (thread.settledAt != null) return false;
  const until = thread.snoozedUntil;
  if (typeof until !== "string" || until.length === 0) return false;
  const parsed = Date.parse(until);
  return Number.isFinite(parsed) && parsed > now;
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

function normalizeReadView(raw: ThreadReadView | undefined): ThreadReadView {
  const view = raw ?? "messages";
  if (view !== "messages" && view !== "turn-items" && view !== "plans" && view !== "checkpoints" && view !== "transfers") {
    throw new CliError("INVALID_THREAD_OPTION", "--view must be messages, turn-items, plans, checkpoints, or transfers.", {
      exitCode: 2,
      details: { view: raw },
    });
  }
  return view;
}

function delegatedStatusOf(thread: T3Thread): DelegatedTaskStatus {
  const state = thread.latestTurn?.state;
  if (state === "completed") return "completed";
  if (state === "error") return "failed";
  if (state === "interrupted") return "interrupted";
  return "running";
}

function delegatedWorkStateOf(status: DelegatedTaskStatus): DelegatedTaskWorkState {
  return status === "running" ? "working" : "result_available";
}

function threadAssistantSummary(thread: T3Thread): string | null {
  const messages = thread.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant" && message.text.trim().length > 0) return message.text;
  }
  return null;
}

function isThreadActive(thread: T3Thread): boolean {
  const latestState = thread.latestTurn?.state as string | undefined;
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.session?.activeTurnId != null ||
    latestState === "running"
  );
}

function delegateThreadTitle(task: string, explicitTitle: string | undefined): string {
  const trimmed = explicitTitle?.trim();
  if (trimmed) return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 79)}…`;
  const firstLine = task.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, " ").trim() || "Delegated task";
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 79)}…`;
}

function requireThreadId(value: string): string {
  const threadId = value.trim();
  if (!threadId) {
    throw new CliError("THREAD_ID_REQUIRED", "A non-empty thread id is required.", { exitCode: 2 });
  }
  return threadId;
}

function threadInspectionView(thread: T3Thread) {
  const messages = thread.messages ?? [];
  const summary = { ...thread };
  delete summary.messages;
  delete summary.activities;
  delete summary.checkpoints;
  delete summary.proposedPlans;
  return {
    ...summary,
    status: threadStatus(thread),
    snoozedUntil: (thread.snoozedUntil as string | null | undefined) ?? null,
    messageCount: messages.length,
    recentMessages: messages.slice(-INSPECT_RECENT_MESSAGE_LIMIT).map((message) => ({
      id: message.id,
      role: message.role,
      turnId: message.turnId,
      text:
        message.text.length <= INSPECT_MESSAGE_TEXT_LIMIT
          ? message.text
          : `${message.text.slice(0, INSPECT_MESSAGE_TEXT_LIMIT - 1)}…`,
      textTruncated: message.text.length > INSPECT_MESSAGE_TEXT_LIMIT,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    })),
  };
}

export interface ThreadReadRequestOptions {
  lastTurn?: boolean;
  view?: ThreadReadView;
}

function threadReadView(thread: T3Thread, options: { lastTurn: boolean; view: ThreadReadView }) {
  const { lastTurn, view } = options;
  const summary = { ...thread } as Record<string, unknown>;
  delete summary.messages;
  delete summary.activities;
  delete summary.checkpoints;
  delete summary.proposedPlans;
  const base = {
    ...summary,
    status: threadStatus(thread),
  };
  if (view === "turn-items") {
    const turnId = lastTurn ? (thread.latestTurn?.turnId ?? null) : null;
    const activities = thread.activities ?? [];
    const items = lastTurn
      ? activities.filter((activity) => turnId !== null && activity.turnId === turnId)
      : activities;
    return {
      ...base,
      view: "turn-items" as const,
      itemCount: items.length,
      items,
      ...(lastTurn ? { messageFilter: { scope: "last-turn" as const, turnId } } : {}),
    };
  }
  if (view === "plans") {
    const plans = thread.proposedPlans ?? [];
    return { ...base, view: "plans" as const, planCount: plans.length, plans };
  }
  if (view === "checkpoints") {
    const checkpoints = thread.checkpoints ?? [];
    return { ...base, view: "checkpoints" as const, checkpointCount: checkpoints.length, checkpoints };
  }
  if (view === "transfers") {
    // No transport exposes ContextTransfer rows; report the empty set
    // explicitly instead of inventing lineage.
    return {
      ...base,
      view: "transfers" as const,
      transferCount: 0,
      transfers: [],
      note: "V1 threads carry no context transfers.",
    };
  }
  const turnId = lastTurn ? (thread.latestTurn?.turnId ?? null) : null;
  const messages = lastTurn
    ? (thread.messages ?? []).filter((message) => turnId !== null && message.turnId === turnId)
    : (thread.messages ?? []);
  return {
    ...base,
    view: "messages" as const,
    messageCount: messages.length,
    messages,
    ...(lastTurn ? { messageFilter: { scope: "last-turn" as const, turnId } } : {}),
  };
}

function isThreadBusy(thread: T3Thread): boolean {
  const latestState = thread.latestTurn?.state as string | undefined;
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.session?.activeTurnId != null ||
    latestState === "pending" ||
    latestState === "running"
  );
}

async function openStore(): Promise<ThreadStore> {
  return await openThreadStore(resolveStoreRoot());
}

async function storedProjects(): Promise<T3Project[]> {
  return await listStoredProjects(resolveStoreRoot());
}

function projectOf(projects: T3Project[], projectId: string): T3Project | null {
  return projects.find((candidate) => candidate.id === projectId) ?? null;
}

const driverOwner = {};

async function fullThread(store: ThreadStore, threadId: string): Promise<T3Thread> {
  const read = await readStoredThread(store, threadId, { view: "messages" });
  return toT3Thread(read.thread, read.turns, {
    messages: read.messages,
    activities: read.activities,
    checkpoints: read.checkpoints,
  });
}

function openedNone(openMode: OpenMode | undefined, config: CliConfig) {
  return { mode: openMode ?? config.openMode, kind: "none" as const, url: null, exactThread: false };
}

export async function listThreads(config: CliConfig, options: ThreadListOptions = {}) {
  const requestedProjectId = options.project?.trim();
  if (options.project !== undefined && !requestedProjectId) {
    throw new CliError("PROJECT_ID_REQUIRED", "--project requires a non-empty project id.", {
      exitCode: 2,
    });
  }
  if (requestedProjectId && options.cwd) {
    throw new CliError("THREAD_FILTER_CONFLICT", "Use either --project or --cwd, not both.", {
      exitCode: 2,
    });
  }
  const store = await openStore();
  const projects = await storedProjects();
  let project: T3Project | null = null;
  let workspace = null;

  if (requestedProjectId) {
    project = projects.filter((candidate) => candidate.deletedAt == null).find((candidate) => candidate.id === requestedProjectId) ?? null;
  } else if (options.cwd) {
    workspace = await resolveWorkspace(options.cwd, options.workspaceMode ?? config.workspaceMode);
    project = projectForWorkspace(projects, workspace.workspaceRoot);
  }

  if ((requestedProjectId || options.cwd) && !project) {
    throw new CliError(
      "PROJECT_NOT_FOUND",
      requestedProjectId
        ? `No active T3 Code project exists with id ${requestedProjectId}.`
        : `No T3 Code project exists for ${workspace!.workspaceRoot}.`,
      { exitCode: 3 },
    );
  }

  const requestedStatus = options.status ?? "all";
  const stored = await listStoredThreads(store, {
    status: requestedStatus === "all" ? "all" : requestedStatus,
    ...(project ? { projectId: project.id } : {}),
  });
  const threads = await Promise.all(
    stored.map(async (entry) => toT3Thread(entry, await store.readTurns(entry.id))),
  );
  const visible = threads
    .filter(nonArchivedThread)
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
    .map((thread) => ({ ...thread, status: threadStatus(thread) }));

  return {
    runtime: directRuntime(),
    auth: directAuth(),
    snapshotSequence: 0,
    filter: {
      status: requestedStatus,
      projectId: project?.id ?? null,
      workspaceRoot: workspace?.workspaceRoot ?? null,
    },
    projects: projects.filter((candidate) => candidate.deletedAt == null),
    threads: visible,
  };
}

export async function inspectThread(config: CliConfig, rawThreadId: string) {
  void config;
  const threadId = requireThreadId(rawThreadId);
  const store = await openStore();
  const thread = await fullThread(store, threadId);
  const project = projectOf(await storedProjects(), thread.projectId);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    snapshotSequence: 0,
    project,
    thread: threadInspectionView(thread),
  };
}

export async function readThread(
  config: CliConfig,
  rawThreadId: string,
  options: ThreadReadRequestOptions = {},
) {
  void config;
  const threadId = requireThreadId(rawThreadId);
  const lastTurn = options.lastTurn ?? false;
  const view = normalizeReadView(options.view);
  const store = await openStore();
  const read = await readStoredThread(store, threadId, { view: "messages" });
  const thread = toT3Thread(read.thread, read.turns, {
    messages: read.messages,
    activities: read.activities,
    checkpoints: read.checkpoints,
  });
  const project = projectOf(await storedProjects(), thread.projectId);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    snapshotSequence: 0,
    project,
    thread: threadReadView(thread, { lastTurn, view }),
  };
}

export async function snoozeThread(config: CliConfig, rawThreadId: string, rawUntil: string) {
  void config;
  const threadId = requireThreadId(rawThreadId);
  const snoozedUntil = normalizeSnoozeUntil(rawUntil);
  const store = await openStore();
  const before = await fullThread(store, threadId);
  if (before.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot be snoozed.`, {
      exitCode: 4,
      details: { threadId, archivedAt: before.archivedAt },
    });
  }
  const project = projectOf(await storedProjects(), before.projectId);
  const command = {
    type: "thread.snooze" as const,
    commandId: randomUUID(),
    threadId,
    snoozedUntil,
  };
  const changed = await snoozeStoredThread(store, threadId, snoozedUntil);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: {
      id: before.id,
      projectId: before.projectId,
      title: before.title,
      snoozedUntil: changed.snoozedUntil,
    },
    command,
    dispatch: null,
    verification: {
      accepted: true as const,
      snoozedUntil: changed.snoozedUntil,
      snoozedAt: changed.snoozedAt,
      snapshotSequence: 0,
    },
  };
}

export async function unsnoozeThread(config: CliConfig, rawThreadId: string) {
  void config;
  const threadId = requireThreadId(rawThreadId);
  const store = await openStore();
  const before = await fullThread(store, threadId);
  if (before.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot be unsnoozed.`, {
      exitCode: 4,
      details: { threadId, archivedAt: before.archivedAt },
    });
  }
  const project = projectOf(await storedProjects(), before.projectId);
  const command = {
    type: "thread.unsnooze" as const,
    commandId: randomUUID(),
    threadId,
    reason: "user" as const,
  };
  const changed = await unsnoozeStoredThread(store, threadId);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: {
      id: before.id,
      projectId: before.projectId,
      title: before.title,
      snoozedUntil: changed.snoozedUntil,
    },
    command,
    dispatch: null,
    verification: {
      accepted: true as const,
      snoozedUntil: changed.snoozedUntil,
      snoozedAt: changed.snoozedAt,
      snapshotSequence: 0,
    },
  };
}

export async function interruptThread(
  config: CliConfig,
  rawThreadId: string,
  options: { run?: string } = {},
) {
  void config;
  const threadId = requireThreadId(rawThreadId);
  const rawRun = options.run?.trim() ?? "";
  if (options.run !== undefined && !rawRun) {
    throw new CliError("INVALID_THREAD_OPTION", "--run requires a non-empty turn id.", { exitCode: 2 });
  }
  const turnId = rawRun || undefined;
  const store = await openStore();
  const thread = await fullThread(store, threadId);
  if (thread.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot be interrupted.`, {
      exitCode: 4,
      details: { threadId, archivedAt: thread.archivedAt },
    });
  }
  const project = projectOf(await storedProjects(), thread.projectId);
  const base = {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      latestTurn: thread.latestTurn ?? null,
    },
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
  // The store interrupt flips the ledger and aborts the live driver run
  // tracked in this process; a foreign process's late completion is
  // dropped by the runner's terminal-state guard.
  const interrupted = await interruptStoredTurn(store, threadId, turnId);
  const after = await fullThread(store, threadId);
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

async function changeThreadSettlement(
  config: CliConfig,
  rawThreadId: string,
  state: "settled" | "active",
) {
  void config;
  const threadId = requireThreadId(rawThreadId);
  const store = await openStore();
  const before = await fullThread(store, threadId);
  if (before.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot change settlement state.`, {
      exitCode: 4,
      details: { threadId, archivedAt: before.archivedAt },
    });
  }
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
  const project = projectOf(await storedProjects(), before.projectId);
  const command = state === "settled"
    ? { type: "thread.settle" as const, commandId: randomUUID(), threadId }
    : { type: "thread.unsettle" as const, commandId: randomUUID(), threadId, reason: "user" as const };
  const changed = state === "settled"
    ? await settleStoredThread(store, threadId)
    : await unsettleStoredThread(store, threadId);
  const after = toT3Thread(changed, await store.readTurns(threadId));
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: {
      id: before.id,
      projectId: before.projectId,
      title: before.title,
      statusBefore: threadStatus(before),
      statusAfter: threadStatus(after),
    },
    command,
    dispatch: null,
    verification: {
      accepted: true as const,
      state,
      snapshotSequence: 0,
      settledAt: changed.settledAt,
      unsettledAt: changed.unsettledAt,
    },
  };
}

export async function settleThread(config: CliConfig, threadId: string) {
  return await changeThreadSettlement(config, threadId, "settled");
}

export async function unsettleThread(config: CliConfig, threadId: string) {
  return await changeThreadSettlement(config, threadId, "active");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  drivers?: TurnDriverFactories;
}

function normalizeDelegateTimeout(raw: number | undefined): number {
  const timeoutMs = raw ?? DELEGATE_DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CliError("INVALID_THREAD_OPTION", "--timeout-ms must be a positive integer.", {
      exitCode: 2,
      details: { timeoutMs: raw },
    });
  }
  return timeoutMs;
}

function requireParentModes(thread: T3Thread): { runtimeMode: RuntimeMode; interactionMode: InteractionMode } {
  const runtimeMode = thread.runtimeMode;
  const interactionMode = thread.interactionMode;
  if (
    !["approval-required", "auto", "auto-accept-edits", "full-access"].includes(runtimeMode ?? "") ||
    !["default", "plan"].includes(interactionMode ?? "")
  ) {
    throw new CliError(
      "T3_INVALID_THREAD",
      `Thread ${thread.id} is missing its runtime or interaction mode.`,
      { details: { threadId: thread.id } },
    );
  }
  return { runtimeMode: runtimeMode as RuntimeMode, interactionMode: interactionMode as InteractionMode };
}

export async function delegateTask(config: CliConfig, options: ThreadDelegateOptions) {
  const parentThreadId = requireThreadId(options.parentThreadId);
  const task = options.task.trim();
  if (!task) {
    throw new CliError("PROMPT_REQUIRED", "A non-empty delegated task is required.", { exitCode: 2 });
  }
  const wait = options.wait ?? true;
  const timeoutMs = normalizeDelegateTimeout(options.timeoutMs);
  const title = delegateThreadTitle(task, options.title);

  const store = await openStore();
  const parent = await fullThread(store, parentThreadId);
  if (parent.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${parentThreadId} is archived and cannot delegate work.`, {
      exitCode: 4,
      details: { threadId: parentThreadId, archivedAt: parent.archivedAt },
    });
  }
  const project = projectOf(await storedProjects(), parent.projectId);

  const baseSelection =
    asModelSelection(parent.modelSelection) ??
    project?.defaultModelSelection ??
    defaultModelSelection();
  const hasModelOverride =
    options.provider !== undefined ||
    options.model !== undefined ||
    options.speedMode !== undefined ||
    options.thinkingEffort !== undefined;
  const delegateConfig: CliConfig = { ...config };
  delete delegateConfig.provider;
  delete delegateConfig.model;
  delete delegateConfig.speedMode;
  delete delegateConfig.thinkingEffort;
  const modelSelection: ModelSelection = hasModelOverride
    ? resolveModelSelection(baseSelection, delegateConfig, {
        prompt: task,
        ...(options.provider !== undefined ? { provider: options.provider } : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.speedMode !== undefined ? { speedMode: options.speedMode } : {}),
        ...(options.thinkingEffort !== undefined ? { thinkingEffort: options.thinkingEffort } : {}),
      })
    : baseSelection;
  const { runtimeMode, interactionMode } = requireParentModes(parent);

  const createdAt = new Date().toISOString();
  const childThreadId = randomUUID();
  const messageId = randomUUID();
  const createCommand = {
    type: "thread.create" as const,
    commandId: randomUUID(),
    threadId: childThreadId,
    projectId: parent.projectId,
    title,
    modelSelection,
    runtimeMode,
    interactionMode,
    branch: parent.branch ?? null,
    worktreePath: null,
    createdAt,
  };
  const turnCommand = {
    type: "thread.turn.start" as const,
    commandId: randomUUID(),
    threadId: childThreadId,
    message: { messageId, role: "user" as const, text: task, attachments: [] as [] },
    modelSelection,
    titleSeed: title,
    runtimeMode,
    interactionMode,
    createdAt,
  };

  const base = {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    parent: { id: parent.id, projectId: parent.projectId, title: parent.title },
    child: { id: childThreadId, projectId: parent.projectId, title },
    createCommand,
    turnCommand,
  };
  if (options.dryRun) {
    return {
      ...base,
      task: {
        taskId: childThreadId,
        childThreadId,
        childRunId: null,
        status: "running" as DelegatedTaskStatus,
        workState: "working" as DelegatedTaskWorkState,
        summary: null,
        waitTimedOut: false,
      },
      dispatch: null,
      verification: null,
      opened: openedNone(options.openMode, config),
      dryRun: true as const,
    };
  }

  const created = await createStoredThread(store, {
    projectId: parent.projectId,
    title,
    modelSelection,
    runtimeMode,
    interactionMode,
    env: { ...(await inspectStoredThread(store, parentThreadId)).env },
  });
  const childId = created.id;
  const childEnvPath = created.env.path;
  const sent = await sendStoredTurn(store, childId, { prompt: task }).catch((cause) => {
    throw new CliError(
      "THREAD_START_FAILED",
      `Created delegated thread ${childId} but could not start its task turn. The child thread was left untouched.`,
      { cause, details: { threadId: childId } },
    );
  });
  await store.appendDelegation({
    id: randomUUID(),
    parentThreadId,
    childThreadId: childId,
    prompt: task,
    status: "running",
    createdAt,
    updatedAt: createdAt,
  }).catch(() => undefined);
  const driver = driverForInstance(driverOwner, modelSelection.instanceId, options.drivers);
  const hasSession = await Effect.runPromise(driver.hasSession(childId)).catch(() => false);
  if (!hasSession) {
    await Effect.runPromise(driver.startSession({
      threadId: childId,
      workingDirectory: childEnvPath.trim().length > 0 ? childEnvPath : process.cwd(),
      modelSelection,
      runtimeMode,
      interactionMode,
    })).catch(() => undefined);
  }
  void executeTurn({
    store,
    driver,
    threadId: childId,
    storeTurnId: sent.turn.id,
    prompt: task,
    modelSelection,
    workingDirectory: childEnvPath,
  }).catch(() => undefined);

  let waitTimedOut = false;
  let latest = await fullThread(store, childId);
  if (wait) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = latest.latestTurn?.state;
      if (state === "completed" || state === "interrupted" || state === "error") break;
      if (Date.now() >= deadline) {
        waitTimedOut = true;
        break;
      }
      await sleep(DELEGATE_POLL_INTERVAL_MS);
      latest = await fullThread(store, childId).catch(() => latest);
    }
    if (!waitTimedOut) {
      const state = latest.latestTurn?.state;
      if (state !== "completed" && state !== "interrupted" && state !== "error") waitTimedOut = true;
    }
  }
  const status = delegatedStatusOf(latest);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    parent: { id: parent.id, projectId: parent.projectId, title: parent.title },
    child: { id: latest.id, projectId: latest.projectId, title: latest.title },
    createCommand: { ...createCommand, threadId: latest.id },
    turnCommand: { ...turnCommand, threadId: latest.id, message: { ...turnCommand.message, messageId: sent.messageId } },
    task: {
      taskId: latest.id,
      childThreadId: latest.id,
      childRunId: latest.latestTurn?.turnId ?? null,
      status,
      workState: delegatedWorkStateOf(status),
      summary: threadAssistantSummary(latest),
      waitTimedOut,
    },
    dispatch: null,
    verification: {
      accepted: true as const,
      method: "message-id" as const,
      snapshotSequence: 0,
      messageId: sent.messageId,
    },
    opened: openedNone(options.openMode, config),
    dryRun: false as const,
  };
}

async function describeDelegatedTask(
  store: ThreadStore,
  parentThreadId: string,
  rawTaskId: string,
): Promise<{
  parent: T3Thread;
  child: T3Thread;
  task: {
    taskId: string;
    childThreadId: string;
    childRunId: string | null;
    status: DelegatedTaskStatus;
    workState: DelegatedTaskWorkState;
    summary: string | null;
  };
}> {
  const taskId = requireThreadId(rawTaskId);
  const parent = await fullThread(store, parentThreadId);
  const delegation = await delegationForChild(store, parentThreadId, taskId);
  const childId = delegation?.childThreadId ?? taskId;
  let child: T3Thread | null = null;
  try {
    child = await fullThread(store, childId);
  } catch {
    child = null;
  }
  if (!child || child.projectId !== parent.projectId) {
    throw new CliError("TASK_NOT_FOUND", `No delegated task exists with id ${taskId} for thread ${parentThreadId}.`, {
      exitCode: 3,
      details: { taskId, parentThreadId },
    });
  }
  const status = delegatedStatusOf(child);
  return {
    parent,
    child,
    task: {
      taskId,
      childThreadId: child.id,
      childRunId: child.latestTurn?.turnId ?? null,
      status,
      workState: delegatedWorkStateOf(status),
      summary: threadAssistantSummary(child),
    },
  };
}

export async function taskStatus(config: CliConfig, rawParentThreadId: string, rawTaskId: string) {
  void config;
  const parentThreadId = requireThreadId(rawParentThreadId);
  const store = await openStore();
  const described = await describeDelegatedTask(store, parentThreadId, rawTaskId);
  const project = projectOf(await storedProjects(), described.parent.projectId);
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    parent: { id: described.parent.id, projectId: described.parent.projectId, title: described.parent.title },
    task: { ...described.task, hasPendingChildRuns: false, waitTimedOut: false },
  };
}

export async function cancelTask(config: CliConfig, rawParentThreadId: string, rawTaskId: string) {
  void config;
  const parentThreadId = requireThreadId(rawParentThreadId);
  const store = await openStore();
  const described = await describeDelegatedTask(store, parentThreadId, rawTaskId);
  const project = projectOf(await storedProjects(), described.parent.projectId);
  const base = {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    parent: { id: described.parent.id, projectId: described.parent.projectId, title: described.parent.title },
  };
  const child = described.child;
  if (!isThreadActive(child)) {
    const terminal = child.latestTurn?.state;
    const status =
      terminal === "completed" ? "completed" as const
      : terminal === "error" ? "failed" as const
      : terminal === "interrupted" ? "interrupted" as const
      : "cancelled" as const;
    return {
      ...base,
      task: { ...described.task, status },
      command: null,
      dispatch: null,
      verification: null,
    };
  }
  const command = {
    type: "thread.turn.interrupt" as const,
    commandId: randomUUID(),
    threadId: child.id,
    createdAt: new Date().toISOString(),
  };
  try {
    await interruptStoredTurn(store, child.id);
  } catch (cause) {
    throw new CliError(
      "TASK_CANCEL_UNSUPPORTED",
      `Could not interrupt delegated task ${described.task.taskId}; cancellation is unsupported for this thread.`,
      { exitCode: 4, cause, details: { taskId: described.task.taskId, childThreadId: child.id } },
    );
  }
  const delegation = await delegationForChild(store, parentThreadId, child.id);
  if (delegation && delegation.status !== "cancelled") {
    await store.updateDelegation(delegation.id, { status: "cancelled" }).catch(() => null);
  }
  const after = await fullThread(store, child.id);
  const state = after.latestTurn?.state;
  return {
    ...base,
    task: {
      ...described.task,
      status: state === "interrupted" ? "interrupted" as const : "cancel_requested" as const,
    },
    command,
    dispatch: null,
    verification: {
      accepted: true as const,
      method: "interrupt" as const,
      snapshotSequence: 0,
      state: state ?? null,
    },
  };
}

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

  const store = await openStore();
  const thread = await fullThread(store, threadId);
  if (thread.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot receive a new turn.`, {
      exitCode: 4,
      details: { threadId, archivedAt: thread.archivedAt },
    });
  }

  const project = projectOf(await storedProjects(), thread.projectId);
  if (threadStatus(thread) === "settled" && !options.wakeSettled) {
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

  const baseSelection =
    asModelSelection(thread.modelSelection) ??
    project?.defaultModelSelection ??
    defaultModelSelection();
  const hasModelOverride =
    options.provider !== undefined ||
    options.model !== undefined ||
    options.speedMode !== undefined ||
    options.thinkingEffort !== undefined;
  // Follow-ups keep the thread's model unless flags explicitly override it:
  // global config provider/model must not flip a scheduled thread's model.
  const sendConfig: CliConfig = { ...config };
  delete sendConfig.provider;
  delete sendConfig.model;
  delete sendConfig.speedMode;
  delete sendConfig.thinkingEffort;
  const modelSelection = hasModelOverride
    ? resolveModelSelection(baseSelection, sendConfig, {
        prompt,
        ...(options.provider !== undefined ? { provider: options.provider } : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.speedMode !== undefined ? { speedMode: options.speedMode } : {}),
        ...(options.thinkingEffort !== undefined ? { thinkingEffort: options.thinkingEffort } : {}),
      })
    : undefined;

  const createdAt = new Date().toISOString();
  const previewCommand = {
    type: "thread.turn.start" as const,
    commandId: randomUUID(),
    threadId,
    message: { messageId: randomUUID(), role: "user" as const, text: prompt, attachments: [] as [] },
    runtimeMode: thread.runtimeMode ?? "full-access",
    interactionMode: thread.interactionMode ?? "default",
    ...(modelSelection ? { modelSelection } : {}),
    createdAt,
  };

  if (options.dryRun) {
    return {
      runtime: directRuntime(),
      auth: directAuth(),
      project,
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        statusBeforeSend: threadStatus(thread),
      },
      message: {
        messageId: previewCommand.message.messageId,
        textLength: previewCommand.message.text.length,
      },
      command: {
        type: previewCommand.type,
        commandId: previewCommand.commandId,
        threadId: previewCommand.threadId,
        runtimeMode: previewCommand.runtimeMode,
        interactionMode: previewCommand.interactionMode,
        ...(modelSelection ? { modelSelection } : {}),
        createdAt: previewCommand.createdAt,
      },
      delivery: deliveryResult,
      handoffNote,
      ...(delivery === "restart"
        ? { interruptPreview: { type: "thread.turn.interrupt", threadId: thread.id } }
        : {}),
      dispatch: null,
      verification: null,
      opened: openedNone(options.openMode, config),
      dryRun: true as const,
    };
  }

  // Resolve the driver before touching the ledger: unknown providers fail
  // without recording a turn.
  const instanceId = modelSelection?.instanceId ?? thread.modelSelection?.instanceId ?? "codex";
  const driver = driverForInstance(driverOwner, instanceId, options.drivers);

  // `restart` is atomic in the store: it interrupts the running turn
  // (aborting the tracked driver run) and chains the replacement turn.
  const sent = await sendStoredTurn(store, threadId, {
    prompt,
    ...(options.ifBusy ? { ifBusy: options.ifBusy } : {}),
    ...(options.delivery ? { delivery: options.delivery } : {}),
    ...(options.wakeSettled !== undefined ? { wakeSettled: options.wakeSettled } : {}),
    ...(modelSelection ? { modelSelection } : {}),
    ...(options.handoffNote !== undefined ? { handoffNote: options.handoffNote } : {}),
  }).catch((cause) => {
    if (cause instanceof CliError && cause.code === "THREAD_BUSY") throw cause;
    throw new CliError(
      "THREAD_START_FAILED",
      `Could not start a turn on thread ${thread.id}. The thread was left untouched.`,
      { cause, details: { threadId: thread.id } },
    );
  });

  const hasSession = await Effect.runPromise(driver.hasSession(threadId)).catch(() => false);
  if (!hasSession) {
    await Effect.runPromise(driver.startSession({
      threadId,
      workingDirectory: sent.thread.env.path.trim().length > 0 ? sent.thread.env.path : process.cwd(),
      modelSelection: sent.thread.modelSelection,
      runtimeMode: sent.thread.runtimeMode,
      interactionMode: sent.thread.interactionMode,
    })).catch(() => undefined);
  }
  void executeTurn({
    store,
    driver,
    threadId,
    storeTurnId: sent.turn.id,
    prompt,
    ...(modelSelection ? { modelSelection } : {}),
    workingDirectory: sent.thread.env.path,
  }).catch(() => undefined);
  if (options.noWait !== true) {
    // One-shot CLI: the process is the only runner. Returning at
    // acceptance would orphan the run and strand the turn `running`.
    await waitForTurnTerminal(store, threadId, sent.turn.id, () =>
      interruptStoredTurn(store, threadId).catch(() => undefined),
    );
  }

  const command = {
    type: "thread.turn.start" as const,
    commandId: randomUUID(),
    threadId,
    message: { messageId: sent.messageId, role: "user" as const, text: prompt, attachments: [] as [] },
    runtimeMode: thread.runtimeMode ?? "full-access",
    interactionMode: thread.interactionMode ?? "default",
    ...(modelSelection ? { modelSelection } : {}),
    createdAt,
  };
  return {
    runtime: directRuntime(),
    auth: directAuth(),
    project,
    thread: {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      statusBeforeSend: threadStatus(thread),
    },
    message: {
      messageId: sent.messageId,
      textLength: prompt.length,
    },
    command: {
      type: command.type,
      commandId: command.commandId,
      threadId: command.threadId,
      runtimeMode: command.runtimeMode,
      interactionMode: command.interactionMode,
      ...(modelSelection ? { modelSelection } : {}),
      createdAt: command.createdAt,
    },
    delivery: deliveryResult,
    handoffNote,
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
