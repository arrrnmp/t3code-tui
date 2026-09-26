import { describe, expect, it } from "vitest";

import type { ActivityEnvelope, MessageEnvelope, ThreadEnvelope } from "../../../core/types.js";
import { agentThreads, contextShares, effectiveContextBreakdown, estimateContextBreakdown, nativeSubagents, planUsageGauges } from "../sidepanel.js";
import type { ContextUsage } from "../thread.js";

function thread(id: string, extra: Partial<ThreadEnvelope> = {}): ThreadEnvelope {
  return { id, projectId: "p", title: id, archivedAt: null, createdAt: "2026-09-25T09:00:00.000Z", ...extra } as ThreadEnvelope;
}

describe("agentThreads", () => {
  it("lists the open thread's live children, newest first, with state and model", () => {
    const rows = agentThreads(
      [
        thread("parent"),
        thread("old", { parentThreadId: "parent", createdAt: "2026-09-25T09:01:00.000Z" } as Partial<ThreadEnvelope>),
        thread("new", {
          parentThreadId: "parent",
          createdAt: "2026-09-25T09:05:00.000Z",
          session: { status: "running", lastError: null },
          modelSelection: { instanceId: "codex", model: "gpt-5.5" },
          latestTurn: { turnId: "t", state: "running", requestedAt: "2026-09-25T09:05:01.000Z", startedAt: "2026-09-25T09:05:02.000Z" },
        } as Partial<ThreadEnvelope>),
        thread("gone", { parentThreadId: "parent", archivedAt: "2026-09-25T09:06:00.000Z" } as Partial<ThreadEnvelope>),
        thread("other", { parentThreadId: "someone-else" } as Partial<ThreadEnvelope>),
      ],
      "parent",
    );
    expect(rows.map((row) => row.threadId)).toEqual(["new", "old"]);
    expect(rows[0]).toMatchObject({ status: "running", model: "codex/gpt-5.5", startedAt: "2026-09-25T09:05:02.000Z", outcome: null });
  });

  it("has nothing to list with no thread open", () => {
    expect(agentThreads([thread("a", { parentThreadId: "x" } as Partial<ThreadEnvelope>)], null)).toEqual([]);
  });
});

describe("nativeSubagents", () => {
  it("keeps each subagent's latest state", () => {
    const activity = (id: string, payload: Record<string, unknown>, createdAt: string) =>
      ({ id, kind: "subagent", summary: "", tone: "info", turnId: "t", createdAt, payload }) as unknown as ActivityEnvelope;
    const rows = nativeSubagents([
      activity("1", { agentId: "a", agentType: "Explore", status: "started" }, "2026-09-25T09:00:00.000Z"),
      activity("2", { agentId: "a", status: "stopped", lastMessage: "done" }, "2026-09-25T09:01:00.000Z"),
      activity("3", { agentId: "b", agentType: "fork", status: "started" }, "2026-09-25T09:02:00.000Z"),
    ]);
    expect(rows).toEqual([
      { agentId: "b", agentType: "fork", running: true, lastMessage: null, at: "2026-09-25T09:02:00.000Z" },
      { agentId: "a", agentType: "Explore", running: false, lastMessage: "done", at: "2026-09-25T09:00:00.000Z" },
    ]);
  });
});

describe("contextShares", () => {
  it("orders used categories by size, then the buffer, then free space", () => {
    const shares = contextShares(
      [
        { name: "Free", tokens: 100, kind: "free" },
        { name: "Tools", tokens: 20, kind: "used" },
        { name: "Buffer", tokens: 30, kind: "buffer" },
        { name: "Messages", tokens: 50, kind: "used" },
        { name: "Empty", tokens: 0, kind: "used" },
      ],
      200,
      70,
    );
    expect(shares.map((share) => [share.name, share.percent])).toEqual([
      ["Messages", 25],
      ["Tools", 10],
      ["Buffer", 15],
      ["Free", 50],
    ]);
  });
});

