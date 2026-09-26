/**
 * What is worth telling the user about, read off successive shell snapshots:
 * a thread whose turn finished or failed, or one a usage limit stopped.
 * Pure — the caller keeps the previous pulses and decides how loudly to say
 * it (a toast, a terminal notification while the window is unfocused).
 */
import type { ThreadEnvelope } from "../../core/types.js";
import { threadStatus } from "./shell.js";

/** The bits of a thread's state a transition is read from. */
export interface ThreadPulse {
  readonly running: boolean;
  readonly turnId: string | null;
  readonly turnState: string | null;
  readonly blocked: boolean;
}

export interface ThreadAlert {
  readonly kind: "finished" | "failed" | "blocked";
  readonly threadId: string;
  readonly title: string;
}

export function threadPulse(thread: ThreadEnvelope): ThreadPulse {
  const status = threadStatus(thread);
  return {
    running: status === "running",
    turnId: thread.latestTurn?.turnId ?? null,
    turnState: thread.latestTurn?.state ?? null,
    blocked: status === "blocked",
  };
}

/**
 * Alerts for the change from `previous` to `threads`, and the pulses to
 * compare the next snapshot against. A thread seen for the first time
 * alerts nothing: its history is not news. An interrupted turn was the
 * user's own doing, so it alerts nothing either.
 */
export function threadAlerts(
  previous: ReadonlyMap<string, ThreadPulse>,
  threads: readonly ThreadEnvelope[],
): { alerts: ThreadAlert[]; next: Map<string, ThreadPulse> } {
  const alerts: ThreadAlert[] = [];
  const next = new Map<string, ThreadPulse>();
  for (const thread of threads) {
    const pulse = threadPulse(thread);
    next.set(thread.id, pulse);
    const before = previous.get(thread.id);
    if (before === undefined) continue;
    const title = thread.title.trim() || "Thread";
    if (pulse.blocked && !before.blocked) {
      alerts.push({ kind: "blocked", threadId: thread.id, title });
      continue;
    }
    // A turn settled: the one that was running, or a whole turn that ran
    // between two snapshots.
    const settled = (before.running && !pulse.running) || (pulse.turnId !== before.turnId && !pulse.running && pulse.turnId !== null);
    if (!settled) continue;
    if (pulse.turnState === "completed") alerts.push({ kind: "finished", threadId: thread.id, title });
    else if (pulse.turnState === "error") alerts.push({ kind: "failed", threadId: thread.id, title });
  }
  return { alerts, next };
}
