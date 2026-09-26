import type { ActivityEnvelope } from "../../core/types.js";

/**
 * Time a turn spent waiting on the user rather than working.
 *
 * A turn that parks on a question or a permission prompt is not working
 * while it waits: the provider has stopped and nothing happens until the
 * user answers. Counting that as "Worked for 20m" misreports the turn —
 * and the live clock ticking on while the answer panel sits open reads as
 * the agent being busy when it is the user it is waiting on.
 *
 * Each wait is bracketed by a pair of ledger rows sharing a `requestId`:
 * `user-input.requested` → `user-input.resolved` for agent questions, and
 * `permission.requested` → `permission.resolved` for tool approvals. A
 * wait with no closing row is still open.
 */
export interface WaitSpan {
  readonly start: number;
  /** Null while the turn is still waiting on this request. */
  readonly end: number | null;
}

export type TurnWaits = ReadonlyMap<string, readonly WaitSpan[]>;

const OPENS: ReadonlySet<string> = new Set(["user-input.requested", "permission.requested"]);
const CLOSES: ReadonlySet<string> = new Set(["user-input.resolved", "permission.resolved"]);

function requestIdOf(activity: ActivityEnvelope): string | null {
  const payload = activity.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : null;
}

/** Every turn's waits, keyed by turn id. Rows without a turn or request id are ignored. */
export function waitSpans(activities: readonly ActivityEnvelope[]): TurnWaits {
  const opened = new Map<string, { turnId: string; start: number }>();
  const closed = new Map<string, number>();
  for (const activity of activities) {
    const requestId = requestIdOf(activity);
    if (requestId === null) continue;
    const at = Date.parse(activity.createdAt);
    if (Number.isNaN(at)) continue;
    if (OPENS.has(activity.kind) && activity.turnId !== null && !opened.has(requestId)) {
      opened.set(requestId, { turnId: activity.turnId, start: at });
    } else if (CLOSES.has(activity.kind) && !closed.has(requestId)) {
      closed.set(requestId, at);
    }
  }
  const byTurn = new Map<string, WaitSpan[]>();
  for (const [requestId, { turnId, start }] of opened) {
    const end = closed.get(requestId);
    const spans = byTurn.get(turnId) ?? [];
    spans.push({ start, end: end === undefined || end < start ? null : end });
    byTurn.set(turnId, spans);
  }
  return byTurn;
}

/**
 * Milliseconds of `spans` that fall inside `[from, to]`. An open span runs
 * to `to`. Overlapping spans (two questions parked at once) are merged, so
 * the same wall-clock second is never subtracted twice.
 */
export function waitedMs(spans: readonly WaitSpan[], from: number, to: number): number {
  if (spans.length === 0 || !(to > from)) return 0;
  const clipped = spans
    .map((span) => ({ start: Math.max(from, span.start), end: Math.min(to, span.end ?? to) }))
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start);
  let total = 0;
  let cursor = from;
  for (const span of clipped) {
    const start = Math.max(cursor, span.start);
    if (span.end > start) {
      total += span.end - start;
      cursor = span.end;
    }
  }
  return total;
}

/** Whether any wait in `spans` is still open — the turn is on the user right now. */
export function isWaiting(spans: readonly WaitSpan[]): boolean {
  return spans.some((span) => span.end === null);
}

/** Wall time from `from` to `to`, minus the waits inside it. */
export function workingMs(spans: readonly WaitSpan[], from: number, to: number): number {
  return Math.max(0, to - from - waitedMs(spans, from, to));
}
