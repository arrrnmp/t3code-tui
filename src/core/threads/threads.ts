/**
 * Thread lifecycle ops over the JSONL store. These mirror the CLI-stable
 * semantics of `src/cli/threads/threads.ts` (status rules, busy policies,
 * error codes) so cutover repoints the transport without renegotiating
 * behavior — but execution is ledger-local: no dispatch-then-poll, no
 * snapshot preflights. A per-thread mutex enforces one active turn per
 * session. Provider drivers attach in Stage 2 via `completeTurn` /
 * `failTurn` / `trackRunning`. See ARCHITECTURE.md §9.
 */
import os from "node:os";

import { CliError } from "../errors.js";
import type {
  InteractionMode,
  ModelSelection,
  RuntimeMode,
} from "../types.js";
import { ThreadStore } from "./store.js";
import type {
  CreateThreadInput,
  ReadView,
  SendDelivery,
  SendIfBusy,
  SendTurnInput,
  StoredDelegation,
  StoredThread,
  StoredTurn,
  ThreadReadResult,
  TurnOwner,
  ThreadStatus,
  TurnDelivery,
  TurnUsage,
} from "./types.js";

const READ_VIEWS: readonly ReadView[] = [
  "messages",
  "turn-items",
  "plans",
  "checkpoints",
  "transfers",
];


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
  const id = input.id?.trim() || store.newId();
  if (input.id?.trim() && (await store.readThreadRecord(id)) !== null) {
    throw new CliError("THREAD_ALREADY_EXISTS", `A thread already exists with id ${id}.`, {
      exitCode: 4,
      details: { threadId: id },
    });
  }
  const thread: StoredThread = {
    id,
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
    deletedAt: null,
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
    if (!thread || thread.archivedAt != null || thread.deletedAt != null) continue;
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
  // Saved before the lock: bytes on disk are harmless if the send is then
  // refused, and the lock is held only for ledger writes.
  const attachments = input.attachments?.length
    ? await Promise.all(input.attachments.map((upload) => store.saveAttachment(upload)))
    : [];
  const withAttachments = attachments.length > 0 ? { attachments } : {};

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
    // The model this turn actually runs on, recorded on the turn itself. An
    // unset override used to store `null` ("whatever the thread says"),
    // which reads back as the thread's *current* model — so switching models
    // mid-conversation relabelled every earlier turn with the new one.
    const modelSelection: ModelSelection = input.modelSelection ?? thread.modelSelection;

    if (running && (delivery === "auto" || delivery === "steer")) {
      const messageId = store.newId();
      await store.appendLedger(threadId, "messages", {
        id: messageId,
        threadId,
        turnId: running.id,
        role: "user",
        text: prompt,
        createdAt: now,
        ...withAttachments,
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
      ...(status === "running" ? { owner: currentTurnOwner() } : {}),
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
      usage: null,
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
      ...withAttachments,
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
/** This process, as the owner of the turns it starts or promotes. */
export function currentTurnOwner(): TurnOwner {
  return { pid: process.pid, host: os.hostname() };
}

/** Whether a process exists. EPERM means it does, just not ours to signal. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as { code?: string } | null)?.code === "EPERM";
  }
}

/**
 * Whether nothing will ever settle this running turn: no run in this
 * process holds it, and the process that owned it — on this machine —
 * is gone (a crashed server, a killed CLI, a TUI closed mid-turn). A turn
 * owned on another host, or recorded before owners were, is never judged:
 * a live turn wrongly reaped would be far worse than a stuck one.
 */
function isOrphaned(store: ThreadStore, turn: StoredTurn): boolean {
  if (turn.status !== "running" || store.isTracked(turn.id)) return false;
  const owner = turn.owner;
  if (!owner || owner.host !== os.hostname() || owner.pid === process.pid) return false;
  return !processAlive(owner.pid);
}

/**
 * Interrupt the thread's running turn if its owner died, and promote the
 * next queued turn (now owned by this process). Returns the promoted turn,
 * which the caller must run; null when there was nothing to recover.
 */
export async function reconcileOrphanedTurn(
  store: ThreadStore,
  rawThreadId: string,
): Promise<{ interrupted: StoredTurn; promoted: StoredTurn | null } | null> {
  const threadId = requireThreadId(rawThreadId);
  const peek = openTurn(await store.readTurns(threadId));
  if (!peek || !isOrphaned(store, peek)) return null;
  return await store.withThreadLock(threadId, async () => {
    const thread = await store.readThreadRecord(threadId);
    const running = openTurn(await store.readTurns(threadId));
    if (!thread || !running || !isOrphaned(store, running)) return null;
    const now = store.nowIso();
    const pid = running.owner?.pid;
    const interrupted =
      (await store.updateTurn(threadId, running.id, {
        status: "interrupted",
        error: `The process running this turn (pid ${pid}) exited before it finished.`,
        updatedAt: now,
        completedAt: now,
      })) ?? running;
    await store.appendLedger(threadId, "activity", {
      id: store.newId(),
      threadId,
      turnId: running.id,
      kind: "turn.orphaned",
      summary: `Turn ${running.id} was interrupted: its process (pid ${pid}) exited mid-turn.`,
      createdAt: now,
    });
    await promoteQueuedLocked(store, threadId, now);
    const promoted = (await store.readTurns(threadId)).find(
      (turn) => turn.status === "running" && turn.id !== running.id && !store.isTracked(turn.id),
    ) ?? null;
    await store.writeThreadRecord({ ...thread, updatedAt: now });
    store.emit(threadId, "turn-interrupted");
    return { interrupted, promoted };
  });
}

async function promoteQueuedLocked(store: ThreadStore, threadId: string, now: string): Promise<void> {
  const turns = await store.readTurns(threadId);
  if (openTurn(turns)) return;
  const next = turns.find((turn) => turn.status === "queued");
  if (!next) return;
  await store.updateTurn(threadId, next.id, { status: "running", owner: currentTurnOwner(), updatedAt: now });
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
  readonly usage?: TurnUsage | null;
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
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
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

export async function archiveThread(store: ThreadStore, rawThreadId: string): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    if (thread.deletedAt != null) {
      throw new CliError("THREAD_ARCHIVED", `Thread ${threadId} is deleted and cannot be archived.`, {
        exitCode: 4,
        details: { threadId },
      });
    }
    const next: StoredThread = { ...thread, archivedAt: thread.archivedAt ?? now, updatedAt: now };
    await store.writeThreadRecord(next);
    store.emit(threadId, "archived");
    return next;
  });
}

export async function deleteThread(store: ThreadStore, rawThreadId: string): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    const next: StoredThread = { ...thread, deletedAt: now, updatedAt: now };
    await store.writeThreadRecord(next);
    store.emit(threadId, "deleted");
    return next;
  });
}

