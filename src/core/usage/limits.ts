/**
 * The latest subscription usage windows each provider reported (Claude's
 * session and weekly limits, Codex's primary/secondary, Grok's), merged
 * from every `rate-limits.updated` event the drivers publish: the start-up
 * probe gives the full set, live events refresh one window at a time.
 *
 * Kept per driver kind, not per thread: the limits belong to the account
 * the provider CLI is logged into, so every thread on it shares them. The
 * process that owns the sessions records them; clients read them through
 * the `usage.limits` query. Persisted next to the thread store so a fresh
 * process shows the last known numbers before its first turn.
 */
import fs from "node:fs";
import path from "node:path";

import type { ProviderUsageLimits, ProviderUsageWindow } from "../catalog/summary.js";
import type { RateLimitWindow } from "../providers/spi.js";

interface RecordedWindow {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

interface RecordedProvider {
  checkedAt: string;
  windows: RecordedWindow[];
}

const FILE_NAME = "usage-limits.json";

let recorded = new Map<string, RecordedProvider>();
let persistFile: string | null = null;

/** Where the registry persists, and loads what an earlier process left. */
export function persistUsageLimits(storeRoot: string): void {
  const file = path.join(storeRoot, FILE_NAME);
  if (persistFile === file) return;
  persistFile = file;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, RecordedProvider>;
    for (const [provider, entry] of Object.entries(raw)) {
      if (!recorded.has(provider) && entry && Array.isArray(entry.windows)) recorded.set(provider, entry);
    }
  } catch {
    // No file yet, or unreadable: start empty.
  }
}

/**
 * Merge one report into the provider's windows. A window reported without a
 * percentage (a live event that only says "allowed") keeps the last known
 * one; a window never seen with a percentage is left out.
 */
export function recordUsageWindows(provider: string, windows: ReadonlyArray<RateLimitWindow>, at: number = Date.now()): void {
  const previous = recorded.get(provider)?.windows ?? [];
  const merged = new Map(previous.map((window) => [window.id, window] as const));
  let changed = false;
  for (const window of windows) {
    const known = merged.get(window.id);
    const usedPercent = window.usedPercent ?? (window.exhausted ? 100 : known?.usedPercent);
    if (usedPercent === undefined || usedPercent === null) continue;
    merged.set(window.id, { id: window.id, label: window.label, usedPercent, resetsAt: window.resetsAt ?? known?.resetsAt ?? null });
    changed = true;
  }
  if (!changed) return;
  recorded.set(provider, { checkedAt: new Date(at).toISOString(), windows: [...merged.values()] });
  if (persistFile !== null) {
    const file = persistFile;
    const payload = JSON.stringify(Object.fromEntries(recorded), null, 2);
    void fs.promises.mkdir(path.dirname(file), { recursive: true }).then(() => fs.promises.writeFile(file, payload)).catch(() => undefined);
  }
}

/** Drivers label windows "Session", "Weekly", "Weekly – Opus", "Monthly"; the kind follows. */
function windowKind(label: string): string {
  const head = label.toLowerCase();
  if (head.startsWith("session")) return "session";
  if (head.startsWith("weekly")) return "weekly";
  if (head.startsWith("monthly")) return "monthly";
  return "other";
}

/**
 * Every provider's windows, keyed by driver kind. A window whose reset time
 * has passed reads 0% with no reset: the provider hasn't reported the new
 * one yet, but the old number no longer holds.
 */
export function usageLimitsSnapshot(now: number = Date.now()): Record<string, ProviderUsageLimits> {
  const result: Record<string, ProviderUsageLimits> = {};
  for (const [provider, entry] of recorded) {
    const windows: ProviderUsageWindow[] = entry.windows.map((window) => {
      const reset = window.resetsAt === null ? Number.NaN : Date.parse(window.resetsAt);
      const lapsed = Number.isFinite(reset) && reset <= now;
      return {
        id: window.id,
        kind: windowKind(window.label),
        label: window.label,
        usedPercent: lapsed ? 0 : window.usedPercent,
        resetsAt: lapsed ? null : window.resetsAt,
      };
    });
    const rank: Record<string, number> = { session: 0, weekly: 1, monthly: 2, other: 3 };
    windows.sort((left, right) => (rank[left.kind] ?? 3) - (rank[right.kind] ?? 3));
    result[provider] = { checkedAt: entry.checkedAt, windows, unavailable: null };
  }
  return result;
}

/**
 * The window that is spent right now for `provider`, if any: at 100% with
 * a reset still ahead. A turn that fails while one stands was stopped by
 * it, whatever its error text says — the provider only reports a limit
 * when it *changes*, so the second turn into the same wall is told nothing.
 */
export function standingLimit(
  provider: string,
  now: number = Date.now(),
): { label: string; resetsAt: string } | null {
  const entry = recorded.get(provider);
  if (!entry) return null;
  const spent = entry.windows
    .filter((window) => window.usedPercent >= 100 && window.resetsAt !== null && Date.parse(window.resetsAt) > now)
    // The soonest reset is the one that frees the account first.
    .sort((left, right) => Date.parse(left.resetsAt!) - Date.parse(right.resetsAt!));
  const first = spent[0];
  return first ? { label: first.label, resetsAt: first.resetsAt! } : null;
}

/** Tests only: forget everything and stop persisting. */
export function resetUsageLimitsForTests(): void {
  recorded = new Map();
  persistFile = null;
}
