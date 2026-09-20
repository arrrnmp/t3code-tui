import { describe, expect, it } from "vitest";

import { defaultExportFilename, exportToolLine, formatThreadExport } from "../export.js";
import type { TimelineEntry } from "../thread.js";
import type { TurnGroup } from "../turns.js";
import type { T3Thread } from "../../../types.js";

function toolEntry(id: string, turnId: string | null, kind: string, payload: Record<string, unknown>): TimelineEntry {
  return {
    id,
    at: "2026-09-16T02:00:00.000Z",
    turnId,
    kind: "activity",
    text: "",
    streaming: false,
    tone: "tool",
    activityKind: kind,
    message: null,
    activity: {
      id,
      tone: "tool",
      kind,
      summary: kind,
      turnId,
      createdAt: "2026-09-16T02:00:00.000Z",
      payload,
    } as unknown as TimelineEntry["activity"],
    checkpoint: null,
    editStats: null,
    proposedPlan: null,
  };
}

function userEntry(id: string, turnId: string | null, text: string): TimelineEntry {
  return {
    id,
    at: "2026-09-16T02:01:00.000Z",
    turnId,
    kind: "user",
    text,
    streaming: false,
    tone: null,
    activityKind: null,
    message: null,
    activity: null,
    checkpoint: null,
    editStats: null,
    proposedPlan: null,
  };
}

function assistantEntry(id: string, turnId: string | null, text: string): TimelineEntry {
  return { ...userEntry(id, turnId, text), kind: "assistant" };
}

function group(overrides: Partial<TurnGroup> & { id: string }): TurnGroup {
  return {
    turnId: "turn-1",
    prompts: [],
    work: [],
    reply: null,
    live: null,
    diff: null,
    proposedPlan: null,
    durationMs: 60_000,
    startedAt: "2026-09-16T02:00:00.000Z",
    ...overrides,
  };
}

function commandPayload(command: string, output: string): Record<string, unknown> {
  return {
    itemType: "command_execution",
    toolCallId: `call-${command}`,
    status: "completed",
    title: command,
    detail: output,
    data: {
      tool: "bash",
      state: {
        status: "completed",
        input: { command },
        output,
        metadata: { exit: 0 },
        time: { start: 1, end: 2 },
      },
    },
  };
}

const thread = {
  id: "t-abc123",
  projectId: "p-1",
  title: "Fix login bug",
  branch: "main",
  modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: "2026-09-16T01:00:00.000Z",
  updatedAt: "2026-09-16T02:00:00.000Z",
} as unknown as T3Thread;

describe("exportToolLine", () => {
  it("collapses a command with output dump to one line with exit status", () => {
    const line = exportToolLine(toolEntry("c1", "turn-1", "tool.completed", commandPayload("bun run check", `${"output line\n".repeat(50)}`)));
    expect(line).toBe("$ bun run check · exit 0");
  });

  it("keeps multi-line commands complete on one line", () => {
    const line = exportToolLine(
      toolEntry("c2", "turn-1", "tool.completed", commandPayload("for i in 1 2 3\ndo\n  echo $i\ndone", "")),
    );
    expect(line).toBe("$ for i in 1 2 3 do echo $i done · exit 0");
  });

  it("renders file edits with counts and reads with ranges", () => {
    const edit = toolEntry("e1", "turn-1", "tool.completed", {
      itemType: "file_change",
      toolCallId: "edit-1",
      status: "completed",
      title: "src/a.ts",
      detail: "Edit applied.",
      data: {
        tool: "edit",
        state: { status: "completed", input: { filePath: "src/a.ts", oldString: "a\n", newString: "b\nc\n" } },
      },
    });
    expect(exportToolLine(edit)).toMatch(/^Update src\/a\.ts \(\+\d+ −\d+\)$/u);
    const read = toolEntry("r1", "turn-1", "tool.completed", {
      itemType: "dynamic_tool_call",
      toolCallId: "read-1",
      status: "completed",
      title: "Tool call",
      detail: "",
      data: { toolName: "Read", input: { file_path: "src/a.ts", offset: 700, limit: 101 } },
    });
    expect(exportToolLine(read)).toBe("Read src/a.ts L700-L800");
  });

  it("skips plan checklists (they render once in State to continue)", () => {
    const plan = toolEntry("p1", "turn-1", "turn.plan.updated", {
      plan: [{ step: "Do it", status: "completed" }],
    });
    expect(exportToolLine(plan)).toBeNull();
  });
});

