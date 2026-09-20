/**
 * Thread lifecycle ops over the JSONL store. These mirror the CLI-stable
 * semantics of `src/cli/threads/threads.ts` (status rules, busy policies,
 * error codes) so cutover repoints the transport without renegotiating
 * behavior — but execution is ledger-local: no dispatch-then-poll, no
 * snapshot preflights. A per-thread mutex enforces one active turn per
 * session. Provider drivers attach in Stage 2 via `completeTurn` /
 * `failTurn` / `trackRunning`. See DECOUPLE.md §9.
 */
import { CliError } from "../errors.js";
import type {
  InteractionMode,
  ModelSelection,
  RuntimeMode,
} from "../types.js";
import { ThreadStore } from "./store.js";
import type {
  CreateThreadInput,
  DelegationStatus,
  ReadView,
  SendDelivery,
  SendIfBusy,
  SendTurnInput,
  StoredDelegation,
  StoredThread,
  StoredTurn,
  ThreadReadResult,
  ThreadStatus,
  TurnDelivery,
} from "./types.js";

const READ_VIEWS: readonly ReadView[] = [
  "messages",
  "turn-items",
  "plans",
  "checkpoints",
  "transfers",
];

const DEFAULT_DELEGATE_TIMEOUT_MS = 300_000;
const DELEGATE_POLL_INTERVAL_MS = 100;

function requireThreadId(threadId: string): string {
  const trimmed = threadId.trim();
  if (!trimmed) {
    throw new CliError("THREAD_ID_REQUIRED", "A non-empty thread id is required.", {
      exitCode: 2,
    });
  }
  return trimmed;
}

function isSnoozed(thread: StoredThread, now: number): boolean {
  if (thread.settledAt != null) return false;
  if (thread.snoozedUntil === null) return false;
  const parsed = Date.parse(thread.snoozedUntil);
  return Number.isFinite(parsed) && parsed > now;
}

/** Identical rule to the CLI `threadStatus`: settled wins, then snoozed. */
export function threadStatus(thread: StoredThread, now: number = Date.now()): ThreadStatus {
  if (thread.settledAt != null) return "settled";
  return isSnoozed(thread, now) ? "snoozed" : "active";
}

function openTurn(turns: StoredTurn[]): StoredTurn | null {
  return turns.find((turn) => turn.status === "running") ?? null;
}

function normalizeIfBusy(raw: SendIfBusy | undefined): SendIfBusy {
  const ifBusy = raw ?? "reject";
  if (ifBusy !== "reject" && ifBusy !== "inject") {
    throw new CliError("INVALID_THREAD_OPTION", "ifBusy must be reject or inject.");
  }
  return ifBusy;
}

