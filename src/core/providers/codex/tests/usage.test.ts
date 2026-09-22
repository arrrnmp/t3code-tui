import { describe, expect, it } from "vitest";

import {
  CodexUsageAccumulator,
  codexWindowsOf,
  rewriteLimitError,
} from "../usage.js";

describe("codex usage", () => {
  it("maps primary/secondary windows with duration kinds", () => {
    const windows = codexWindowsOf({
      limitId: "codex",
      primary: { usedPercent: 12, resetsAt: 1_788_000_000, windowDurationMins: 300 },
      secondary: { usedPercent: 34, resetsAt: 1_788_060_000, windowDurationMins: 10080 },
    });
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ id: "primary", label: "Session", exhausted: false });
    expect(windows[1]).toMatchObject({ id: "secondary", label: "Weekly" });
    expect(windows[0]!.resetsAt).toBe(new Date(1_788_000_000 * 1000).toISOString());
  });

  it("falls back to monthly for free plans and ignores foreign limits", () => {
    const monthly = codexWindowsOf({ planType: "free", primary: { usedPercent: 50 } });
    expect(monthly[0]).toMatchObject({ label: "Monthly" });
    expect(codexWindowsOf({ limitId: "spark", primary: { usedPercent: 90 } })).toEqual([]);
    expect(codexWindowsOf({ primary: { usedPercent: null } })).toEqual([]);
  });

  it("accumulates baseline deltas and resets on regression", () => {
    const accumulator = new CodexUsageAccumulator();
    const first = accumulator.observe(
      "t-1",
      { input: 100, cacheRead: 10, cacheCreate: 0, output: 50, reasoning: 5 },
      { input: 8, cacheRead: 0, cacheCreate: 0, output: 4, reasoning: 0 },
    );
    expect(first).toMatchObject({ input: 8, output: 4 });
    const second = accumulator.observe(
      "t-1",
      { input: 150, cacheRead: 10, cacheCreate: 0, output: 70, reasoning: 5 },
      { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, reasoning: 0 },
    );
    expect(second).toMatchObject({ input: 58, output: 24 });
    // Regression (post-compaction totals) counts zero, not negative.
    const third = accumulator.observe(
      "t-1",
      { input: 20, cacheRead: 0, cacheCreate: 0, output: 5, reasoning: 0 },
      { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, reasoning: 0 },
    );
    expect(third).toMatchObject({ input: 58, output: 24 });
    expect(accumulator.take("t-1")).toMatchObject({ input: 58 });
    expect(accumulator.take("t-1")).toMatchObject({ input: 0 });
  });

  it("rewrites limit errors with reset times", () => {
    expect(rewriteLimitError("boom", null)).toBe("boom");
    expect(rewriteLimitError("usage limit exceeded", null)).toBe("Usage limit exceeded.");
    const resetsAt = new Date(Date.now() + 90 * 60_000).toISOString();
    expect(rewriteLimitError("Usage limit exceeded", resetsAt)).toBe(
      "Usage limit exceeded; resets in 1h 30m.",
    );
  });
});
