import type { T3Project, T3Thread } from "../../types.js";

export interface ShellState {
  snapshotSequence: number;
  projects: T3Project[];
  threads: T3Thread[];
  synchronized: boolean;
  unhandled: Record<string, number>;
}

export function emptyShellState(): ShellState {
  return { snapshotSequence: 0, projects: [], threads: [], synchronized: false, unhandled: {} };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => asRecord(entry) !== null) : [];
}

function upsert<T extends { id: string }>(rows: readonly T[], next: T): T[] {
  const index = rows.findIndex((row) => row.id === next.id);
  if (index === -1) return [...rows, next];
  const copy = [...rows];
  copy[index] = next;
  return copy;
}

export function applyShellFrame(state: ShellState, frame: unknown): ShellState {
  const record = asRecord(frame);
  if (record === null) return state;
  const kind = typeof record.kind === "string" ? record.kind : "unknown";

  if (kind === "snapshot") {
    const snapshot = asRecord(record.snapshot) ?? record;
    return {
      ...state,
      snapshotSequence: typeof snapshot.snapshotSequence === "number" ? snapshot.snapshotSequence : state.snapshotSequence,
      projects: asRows(snapshot.projects) as unknown as T3Project[],
      threads: asRows(snapshot.threads) as unknown as T3Thread[],
    };
  }
  if (kind === "synchronized") return { ...state, synchronized: true };

  const sequence = typeof record.sequence === "number" ? record.sequence : state.snapshotSequence;
  const thread = asRecord(record.thread);
  if (thread !== null && typeof thread.id === "string") {
    return { ...state, snapshotSequence: sequence, threads: upsert(state.threads, thread as unknown as T3Thread) };
  }
  const project = asRecord(record.project);
  if (project !== null && typeof project.id === "string") {
    return { ...state, snapshotSequence: sequence, projects: upsert(state.projects, project as unknown as T3Project) };
  }
  if (typeof record.threadId === "string") {
    return { ...state, snapshotSequence: sequence, threads: state.threads.filter((row) => row.id !== record.threadId) };
  }

  return { ...state, unhandled: { ...state.unhandled, [kind]: (state.unhandled[kind] ?? 0) + 1 } };
}

export type ThreadStatus = "active" | "running" | "settled" | "snoozed" | "blocked";

/**
 * Sticky settlement: the server may project `settledAt` without
 * `settledOverride` (or a stale override in either direction), so both are
 * consulted. An explicit `unsettledAt` later than `settledAt` — or an
 * override of `"active"` — reopens the thread. Settlement beats snooze and
 * stale usage-limit errors (the CLI's `threads.ts` likewise reports
 * `settledAt != null` as settled and ignores snooze then); only a live
 * session still reads as running, since a turn in flight means the thread
 * woke back up.
 */
export function isSettledThread(thread: T3Thread): boolean {
  if (thread.settledOverride === "settled") return true;
  if (thread.settledOverride === "active") return false;
  if (thread.settledAt == null) return false;
  if (thread.unsettledAt == null) return true;
  return Date.parse(thread.settledAt) >= Date.parse(thread.unsettledAt);
}

export function threadStatus(thread: T3Thread, now = Date.now()): ThreadStatus {
  const session = thread.session;
  if (session?.status === "running" || session?.status === "starting") return "running";
  if (isSettledThread(thread)) return "settled";
  if (typeof session?.lastError === "string" && /usage limit/i.test(session.lastError)) return "blocked";
  const snoozedUntil = thread.snoozedUntil;
  if (typeof snoozedUntil === "string" && Date.parse(snoozedUntil) > now) return "snoozed";
  return "active";
}

export function visibleThreads(state: ShellState): T3Thread[] {
  const now = Date.now();
  const rank: Record<ThreadStatus, number> = { running: 0, blocked: 1, active: 2, snoozed: 3, settled: 4 };
  return state.threads
    .filter((thread) => thread.archivedAt === null && thread.deletedAt == null)
    .sort((left, right) => {
      const byStatus = rank[threadStatus(left, now)] - rank[threadStatus(right, now)];
      if (byStatus !== 0) return byStatus;
      return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
    });
}
