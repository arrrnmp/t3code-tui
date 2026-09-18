import { describe, expect, it } from "vitest";

import {
  clockTime,
  formatContextUsage,
  formatDuration,
  formatTokenCount,
  groupTurns,
  proportionalTarget,
  segmentWork,
  summarizeWork,
} from "./turns.js";
import type { TimelineEntry } from "./thread.js";

function entry(overrides: Partial<TimelineEntry> & { id: string }): TimelineEntry {
  return {
    at: "2026-09-16T02:00:00.000Z",
    turnId: "turn-1",
    kind: "activity",
    text: "",
    streaming: false,
    tone: null,
    activityKind: null,
    message: null,
    activity: null,
    checkpoint: null,
    editStats: null,
    proposedPlan: null,
    ...overrides,
  };
}

describe("summarizeWork", () => {
  const toolEntry = (id: string, kind: string, payload: Record<string, unknown>): TimelineEntry =>
    entry({
      id,
      kind: "activity",
      activityKind: kind,
      activity: {
        id,
        tone: "tool",
        kind,
        summary: kind,
        turnId: "turn-1",
        createdAt: "2026-09-16T02:00:00.000Z",
        payload,
      } as unknown as TimelineEntry["activity"],
    });

  const commandPayload = (command: string): Record<string, unknown> => ({
    itemType: "command_execution",
    toolCallId: `call-${command}`,
    status: "completed",
    title: command,
    detail: "",
    data: {
      tool: "bash",
      state: { status: "completed", input: { command }, metadata: { exit: 0 }, time: { start: 1, end: 2 } },
    },
  });

  const readPayload = (path: string): Record<string, unknown> => ({
    itemType: "dynamic_tool_call",
    toolCallId: `read-${path}`,
    status: "completed",
    title: "Tool call",
    detail: "",
    data: { toolName: "Read", input: { file_path: path } },
  });

  it("aggregates every tool type into one line, highest count first", () => {
    const entries = [
      toolEntry("c1", "tool.completed", commandPayload("bun install")),
      toolEntry("c2", "tool.completed", commandPayload("bun run check")),
      toolEntry("r1", "tool.completed", readPayload("a.ts")),
      toolEntry("q1", "user-input.requested", {
        requestId: "req_1",
        questions: [{ id: "q1", header: "Next", question: "What next?", options: [] }],
      }),
    ];
    expect(summarizeWork(entries)).toBe("Ran 2 commands, read 1 file, asked 1 question");
  });

  it("tells created files apart from updated ones", () => {
    const updated = toolEntry("f1", "tool.completed", {
      itemType: "file_change",
      toolCallId: "call-f1",
      status: "completed",
      title: "a.ts",
      detail: "",
      data: {
        tool: "Edit",
        files: [{ path: "a.ts" }],
        state: { status: "completed", input: { file_path: "a.ts", old_string: "a\n", new_string: "b\n" } },
      },
    });
    const created = toolEntry("f2", "tool.completed", {
      itemType: "file_change",
      toolCallId: "call-f2",
      status: "completed",
      title: "b.ts",
      detail: "",
      data: {
        tool: "Write",
        files: [{ path: "b.ts" }],
        state: { status: "completed", input: { file_path: "b.ts", content: "hello\n" } },
      },
    });
    expect(summarizeWork([updated, created])).toBe("Updated 1 file, created 1 new file");
  });

  it("skips notes and returns null when nothing countable ran", () => {
    const note = toolEntry("n1", "runtime.warning", { detail: "quota wobble" });
    expect(summarizeWork([note])).toBeNull();
    expect(summarizeWork([])).toBeNull();
  });
});

describe("segmentWork", () => {
  const tool = (id: string): TimelineEntry => entry({ id, kind: "activity" });
  const msg = (id: string): TimelineEntry => entry({ id, kind: "assistant", text: id });

  it("closes a segment at every assistant message, trailing tools stay open", () => {
    const closing = msg("m2");
    const segments = segmentWork([tool("a"), tool("b"), msg("m1"), tool("c")], closing);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.tools.map((row) => row.id)).toEqual(["a", "b"]);
    expect(segments[0]?.message?.id).toBe("m1");
    expect(segments[1]?.tools.map((row) => row.id)).toEqual(["c"]);
    expect(segments[1]?.message?.id).toBe("m2");
  });

  it("leaves the trailing segment open without a closing reply", () => {
    const segments = segmentWork([tool("a"), msg("m1"), tool("b")], null);
    expect(segments).toHaveLength(2);
    expect(segments[1]?.message).toBeNull();
  });

  it("bounds nothing when the work ends with a message already", () => {
    const segments = segmentWork([tool("a"), msg("m1")], msg("m2"));
    expect(segments).toHaveLength(1);
    expect(segments[0]?.message?.id).toBe("m1");
  });

  it("returns no segments for empty work", () => {
    expect(segmentWork([], msg("m2"))).toEqual([]);
    expect(segmentWork([], null)).toEqual([]);
  });
});

