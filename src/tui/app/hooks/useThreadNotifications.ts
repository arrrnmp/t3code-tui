import { useEffect, useRef } from "react";

import type { ThreadEnvelope } from "../../../core/types.js";
import type { ToastTone } from "../../hooks/useToasts.js";
import { threadAlerts, type ThreadPulse } from "../../model/notifications.js";

/**
 * Tells the user when a thread needs them: a turn finished or failed, a
 * usage limit stopped one, or the open thread is waiting on an answer. In
 * the app, a toast for threads other than the open one (whose transcript
 * already shows it); outside it, a terminal notification while the window
 * is unfocused (`notify` decides that).
 */
export function useThreadNotifications(args: {
  threads: readonly ThreadEnvelope[];
  openThreadId: string | null;
  openThreadTitle: string | null;
  pendingQuestions: number;
  pushToast: (id: string, tone: ToastTone, text: string, ms?: number) => void;
  notify: (title: string, body: string) => void;
}): void {
  const { threads, openThreadId, openThreadTitle, pendingQuestions, pushToast, notify } = args;
  const pulses = useRef<Map<string, ThreadPulse> | null>(null);
  useEffect(() => {
    // The first snapshot is history, not news.
    if (pulses.current === null) {
      pulses.current = threadAlerts(new Map(), threads).next;
      return;
    }
    const { alerts, next } = threadAlerts(pulses.current, threads);
    pulses.current = next;
    for (const alert of alerts) {
      const text =
        alert.kind === "finished"
          ? `✓ ${alert.title} finished`
          : alert.kind === "failed"
            ? `✗ ${alert.title} failed`
            : `◔ ${alert.title} hit a usage limit`;
      if (alert.threadId !== openThreadId) {
        pushToast(`thread-alert:${alert.threadId}`, alert.kind === "finished" ? "info" : alert.kind === "failed" ? "danger" : "warn", text, 5000);
      }
      notify("Moxen", text);
    }
  }, [threads, openThreadId, pushToast, notify]);

  const asked = useRef({ threadId: openThreadId, count: pendingQuestions });
  useEffect(() => {
    const previous = asked.current;
    asked.current = { threadId: openThreadId, count: pendingQuestions };
    // Switching threads is not a new question.
    if (previous.threadId !== openThreadId || pendingQuestions <= previous.count) return;
    notify("Moxen", `? ${openThreadTitle?.trim() || "A thread"} needs your answer`);
  }, [openThreadId, openThreadTitle, pendingQuestions, notify]);
}
