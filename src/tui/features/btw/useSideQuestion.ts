import { useCallback, useEffect, useRef, useState } from "react";

import type { ClientApi } from "../../../server/api.js";

/** One `/btw` asked in this session. */
export interface SideQuestion {
  readonly id: number;
  readonly threadId: string;
  readonly question: string;
  readonly status: "asking" | "answered" | "failed";
  readonly answer: string | null;
  readonly error: string | null;
  /** False when the thread had no session to copy, so the answer lacks its context. */
  readonly withContext: boolean;
}

/**
 * `/btw <question>` in the composer asks a side question; a bare `/btw`
 * reopens the last one. Answers come from a copy of the thread's context
 * and are never written into the thread, so they live here, for this
 * session — the same trade Claude Code makes.
 *
 * One at a time, like Claude Code and omp: a second question while one is
 * still out is refused rather than queued, so nothing answers into a panel
 * the user has already moved on from.
 */
export function useSideQuestion(client: ClientApi, threadId: string | null): {
  current: SideQuestion | null;
  open: boolean;
  ask: (question: string) => boolean;
  reopen: () => boolean;
  close: () => void;
} {
  const [history, setHistory] = useState<readonly SideQuestion[]>([]);
  const [open, setOpen] = useState(false);
  const nextId = useRef(1);
  const current = [...history].reverse().find((entry) => entry.threadId === threadId) ?? null;

  // Another thread's answer never shows over this one.
  useEffect(() => setOpen(false), [threadId]);

  const ask = useCallback(
    (question: string): boolean => {
      const text = question.trim();
      if (threadId === null || text.length === 0) return false;
      if (history.some((entry) => entry.status === "asking")) return false;
      const id = nextId.current++;
      setHistory((entries) => [
        ...entries.slice(-19),
        { id, threadId, question: text, status: "asking", answer: null, error: null, withContext: true },
      ]);
      setOpen(true);
      void client
        .dispatch({ type: "thread.side-question", threadId, question: text })
        .then((result) => {
          setHistory((entries) =>
            entries.map((entry) =>
              entry.id === id ? { ...entry, status: "answered", answer: result.text, withContext: result.withContext } : entry,
            ),
          );
        })
        .catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause);
          setHistory((entries) => entries.map((entry) => (entry.id === id ? { ...entry, status: "failed", error: message } : entry)));
        });
      return true;
    },
    [client, threadId, history],
  );

  const reopen = useCallback((): boolean => {
    if (current === null) return false;
    setOpen(true);
    return true;
  }, [current]);

  const close = useCallback(() => setOpen(false), []);
  return { current, open: open && current !== null, ask, reopen, close };
}

/** `/btw`, `/btw question` → the question ("" for bare); anything else → null. */
export function parseSideQuestion(text: string): string | null {
  const match = /^\/btw(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (match === null) return null;
  return (match[1] ?? "").trim();
}