function normalizeDelivery(raw: SendDelivery | undefined): SendDelivery {
  const delivery = raw ?? "auto";
  if (delivery !== "auto" && delivery !== "steer" && delivery !== "restart" && delivery !== "queue") {
    throw new CliError("INVALID_THREAD_OPTION", "--delivery must be auto, steer, restart, or queue.", {
      exitCode: 2,
    });
  }
  return delivery;
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

function requireStoredThread(thread: StoredThread | null, threadId: string): StoredThread {
  if (!thread) {
    throw new CliError("THREAD_NOT_FOUND", `No thread exists with id ${threadId}.`, {
      exitCode: 3,
      details: { threadId },
    });
  }
  return thread;
}

function requireNotArchived(thread: StoredThread, action: string): void {
  if (thread.archivedAt != null) {
    throw new CliError("THREAD_ARCHIVED", `Thread ${thread.id} is archived and cannot ${action}.`, {
      exitCode: 4,
      details: { threadId: thread.id, archivedAt: thread.archivedAt },
    });
  }
}

export async function createThread(
  store: ThreadStore,
  input: CreateThreadInput,
): Promise<StoredThread> {
  const projectId = input.projectId.trim();
  if (!projectId) {
    throw new CliError("PROJECT_ID_REQUIRED", "A non-empty project id is required.", {
      exitCode: 2,
    });
  }
  const title = input.title.trim();
  if (!title) {
    throw new CliError("INVALID_THREAD_OPTION", "A non-empty thread title is required.", {
      exitCode: 2,
    });
  }
  const now = store.nowIso();
  const thread: StoredThread = {
    id: store.newId(),
    projectId,
    title,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode ?? "full-access",
    interactionMode: input.interactionMode ?? "default",
    env: {
      mode: input.env?.mode ?? "local",
      path: input.env?.path ?? "",
      branch: input.env?.branch ?? null,
    },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledAt: null,
    unsettledAt: null,
    settledOverride: null,
    snoozedUntil: null,
    snoozedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
  };
  await store.writeThreadRecord(thread);
  store.emit(thread.id, "created");
  return thread;
}

export async function listThreads(
  store: ThreadStore,
  options: { status?: ThreadStatus | "all"; projectId?: string } = {},
): Promise<StoredThread[]> {
  const status = options.status ?? "active";
  const now = Date.parse(store.nowIso());
  const threads: StoredThread[] = [];
  for (const id of await store.listThreadIds()) {
    const thread = await store.readThreadRecord(id);
    if (!thread || thread.archivedAt != null) continue;
    if (options.projectId !== undefined && thread.projectId !== options.projectId) continue;
    if (status !== "all" && threadStatus(thread, now) !== status) continue;
    threads.push(thread);
  }
  threads.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return threads;
}

export async function inspectThread(store: ThreadStore, rawThreadId: string): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  return requireStoredThread(await store.readThreadRecord(threadId), threadId);
}

export async function readThread(
  store: ThreadStore,
  rawThreadId: string,
  options: { view?: ReadView } = {},
): Promise<ThreadReadResult & { view: ReadView }> {
  const view = options.view ?? "messages";
  if (!READ_VIEWS.includes(view)) {
    throw new CliError(
      "INVALID_THREAD_OPTION",
      "--view must be messages, turn-items, plans, checkpoints, or transfers.",
      { exitCode: 2, details: { view: options.view } },
    );
  }
  const thread = await inspectThread(store, rawThreadId);
  const [turns, messages, activities, checkpoints] = await Promise.all([
    store.readTurns(thread.id),
    store.readMessages(thread.id),
    store.readActivities(thread.id),
    store.readCheckpoints(thread.id),
  ]);
  // plans/transfers have no store yet; they materialize at CLI cutover.
  return { thread, turns, messages, activities, checkpoints, view };
}

export interface SendTurnResult {
  readonly thread: StoredThread;
  readonly turn: StoredTurn;
  readonly messageId: string;
  readonly delivery: TurnDelivery;
}