describe("formatThreadExport", () => {
  it("exports header, state to continue, and one section per turn", () => {
    const groups = [
      group({
        id: "turn-1",
        turnId: "turn-1",
        prompts: [userEntry("m1", "turn-1", "Fix the login bug")],
        work: [toolEntry("c1", "turn-1", "tool.completed", commandPayload("bun run check", "ok\n"))],
        reply: assistantEntry("m2", "turn-1", "Fixed it."),
        diff: {
          id: "diff:turn-1",
          at: "2026-09-16T02:02:00.000Z",
          turnId: "turn-1",
          kind: "turn-diff",
          text: "",
          streaming: false,
          tone: null,
          activityKind: null,
          message: null,
          activity: null,
          checkpoint: {
            turnId: "turn-1",
            checkpointTurnCount: 5,
            status: "ready",
            files: [{ path: "src/auth.ts", kind: "modified", additions: 10, deletions: 2 }],
          },
          editStats: null,
          proposedPlan: null,
        },
      }),
      group({
        id: "turn-2",
        turnId: "turn-2",
        prompts: [userEntry("m3", "turn-2", "Also update the docs")],
        work: [],
        reply: null,
        live: null,
      }),
    ];
    const markdown = formatThreadExport({
      thread,
      threadId: thread.id,
      project: { title: "demo", workspaceRoot: "/repo" },
      groups,
      plan: { items: [{ content: "Fix bug", status: "completed" }], at: "2026-09-16T02:00:00.000Z" },
      pending: [],
      contextUsage: null,
      exportedAt: "2026-09-16T03:00:00.000Z",
    });
    expect(markdown).toContain("# Thread export: Fix login bug");
    expect(markdown).toContain("- project: demo (`/repo`)");
    expect(markdown).toContain("- model: `claudeAgent/claude-opus-5`");
    expect(markdown).toContain("- turns: 2 · messages: 3 · tool calls: 1");
    expect(markdown).toContain("## State to continue");
    expect(markdown).toContain("Goal: Fix the login bug");
    expect(markdown).toContain("Latest reply: Fixed it.");
    expect(markdown).toContain("- [x] Fix bug");
    expect(markdown).toContain("- src/auth.ts (+10 −2)");
    expect(markdown).toContain("## T1 · Fix the login bug · turn-1");
    expect(markdown).toContain("$ bun run check · exit 0");
    expect(markdown).toContain("Files: src/auth.ts (+10 −2)");
    expect(markdown).toContain("## T2 · Also update the docs · turn-2");
    expect(markdown).toContain("_(no reply)_");
  });

  it("never truncates message bodies — long replies stay complete", () => {
    const longReply = `x`.repeat(7000);
    const groups = [
      group({
        id: "turn-1",
        prompts: [userEntry("m1", "turn-1", "Go")],
        reply: assistantEntry("m2", "turn-1", longReply),
      }),
    ];
    const markdown = formatThreadExport({
      thread,
      threadId: thread.id,
      project: null,
      groups,
      plan: null,
      pending: [
        {
          requestId: "req-1",
          questions: [
            {
              id: "q-1",
              header: "Direction",
              question: "Which way?",
              options: [{ label: "Forward", description: "keep going", value: null }],
              multiSelect: false,
              allowCustomAnswer: true,
            },
          ],
        },
      ],
      contextUsage: { usedTokens: 10_000, maxTokens: 200_000, totalProcessedTokens: null, cachedInputTokens: null, compactsAutomatically: null, autoCompactThreshold: null },
      exportedAt: "2026-09-16T03:00:00.000Z",
    });
    expect(markdown).toContain(longReply);
    expect(markdown).not.toContain("truncated");
    expect(markdown).toContain("Open questions (answer these first):");
    expect(markdown).toContain("- Direction: Which way?");
    expect(markdown).toContain("- context: 10000/200000 tokens");
  });

  it("handles an empty transcript without turn sections", () => {
    const markdown = formatThreadExport({
      thread: null,
      threadId: "t-empty",
      project: null,
      groups: [],
      plan: null,
      pending: [],
      contextUsage: null,
      exportedAt: "2026-09-16T03:00:00.000Z",
    });
    expect(markdown).toContain("# Thread export: (untitled thread)");
    expect(markdown).toContain("- turns: 0 · messages: 0 · tool calls: 0");
    expect(markdown).not.toContain("## T1");
  });
});

describe("defaultExportFilename", () => {
  it("slugifies the title and appends the short id", () => {
    expect(defaultExportFilename({ id: "t-now", title: "Message delay and scheduling!" }, "t-now")).toBe(
      "message-delay-and-scheduling-tnow.md",
    );
  });

  it("falls back for missing titles and ids", () => {
    expect(defaultExportFilename(null, "")).toBe("thread-export.md");
    expect(defaultExportFilename({ id: "x", title: "!!!" }, "x")).toBe("thread-x.md");
  });
});
