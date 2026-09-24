/**
 * Read-side projections of a thread: the list status, the busy/active
 * predicates, and the `inspect` / `read` views.
 *
 * These lived in the CLI, which made them a CLI feature: the server had no
 * way to answer "is this thread busy" the same way, and a second client
 * would have had to copy them. They are pure functions over the envelope
 * (`./project.ts`) — no store access — so any client can apply them to a
 * thread it received over `ClientApi`, and all of them read a thread the
 * same way.
 */
import { CliError } from "../errors.js";
import type { ThreadEnvelope } from "../types.js";
import type { ReadView } from "./types.js";

export type ThreadListStatus = "active" | "settled" | "snoozed" | "all";

export type ThreadReadView = ReadView;

export type DelegatedTaskStatus = "running" | "completed" | "failed" | "interrupted";

export type DelegatedTaskWorkState = "working" | "result_available";

const INSPECT_RECENT_MESSAGE_LIMIT = 6;
const INSPECT_MESSAGE_TEXT_LIMIT = 2_000;

export function isVisibleThread(thread: ThreadEnvelope): boolean {
  return thread.archivedAt == null && thread.deletedAt == null;
}

export function isSnoozedThread(thread: ThreadEnvelope, now = Date.now()): boolean {
  if (thread.settledAt != null) return false;
  const until = thread.snoozedUntil;
  if (typeof until !== "string" || until.length === 0) return false;
  const parsed = Date.parse(until);
  return Number.isFinite(parsed) && parsed > now;
}

export function threadListStatus(thread: ThreadEnvelope): Exclude<ThreadListStatus, "all"> {
  if (thread.settledAt != null) return "settled";
  return isSnoozedThread(thread) ? "snoozed" : "active";
}

/** A turn is running or starting — the thread would reject a plain send. */
export function isThreadBusy(thread: ThreadEnvelope): boolean {
  const latestState = thread.latestTurn?.state as string | undefined;
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.session?.activeTurnId != null ||
    latestState === "pending" ||
    latestState === "running"
  );
}

/** A run exists that an interrupt could reach. */
export function isThreadActive(thread: ThreadEnvelope): boolean {
  const latestState = thread.latestTurn?.state as string | undefined;
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.session?.activeTurnId != null ||
    latestState === "running"
  );
}

export function latestAssistantText(thread: ThreadEnvelope): string | null {
  const messages = thread.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant" && message.text.trim().length > 0) return message.text;
  }
  return null;
}

export function delegatedStatusOf(thread: ThreadEnvelope): DelegatedTaskStatus {
  const state = thread.latestTurn?.state;
  if (state === "completed") return "completed";
  if (state === "error") return "failed";
  if (state === "interrupted") return "interrupted";
  return "running";
}

export function delegatedWorkStateOf(status: DelegatedTaskStatus): DelegatedTaskWorkState {
  return status === "running" ? "working" : "result_available";
}

export function normalizeReadView(raw: ThreadReadView | undefined): ThreadReadView {
  const view = raw ?? "messages";
  if (view !== "messages" && view !== "turn-items" && view !== "plans" && view !== "checkpoints" && view !== "transfers") {
    throw new CliError("INVALID_THREAD_OPTION", "--view must be messages, turn-items, plans, checkpoints, or transfers.", {
      exitCode: 2,
      details: { view: raw },
    });
  }
  return view;
}

/** The thread without its ledger arrays (all optional on the envelope). */
function withoutLedger(thread: ThreadEnvelope): ThreadEnvelope {
  const summary = { ...thread };
  delete summary.messages;
  delete summary.activities;
  delete summary.checkpoints;
  delete summary.proposedPlans;
  return summary;
}

/** `inspect`: the thread summary plus its last few messages, truncated. */
export function threadInspectionView(thread: ThreadEnvelope) {
  const messages = thread.messages ?? [];
  return {
    ...withoutLedger(thread),
    status: threadListStatus(thread),
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

export type ThreadInspection = ReturnType<typeof threadInspectionView>;

/** `read`: one ledger view of the thread, optionally narrowed to its last turn. */
export function threadReadView(thread: ThreadEnvelope, options: { lastTurn: boolean; view: ThreadReadView }) {
  const { lastTurn, view } = options;
  const base = { ...withoutLedger(thread), status: threadListStatus(thread) };
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
    // No store records ContextTransfer rows; report the empty set
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

export type ThreadReading = ReturnType<typeof threadReadView>;

export interface OpenQuestion {
  readonly id: string;
  readonly question: string;
  readonly header: string;
  readonly multiSelect: boolean;
  readonly allowCustomAnswer: boolean;
  readonly options: ReadonlyArray<{ readonly label: string; readonly description?: string }>;
}

export interface OpenRequest {
  readonly requestId: string;
  readonly turnId: string | null;
  readonly questions: readonly OpenQuestion[];
}

/**
 * Questions the running turn is parked on: `user-input.requested` rows of
 * the running turn with no `user-input.resolved` row after them. A turn
 * that ended took its questions with it, so only the running one counts.
 */
export function openQuestions(thread: ThreadEnvelope): OpenRequest[] {
  const turnId = thread.latestTurn?.state === "running" ? thread.latestTurn.turnId : null;
  if (turnId === null) return [];
  const resolved = new Set<string>();
  const open: OpenRequest[] = [];
  for (const activity of thread.activities ?? []) {
    const payload = activity.payload as Record<string, unknown> | undefined;
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (requestId === null) continue;
    if (activity.kind === "user-input.resolved") resolved.add(requestId);
    else if (activity.kind === "user-input.requested" && activity.turnId === turnId && Array.isArray(payload?.questions)) {
      open.push({ requestId, turnId, questions: payload.questions as OpenQuestion[] });
    }
  }
  return open.filter((request) => !resolved.has(request.requestId));
}
