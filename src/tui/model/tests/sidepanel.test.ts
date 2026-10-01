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
      { agentId: "b", agentType: "fork", description: null, running: true, lastMessage: null, at: "2026-09-25T09:02:00.000Z", stoppedAt: null },
      {
        agentId: "a",
        agentType: "Explore",
        description: null,
        running: false,
        lastMessage: "done",
        at: "2026-09-25T09:00:00.000Z",
        stoppedAt: "2026-09-25T09:01:00.000Z",
      },
    ]);
  });

  it("ignores Claude Code's internal agents: a stop with no start", () => {
    const stopped = { id: "s", kind: "subagent", summary: "", tone: "info", turnId: "t", createdAt: "2026-09-25T09:00:00.000Z", payload: { agentId: "x", agentType: "agent", status: "stopped", lastMessage: "check the background tab" } };
    expect(nativeSubagents([stopped as unknown as ActivityEnvelope])).toEqual([]);
  });

  it("takes a background subagent's task ending as its stop when the stop row is missing", () => {
    const row = (id: string, kind: string, payload: Record<string, unknown>, createdAt: string) =>
      ({ id, kind, summary: "", tone: "info", turnId: "t", createdAt, payload }) as unknown as ActivityEnvelope;
    const rows = nativeSubagents([
      row("1", "tool-call.completed", { toolCallId: "toolu_1", data: { tool: "Agent", state: { input: { subagent_type: "Explore", description: "Count TODOs" } } } }, "2026-09-25T09:00:00.000Z"),
      row("2", "background.started", { taskId: "ag", toolUseId: "toolu_1", status: "started" }, "2026-09-25T09:00:00.000Z"),
      row("3", "subagent", { agentId: "ag", agentType: "Explore", status: "started" }, "2026-09-25T09:00:00.000Z"),
      row("4", "background.completed", { taskId: "ag", status: "completed", summary: "Found 3." }, "2026-09-25T09:00:14.000Z"),
    ]);
    expect(rows).toEqual([
      {
        agentId: "ag",
        agentType: "Explore",
        description: "Count TODOs",
        running: false,
        lastMessage: "Found 3.",
        at: "2026-09-25T09:00:00.000Z",
        stoppedAt: "2026-09-25T09:00:14.000Z",
      },
    ]);
  });

  it("names each subagent after the Agent call of its turn and type, in order", () => {
    const at = "2026-09-25T09:00:00.000Z";
    const call = (id: string, callId: string, type: string, description: string, turnId = "t") =>
      ({
        id,
        kind: "tool-call.completed",
        summary: "Agent",
        tone: "tool",
        turnId,
        createdAt: at,
        payload: { toolCallId: callId, data: { tool: "Agent", state: { input: { subagent_type: type, description } } } },
      }) as unknown as ActivityEnvelope;
    const started = (id: string, agentId: string, agentType: string, turnId = "t") =>
      ({ id, kind: "subagent", summary: "", tone: "info", turnId, createdAt: at, payload: { agentId, agentType, status: "started" } }) as unknown as ActivityEnvelope;
    const rows = nativeSubagents([
      { ...call("0", "c1", "Explore", "Count TODOs"), kind: "tool-call.started" } as ActivityEnvelope,
      call("1", "c1", "Explore", "Count TODOs"),
      call("2", "c2", "Plan", "Plan the fix"),
      call("3", "c3", "Explore", "Find call sites"),
      started("4", "a1", "Explore"),
      started("5", "a2", "Plan"),
      started("6", "a3", "Explore"),
      started("7", "a4", "Explore", "other-turn"),
    ]);
    expect(Object.fromEntries(rows.map((row) => [row.agentId, row.description]))).toEqual({
      a1: "Count TODOs",
      a2: "Plan the fix",
      a3: "Find call sites",
      a4: null,
    });
  });

  it("lists OpenCode's subagents, named by the description they start with", () => {
    const at = "2026-09-25T09:00:00.000Z";
    const row = (id: string, payload: Record<string, unknown>) =>
      ({ id, kind: "subagent", summary: "", tone: "info", turnId: "t", createdAt: at, payload }) as unknown as ActivityEnvelope;
    const rows = nativeSubagents([
      {
        id: "0",
        kind: "tool-call.started",
        summary: "subagent",
        tone: "tool",
        turnId: "t",
        createdAt: at,
        payload: { toolCallId: "call_sub", data: { tool: "subagent", state: { input: { agent: "explore", description: "From the call" } } } },
      } as unknown as ActivityEnvelope,
      row("1", { agentId: "ses_child", agentType: "explore", status: "started", description: "Find one file in /tmp" }),
      row("2", { agentId: "ses_child", agentType: "explore", status: "stopped", lastMessage: "Found /tmp/x" }),
    ]);
    expect(rows).toMatchObject([{ agentId: "ses_child", agentType: "explore", description: "Find one file in /tmp", running: false, lastMessage: "Found /tmp/x" }]);
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
        activity("r1", "reasoning", { itemType: "reasoning", toolCallId: "reasoning:1", status: "completed", text: "z".repeat(400) }),
        activity("t1", "tool.completed", { itemType: "dynamic_tool_call", toolCallId: "c1", status: "completed", data: { toolName: "Read" } }),
      ],
    )!;
    const names = breakdown.categories.map((category) => category.name);
    expect(names).toContain("Reasoning");
    expect(names).toContain("Tool calls");
  });

  it("names tools from the call rows only, counting each call once", () => {
    const call = (id: string, status: string, output: string) =>
      activity(id, status === "completed" ? "tool-call.completed" : "tool-call.started", {
        itemType: "command_execution",
        toolCallId: "c1",
        status,
        data: { tool: "Bash", state: { input: { command: "ls" }, output } },
      });
    const breakdown = estimateContextBreakdown(
      usage({ usedTokens: 1_000_000, maxTokens: 2_000_000 }),
      [],
      [
        // Ledger bookkeeping is not context: the prompt on `turn.started`
        // and the turn id on `turn.completed` once read as tools "This"
        // and "ce78c419-…".
        { ...activity("s", "turn.started", { prompt: "This is the prompt" }), summary: "This is the prompt" },
        { ...activity("e", "turn.completed", {}), summary: "ce78c419-44d0-4773-8a05-d7506a37d913" },
        call("t1", "inProgress", ""),
        call("t2", "completed", "x".repeat(400)),
        activity("m", "tool-call.completed", { toolCallId: "c2", status: "completed", data: { tool: "mcp__moxen__delegate", state: { input: {} } } }),
      ],
    )!;
    expect(breakdown.tools?.map((tool) => tool.name)).toEqual(["Bash", "delegate"]);
    const single = estimateContextBreakdown(usage({ usedTokens: 1_000_000, maxTokens: 2_000_000 }), [], [call("t2", "completed", "x".repeat(400))])!;
    expect(breakdown.tools?.[0]?.tokens).toBe(single.tools?.[0]?.tokens);
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
