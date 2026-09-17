import { randomUUID } from "node:crypto";

import { withT3Api } from "../infra/api.js";
import { CliError } from "../errors.js";
import { openThread } from "../infra/open.js";
import { discoverRuntime } from "../infra/runtime.js";
import { resolveWorkspace } from "../infra/workspace.js";
import { activeProjects, projectForWorkspace } from "../projects/projects.js";
import type { WorkspaceOptions } from "../projects/projects.js";
import {
  asModelSelection,
  defaultModelSelectionForVersion,
  resolveModelSelection,
} from "../shared/selection.js";
import { T3ThreadApi, type ThreadSettlementState } from "./threadApi.js";
import type {
  CliConfig,
  InteractionMode,
  ModelSelection,
  OpenMode,
  RuntimeMode,
  SpeedMode,
  T3Project,
  T3Thread,
} from "../types.js";

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
    // V1 transport exposes no ContextTransfer rows; report the empty set
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
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: false });
  return await withT3Api(runtime, config, async (api, invocation) => {
    const catalog = await new T3ThreadApi(api).catalog();
    const projects = activeProjects(catalog.projects);
    let project: T3Project | null = null;
    let workspace = null;

    if (requestedProjectId) {
      project = projects.find((candidate) => candidate.id === requestedProjectId) ?? null;
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
    const threads = catalog.threads
      .filter(nonArchivedThread)
      .filter((thread) => project === null || thread.projectId === project.id)
      .filter((thread) => requestedStatus === "all" || threadStatus(thread) === requestedStatus)
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
      .map((thread) => ({ ...thread, status: threadStatus(thread) }));

    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      snapshotSequence: catalog.snapshotSequence,
      filter: {
        status: requestedStatus,
        projectId: project?.id ?? null,
        workspaceRoot: workspace?.workspaceRoot ?? null,
      },
      projects,
      threads,
    };
  });
}

export async function inspectThread(config: CliConfig, rawThreadId: string) {
  const threadId = requireThreadId(rawThreadId);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: false });
  return await withT3Api(runtime, config, async (api, invocation) => {
    const inspected = await new T3ThreadApi(api).inspect(threadId);
    const snapshot = await api.shellSnapshot().catch(() => api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === inspected.thread.projectId) ?? null;
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      snapshotSequence: inspected.snapshotSequence,
      project,
      thread: threadInspectionView(inspected.thread),
    };
  });
}

export async function readThread(
  config: CliConfig,
  rawThreadId: string,
  options: ThreadReadRequestOptions = {},
) {
  const threadId = requireThreadId(rawThreadId);
  const lastTurn = options.lastTurn ?? false;
  const view = normalizeReadView(options.view);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: false });
  return await withT3Api(runtime, config, async (api, invocation) => {
    const read = await new T3ThreadApi(api).read(threadId, { lastTurn: view === "messages" && lastTurn });
    const snapshot = await api.shellSnapshot().catch(() => api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === read.thread.projectId) ?? null;
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      snapshotSequence: read.snapshotSequence,
      project,
      thread: threadReadView(read.thread, { lastTurn, view }),
    };
  });
}

export async function snoozeThread(config: CliConfig, rawThreadId: string, rawUntil: string) {
  const threadId = requireThreadId(rawThreadId);
  const snoozedUntil = normalizeSnoozeUntil(rawUntil);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });
  return await withT3Api(runtime, config, async (api, invocation) => {
    const adapter = new T3ThreadApi(api);
    const inspected = await adapter.inspect(threadId);
    const thread = inspected.thread;
    if (thread.archivedAt != null) {
      throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot be snoozed.`, {
        exitCode: 4,
        details: { threadId, archivedAt: thread.archivedAt },
      });
    }
    const snapshot = await api.shellSnapshot().catch(() => api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === thread.projectId) ?? null;
    const command = adapter.buildSnooze(threadId, snoozedUntil);
    const changed = await adapter.dispatchSnooze(command);
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      project,
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        snoozedUntil: changed.verification.snoozedUntil,
      },
      command,
      dispatch: changed.dispatch,
      verification: changed.verification,
    };
  });
}

export async function unsnoozeThread(config: CliConfig, rawThreadId: string) {
  const threadId = requireThreadId(rawThreadId);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });
  return await withT3Api(runtime, config, async (api, invocation) => {
    const adapter = new T3ThreadApi(api);
    const inspected = await adapter.inspect(threadId);
    const thread = inspected.thread;
    if (thread.archivedAt != null) {
      throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot be unsnoozed.`, {
        exitCode: 4,
        details: { threadId, archivedAt: thread.archivedAt },
      });
    }
    const snapshot = await api.shellSnapshot().catch(() => api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === thread.projectId) ?? null;
    const command = adapter.buildUnsnooze(threadId);
    const changed = await adapter.dispatchUnsnooze(command);
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      project,
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        snoozedUntil: changed.verification.snoozedUntil,
      },
      command,
      dispatch: changed.dispatch,
      verification: changed.verification,
    };
  });
}

