import { useMemo, useState } from "react";

import type { ClientApi } from "../../../server/api.js";
import { USAGE_CONTINUE_GRACE_MS, USAGE_CONTINUE_PROMPT } from "../../../core/threads/views.js";
import { detectUsageLimit, type ThreadState } from "../../model/thread.js";

export interface UsageLimitBanner {
  /** Per thread and reset: dismissing one hides it until the next hit. */
  key: string;
  /** "Session", "Weekly", … ; null when the provider didn't say. */
  windowLabel: string | null;
  resetsAt: Date | null;
  /** Met gracefully: the turn is finishing on a small allowance, not cut off. */
  wrapUp: boolean;
  /** The continue already waiting for the reset (scheduled here or automatically). */
  continueAt: string | null;
  continueTurnId: string | null;
}

/**
 * The banner above the composer while the open thread is stopped by a plan
 * usage limit: when it resets, and either the offer to continue then or the
 * continue already waiting (with a way to call it off). It stays while a
 * continue waits, even past the reset, until that continue runs.
 */
export function useUsageLimitBanner(params: {
  client: ClientApi;
  threadState: ThreadState;
  openThreadId: string | null;
  now: number;
  setError: (message: string) => void;
  /** Opens a thread by id — where "continue in a new thread" lands you. */
  openThread?: (threadId: string) => void;
}): {
  banner: UsageLimitBanner | null;
  scheduleContinue: () => void;
  continueInNewThread: () => void;
  cancelContinue: () => void;
  dismiss: () => void;
} {
  const { client, threadState, openThreadId, now, setError, openThread } = params;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const limit = useMemo(() => detectUsageLimit(threadState, now), [threadState, now]);
  const pending = (threadState.thread?.queuedTurns ?? []).find((queued) => queued.scheduleReason === "usage-reset") ?? null;

  let banner: UsageLimitBanner | null = null;
  if (openThreadId !== null && (limit !== null || pending !== null)) {
    const key = `${openThreadId}:${limit?.resetsAt?.toISOString() ?? pending?.turnId ?? ""}`;
    if (key !== dismissedKey || pending !== null) {
      banner = {
        key,
        windowLabel: limit?.label ?? null,
        resetsAt: limit?.resetsAt ?? null,
        wrapUp: limit?.wrapUp ?? false,
        continueAt: pending?.scheduledFor ?? null,
        continueTurnId: pending?.turnId ?? null,
      };
    }
  }

  const scheduleContinue = () => {
    const resetsAt = banner?.resetsAt ?? null;
    if (openThreadId === null || resetsAt === null) return;
    void client
      .dispatch({
        type: "thread.turn.start",
        threadId: openThreadId,
        message: { text: USAGE_CONTINUE_PROMPT },
        scheduledFor: new Date(resetsAt.getTime() + USAGE_CONTINUE_GRACE_MS).toISOString(),
        scheduleReason: "usage-reset",
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  const cancelContinue = () => {
    const turnId = banner?.continueTurnId ?? null;
    if (openThreadId === null || turnId === null) return;
    void client
      .dispatch({ type: "thread.turn.interrupt", threadId: openThreadId, turnId })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  /**
   * Carry on in a fresh thread rather than this one: the same project,
   * model and checkout, opened with a handoff written from this thread.
   * While the limit still stands, the handoff waits for the reset (the
   * account is the same one); once it has passed, it goes at once.
   */
  const continueInNewThread = () => {
    if (openThreadId === null) return;
    const resetsAt = banner?.resetsAt ?? null;
    const scheduledFor =
      resetsAt !== null && resetsAt.getTime() > Date.now()
        ? new Date(resetsAt.getTime() + USAGE_CONTINUE_GRACE_MS).toISOString()
        : undefined;
    void client
      .dispatch({ type: "thread.continue", threadId: openThreadId, ...(scheduledFor ? { scheduledFor } : {}) })
      .then((result) => openThread?.(result.threadId))
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };
  const dismiss = () => setDismissedKey(banner?.key ?? null);
  return { banner, scheduleContinue, continueInNewThread, cancelContinue, dismiss };
}
