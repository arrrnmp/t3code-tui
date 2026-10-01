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

import { imageSetError } from "../attachments.js";
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
  StoredAttachment,
  StoredDelegation,
  StoredMessage,
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

export function openTurn(turns: StoredTurn[]): StoredTurn | null {
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

function normalizeScheduledFor(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const parsed = Date.parse(raw.trim());
  if (!Number.isFinite(parsed)) {
    throw new CliError("INVALID_THREAD_OPTION", "The scheduled time must be an ISO date-time.", { exitCode: 2 });
  }
  return new Date(parsed).toISOString();
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
    ...(input.titleSource ? { titleSource: input.titleSource } : {}),
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
  const scheduledFor = normalizeScheduledFor(input.scheduledFor);
  // A scheduled message is a queued one that also waits for its time.
  const delivery = scheduledFor === null ? normalizeDelivery(input.delivery) : "queue";
  if (scheduledFor !== null && (input.delivery === "steer" || input.delivery === "restart")) {
    throw new CliError("INVALID_THREAD_OPTION", "A scheduled message cannot steer or restart a turn.", { exitCode: 2 });
  }
  // The API's image limits, refused here in words rather than by the
  // provider mid-turn — whichever client sent them.
  const imageError = input.attachments?.length ? imageSetError(input.attachments) : null;
  if (imageError !== null) throw new CliError("INVALID_ATTACHMENT", `Cannot send: ${imageError}.`, { exitCode: 2 });
  // Saved before the lock: bytes on disk are harmless if the send is then
  // refused, and the lock is held only for ledger writes.
  const attachments = input.attachments?.length
    ? await Promise.all(input.attachments.map((upload) => store.saveAttachment(upload)))
    : [];
  const withAttachments = attachments.length > 0 ? { attachments } : {};
  // A continue after a usage limit is moxen's message, not the user's,
  // whoever scheduled it: clients draw it as a notice, not a "you" prompt.
  const origin = input.origin ?? (input.scheduleReason === "usage-reset" ? ("usage-continue" as const) : undefined);
  const withOrigin = origin !== undefined ? { origin, ...(input.notification ? { notification: input.notification } : {}) } : {};

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
        ...withOrigin,
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

    // One continue after a usage limit at a time: a second request (a double
    // click, a client and the automatic continue racing) gets the first.
    if (input.scheduleReason === "usage-reset") {
      const waiting = (await store.readTurns(threadId)).find((row) => row.status === "queued" && row.scheduleReason === "usage-reset");
      if (waiting) return { thread, turn: waiting, messageId: waiting.messageId, delivery: waiting.delivery };
    }

    // Held for later only while that time is still ahead; a past time runs now.
    // A plain send while a continue waits out a usage limit queues behind
    // it instead of running into the same wall: held to the same time, it
    // goes out once the continue has run.
    const waitingOut = scheduledFor === null && !running && delivery !== "restart" ? usageHoldUntil(turns, Date.parse(now)) : null;
    const holdUntil = waitingOut ?? (scheduledFor !== null && Date.parse(scheduledFor) > Date.parse(now) ? scheduledFor : null);
    const scheduleReason = waitingOut !== null ? ("usage-hold" as const) : (input.scheduleReason ?? "user");
    const status = holdUntil !== null || (delivery === "queue" && openTurn(await store.readTurns(threadId))) ? "queued" : "running";
    const turn: StoredTurn = {
      id: store.newId(),
      threadId,
      status,
      ...(status === "running" ? { owner: currentTurnOwner() } : {}),
      delivery:
        delivery === "queue" || waitingOut !== null ? (status === "queued" ? "queued" : "started")
        : delivery === "restart" ? "restarted"
        : "started",
      messageId: store.newId(),
      runtimeMode,
      interactionMode,
      modelSelection,
      parentTurnId: delivery === "restart" && running ? running.id : null,
      ...(holdUntil !== null
        ? {
            scheduledFor: holdUntil,
            scheduleReason,
            ...(input.continueAttempt !== undefined ? { continueAttempt: input.continueAttempt } : {}),
          }
        : {}),
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
      ...withOrigin,
    });
    await store.appendLedger(threadId, "activity", {
      id: store.newId(),
      threadId,
      turnId: turn.id,
      kind: holdUntil !== null ? "turn.scheduled" : status === "queued" ? "turn.queued" : "turn.started",
      summary: prompt.slice(0, 120),
      ...(holdUntil !== null ? { payload: { scheduledFor: holdUntil, reason: scheduleReason } } : {}),
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
    // A queued or scheduled message taken back before it ran: clients drop
    // it from the transcript rather than show a turn that never happened.
    ...(turn.status === "queued" ? { payload: { beforeStart: true } } : {}),
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
/**
 * Record a turn the provider started on its own (see `turn.started` with
 * `origin: "background"`): no prompt of ours, so no user message — an
 * activity row says what woke it. Claude Code starts such a turn the moment
 * the previous one ends, often while that turn's runner is still writing its
 * outcome, so this waits briefly for the thread to go idle first.
 */
export async function startBackgroundTurn(
  store: ThreadStore,
  rawThreadId: string,
  input: { readonly modelSelection: ModelSelection | null },
): Promise<StoredTurn> {
  const threadId = requireThreadId(rawThreadId);
  for (let wait = 0; wait < 150 && openTurn(await store.readTurns(threadId)); wait += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const thread = requireStoredThread(await store.readThreadRecord(threadId), threadId);
    const turn: StoredTurn = {
      id: store.newId(),
      threadId,
      status: "running",
      owner: currentTurnOwner(),
      delivery: "background",
      messageId: store.newId(),
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      modelSelection: input.modelSelection ?? thread.modelSelection,
      parentTurnId: null,
      error: null,
      usage: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await store.appendLedger(threadId, "turns", turn);
    await store.appendLedger(threadId, "activity", {
      id: store.newId(),
      threadId,
      turnId: turn.id,
      kind: "turn.background",
      summary: "Woken by a background task",
      createdAt: now,
    });
    await store.writeThreadRecord({ ...thread, updatedAt: now });
    store.emit(threadId, "turn-started");
    return turn;
  });
}

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

/** A queued turn still waiting for its scheduled time. */
/**
 * Put a promoted turn back in the queue, held until `until`.
 *
 * Settling a turn promotes the next queued one, and its runner starts it
 * at once. When the turn just settled ran into a usage limit, starting the
 * next one only runs it into the same wall — and the one after that, until
 * every queued message is a failed turn. The runner calls this instead, so
 * the message waits for the reset like a scheduled one.
 *
 * Only a turn still `running` with no provider run attached is moved: one
 * that has already started belongs to its run.
 */
export async function holdPromotedTurn(
  store: ThreadStore,
  rawThreadId: string,
  turnId: string,
  until: string,
): Promise<boolean> {
  const threadId = requireThreadId(rawThreadId);
  return await store.withThreadLock(threadId, async () => {
    const turn = (await store.readTurns(threadId)).find((candidate) => candidate.id === turnId);
    if (!turn || turn.status !== "running" || store.isTracked(turnId)) return false;
    const now = store.nowIso();
    await store.updateTurn(threadId, turnId, {
      status: "queued",
      scheduledFor: until,
      scheduleReason: "usage-hold",
      // Released: whoever runs it at the reset takes it then.
      owner: null,
      updatedAt: now,
    });
    await store.appendLedger(threadId, "activity", {
      id: store.newId(),
      threadId,
      turnId,
      kind: "turn.held",
      summary: "Held until the usage limit resets",
      payload: { until },
      createdAt: now,
    });
    store.emit(threadId, "turn-held");
    return true;
  });
}

/**
 * When a message sent now should go out instead: the time a continue after
 * a usage limit (or a message already held behind one) waits for, while it
 * is still ahead. Null when nothing is waiting out a limit.
 */
export function usageHoldUntil(turns: readonly StoredTurn[], now: number): string | null {
  let until: string | null = null;
  for (const turn of turns) {
    if (!isHeldTurn(turn, now)) continue;
    if (turn.scheduleReason !== "usage-reset" && turn.scheduleReason !== "usage-hold") continue;
    if (until === null || Date.parse(turn.scheduledFor!) > Date.parse(until)) until = turn.scheduledFor!;
  }
  return until;
}

export function isHeldTurn(turn: StoredTurn, now: number = Date.now()): boolean {
  return turn.status === "queued" && typeof turn.scheduledFor === "string" && Date.parse(turn.scheduledFor) > now;
}

function sameModel(left: StoredTurn, right: StoredTurn): boolean {
  return left.modelSelection?.instanceId === right.modelSelection?.instanceId && left.modelSelection?.model === right.modelSelection?.model;
}

/**
 * Fold every other queued message that could go now into `next`: queued
 * behind the same turn, or held for the same reset, they are sent together
 * as one turn — not one turn each, with the agent working through the first
 * before it even sees the second. Their turns never ran, so they are dropped
 * and their messages move onto `next`. A message for another model, or one
 * still waiting for a later time, keeps its own turn.
 */
async function batchQueuedLocked(store: ThreadStore, threadId: string, next: StoredTurn, turns: readonly StoredTurn[], now: string): Promise<void> {
  const batch = turns.filter(
    (turn) =>
      turn.id !== next.id &&
      turn.status === "queued" &&
      !isHeldTurn(turn, Date.parse(now)) &&
      turn.scheduleReason !== "usage-reset" &&
      sameModel(turn, next),
  );
  if (batch.length === 0) return;
  const folded = new Set(batch.map((turn) => turn.id));
  const messages = await store.readMessages(threadId);
  await store.rewriteLedger(threadId, "messages", messages.map((message) => (folded.has(message.turnId) ? { ...message, turnId: next.id } : message)));
  await store.rewriteLedger(threadId, "turns", turns.filter((turn) => !folded.has(turn.id)));
  await store.appendLedger(threadId, "activity", {
    id: store.newId(),
    threadId,
    turnId: next.id,
    kind: "turn.batched",
    summary: `${batch.length + 1} queued messages sent together`,
    payload: { turnIds: [...folded] },
    createdAt: now,
  });
}

/**
 * What a turn sends: every user message on it, in order — one, or several
 * queued messages batched into it — with all their images.
 */
export function turnPrompt(messages: readonly StoredMessage[], turn: StoredTurn): { text: string; attachments: StoredAttachment[] } | null {
  const own = messages.filter((message) => message.turnId === turn.id && message.role === "user" && message.text.trim().length > 0);
  if (own.length === 0) {
    const first = messages.find((message) => message.id === turn.messageId);
    return first?.text ? { text: first.text, attachments: [...(first.attachments ?? [])] } : null;
  }
  return {
    text: own.map((message) => message.text.trim()).join("\n\n"),
    attachments: own.flatMap((message) => message.attachments ?? []),
  };
}

async function promoteQueuedLocked(store: ThreadStore, threadId: string, now: string): Promise<void> {
  const turns = await store.readTurns(threadId);
  if (openTurn(turns)) return;
  // A scheduled turn waits for its time; ordinary queued turns go ahead of it.
  const next = turns.find((turn) => turn.status === "queued" && !isHeldTurn(turn, Date.parse(now)));
  if (!next) return;
  await batchQueuedLocked(store, threadId, next, turns, now);
  await store.updateTurn(threadId, next.id, { status: "running", owner: currentTurnOwner(), startedAt: now, updatedAt: now });
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

/**
 * Start the thread's scheduled turn that has come due, if the thread is free:
 * promoted to `running` (owned by this process) and returned for the caller
 * to run. Null when nothing is due, or a turn is already running — that
 * turn's settle promotes it instead.
 */
export async function promoteDueScheduledTurn(store: ThreadStore, rawThreadId: string): Promise<StoredTurn | null> {
  const threadId = requireThreadId(rawThreadId);
  return await store.withThreadLock(threadId, async () => {
    const now = store.nowIso();
    const turns = await store.readTurns(threadId);
    if (openTurn(turns)) return null;
    const due = turns.find(
      (turn) => turn.status === "queued" && typeof turn.scheduledFor === "string" && !isHeldTurn(turn, Date.parse(now)),
    );
    if (!due) return null;
    await promoteQueuedLocked(store, threadId, now);
    return (await store.readTurns(threadId)).find((turn) => turn.status === "running" && !store.isTracked(turn.id)) ?? null;
  });
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

/**
 * A thread's settlement family: its root ancestor (climbing `parentThreadId`,
 * stopping at a missing parent or a cycle) and every live descendant. Archived
 * and deleted members are left out; the requested thread is always in.
 */
async function threadFamily(store: ThreadStore, threadId: string): Promise<string[]> {
  // The parent link lives in the delegations ledger, not on the thread record.
  const rows = await store.readDelegations().catch(() => []);
  const parentOf = new Map(rows.map((row) => [row.childThreadId, row.parentThreadId]));
  let root = threadId;
  const seen = new Set([root]);
  for (;;) {
    const parent = parentOf.get(root);
    if (parent === undefined || seen.has(parent) || (await store.readThreadRecord(parent)) === null) break;
    seen.add(parent);
    root = parent;
  }
  const family = new Set([root]);
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const row of rows) {
      if (row.parentThreadId !== current || family.has(row.childThreadId)) continue;
      const child = await store.readThreadRecord(row.childThreadId);
      if (child === null || child.archivedAt != null || child.deletedAt != null) continue;
      family.add(row.childThreadId);
      queue.push(row.childThreadId);
    }
  }
  family.add(threadId);
  return [...family];
}

/** Hold every listed thread's lock at once; ids are taken in sorted order, so concurrent family operations cannot deadlock. */
async function withThreadLocks<T>(store: ThreadStore, ids: readonly string[], run: () => Promise<T>): Promise<T> {
  const [first, ...rest] = [...ids].sort();
  if (first === undefined) return await run();
  return await store.withThreadLock(first, () => withThreadLocks(store, rest, run));
}

/**
 * Settling any thread settles its whole family (root and all live
 * descendants), so a settled parent never leaves active subthreads behind.
 * If any member still has running/queued work or pending approvals or input,
 * nothing is settled. Returns the requested thread's record.
 */
export async function settleThread(store: ThreadStore, rawThreadId: string): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  const family = await threadFamily(store, threadId);
  return await withThreadLocks(store, family, async () => {
    const now = store.nowIso();
    const members: StoredThread[] = [];
    const blocked: Array<{ id: string; running: boolean; thread: StoredThread }> = [];
    for (const id of family) {
      const thread = requireStoredThread(await store.readThreadRecord(id), id);
      if (id === threadId) requireNotArchived(thread, "change settlement state");
      if (thread.archivedAt != null || thread.deletedAt != null) continue;
      members.push(thread);
      const running = openTurn(await store.readTurns(id)) !== null;
      if (running || thread.hasPendingApprovals || thread.hasPendingUserInput) blocked.push({ id, running, thread });
    }
    if (blocked.length > 0) {
      const culprit = blocked.find((entry) => entry.id === threadId) ?? blocked[0]!;
      throw new CliError(
        "THREAD_SETTLE_BLOCKED",
        culprit.id === threadId
          ? `Thread ${threadId} still has active or blocked work.`
          : `Thread ${threadId} cannot settle: ${culprit.id} in its family still has active or blocked work.`,
        {
          exitCode: 4,
          details: {
            threadId,
            hasActiveTurn: culprit.running,
            hasPendingApprovals: culprit.thread.hasPendingApprovals,
            hasPendingUserInput: culprit.thread.hasPendingUserInput,
            blockedThreadIds: blocked.map((entry) => entry.id),
          },
        },
      );
    }
    let result: StoredThread | null = null;
    for (const thread of members) {
      if (thread.id !== threadId && thread.settledAt != null) continue;
      const next: StoredThread = { ...thread, settledAt: now, settledOverride: null, snoozedUntil: null, updatedAt: now };
      await store.writeThreadRecord(next);
      store.emit(thread.id, "settled");
      if (thread.id === threadId) result = next;
    }
    return result ?? members.find((thread) => thread.id === threadId)!;
  });
}

/** The mirror of `settleThread`: the whole family is woken; nothing can block it. Returns the requested thread's record. */
export async function unsettleThread(store: ThreadStore, rawThreadId: string): Promise<StoredThread> {
  const threadId = requireThreadId(rawThreadId);
  const family = await threadFamily(store, threadId);
  return await withThreadLocks(store, family, async () => {
    const now = store.nowIso();
    let result: StoredThread | null = null;
    for (const id of family) {
      const thread = requireStoredThread(await store.readThreadRecord(id), id);
      if (id === threadId) requireNotArchived(thread, "change settlement state");
      if (thread.archivedAt != null || thread.deletedAt != null) continue;
      const next: StoredThread = { ...thread, settledAt: null, settledOverride: "active", unsettledAt: now, updatedAt: now };
      await store.writeThreadRecord(next);
      store.emit(id, "unsettle");
      if (id === threadId) result = next;
    }
    return result!;
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
    let titleSource = thread.titleSource;
    if (input.title !== undefined) {
      const trimmed = input.title.trim();
      if (!trimmed) {
        throw new CliError("INVALID_THREAD_OPTION", "A non-empty thread title is required.", { exitCode: 2 });
      }
      title = trimmed;
      titleSource = "user";
    } else if (input.regenerateTitle === true) {
      const messages = await store.readMessages(threadId);
      const firstUser = messages.find((message) => message.role === "user" && message.text.trim().length > 0);
      const seed = firstUser?.text.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, " ").trim() || thread.title;
      title = seed.length <= 80 ? seed : `${seed.slice(0, 79)}…`;
      titleSource = "seed";
    }
    const next: StoredThread = {
      ...thread,
      title,
      ...(titleSource ? { titleSource } : {}),
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

/**
 * Take the provider's native session title as the thread's. A title someone
 * chose (`titleSource: "user"`) stays unless `force` says the user asked for
 * the provider's (regenerate). Returns null when nothing changed.
 */
export async function adoptProviderTitle(
  store: ThreadStore,
  rawThreadId: string,
  rawTitle: string,
  options: { readonly force?: boolean } = {},
): Promise<StoredThread | null> {
  const threadId = requireThreadId(rawThreadId);
  const title = rawTitle.trim().replace(/\s+/gu, " ");
  if (!title) return null;
  return await store.withThreadLock(threadId, async () => {
    const thread = await store.readThreadRecord(threadId);
    if (thread === null || thread.archivedAt != null || thread.deletedAt != null) return null;
    if (thread.titleSource === "user" && options.force !== true) return null;
    if (thread.title === title && thread.titleSource === "provider") return null;
    const next: StoredThread = { ...thread, title, titleSource: "provider", updatedAt: store.nowIso() };
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