export interface UpdateThreadMetaInput {
  readonly title?: string;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: InteractionMode;
  readonly regenerateTitle?: boolean;
}

export async function updateThreadMeta(
  store: ThreadStore,
  rawThreadId: string,
  input: UpdateThreadMetaInput,
): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    requireNotArchived(thread, "be updated");
    let title = thread.title;
    if (input.title !== undefined) {
      const trimmed = input.title.trim();
      if (!trimmed) {
        throw new CliError("INVALID_THREAD_OPTION", "A non-empty thread title is required.", { exitCode: 2 });
      }
      title = trimmed;
    } else if (input.regenerateTitle === true) {
      const messages = await store.readMessages(threadId);
      const firstUser = messages.find((message) => message.role === "user" && message.text.trim().length > 0);
      const seed = firstUser?.text.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, " ").trim() || thread.title;
      title = seed.length <= 80 ? seed : `${seed.slice(0, 79)}…`;
    }
    const next: StoredThread = {
      ...thread,
      title,
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
      updatedAt: now,
    };
    await store.writeThreadRecord(next);
    store.emit(threadId, "meta-updated");
    return next;
  });
}

/** CLI `task-status`/`task-cancel` address delegations by child thread id. */
export async function delegationForChild(
  store: ThreadStore,
  parentThreadId: string,
  childThreadId: string,
): Promise<StoredDelegation | null> {
  const rows = await store.readDelegations();
  return rows.find((row) => row.parentThreadId === parentThreadId && row.childThreadId === childThreadId) ?? null;
}
