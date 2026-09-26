/**
 * Timers for scheduled turns, in the process that runs them.
 *
 * A scheduled message is a queued turn with a time on it (`scheduledFor`).
 * When the thread is busy at that time, the running turn's settle promotes
 * it like any queued turn. When the thread is idle, nothing would ever
 * start it — so the process that owns provider sessions (the shared
 * server, or a client running in-process) registers a handler here, and
 * every scheduled send arms a timer that calls it once the time comes.
 *
 * A process with no handler (a one-shot CLI command) arms nothing: its
 * scheduled turn waits on disk until a running owner picks it up (each one
 * scans for pending schedules when it starts).
 */

/** Node's timers overflow past ~24.8 days; longer waits re-arm in steps. */
const MAX_TIMER_MS = 2 ** 31 - 1;

let dueHandler: ((threadId: string) => void) | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Register (or, with null, remove) what runs a thread's scheduled turn once it is due. */
export function onScheduledTurnDue(handler: ((threadId: string) => void) | null): void {
  dueHandler = handler;
  if (handler === null) {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }
}

/** Arm a timer for one scheduled turn. Idempotent per turn; a no-op without a handler. */
export function armScheduledTurn(threadId: string, turnId: string, at: string, now: number = Date.now()): void {
  if (dueHandler === null) return;
  const key = `${threadId}:${turnId}`;
  const existing = timers.get(key);
  if (existing !== undefined) clearTimeout(existing);
  const due = Date.parse(at);
  if (!Number.isFinite(due)) return;
  const wait = Math.max(0, due - now);
  const timer = setTimeout(() => {
    timers.delete(key);
    if (Date.now() < due) {
      armScheduledTurn(threadId, turnId, at);
      return;
    }
    dueHandler?.(threadId);
  }, Math.min(wait, MAX_TIMER_MS));
  // A pending schedule never keeps the process alive on its own.
  timer.unref?.();
  timers.set(key, timer);
}

/** Drop a turn's timer (it was cancelled, or ran). */
export function disarmScheduledTurn(threadId: string, turnId: string): void {
  const key = `${threadId}:${turnId}`;
  const timer = timers.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(key);
}

/** Armed timers, for tests. */
export function armedScheduleCount(): number {
  return timers.size;
}