export async function sendTurn(
  store: ThreadStore,
  rawThreadId: string,
  input: SendTurnInput,
): Promise<SendTurnResult> {
  const threadId = requireThreadId(rawThreadId);
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new CliError("PROMPT_REQUIRED", "A non-empty thread message is required.", {
      exitCode: 2,
    });
  }
  const ifBusy = normalizeIfBusy(input.ifBusy);
  const delivery = normalizeDelivery(input.delivery);

  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    let thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    requireNotArchived(thread, "receive a new turn");

    if (threadStatus(thread, Date.parse(now)) === "settled" && !input.wakeSettled) {
      throw new CliError(
        "SETTLED_THREAD_CONFIRMATION_REQUIRED",
        `Thread ${threadId} is settled. Re-run with wakeSettled to send and wake it.`,
        { exitCode: 4, details: { threadId, settledAt: thread.settledAt } },
      );
    }
    if (thread.settledAt != null && input.wakeSettled === true) {
      thread = {
        ...thread,
        settledAt: null,
        settledOverride: "active",
        unsettledAt: now,
        updatedAt: now,
      };
      await store.writeThreadRecord(thread);
      store.emit(threadId, "unsettle");
    }

    const turns = await store.readTurns(threadId);
    const running = openTurn(turns);

    if (delivery === "auto" && running && ifBusy === "reject") {
      throw new CliError(
        "THREAD_BUSY",
        "The thread has an active turn. Retry when idle or use ifBusy inject.",
        { details: { threadId } },
      );
    }
    if ((delivery === "steer" || delivery === "restart") && !running) {
      throw new CliError(
        "THREAD_NOT_STEERABLE",
        `Thread ${threadId} has no active turn to ${delivery}. Send without delivery or with queue.`,
        { exitCode: 4, details: { threadId, delivery } },
      );
    }

    const runtimeMode: RuntimeMode = input.runtimeMode ?? thread.runtimeMode;
    const interactionMode: InteractionMode = input.interactionMode ?? thread.interactionMode;
    const modelSelection: ModelSelection | null = input.modelSelection ?? null;

    if (running && (delivery === "auto" || delivery === "steer")) {
      const messageId = store.newId();
      await store.appendLedger(threadId, "messages", {
        id: messageId,
        threadId,
        turnId: running.id,
        role: "user",
        text: prompt,
        createdAt: now,
      });
      const result: TurnDelivery = delivery === "steer" ? "steered" : "injected";
      await store.appendLedger(threadId, "activity", {
        id: store.newId(),
        threadId,
        turnId: running.id,
        kind: delivery === "steer" ? "turn.steered" : "message.injected",
        summary: prompt.slice(0, 120),
        createdAt: now,
      });
      if (input.handoffNote !== undefined && input.handoffNote.trim()) {
        await store.appendLedger(threadId, "activity", {
          id: store.newId(),
          threadId,
          turnId: running.id,
          kind: "handoff-note",
          summary: input.handoffNote.trim().slice(0, 500),
          createdAt: now,
        });
      }
      thread = { ...thread, updatedAt: now };
      await store.writeThreadRecord(thread);
      store.emit(threadId, result === "steered" ? "turn-steered" : "message-injected");
      return { thread, turn: running, messageId, delivery: result };
    }

    if (running && delivery === "restart") {
      await interruptTurnLocked(store, thread, running, now);
    }

    const status = delivery === "queue" && openTurn(await store.readTurns(threadId)) ? "queued" : "running";
    const turn: StoredTurn = {
      id: store.newId(),
      threadId,
      status,
      delivery:
        delivery === "queue" ? (status === "queued" ? "queued" : "started")
        : delivery === "restart" ? "restarted"
        : "started",
      messageId: store.newId(),
      runtimeMode,
      interactionMode,
      modelSelection,
      parentTurnId: delivery === "restart" && running ? running.id : null,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await store.appendLedger(threadId, "turns", turn);
    await store.appendLedger(threadId, "messages", {
      id: turn.messageId,
      threadId,
      turnId: turn.id,
      role: "user",
      text: prompt,
      createdAt: now,
    });
    await store.appendLedger(threadId, "activity", {
      id: store.newId(),
      threadId,
      turnId: turn.id,
      kind: status === "queued" ? "turn.queued" : "turn.started",
      summary: prompt.slice(0, 120),
      createdAt: now,
    });
    if (input.handoffNote !== undefined && input.handoffNote.trim()) {
      await store.appendLedger(threadId, "activity", {
        id: store.newId(),
        threadId,
        turnId: turn.id,
        kind: "handoff-note",
        summary: input.handoffNote.trim().slice(0, 500),
        createdAt: now,
      });
    }
    thread = { ...thread, updatedAt: now };
    await store.writeThreadRecord(thread);
    store.emit(threadId, status === "queued" ? "turn-queued" : "turn-started");
    return { thread, turn, messageId: turn.messageId, delivery: turn.delivery };
  });
}

