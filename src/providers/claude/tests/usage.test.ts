import { describe, expect, it } from "vitest";

import {
  addFrameUsage,
  describePauseUntil,
  emptyUsage,
  mapRateLimitEvent,
  mapUsageProbe,
} from "../usage.js";

describe("claude usage", () => {
  it("accumulates frame usage without double counting", () => {
    const totals = addFrameUsage(emptyUsage(), {
      input_tokens: 10,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 2,
      output_tokens: 7,
    });
    expect(totals).toMatchObject({ input: 10, cacheRead: 4, cacheCreate: 2, output: 7, costUsd: 0 });
    const again = addFrameUsage(totals, null);
    expect(again).toBe(totals);
  });

  it("maps streamed rate-limit events to windows with park decisions", () => {
    const allowed = mapRateLimitEvent({ status: "allowed", rateLimitType: "five_hour" });
    expect(allowed.windows[0]).toMatchObject({ id: "session", label: "Session" });
    expect(allowed.blocked).toBe(false);

    const rejected = mapRateLimitEvent({
      status: "rejected",
      rateLimitType: "seven_day",
      resetsAt: 1_788_000_000,
    });
    expect(rejected.windows[0]).toMatchObject({ id: "weekly", exhausted: true });
    expect(rejected.blocked).toBe(true);

    const overage = mapRateLimitEvent({
      status: "rejected",
      rateLimitType: "seven_day",
      overageStatus: "allowed",
    });
    expect(overage.blocked).toBe(false);
  });

  it("describes pause durations", () => {
    const now = Date.parse("2026-09-20T12:00:00.000Z");
    expect(describePauseUntil("2026-09-20T14:30:00.000Z", now)).toBe("paused until 2h 30m");
    expect(describePauseUntil("2026-09-20T12:05:00.000Z", now)).toBe("paused until 5m");
    expect(describePauseUntil(null, now)).toBeNull();
    expect(describePauseUntil("2026-09-20T11:00:00.000Z", now)).toBeNull();
  });

  it("maps the get_usage probe and treats missing windows as API-key", () => {
    expect(mapUsageProbe(null).available).toBe(false);
    expect(
      mapUsageProbe({ rate_limits_available: false, subscription_type: null }).available,
    ).toBe(false);

    const probed = mapUsageProbe({
      session: { total_cost_usd: 1.5 },
      subscription_type: "max",
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 20, resets_at: "2026-09-20T17:00:00.000Z" },
        seven_day: { utilization: 55, resets_at: "2026-09-27T00:00:00.000Z" },
        model_scoped: [{ display_name: "Opus", utilization: 10, resets_at: null }],
      },
    });
    expect(probed.available).toBe(true);
    expect(probed.subscriptionType).toBe("max");
    expect(probed.costUsd).toBe(1.5);
    expect(probed.windows.map((window) => window.id)).toEqual([
      "session",
      "weekly",
      "seven_day_opus",
    ]);
  });
});