export async function interruptThread(
  config: CliConfig,
  rawThreadId: string,
  options: { run?: string } = {},
) {
  const threadId = requireThreadId(rawThreadId);
  const rawRun = options.run?.trim() ?? "";
  if (options.run !== undefined && !rawRun) {
    throw new CliError("INVALID_THREAD_OPTION", "--run requires a non-empty turn id.", { exitCode: 2 });
  }
  const turnId = rawRun || undefined;
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });
  return await withT3Api(runtime, config, async (api, invocation) => {
    const adapter = new T3ThreadApi(api);
    const inspected = await adapter.inspect(threadId);
    const thread = inspected.thread;
    if (thread.archivedAt != null) {
      throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot be interrupted.`, {
        exitCode: 4,
        details: { threadId, archivedAt: thread.archivedAt },
      });
    }
    const snapshot = await api.shellSnapshot().catch(() => api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === thread.projectId) ?? null;
    const base = {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
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
    const command = adapter.buildInterrupt(threadId, turnId);
    let interrupted: { dispatch: unknown; thread: T3Thread; verification: { accepted: true; method: "interrupt"; snapshotSequence: number; state: string | null } };
    try {
      interrupted = await adapter.dispatchInterrupt(command);
    } catch (cause) {
      if (cause instanceof CliError && cause.code === "THREAD_INTERRUPT_NOT_VERIFIED") throw cause;
      throw new CliError(
        "THREAD_INTERRUPT_FAILED",
        `T3 could not interrupt the active turn on thread ${threadId}.`,
        { exitCode: 4, cause, details: { threadId } },
      );
    }
    return {
      ...base,
      run: interrupted.thread.latestTurn?.turnId ?? turnId ?? null,
      result: "interrupt_requested" as const,
      command,
      dispatch: interrupted.dispatch,
      verification: interrupted.verification,
    };
  });
}

async function changeThreadSettlement(
  config: CliConfig,
  rawThreadId: string,
  state: ThreadSettlementState,
) {
  const threadId = requireThreadId(rawThreadId);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });
  if (runtime.capabilities.threadSettlement !== true) {
    throw new CliError(
      "THREAD_SETTLEMENT_UNSUPPORTED",
      "This T3 Code server does not advertise thread settlement support.",
      {
        exitCode: 4,
        details: { capability: "threadSettlement", serverVersion: runtime.serverVersion },
      },
    );
  }
  return await withT3Api(runtime, config, async (api, invocation) => {
    const adapter = new T3ThreadApi(api);
    const inspected = await adapter.inspect(threadId);
    const thread = inspected.thread;
    if (thread.archivedAt != null) {
      throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot change settlement state.`, {
        exitCode: 4,
        details: { threadId, archivedAt: thread.archivedAt },
      });
    }
    // The thread detail endpoint never carries the pending-work flags — they
    // only exist on shell snapshot rows — so read the guard from there.
    const shell = await api.shellSnapshot().catch(() => null);
    const shellThread = Array.isArray(shell?.threads)
      ? (shell.threads.find((candidate) => candidate.id === threadId) ?? null)
      : null;
    const sessionStatus = shellThread?.session?.status ?? thread.session?.status ?? null;
    const hasPendingApprovals = (shellThread?.hasPendingApprovals ?? thread.hasPendingApprovals) === true;
    const hasPendingUserInput = (shellThread?.hasPendingUserInput ?? thread.hasPendingUserInput) === true;
    if (
      state === "settled" &&
      (sessionStatus === "starting" ||
        sessionStatus === "running" ||
        hasPendingApprovals ||
        hasPendingUserInput)
    ) {
      throw new CliError("THREAD_SETTLE_BLOCKED", `Thread ${threadId} still has active or blocked work.`, {
        exitCode: 4,
        details: {
          threadId,
          sessionStatus,
          hasPendingApprovals,
          hasPendingUserInput,
        },
      });
    }

    const snapshot = shell ?? (await api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === thread.projectId) ?? null;
    const command = adapter.buildSettlement(threadId, state);
    const changed = await adapter.dispatchSettlement(command, thread.updatedAt);
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      project,
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        statusBefore: threadStatus(thread),
        statusAfter: threadStatus(changed.thread),
      },
      command,
      dispatch: changed.dispatch,
      verification: changed.verification,
    };
  });
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
      `T3 thread ${thread.id} is missing its runtime or interaction mode.`,
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

  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });
  const result = await withT3Api(runtime, config, async (api, invocation) => {
    const adapter = new T3ThreadApi(api);
    const inspectedParent = await adapter.inspect(parentThreadId);
    const parent = inspectedParent.thread;
    if (parent.archivedAt != null) {
      throw new CliError("THREAD_ARCHIVED", `Thread ${parentThreadId} is archived and cannot delegate work.`, {
        exitCode: 4,
        details: { threadId: parentThreadId, archivedAt: parent.archivedAt },
      });
    }
    const snapshot = await api.shellSnapshot().catch(() => api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === parent.projectId) ?? null;

    const baseSelection =
      asModelSelection(parent.modelSelection) ??
      project?.defaultModelSelection ??
      defaultModelSelectionForVersion(runtime.serverVersion);
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
      runtime,
      auth: { source: invocation.source, version: invocation.version },
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
      };
    }

    await api.dispatch(createCommand);
    let sent: { dispatch: unknown; verification: { accepted: true; method: "message-id"; snapshotSequence: number; messageId: string } };
    try {
      sent = await adapter.dispatchTurn(turnCommand);
    } catch (cause) {
      if (cause instanceof CliError && (cause.code === "THREAD_TURN_NOT_VERIFIED" || cause.code === "T3_INVALID_DISPATCH")) {
        throw cause;
      }
      throw new CliError(
        "THREAD_START_FAILED",
        `T3 created delegated thread ${childThreadId} but could not start its task turn. The child thread was left untouched.`,
        { cause, details: { threadId: childThreadId } },
      );
    }

    let waitTimedOut = false;
    let child = (await adapter.inspect(childThreadId)).thread;
    if (wait) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const state = child.latestTurn?.state;
        if (state === "completed" || state === "interrupted" || state === "error") break;
        if (Date.now() >= deadline) {
          waitTimedOut = true;
          break;
        }
        await sleep(DELEGATE_POLL_INTERVAL_MS);
        child = (await adapter.inspect(childThreadId).catch(() => null))?.thread ?? child;
      }
      if (!waitTimedOut) {
        const state = child.latestTurn?.state;
        if (state !== "completed" && state !== "interrupted" && state !== "error") waitTimedOut = true;
      }
    }
    const read = await adapter.read(childThreadId).catch(() => null);
    const summaryThread = read?.thread ?? child;
    const status = delegatedStatusOf(child);
    return {
      ...base,
      task: {
        taskId: childThreadId,
        childThreadId,
        childRunId: child.latestTurn?.turnId ?? null,
        status,
        workState: delegatedWorkStateOf(status),
        summary: threadAssistantSummary(summaryThread),
        waitTimedOut,
      },
      dispatch: sent.dispatch,
      verification: sent.verification,
    };
  });

  const opened = options.dryRun
    ? { mode: options.openMode ?? config.openMode, kind: "none" as const, url: null, exactThread: false }
    : await openThread(options.openMode ?? config.openMode, runtime, result.child.id);
  return { ...result, opened, dryRun: options.dryRun ?? false };
}