/** Caller must hold the thread lock. */
async function interruptTurnLocked(
  store: ThreadStore,
  thread: StoredThread,
  turn: StoredTurn,
  now: string,
): Promise<StoredTurn> {
  store.abortRunning(turn.id);
  store.untrackRunning(turn.id);
  const updated = await store.updateTurn(thread.id, turn.id, {
    status: "interrupted",
    updatedAt: now,
    completedAt: now,
  });
  await store.appendLedger(thread.id, "activity", {
    id: store.newId(),
    threadId: thread.id,
    turnId: turn.id,
    kind: "turn.interrupted",
    summary: turn.id,
    createdAt: now,
  });
  if (!updated) {
    throw new CliError("TURN_NOT_FOUND", `No turn exists with id ${turn.id}.`, {
      exitCode: 3,
      details: { threadId: thread.id, turnId: turn.id },
    });
  }
  return updated;
}

/** Caller must hold the thread lock. Promotes the oldest queued turn, if any. */
async function promoteQueuedLocked(store: ThreadStore, threadId: string, now: string): Promise<void> {
  const turns = await store.readTurns(threadId);
  if (openTurn(turns)) return;
  const next = turns.find((turn) => turn.status === "queued");
  if (!next) return;
  await store.updateTurn(threadId, next.id, { status: "running", updatedAt: now });
  await store.appendLedger(threadId, "activity", {
    id: store.newId(),
    threadId,
    turnId: next.id,
    kind: "turn.promoted",
    summary: next.id,
    createdAt: now,
  });
  store.emit(threadId, "turn-promoted");
}

export interface FinishTurnInput {
  /** Assistant text appended on completion; omitted for pure interrupts/failures. */
  readonly text?: string;
  readonly error?: string;
}

async function finishTurn(
  store: ThreadStore,
  rawThreadId: string,
  rawTurnId: string,
  status: "completed" | "failed",
  input: FinishTurnInput = {},
): Promise<{ thread: StoredThread; turn: StoredTurn }> {
  const threadId = requireThreadId(rawThreadId);
  const turnId = rawTurnId.trim();
  if (!turnId) {
    throw new CliError("TURN_ID_REQUIRED", "A non-empty turn id is required.", { exitCode: 2 });
  }
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    const turn = (await store.readTurns(threadId)).find((candidate) => candidate.id === turnId);
    if (!turn) {
      throw new CliError("TURN_NOT_FOUND", `No turn exists with id ${turnId}.`, {
        exitCode: 3,
        details: { threadId, turnId },
      });
    }
    if (turn.status !== "running") {
      throw new CliError("TURN_NOT_RUNNING", `Turn ${turnId} is ${turn.status}, not running.`, {
        exitCode: 4,
        details: { threadId, turnId, status: turn.status },
      });
    }
    if (status === "completed" && input.text !== undefined) {
      await store.appendLedger(threadId, "messages", {
        id: store.newId(),
        threadId,
        turnId,
        role: "assistant",
        text: input.text,
        createdAt: now,
      });
    }
    store.untrackRunning(turnId);
    const updated = await store.updateTurn(threadId, turnId, {
      status,
      ...(status === "failed" && input.error !== undefined ? { error: input.error } : {}),
      updatedAt: now,
      completedAt: now,
    });
    if (!updated) {
      throw new CliError("TURN_NOT_FOUND", `No turn exists with id ${turnId}.`, {
        exitCode: 3,
        details: { threadId, turnId },
      });
    }
    await store.appendLedger(threadId, "activity", {
      id: store.newId(),
      threadId,
      turnId,
      kind: status === "completed" ? "turn.completed" : "turn.failed",
      summary: status === "failed" ? (input.error ?? turnId) : turnId,
      createdAt: now,
    });
    await promoteQueuedLocked(store, threadId, now);
    const next = { ...thread, updatedAt: now };
    await store.writeThreadRecord(next);
    store.emit(threadId, status === "completed" ? "turn-completed" : "turn-failed");
    return { thread: next, turn: updated };
  });
}

/** Stage 2 drivers call this when the provider run finishes. */
export async function completeTurn(
  store: ThreadStore,
  threadId: string,
  turnId: string,
  input: FinishTurnInput = {},
): Promise<{ thread: StoredThread; turn: StoredTurn }> {
  return await finishTurn(store, threadId, turnId, "completed", input);
}