describe("planUsageGauges", () => {
  it("always shows the session and main weekly window, other windows once they bite", () => {
    const gauges = planUsageGauges({
      windows: [
        { id: "session", kind: "session", label: "Session", usedPercent: 42 },
        { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 18 },
        { id: "seven_day_opus", kind: "weekly", label: "Weekly – Opus", usedPercent: 85 },
        { id: "seven_day_sonnet", kind: "weekly", label: "Weekly – Sonnet", usedPercent: 10 },
      ],
    });
    expect(gauges).toEqual([
      { short: "5h", percent: 42 },
      { short: "wk", percent: 18 },
      { short: "Opus", percent: 85 },
    ]);
  });

  it("shows nothing without a reading", () => {
    expect(planUsageGauges(null)).toEqual([]);
  });
});

function message(id: string, role: "user" | "assistant", text: string): MessageEnvelope {
  return { id, role, text, turnId: "t1", streaming: false, createdAt: "2026-09-25T09:00:00.000Z", updatedAt: "2026-09-25T09:00:00.000Z" };
}

function activity(id: string, kind: string, payload: Record<string, unknown> = {}): ActivityEnvelope {
  return { id, tone: "info", kind, summary: kind, turnId: "t1", createdAt: "2026-09-25T09:00:00.000Z", payload } as unknown as ActivityEnvelope;
}

const usage = (overrides: Partial<ContextUsage> = {}): ContextUsage => ({
  usedTokens: 10_000,
  maxTokens: 20_000,
  totalProcessedTokens: null,
  cachedInputTokens: null,
  compactsAutomatically: null,
  autoCompactThreshold: null,
  costUsd: null,
  ...overrides,
});

describe("estimateContextBreakdown", () => {
  it("returns null without a reading to scale against", () => {
    expect(estimateContextBreakdown(null, [message("m1", "user", "hello")], [])).toBeNull();
  });

  it("splits the total across roles with the remainder as system prompt", () => {
    const breakdown = estimateContextBreakdown(
      usage(),
      [message("m1", "user", "x".repeat(400)), message("m2", "assistant", "y".repeat(400))],
      [],
    )!;
    expect(breakdown.estimated).toBe(true);
    const names = breakdown.categories.map((category) => category.name);
    expect(names).toContain("User messages");
    expect(names).toContain("Assistant messages");
    expect(names).toContain("System prompt & tools");
    expect(names).toContain("Free space");
    expect(breakdown.categories.reduce((sum, category) => sum + (category.kind === "free" ? 0 : category.tokens), 0)).toBe(10_000);
  });

  it("counts reasoning and tool calls separately", () => {
    const breakdown = estimateContextBreakdown(
      usage(),
      [],
      [
        activity("r1", "tool.completed", { itemType: "reasoning", status: "completed", text: "z".repeat(400) }),
        activity("t1", "tool.completed", { itemType: "dynamic_tool_call", toolCallId: "c1", status: "completed", data: { toolName: "Read" } }),
      ],
    )!;
    const names = breakdown.categories.map((category) => category.name);
    expect(names).toContain("Reasoning");
    expect(names).toContain("Tool calls");
  });
});

describe("effectiveContextBreakdown", () => {
  it("prefers the live breakdown when it names categories", () => {
    const live = {
      usedTokens: 100,
      maxTokens: 200,
      cachedInputTokens: null,
      autoCompactThreshold: null,
      compactsAutomatically: null,
      categories: [{ name: "Messages", tokens: 60, kind: "used" as const }],
      estimated: false,
    };
    expect(effectiveContextBreakdown(live, usage(), [], [])).toBe(live);
  });

  it("falls back to the transcript estimate for a total-only reading", () => {
    const live = {
      usedTokens: 100,
      maxTokens: 200,
      cachedInputTokens: null,
      autoCompactThreshold: null,
      compactsAutomatically: null,
      categories: [],
      estimated: false,
    };
    const estimated = effectiveContextBreakdown(live, usage({ usedTokens: 500, maxTokens: 1000 }), [message("m1", "user", "hello world")], []);
    expect(estimated?.estimated).toBe(true);
    expect(estimated?.categories.length).toBeGreaterThan(0);
  });
});
