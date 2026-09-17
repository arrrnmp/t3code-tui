import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "info" | "warn" | "danger";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  tone: ToastTone;
  text: string;
  action: ToastAction | null;
}

/**
 * Small floating notices (quit-armed, dispatch errors, usage-limit blocks,
 * copy confirmations, ...). `push` upserts by `id`, so a reactive condition
 * (e.g. "is the thread usage-limited") can call it every render without
 * piling up duplicates — call `dismiss(id)` once the condition clears. `ms`
 * auto-dismisses after that many ms; omit it for a toast that only goes away
 * via an explicit `dismiss` (or the next `push` for the same id).
 */
export function useToasts(): {
  toasts: Toast[];
  push: (id: string, tone: ToastTone, text: string, ms?: number, action?: ToastAction) => void;
  dismiss: (id: string) => void;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (id: string, tone: ToastTone, text: string, ms?: number, action?: ToastAction) => {
      setToasts((current) => [...current.filter((toast) => toast.id !== id), { id, tone, text, action: action ?? null }]);
      const existing = timers.current.get(id);
      if (existing !== undefined) clearTimeout(existing);
      if (ms === undefined) {
        timers.current.delete(id);
        return;
      }
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms),
      );
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  return { toasts, push, dismiss };
}