/** Stage 2 drivers call this when the provider run errors. */
export async function failTurn(
  store: ThreadStore,
  threadId: string,
  turnId: string,
  input: FinishTurnInput = {},
): Promise<{ thread: StoredThread; turn: StoredTurn }> {
  return await finishTurn(store, threadId, turnId, "failed", input);
}

export interface InterruptTurnResult {
  readonly thread: StoredThread;
  readonly turn: StoredTurn | null;
  readonly interrupted: boolean;
}

export async function interruptTurn(
  store: ThreadStore,
  rawThreadId: string,
  rawTurnId?: string,
): Promise<InterruptTurnResult> {
  const threadId = requireThreadId(rawThreadId);
  const turnId = rawTurnId?.trim() || undefined;
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    requireNotArchived(thread, "be interrupted");
    const turns = await store.readTurns(threadId);
    const target = turnId
      ? (turns.find((turn) => turn.id === turnId) ?? null)
      : (openTurn(turns) ?? null);
    if (!target || (target.status !== "running" && target.status !== "queued")) {
      return { thread, turn: target, interrupted: false };
    }
    const updated = await interruptTurnLocked(store, thread, target, now);
    await promoteQueuedLocked(store, threadId, now);
    const next = { ...thread, updatedAt: now };
    await store.writeThreadRecord(next);
    store.emit(threadId, "turn-interrupted");
    return { thread: next, turn: updated, interrupted: true };
  });
}

export async function settleThread(store: ThreadStore, rawThreadId: string): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    requireNotArchived(thread, "change settlement state");
    const running = openTurn(await store.readTurns(threadId));
    if (running || thread.hasPendingApprovals || thread.hasPendingUserInput) {
      throw new CliError("THREAD_SETTLE_BLOCKED", `Thread ${threadId} still has active or blocked work.`, {
        exitCode: 4,
        details: {
          threadId,
          hasActiveTurn: running !== null,
          hasPendingApprovals: thread.hasPendingApprovals,
          hasPendingUserInput: thread.hasPendingUserInput,
        },
      });
    }
    const next: StoredThread = {
      ...thread,
      settledAt: now,
      settledOverride: null,
      snoozedUntil: null,
      updatedAt: now,
    };
    await store.writeThreadRecord(next);
    store.emit(threadId, "settled");
    return next;
  });
}

export async function unsettleThread(store: ThreadStore, rawThreadId: string): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    requireNotArchived(thread, "change settlement state");
    const next: StoredThread = {
      ...thread,
      settledAt: null,
      settledOverride: "active",
      unsettledAt: now,
      updatedAt: now,
    };
    await store.writeThreadRecord(next);
    store.emit(threadId, "unsettle");
    return next;
  });
}

export async function snoozeThread(
  store: ThreadStore,
  rawThreadId: string,
  rawUntil: string,
): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  const snoozedUntil = normalizeSnoozeUntil(rawUntil);
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    requireNotArchived(thread, "be snoozed");
    const next: StoredThread = { ...thread, snoozedUntil, snoozedAt: now, updatedAt: now };
    await store.writeThreadRecord(next);
    store.emit(threadId, "snoozed");
    return next;
  });
}

export async function unsnoozeThread(store: ThreadStore, rawThreadId: string): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    requireNotArchived(thread, "be unsnoozed");
    const next: StoredThread = { ...thread, snoozedUntil: null, updatedAt: now };
    await store.writeThreadRecord(next);
    store.emit(threadId, "unsnoozed");
    return next;
  });
}

export interface DelegateTaskInput {
  readonly task: string;
  readonly title?: string;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: InteractionMode;
  readonly wait?: boolean;
  readonly timeoutMs?: number;
}