async function describeDelegatedTask(
  api: T3ThreadApi,
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
  const inspectedParent = await api.inspect(parentThreadId);
  const inspectedChild = await api.inspect(taskId).catch(() => null);
  if (!inspectedChild) {
    throw new CliError("TASK_NOT_FOUND", `No delegated task exists with id ${taskId} for thread ${parentThreadId}.`, {
      exitCode: 3,
      details: { taskId, parentThreadId },
    });
  }
  const parent = inspectedParent.thread;
  const childSummary = await api.read(taskId).catch(() => null);
  const child = childSummary?.thread ?? inspectedChild.thread;
  if (child.projectId !== parent.projectId) {
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
  const parentThreadId = requireThreadId(rawParentThreadId);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: false });
  return await withT3Api(runtime, config, async (api, invocation) => {
    const adapter = new T3ThreadApi(api);
    const described = await describeDelegatedTask(adapter, parentThreadId, rawTaskId);
    const snapshot = await api.shellSnapshot().catch(() => api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === described.parent.projectId) ?? null;
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      project,
      parent: { id: described.parent.id, projectId: described.parent.projectId, title: described.parent.title },
      task: { ...described.task, hasPendingChildRuns: false, waitTimedOut: false },
    };
  });
}

export async function cancelTask(config: CliConfig, rawParentThreadId: string, rawTaskId: string) {
  const parentThreadId = requireThreadId(rawParentThreadId);
  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });
  return await withT3Api(runtime, config, async (api, invocation) => {
    const adapter = new T3ThreadApi(api);
    const described = await describeDelegatedTask(adapter, parentThreadId, rawTaskId);
    const snapshot = await api.shellSnapshot().catch(() => api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === described.parent.projectId) ?? null;
    const base = {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
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
    const command = adapter.buildInterrupt(child.id);
    let interrupted: { dispatch: unknown; thread: T3Thread; verification: { accepted: true; method: "interrupt"; snapshotSequence: number; state: string | null } };
    try {
      interrupted = await adapter.dispatchInterrupt(command);
    } catch (cause) {
      if (cause instanceof CliError && cause.code === "THREAD_INTERRUPT_NOT_VERIFIED") throw cause;
      throw new CliError(
        "TASK_CANCEL_UNSUPPORTED",
        `T3 could not interrupt delegated task ${described.task.taskId}; cancellation is unsupported for this thread.`,
        { exitCode: 4, cause, details: { taskId: described.task.taskId, childThreadId: child.id } },
      );
    }
    const state = interrupted.thread.latestTurn?.state;
    return {
      ...base,
      task: {
        ...described.task,
        status: state === "interrupted" ? "interrupted" as const : "cancel_requested" as const,
      },
      command,
      dispatch: interrupted.dispatch,
      verification: interrupted.verification,
    };
  });
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

  const runtime = await discoverRuntime(config, { startDesktopIfNeeded: true });

  const result = await withT3Api(runtime, config, async (api, invocation) => {
    const adapter = new T3ThreadApi(api);
    const inspected = await adapter.inspect(threadId);
    const thread = inspected.thread;
    if (thread.archivedAt != null) {
      throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is archived and cannot receive a new turn.`, {
        exitCode: 4,
        details: { threadId, archivedAt: thread.archivedAt },
      });
    }

    const snapshot = await api.shellSnapshot().catch(() => api.snapshot().catch(() => null));
    const projects = snapshot && Array.isArray(snapshot.projects) ? snapshot.projects : [];
    const project = projects.find((candidate) => candidate.id === thread.projectId) ?? null;
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
    // V1 transports every follow-up as thread.turn.start; --delivery selects
    // client-side policy and reporting because the V1 wire has no steer/queue
    // mode. queue/steer/restart take precedence over --if-busy.
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
      defaultModelSelectionForVersion(runtime.serverVersion);
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

    const baseCommand = adapter.buildTurnStart(thread, prompt);
    const command = {
      ...baseCommand,
      ...(modelSelection ? { modelSelection } : {}),
    };

    if (options.dryRun) {
      return {
        runtime,
        auth: { source: invocation.source, version: invocation.version },
        project,
        thread: {
          id: thread.id,
          projectId: thread.projectId,
          title: thread.title,
          statusBeforeSend: threadStatus(thread),
        },
        message: {
          messageId: command.message.messageId,
          textLength: command.message.text.length,
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
        ...(delivery === "restart"
          ? { interruptPreview: { type: "thread.turn.interrupt", threadId: thread.id } }
          : {}),
        dispatch: null,
        verification: null,
      };
    }

    if (delivery === "restart") {
      // Restart steers by interrupting the active provider turn first, then
      // sending the replacement message as a fresh turn.
      const interrupt = adapter.buildInterrupt(thread.id);
      try {
        await adapter.dispatchInterrupt(interrupt);
      } catch (cause) {
        throw new CliError(
          "THREAD_RESTART_FAILED",
          `T3 could not interrupt the active turn on thread ${thread.id} before restarting it.`,
          { exitCode: 4, cause, details: { threadId: thread.id } },
        );
      }
    }

    let sent: { dispatch: unknown; verification: { accepted: true; method: "message-id"; snapshotSequence: number; messageId: string } };
    try {
      sent = await adapter.dispatchTurn(command);
    } catch (cause) {
      if (cause instanceof CliError && (cause.code === "THREAD_TURN_NOT_VERIFIED" || cause.code === "T3_INVALID_DISPATCH")) {
        throw cause;
      }
      throw new CliError(
        "THREAD_START_FAILED",
        `T3 could not start a turn on thread ${thread.id}. The thread was left untouched.`,
        { cause, details: { threadId: thread.id } },
      );
    }
    return {
      runtime,
      auth: { source: invocation.source, version: invocation.version },
      project,
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        statusBeforeSend: threadStatus(thread),
      },
      message: {
        messageId: command.message.messageId,
        textLength: command.message.text.length,
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
      dispatch: sent.dispatch,
      verification: sent.verification,
      ...(modelSelection ? { modelSelection } : {}),
    };
  });

  const opened = options.dryRun
    ? { mode: options.openMode ?? config.openMode, kind: "none" as const, url: null, exactThread: false }
    : await openThread(options.openMode ?? config.openMode, runtime, result.thread.id);
  return { ...result, opened, dryRun: options.dryRun ?? false };
}

export async function sendThreadPrompt(config: CliConfig, options: ThreadSendOptions) {
  return await sendThreadMessage(config, options);
}
