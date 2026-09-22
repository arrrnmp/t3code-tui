/**
 * The mapper's contract is that the TUI renderer can read what it writes,
 * so each case asserts the payload *through* `describeActivity` rather
 * than field by field — a shape that only looks right is the bug this
 * whole path had.
 */
import { describe, expect, it } from "vitest";

import { describeActivity } from "../../tui/model/activity.js";
import type { T3ThreadActivity } from "../../types.js";
import { toolActivityRow, type ToolRuntimeEvent } from "../toolactivity.js";

function view(row: { payload: Record<string, unknown>; summary: string; kind: string }) {
  const activity: T3ThreadActivity = {
    id: "a1",
    tone: "info",
    kind: row.kind,
    summary: row.summary,
    turnId: "turn-1",
    createdAt: "2026-09-22T00:00:00.000Z",
    payload: row.payload,
  };
  return describeActivity(activity);
}

function event(partial: Partial<ToolRuntimeEvent> & { provider: ToolRuntimeEvent["provider"] }): ToolRuntimeEvent {
  return {
    type: "tool.execute.started",
    threadId: "thread-1",
    turnId: "turn-1",
    tool: "tool",
    ...partial,
  } as ToolRuntimeEvent;
}

describe("toolActivityRow", () => {
  it("maps a Claude Bash call to a command row and settles it on the tool result", () => {
    const started = toolActivityRow(
      event({
        provider: "claude",
        tool: "Bash",
        raw: { toolUseId: "toolu_1", input: { command: "git status", workdir: "/repo" } },
      }),
    );
    expect(started?.callId).toBe("toolu_1");
    const startedView = view(started!);
    expect(startedView.kind).toBe("command");
    expect(startedView).toMatchObject({ command: "git status", workdir: "/repo", running: true });
    expect(started?.summary).toBe("$ git status");

    const done = toolActivityRow(
      event({
        provider: "claude",
        type: "tool.execute.completed",
        tool: "tool",
        raw: { toolUseId: "toolu_1", output: "on branch main", isError: false },
      }),
    );
    // Same call id, so the transcript folds both onto one card.
    expect(done?.callId).toBe("toolu_1");
    expect(view(done!)).toMatchObject({ running: false });
  });

  it("maps a Claude Read call to a read row with its path", () => {
    const row = toolActivityRow(
      event({ provider: "claude", tool: "Read", raw: { toolUseId: "toolu_2", input: { file_path: "/repo/src/app.ts" } } }),
    );
    expect(view(row!)).toMatchObject({ kind: "read", path: "src/app.ts" });
  });

  it("maps a Codex commandExecution item, including its exit code", () => {
    const row = toolActivityRow(
      event({
        provider: "codex",
        type: "tool.execute.completed",
        raw: {
          item: {
            id: "item_1",
            type: "commandExecution",
            command: "bun test",
            cwd: "/repo",
            exitCode: 1,
            durationMs: 1200,
            aggregatedOutput: "1 failed",
            status: "completed",
          },
        },
      }),
    );
    expect(view(row!)).toMatchObject({
      kind: "command",
      command: "bun test",
      exit: 1,
      failed: true,
      running: false,
    });
  });

  it("maps a Codex fileChange item to a file row carrying the real diff", () => {
    const row = toolActivityRow(
      event({
        provider: "codex",
        type: "tool.execute.completed",
        raw: {
          item: {
            id: "item_2",
            type: "fileChange",
            status: "completed",
            changes: [{ path: "/repo/src/app.ts", kind: "edit", diff: "@@ -1 +1 @@\n-old\n+new\n" }],
          },
        },
      }),
    );
    const mapped = view(row!);
    expect(mapped.kind).toBe("file");
    // The provider's own patch must reach the renderer, not just sit in
    // `files[]` — asserting only the path let a dropped diff pass.
    expect(mapped).toMatchObject({ path: "src/app.ts", running: false, added: 1, removed: 1 });
    expect((mapped as { diff: string | null }).diff).toContain("+new");
  });

  it("ignores Codex items that are not tool calls", () => {
    expect(toolActivityRow(event({ provider: "codex", raw: { item: { id: "i", type: "reasoning" } } }))).toBeNull();
    expect(toolActivityRow(event({ provider: "codex", raw: {} }))).toBeNull();
  });

  it("maps a Grok ACP tool call, taking the path from its locations", () => {
    const row = toolActivityRow(
      event({
        provider: "grok",
        tool: "read",
        raw: {
          toolCallId: "call_7",
          title: "Reading app.ts",
          kind: "read",
          status: "in_progress",
          locations: [{ path: "/repo/src/app.ts" }],
          rawInput: {},
        },
      }),
    );
    expect(view(row!)).toMatchObject({ kind: "read", path: "src/app.ts", running: true });
  });

  it("maps a Grok execute call to a command row", () => {
    const row = toolActivityRow(
      event({
        provider: "grok",
        raw: { toolCallId: "call_8", kind: "execute", status: "completed", rawInput: { command: "ls" } },
      }),
    );
    expect(view(row!)).toMatchObject({ kind: "command", command: "ls", running: false });
  });

  it("maps an OpenCode tool part, reading status from the part's own state", () => {
    const running = toolActivityRow(
      event({
        provider: "opencode",
        tool: "bash",
        raw: {
          id: "prt_1",
          callID: "call_1",
          type: "tool",
          tool: "bash",
          state: { status: "running", input: { command: "ls" }, time: { start: 1000 } },
        },
      }),
    );
    expect(view(running!)).toMatchObject({ kind: "command", command: "ls", running: true });

    const done = toolActivityRow(
      event({
        provider: "opencode",
        type: "tool.execute.completed",
        tool: "bash",
        raw: {
          id: "prt_1",
          callID: "call_1",
          type: "tool",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "ls" },
            output: "README.md",
            metadata: { exit: 0 },
            time: { start: 1000, end: 2000 },
          },
        },
      }),
    );
    expect(done?.callId).toBe("call_1");
    expect(view(done!)).toMatchObject({ kind: "command", exit: 0, durationMs: 1000, running: false });
  });

  it("keeps a signature that changes only when the row says something new", () => {
    const base = {
      provider: "opencode" as const,
      tool: "bash",
      raw: {
        callID: "call_2",
        tool: "bash",
        state: { status: "running", input: { command: "ls" }, output: "a" },
      },
    };
    const first = toolActivityRow(event(base));
    const same = toolActivityRow(event(base));
    expect(same?.signature).toBe(first?.signature);
    const grown = toolActivityRow(
      event({
        ...base,
        raw: { callID: "call_2", tool: "bash", state: { status: "running", input: { command: "ls" }, output: "ab" } },
      }),
    );
    expect(grown?.signature).not.toBe(first?.signature);
  });

  it("returns null rather than throwing on a shape it cannot read", () => {
    expect(toolActivityRow(event({ provider: "claude", raw: undefined }))).toBeNull();
    expect(toolActivityRow(event({ provider: "claude", raw: { input: {} } }))).toBeNull();
    expect(toolActivityRow(event({ provider: "grok", raw: { status: "completed" } }))).toBeNull();
    expect(toolActivityRow(event({ provider: "opencode", raw: { tool: "bash" } }))).toBeNull();
  });
});