describe("groupTurns", () => {
  it("holds streaming text as live output, never as the closing reply", () => {
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go" }),
      entry({ id: "m1", kind: "assistant", text: "partial…", streaming: true }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reply).toBeNull();
    expect(groups[0]?.live).toMatchObject({ id: "m1", text: "partial…" });
  });

  it("promotes the final message for the same id into the reply", () => {
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go" }),
      entry({ id: "m1", kind: "assistant", text: "partial…", streaming: true }),
      entry({ id: "m1", kind: "assistant", text: "done.", streaming: false }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.live).toBeNull();
    expect(groups[0]?.reply).toMatchObject({ id: "m1", text: "done." });
  });

  it("demotes a superseded finished reply into work", () => {
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go" }),
      entry({ id: "m1", kind: "assistant", text: "first.", streaming: false }),
      entry({ id: "m2", kind: "assistant", text: "second.", streaming: false }),
    ]);
    expect(groups[0]?.reply).toMatchObject({ id: "m2" });
    expect(groups[0]?.work.map((row) => row.id)).toEqual(["m1"]);
  });

  it("merges a same-turn follow-up (a nudge) into the open group instead of resetting it", () => {
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go", at: "2026-09-16T02:00:00.000Z" }),
      entry({ id: "a1", kind: "activity", at: "2026-09-16T02:05:00.000Z" }),
      // Sent while the turn is still running: same turnId, much later timestamp.
      entry({ id: "u2", kind: "user", text: "also do X", at: "2026-09-16T02:09:00.000Z" }),
      entry({ id: "m1", kind: "assistant", text: "done.", streaming: false, at: "2026-09-16T02:09:43.000Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.prompts.map((row) => row.id)).toEqual(["u1", "u2"]);
    // Elapsed spans from the very first prompt, not the nudge — a nudge must
    // never restart the turn's clock.
    expect(groups[0]?.startedAt).toBe("2026-09-16T02:00:00.000Z");
    expect(groups[0]?.durationMs).toBe(9 * 60_000 + 43_000);
  });

  // A nudge sent after the model had already replied once (thinking it was
  // done) used to leave that stale reply sitting in `group.reply` forever —
  // only a second *textual* reply ever demoted it, not a nudge. The stale
  // reply then rendered on next to a brand-new "Worked for..." fold for the
  // post-nudge work, looking like two turns happening at once.
  it("demotes a reply once a same-turn nudge lands after it", () => {
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go", at: "2026-09-16T02:00:00.000Z" }),
      entry({ id: "m1", kind: "assistant", text: "Done!", streaming: false, at: "2026-09-16T02:01:00.000Z" }),
      entry({ id: "u2", kind: "user", text: "actually also do X", at: "2026-09-16T02:05:00.000Z" }),
      entry({ id: "a1", kind: "activity", at: "2026-09-16T02:06:00.000Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reply).toBeNull();
    expect(groups[0]?.work.map((row) => row.id)).toEqual(["m1", "a1"]);
  });

  // Deliberately *not* a bug: an ordinary turn often explains itself in text
  // and then keeps working with no final wrap-up line (t3code-cli's own
  // sessions do this constantly) — that explanation must stay the visible
  // reply. Only a nudge, or the model actually sending a second reply,
  // proves the first one was superseded.
  it("keeps a reply visible when only ordinary work (no nudge) follows it", () => {
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go", at: "2026-09-16T02:00:00.000Z" }),
      entry({ id: "m1", kind: "assistant", text: "Here's the plan.", streaming: false, at: "2026-09-16T02:01:00.000Z" }),
      entry({ id: "a1", kind: "activity", at: "2026-09-16T02:05:00.000Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reply).toMatchObject({ id: "m1" });
    expect(groups[0]?.work.map((row) => row.id)).toEqual(["a1"]);
  });

  it("still opens a new group for a user prompt on a different turn", () => {
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go", turnId: "turn-1" }),
      entry({ id: "m1", kind: "assistant", text: "done.", streaming: false, turnId: "turn-1" }),
      entry({ id: "u2", kind: "user", text: "next", turnId: "turn-2" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[1]?.prompts.map((row) => row.id)).toEqual(["u2"]);
  });

  it("keeps a turn-diff in its own turn group instead of a foreign one", () => {
    const checkpoint = { turnId: "turn-9", checkpointTurnCount: 9, status: "ready", files: [] };
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go", turnId: "turn-1" }),
      // System event with no turn — previously absorbed the diff below.
      entry({ id: "sys", kind: "activity", turnId: null }),
      entry({ id: "d9", kind: "turn-diff", turnId: "turn-9", checkpoint }),
    ]);
    const host = groups.find((group) => group.diff?.checkpoint?.checkpointTurnCount === 9);
    expect(host?.turnId).toBe("turn-9");
  });

  it("folds a turn-diff into its turn's own group when it matches", () => {
    const checkpoint = { turnId: "turn-1", checkpointTurnCount: 5, status: "ready", files: [] };
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go", turnId: "turn-1" }),
      entry({ id: "m1", kind: "assistant", text: "done.", streaming: false, turnId: "turn-1" }),
      entry({ id: "d1", kind: "turn-diff", turnId: "turn-1", checkpoint }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.diff?.checkpoint?.checkpointTurnCount).toBe(5);
  });

  it("splits turnId'd work out of a null-turn prompt group so the diff resolves", () => {
    // Live user prompts carry a null turnId: without the split, the whole
    // turn's work merges into the prompt's group while the checkpoint diff
    // orphans into a work-less group of its own — leaving inline diffs with
    // no turn to resolve against.
    const checkpoint = { turnId: "turn-7", checkpointTurnCount: 7, status: "ready", files: [] };
    const groups = groupTurns([
      entry({ id: "u1", kind: "user", text: "go", turnId: null }),
      entry({ id: "a1", kind: "activity", turnId: "turn-7" }),
      entry({ id: "d7", kind: "turn-diff", turnId: "turn-7", checkpoint }),
    ]);
    const host = groups.find((group) => group.diff?.checkpoint?.checkpointTurnCount === 7);
    expect(host?.turnId).toBe("turn-7");
    expect(host?.work.map((row) => row.id)).toEqual(["a1"]);
    expect(groups.find((group) => group.prompts.some((row) => row.id === "u1"))?.work).toEqual([]);
  });
});

describe("formatDuration", () => {
  it("renders human durations", () => {
    expect(formatDuration(209_000)).toBe("3m 29s");
    expect(formatDuration(17_000)).toBe("17s");
    expect(formatDuration(150_000)).toBe("2m 30s");
  });
});

describe("formatTokenCount", () => {
  it("renders human token counts", () => {
    expect(formatTokenCount(359_000)).toBe("359k");
    expect(formatTokenCount(1_000_000)).toBe("1m");
    expect(formatTokenCount(1_400_000)).toBe("1.4m");
    expect(formatTokenCount(842)).toBe("842");
  });
});

describe("formatContextUsage", () => {
  it("derives percent and human labels from a raw usage snapshot", () => {
    expect(
      formatContextUsage({ usedTokens: 359_000, maxTokens: 1_000_000, totalProcessedTokens: 1_400_000 }),
    ).toEqual({ percent: 36, usedLabel: "359k", maxLabel: "1m", totalProcessedLabel: "1.4m" });
  });

  it("omits percent when the driver reports no ceiling", () => {
    expect(formatContextUsage({ usedTokens: 359_000, maxTokens: null, totalProcessedTokens: null })).toEqual({
      percent: null,
      usedLabel: "359k",
      maxLabel: null,
      totalProcessedLabel: null,
    });
  });
});

const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

describe("clockTime", () => {
  const now = new Date(2026, 8, 16, 12, 0, 0).getTime();

  it("shows hour only for the same calendar day", () => {
    const value = new Date(2026, 8, 16, 9, 5, 0);
    expect(clockTime(value.toISOString(), now)).toBe("09:05");
  });

  it("shows weekday + time within the last 6 days", () => {
    const value = new Date(2026, 8, 14, 9, 5, 0);
    expect(clockTime(value.toISOString(), now)).toBe(`${WEEKDAY_LABEL[value.getDay()]}, 09:05`);
  });

  it("shows date + time for anything a week or older", () => {
    const value = new Date(2026, 8, 1, 9, 5, 0);
    expect(clockTime(value.toISOString(), now)).toBe(`01 ${MONTH_LABEL[value.getMonth()]}, 09:05`);
  });

  it("treats a future value (clock skew) as same-day hour-only rather than negative days", () => {
    const value = new Date(2026, 8, 16, 23, 59, 0);
    expect(clockTime(value.toISOString(), now)).toBe("23:59");
  });
});

describe("proportionalTarget", () => {
  it("places the first group at the top", () => {
    expect(proportionalTarget(0, 4, 400, 20)).toBe(0);
  });

  it("places a middle group proportionally", () => {
    expect(proportionalTarget(1, 4, 400, 20)).toBe(100);
  });

  it("clamps a past-the-end target to the real scroll range", () => {
    // 3/4 * 100 = 75, but only 60 rows are reachable with a 40-row window.
    expect(proportionalTarget(3, 4, 100, 40)).toBe(60);
  });

  it("returns 0 when content fits the viewport", () => {
    expect(proportionalTarget(2, 4, 10, 20)).toBe(0);
  });

  it("returns 0 for an empty group list", () => {
    expect(proportionalTarget(0, 0, 400, 20)).toBe(0);
  });
});
