import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";

import type { ProviderUsageLimits } from "../../../core/catalog/summary.js";
import type { ContextBreakdown } from "../../model/sidepanel.js";
import type { ClientApi } from "../../../server/api.js";
import type { SideTab } from "../../model/sidepanel.js";

/**
 * The side panel's open tab (null: closed). The Diff tab follows the diff
 * panel's own state — opening a turn's diff shows it, closing the diff
 * closes it — the other tabs are opened and closed here. Also holds the
 * non-diff tabs' scroll pane.
 */
export function useSidePanel(diffOpen: boolean): {
  tab: SideTab | null;
  open: (tab: SideTab) => void;
  toggle: (tab: SideTab) => void;
  close: () => void;
  scrollRef: MutableRefObject<ScrollBoxRenderable | null>;
} {
  const [tab, setTab] = useState<SideTab | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  useEffect(() => {
    if (diffOpen) setTab("diff");
    else setTab((current) => (current === "diff" ? null : current));
  }, [diffOpen]);
  const open = useCallback((next: SideTab) => setTab(next), []);
  const toggle = useCallback((next: SideTab) => setTab((current) => (current === next ? null : next)), []);
  const close = useCallback(() => setTab(null), []);
  return { tab, open, toggle, close, scrollRef };
}

/** Default for `ui.contextRefreshSeconds`, when the config pins nothing. */
const CONTEXT_REFRESH_MS = 5_000;

/**
 * The open thread's live context breakdown, re-read while the Context tab
 * is showing (and whenever `refreshKey` moves — a turn settling, say).
 * Null until the first answer, or when no session runs here.
 */
export function useContextBreakdown(
  client: ClientApi,
  threadId: string | null,
  active: boolean,
  refreshKey: unknown,
  intervalMs: number = CONTEXT_REFRESH_MS,
): { breakdown: ContextBreakdown | null; live: boolean } {
  const [state, setState] = useState<{ breakdown: ContextBreakdown | null; live: boolean }>({ breakdown: null, live: false });
  useEffect(() => {
    setState({ breakdown: null, live: false });
  }, [threadId]);
  useEffect(() => {
    if (!active || threadId === null) return;
    let cancelled = false;
    const read = (): void => {
      void client
        .query({ type: "thread.context", threadId })
        .then((result) => {
          if (!cancelled) setState({ breakdown: result.breakdown, live: result.live });
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, threadId, active, refreshKey, intervalMs]);
  return state;
}

/** Default for `ui.usageRefreshSeconds` (live events refresh the server's copy; this just picks it up). */
const USAGE_REFRESH_MS = 20_000;

/**
 * The account's plan usage per driver kind, as the server last recorded it,
 * re-read on a slow timer and whenever `refreshKey` moves (a turn settling).
 */
export function usePlanUsage(
  client: ClientApi,
  refreshKey: unknown,
  intervalMs: number = USAGE_REFRESH_MS,
): Readonly<Record<string, ProviderUsageLimits>> {
  const [limits, setLimits] = useState<Readonly<Record<string, ProviderUsageLimits>>>({});
  useEffect(() => {
    let cancelled = false;
    const read = (): void => {
      void client
        .query({ type: "usage.limits" })
        .then((result) => {
          if (!cancelled) setLimits(result.providers);
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, refreshKey, intervalMs]);
  return limits;
}