export interface DelegateTaskResult {
  readonly delegation: StoredDelegation;
  readonly child: StoredThread;
  readonly turn: StoredTurn;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function delegationStatusOfTurn(turn: StoredTurn | undefined): DelegationStatus | null {
  if (!turn) return null;
  if (turn.status === "completed") return "completed";
  if (turn.status === "failed") return "failed";
  if (turn.status === "interrupted") return "interrupted";
  return "running";
}

export async function delegateTask(
  store: ThreadStore,
  rawParentThreadId: string,
  input: DelegateTaskInput,
): Promise<DelegateTaskResult> {
  const parentThreadId = requireThreadId(rawParentThreadId);
  const task = input.task.trim();
  if (!task) {
    throw new CliError("PROMPT_REQUIRED", "A non-empty delegated task is required.", {
      exitCode: 2,
    });
  }
  const wait = input.wait ?? true;
  const timeoutMs = input.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CliError("INVALID_THREAD_OPTION", "timeoutMs must be a positive integer.", {
      exitCode: 2,
    });
  }

  const parent = await inspectThread(store, parentThreadId);
  requireNotArchived(parent, "delegate work");
  const title = input.title?.trim() || `Task: ${task.slice(0, 60)}`;
  const child = await createThread(store, {
    projectId: parent.projectId,
    title,
    modelSelection: input.modelSelection ?? parent.modelSelection,
    ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
    ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    env: { ...parent.env },
  });
  const sent = await sendTurn(store, child.id, { prompt: task });
  const now = store.nowIso();
  const delegation: StoredDelegation = {
    id: store.newId(),
    parentThreadId,
    childThreadId: child.id,
    prompt: task,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
  await store.appendDelegation(delegation);
  store.emit(parentThreadId, "delegated");

  if (!wait) return { delegation, child, turn: sent.turn };

  const deadline = Date.now() + timeoutMs;
  let status: DelegationStatus = "running";
  for (;;) {
    const turns = await store.readTurns(child.id);
    const latest = turns[turns.length - 1];
    const derived = delegationStatusOfTurn(latest);
    if (derived && derived !== "running") {
      status = derived;
      break;
    }
    if (Date.now() >= deadline) {
      status = "waitTimedOut";
      break;
    }
    await sleep(Math.min(DELEGATE_POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
  }
  const updated =
    (await store.updateDelegation(delegation.id, { status })) ?? { ...delegation, status };
  return { delegation: updated, child, turn: sent.turn };
}

export async function taskStatus(
  store: ThreadStore,
  rawDelegationId: string,
): Promise<{ delegation: StoredDelegation; child: StoredThread }> {
  const delegationId = rawDelegationId.trim();
  if (!delegationId) {
    throw new CliError("DELEGATION_ID_REQUIRED", "A non-empty delegation id is required.", {
      exitCode: 2,
    });
  }
  const delegation = (await store.readDelegations()).find((row) => row.id === delegationId);
  if (!delegation) {
    throw new CliError("DELEGATION_NOT_FOUND", `No delegation exists with id ${delegationId}.`, {
      exitCode: 3,
      details: { delegationId },
    });
  }
  const child = requireStoredThread(
    await store.readThreadRecord(delegation.childThreadId),
    delegation.childThreadId,
  );
  if (delegation.status === "cancelled") return { delegation, child };
  const turns = await store.readTurns(child.id);
  const derived = delegationStatusOfTurn(turns[turns.length - 1]);
  if (derived && derived !== "running" && delegation.status !== derived) {
    const updated = await store.updateDelegation(delegation.id, { status: derived });
    return { delegation: updated ?? { ...delegation, status: derived }, child };
  }
  return { delegation, child };
}

export async function taskCancel(
  store: ThreadStore,
  rawDelegationId: string,
): Promise<{ delegation: StoredDelegation; child: StoredThread; interrupted: boolean }> {
  const { delegation, child } = await taskStatus(store, rawDelegationId);
  if (
    delegation.status === "completed" ||
    delegation.status === "failed" ||
    delegation.status === "interrupted" ||
    delegation.status === "cancelled"
  ) {
    return { delegation, child, interrupted: false };
  }
  const result = await interruptTurn(store, child.id);
  const updated =
    (await store.updateDelegation(delegation.id, { status: "cancelled" })) ??
    ({ ...delegation, status: "cancelled" } as StoredDelegation);
  store.emit(child.id, "task-cancelled");
  return { delegation: updated, child, interrupted: result.interrupted };
}
