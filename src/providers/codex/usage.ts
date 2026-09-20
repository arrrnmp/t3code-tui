/**
 * Codex usage accounting. `thread/tokenUsage/updated` carries thread-wide
 * cumulative totals, so per-turn usage is a baseline delta (resets and
 * backwards totals fall back to the `last` breakdown). Rate windows are
 * positional: primary/secondary with duration-derived kinds, ignoring
 * non-`codex` limit ids; Free/Go plans without durations fall back to a
 * monthly allowance. Limit-exceeded errors are rewritten to "resets in X".
 */
import type { RateLimitWindow } from "../spi.js";
import { codexRateWindowOf } from "./protocol.js";
import type { CodexTokenBreakdown } from "./protocol.js";

const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;
const MONTH_MINS = 30 * 24 * 60;

function kindForDuration(mins: number): "session" | "weekly" | "monthly" {
  if (mins >= MONTH_MINS) return "monthly";
  if (mins >= WEEK_MINS) return "weekly";
  return "session";
}

function labelForKind(kind: "session" | "weekly" | "monthly"): string {
  return kind === "session" ? "Session" : kind === "weekly" ? "Weekly" : "Monthly";
}

function isoFromEpochSeconds(value: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

export interface CodexRateSnapshot {
  readonly limitId?: string | undefined;
  readonly planType?: string | undefined;
  readonly primary?: unknown;
  readonly secondary?: unknown;
}

/** Map a rate-limits snapshot to windows (empty when not ours to show). */
export function codexWindowsOf(snapshot: CodexRateSnapshot): RateLimitWindow[] {
  if (snapshot.limitId && snapshot.limitId !== "codex") return [];
  const monthlyPlan = snapshot.planType === "free" || snapshot.planType === "go";
  const positions = [
    { id: "primary", raw: snapshot.primary, fallback: monthlyPlan ? MONTH_MINS : SESSION_MINS },
    { id: "secondary", raw: snapshot.secondary, fallback: WEEK_MINS },
  ] as const;
  const windows: RateLimitWindow[] = [];
  for (const { id, raw, fallback } of positions) {
    const window = codexRateWindowOf(raw);
    if (!window || window.usedPercent === null) continue;
    const kind = kindForDuration(window.windowDurationMins ?? fallback);
    windows.push({
      id,
      label: labelForKind(kind),
      resetsAt: isoFromEpochSeconds(window.resetsAt),
      exhausted: window.usedPercent >= 100,
    });
  }
  return windows;
}

export function zeroBreakdown(): CodexTokenBreakdown {
  return { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, reasoning: 0 };
}

function subBreakdown(current: CodexTokenBreakdown, previous: CodexTokenBreakdown): CodexTokenBreakdown {
  return {
    input: current.input - previous.input,
    cacheRead: current.cacheRead - previous.cacheRead,
    cacheCreate: current.cacheCreate - previous.cacheCreate,
    output: current.output - previous.output,
    reasoning: current.reasoning - previous.reasoning,
  };
}

/**
 * Baseline-delta accumulator: totals are thread-wide, so each update moves
 * the baseline and only the delta counts toward the live turn. Backwards
 * totals (compaction/rotation) reset the baseline and yield zero.
 */
export class CodexUsageAccumulator {
  private baseline: CodexTokenBreakdown | null = null;
  private turnTotals = new Map<string, CodexTokenBreakdown>();

  observe(turnId: string, total: CodexTokenBreakdown, last: CodexTokenBreakdown): CodexTokenBreakdown {
    const previous = this.baseline;
    this.baseline = total;
    // Without a baseline the `last` breakdown is the only per-turn signal.
    const delta = !previous ? { ...last } : subBreakdown(total, previous);
    const regressed =
      previous !== null &&
      (total.input < previous.input ||
        total.cacheRead < previous.cacheRead ||
        total.output < previous.output ||
        total.reasoning < previous.reasoning);
    const counted = regressed ? zeroBreakdown() : delta;
    const current = this.turnTotals.get(turnId) ?? zeroBreakdown();
    const next: CodexTokenBreakdown = {
      input: current.input + Math.max(0, counted.input),
      cacheRead: current.cacheRead + Math.max(0, counted.cacheRead),
      cacheCreate: current.cacheCreate + Math.max(0, counted.cacheCreate),
      output: current.output + Math.max(0, counted.output),
      reasoning: current.reasoning + Math.max(0, counted.reasoning),
    };
    this.turnTotals.set(turnId, next);
    return next;
  }

  take(turnId: string): CodexTokenBreakdown {
    const totals = this.turnTotals.get(turnId) ?? zeroBreakdown();
    this.turnTotals.delete(turnId);
    return totals;
  }

  peek(turnId: string): CodexTokenBreakdown {
    return { ...(this.turnTotals.get(turnId) ?? zeroBreakdown()) };
  }
}

const LIMIT_EXCEEDED_PATTERNS: readonly RegExp[] = [/usage.?limit.?exceeded/i, /rate.?limit/i, /429/];

/** Rewrite limit errors to "resets in X" when a reset time is known. */
export function rewriteLimitError(message: string, resetsAtIso: string | null): string {
  if (!LIMIT_EXCEEDED_PATTERNS.some((pattern) => pattern.test(message))) return message;
  if (!resetsAtIso) return "Usage limit exceeded.";
  const parsed = Date.parse(resetsAtIso);
  if (!Number.isFinite(parsed)) return "Usage limit exceeded.";
  const minutes = Math.max(1, Math.round((parsed - Date.now()) / 60_000));
  if (minutes < 60) return `Usage limit exceeded; resets in ${minutes}m.`;
  const hours = Math.floor(minutes / 60);
  return `Usage limit exceeded; resets in ${hours}h ${minutes % 60}m.`;
}
