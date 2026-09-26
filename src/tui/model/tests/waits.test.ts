import { describe, expect, it } from "vitest";

import type { ActivityEnvelope } from "../../../core/types.js";
import type { TimelineEntry } from "../thread.js";
import { groupTurns } from "../turns.js";
import { isWaiting, waitSpans, waitedMs, workingMs } from "../waits.js";

const T0 = Date.parse("2026-09-26T10:00:00.000Z");
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString();

function activity(kind: string, seconds: number, requestId: string, turnId: string | null = "turn-1"): ActivityEnvelope {
  return { id: `${kind}:${requestId}`, tone: "info", kind, summary: kind, turnId, createdAt: at(seconds), payload: { requestId } };
}

function entry(id: string, seconds: number, kind: TimelineEntry["kind"] = "activity"): TimelineEntry {
  return {
    id,
    at: at(seconds),
    turnId: "turn-1",
    kind,
    text: id,
    streaming: false,
    tone: null,
    activityKind: kind === "activity" ? "tool" : null,
    message: null,
    activity: null,
    checkpoint: null,
    editStats: null,
    proposedPlan: null,
  };
}

describe("waitSpans", () => {
  it("pairs a question with its answer, and a permission prompt with its decision", () => {
    const waits = waitSpans([
      activity("user-input.requested", 10, "q1"),
      activity("user-input.resolved", 70, "q1"),
      activity("permission.requested", 100, "p1"),
      activity("permission.resolved", 130, "p1"),
    ]);
    expect(waits.get("turn-1")).toEqual([
      { start: T0 + 10_000, end: T0 + 70_000 },
      { start: T0 + 100_000, end: T0 + 130_000 },
    ]);
  });

  it("leaves a wait open until it is answered", () => {
    const spans = waitSpans([activity("user-input.requested", 10, "q1")]).get("turn-1") ?? [];
    expect(spans).toEqual([{ start: T0 + 10_000, end: null }]);
    expect(isWaiting(spans)).toBe(true);
  });

  it("keys waits by the turn that asked, and skips rows it cannot place", () => {
    const waits = waitSpans([
      activity("user-input.requested", 5, "a", "turn-a"),
      activity("user-input.requested", 6, "b", "turn-b"),
      activity("user-input.requested", 7, "orphan", null),
      { ...activity("user-input.requested", 8, "x"), payload: {} },
    ]);
    expect([...waits.keys()].sort()).toEqual(["turn-a", "turn-b"]);
  });
});

describe("waitedMs", () => {
  it("clips to the window, runs an open wait to its end, and never counts a second twice", () => {
    const spans = [
      { start: T0 + 10_000, end: T0 + 40_000 },
      // Overlaps the first: two questions parked at once.
      { start: T0 + 30_000, end: T0 + 50_000 },
      { start: T0 + 90_000, end: null },
    ];
    expect(waitedMs(spans, T0, T0 + 100_000)).toBe(40_000 + 10_000);
    expect(waitedMs(spans, T0 + 20_000, T0 + 35_000)).toBe(15_000);
    expect(waitedMs([], T0, T0 + 1000)).toBe(0);
  });

  it("subtracts waits from the wall time", () => {
    expect(workingMs([{ start: T0 + 10_000, end: T0 + 70_000 }], T0, T0 + 100_000)).toBe(40_000);
  });
});

describe("groupTurns with waits", () => {
  it("reports working time, not wall time, for a turn that asked a question", () => {
    const entries = [entry("p", 0, "user"), entry("tool", 5), entry("reply", 100, "assistant")];
    const waits = waitSpans([activity("user-input.requested", 10, "q1"), activity("user-input.resolved", 70, "q1")]);
    const [group] = groupTurns(entries, waits);
    expect(group?.durationMs).toBe(40_000);
    expect(group?.waits).toHaveLength(1);
  });

  it("is unchanged for a turn that never waited", () => {
    const [group] = groupTurns([entry("p", 0, "user"), entry("reply", 30, "assistant")]);
    expect(group?.durationMs).toBe(30_000);
    expect(group?.waits).toEqual([]);
  });
});
