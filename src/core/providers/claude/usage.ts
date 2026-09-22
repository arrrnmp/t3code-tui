/**
 * Claude usage accounting, from the SDK stream only (no header parsing).
 * Assistant-frame usage accumulates into totals (input / cache_read /
 * cache_create / output / thinking, main-agent scope); `total_cost_usd`
 * from result messages is a running total — replaced, never summed.
 * Quota windows: `get_usage` probe → Session (5h) + Weekly (7d) + per-model
 * Weekly rows; live `rate_limit_event`s land on the same ids. Absent
 * windows on a successful probe = API-key account. See DECOUPLE.md §5.
 */
import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

import type { RateLimitWindow } from "../spi.js";

export interface UsageTotals {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheCreate: number;
  readonly output: number;
  readonly thinking: number;
  /** Running total from the latest result; an estimate, not a bill. */
  readonly costUsd: number;
}

export function emptyUsage(): UsageTotals {
  return { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0, costUsd: 0 };
}

interface ApiUsageShape {
  readonly input_tokens?: number;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
  readonly output_tokens?: number;
}

function num(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Add one assistant-frame usage payload to running totals. */
export function addFrameUsage(totals: UsageTotals, usage: ApiUsageShape | null | undefined): UsageTotals {
  if (!usage) return totals;
  return {
    ...totals,
    input: totals.input + num(usage.input_tokens),
    cacheRead: totals.cacheRead + num(usage.cache_read_input_tokens),
    cacheCreate: totals.cacheCreate + num(usage.cache_creation_input_tokens),
    output: totals.output + num(usage.output_tokens),
  };
}

const FIVE_HOUR_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;

function windowIdForType(rateLimitType: string, overageIncludedName?: string): string {
  if (rateLimitType === "five_hour") return "session";
  if (rateLimitType === "seven_day") return "weekly";
  if (rateLimitType === "seven_day_overage_included") {
    const slug = (overageIncludedName ?? "overage").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return `seven_day_${slug}`;
  }
  return rateLimitType;
}

function labelForType(rateLimitType: string, overageIncludedName?: string): string {
  if (rateLimitType === "five_hour") return "Session";
  if (rateLimitType === "seven_day") return "Weekly";
  if (rateLimitType === "seven_day_overage_included") {
    return `Weekly – ${overageIncludedName ?? "overage"}`;
  }
  if (rateLimitType === "seven_day_opus") return "Weekly – Opus";
  if (rateLimitType === "seven_day_sonnet") return "Weekly – Sonnet";
  return rateLimitType;
}

function epochToIso(resetsAt: number | undefined): string | null {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) return null;
  return new Date(resetsAt * 1000).toISOString();
}

/** Map one streamed `rate_limit_event` to windows + park decision. */
export function mapRateLimitEvent(
  info: SDKRateLimitInfo,
  overageIncludedName?: string,
): { windows: RateLimitWindow[]; blocked: boolean; rateLimitType: string } {
  const rateLimitType = info.rateLimitType ?? "unknown";
  const overageAllowed =
    info.overageStatus === "allowed" ||
    info.overageStatus === "allowed_warning" ||
    info.isUsingOverage === true ||
    info.overageInUse === true;
  const blocked = info.status === "rejected" && !overageAllowed;
  const windows: RateLimitWindow[] = [
    {
      id: windowIdForType(rateLimitType, overageIncludedName),
      label: labelForType(rateLimitType, overageIncludedName),
      resetsAt: epochToIso(info.resetsAt),
      exhausted: blocked,
    },
  ];
  return { windows, blocked, rateLimitType };
}

/** "paused until Xh Ym" for a rejected window; null when unparseable. */
export function describePauseUntil(resetsAtIso: string | null, nowMs: number): string | null {
  if (!resetsAtIso) return null;
  const parsed = Date.parse(resetsAtIso);
  if (!Number.isFinite(parsed) || parsed <= nowMs) return null;
  const minutes = Math.floor((parsed - nowMs) / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours <= 0) return `paused until ${minutes}m`;
  return `paused until ${hours}h ${minutes % 60}m`;
}

export interface UsageProbeWindow {
  readonly id: string;
  readonly label: string;
  readonly windowDurationMins: number;
  readonly usedPercent: number;
  readonly resetsAt: string | null;
}

export interface UsageProbeResult {
  readonly available: boolean;
  readonly subscriptionType: string | null;
  readonly windows: UsageProbeWindow[];
  readonly costUsd: number;
}

function clampPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

interface ProbeRateLimits {
  readonly five_hour?: { utilization?: number | null; resets_at?: string | null } | null;
  readonly seven_day?: { utilization?: number | null; resets_at?: string | null } | null;
  readonly rate_limits?: unknown;
  readonly model_scoped?: ReadonlyArray<{
    readonly display_name?: string;
    readonly utilization?: number | null;
    readonly resets_at?: string | null;
  }> | null;
}

interface ProbeResponseShape {
  readonly session?: { total_cost_usd?: number };
  readonly subscription_type?: string | null;
  readonly rate_limits_available?: boolean;
  readonly rate_limits?: ProbeRateLimits | null;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Map the `get_usage` probe response to windows (null = API-key account). */
export function mapUsageProbe(response: ProbeResponseShape | null): UsageProbeResult {
  if (!response || response.rate_limits_available !== true || !response.rate_limits) {
    return {
      available: false,
      subscriptionType: response?.subscription_type ?? null,
      windows: [],
      costUsd: num(response?.session?.total_cost_usd),
    };
  }
  const limits = response.rate_limits;
  const windows: UsageProbeWindow[] = [];
  if (limits.five_hour) {
    windows.push({
      id: "session",
      label: "Session",
      windowDurationMins: FIVE_HOUR_MINS,
      usedPercent: clampPercent(limits.five_hour.utilization),
      resetsAt: isoOrNull(limits.five_hour.resets_at),
    });
  }
  if (limits.seven_day) {
    windows.push({
      id: "weekly",
      label: "Weekly",
      windowDurationMins: WEEK_MINS,
      usedPercent: clampPercent(limits.seven_day.utilization),
      resetsAt: isoOrNull(limits.seven_day.resets_at),
    });
  }
  for (const scoped of limits.model_scoped ?? []) {
    const display = scoped.display_name ?? "model";
    windows.push({
      id: `seven_day_${display.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      label: `Weekly – ${display}`,
      windowDurationMins: WEEK_MINS,
      usedPercent: clampPercent(scoped.utilization),
      resetsAt: isoOrNull(scoped.resets_at),
    });
  }
  return {
    available: true,
    subscriptionType: response.subscription_type ?? null,
    windows,
    costUsd: num(response.session?.total_cost_usd),
  };
}
