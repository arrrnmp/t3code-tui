import { describe, expect, it } from "vitest";

import { describeActivity, fileRowCounts, formatMs, missingCompletedInput, readRangeLabel, toolCallIdOf, withCompletedInput } from "../activity.js";
import type { T3ThreadActivity } from "../../../types.js";

function activity(kind: string, payload: Record<string, unknown>): T3ThreadActivity {
  return {
    id: "a1",
    tone: "tool",
    kind,
    summary: kind,
    turnId: "turn-1",
    createdAt: "2026-09-15T00:28:00.000Z",
    payload,
  } as unknown as T3ThreadActivity;
}

describe("describeActivity", () => {
  it("reads real command_execution payloads with exit and duration", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "command_execution",
        toolCallId: "call-1",
        status: "completed",
        title: "bun run check",
        detail: "ok\n",
        data: {
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "bun run check", workdir: "C:\\repo" },
            output: "ok\n",
            metadata: { exit: 0 },
            time: { start: 1000, end: 6500 },
          },
        },
      }),
    );
    expect(view).toMatchObject({
      kind: "command",
      tool: "bash",
      command: "bun run check",
      exit: 0,
      durationMs: 5500,
      failed: false,
      running: false,
    });
  });

  it("flags failed commands and keeps the output tail", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "command_execution",
        toolCallId: "call-1",
        status: "completed",
        data: {
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "bun run check" },
            output: "line1\nline2\nboom\n",
            metadata: { exit: 1 },
          },
        },
      }),
    );
    expect(view.kind).toBe("command");
    if (view.kind !== "command") throw new Error("unreachable");
    expect(view.failed).toBe(true);
    expect(view.outputTail).toContain("boom");
  });

  it("maps provider-native Bash dynamic_tool_call rows to the command view", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-9",
        status: "completed",
        title: "Bash",
        data: {
          toolName: "Bash",
          input: { command: "bun run check", workdir: "C:\\repo" },
        },
      }),
    );
    expect(view).toMatchObject({
      kind: "command",
      tool: "bash",
      command: "bun run check",
      workdir: "C:\\repo",
      running: false,
    });
  });

  it("maps namespaced harness Bash rows to the same command view", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-9",
        status: "completed",
        title: "default.bash",
        data: {
          toolName: "default.bash",
          input: { command: "bun run check" },
        },
      }),
    );
    expect(view).toMatchObject({
      kind: "command",
      tool: "bash",
      command: "bun run check",
      running: false,
    });
  });

  it("marks provider-native Bash rows running while in flight", () => {
    const view = describeActivity(
      activity("tool.started", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-9",
        status: "inProgress",
        title: "Bash",
        data: { toolName: "bash", input: { command: "bun run check" } },
      }),
    );
    expect(view).toMatchObject({ kind: "command", running: true });
  });

  it("reads real file_change payloads with edit stats", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "file_change",
        toolCallId: "call-2",
        status: "completed",
        title: "src/tui/timeline.tsx",
        detail: "Edit applied successfully.",
        data: {
          tool: "edit",
          state: {
            status: "completed",
            input: {
              filePath: "C:/repo/src/tui/timeline.tsx",
              oldString: "a\nb",
              newString: "a\nb\nc\nd",
            },
          },
        },
      }),
    );
    expect(view).toMatchObject({ kind: "file", verb: "Update", path: "src/tui/timeline.tsx", added: 2, removed: 0 });
  });

  it("resolves stripped wire payloads from data.files", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "file_change",
        toolCallId: "call-2",
        status: "completed",
        title: "src\\tui\\timeline.tsx",
        detail: "Edit applied successfully.",
        data: { files: [{ path: "C:/repo/src/tui/timeline.tsx" }] },
      }),
    );
    expect(view).toMatchObject({ kind: "file", verb: "Update", path: "src/tui/timeline.tsx", added: null, removed: null, diff: null });
  });

  it("shows the file while running instead of the bare verb title", () => {
    const view = describeActivity(
      activity("tool.updated", {
        itemType: "file_change",
        toolCallId: "call-2",
        status: "inProgress",
        title: "edit",
        data: { files: [{ path: "C:/repo/src/tui/model/sidebar.ts" }] },
      }),
    );
    expect(view).toMatchObject({ kind: "file", verb: "Update", path: "src/tui/model/sidebar.ts" });
    if (view.kind !== "file") throw new Error("unreachable");
    expect(view.running).toBe(true);
  });

  it("builds a real unified diff for inline edits instead of dumping old/new blocks", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "file_change",
        toolCallId: "call-2",
        status: "completed",
        title: "src/tui/timeline.tsx",
        detail: "Edit applied successfully.",
        data: {
          tool: "edit",
          state: {
            status: "completed",
            input: {
              filePath: "C:/repo/src/tui/timeline.tsx",
              oldString: "a\nb",
              newString: "a\nb\nc\nd",
            },
          },
        },
      }),
    );
    expect(view).toMatchObject({ kind: "file", verb: "Update", added: 2, removed: 0, diffMore: 0 });
    if (view.kind !== "file") throw new Error("unreachable");
    expect(view.diff).not.toBeNull();
    expect(view.diff).toContain("+c");
    expect(view.diff).toContain("+d");
    // Unchanged context lines must not appear as removed — the old bug dumped
    // the whole old_string as "-" even when most of it was unchanged.
    expect(view.diff).not.toMatch(/^-a$/m);
    expect(view.diff).not.toMatch(/^-b$/m);
  });

  it("prefers a provider-supplied diff over computing one", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "file_change",
        toolCallId: "call-3",
        status: "completed",
        title: "src/tui/app.tsx",
        data: {
          tool: "edit",
          state: {
            status: "completed",
            input: { filePath: "C:/repo/src/tui/app.tsx", oldString: "x", newString: "y" },
            metadata: { diff: "Index: src/tui/app.tsx\n===\n--- a\n+++ b\n@@ -1,1 +1,1 @@\n-x\n+y\n" },
          },
        },
      }),
    );
    if (view.kind !== "file") throw new Error("unreachable");
    expect(view.diff).toBe("Index: src/tui/app.tsx\n===\n--- a\n+++ b\n@@ -1,1 +1,1 @@\n-x\n+y\n");
    expect(view.added).toBe(1);
    expect(view.removed).toBe(1);
  });

  it("caps an oversized file creation without breaking the diff, keeping the true line count", () => {
    const content = Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n");
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "file_change",
        toolCallId: "call-4",
        status: "completed",
        title: "src/tui/model/clipboard.ts",
        data: {
          tool: "write",
          state: { status: "completed", input: { filePath: "C:/repo/src/tui/model/clipboard.ts", content } },
        },
      }),
    );
    expect(view).toMatchObject({ kind: "file", verb: "Write", added: 60, diffMore: 20 });
    if (view.kind !== "file") throw new Error("unreachable");
    expect(view.diff).not.toBeNull();
    expect(view.diff).not.toContain("line 59");
  });

  it("names unknown tool shapes instead of rendering a bare tool row", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-9",
        status: "completed",
        title: "MysteryOp",
        detail: "did things",
        data: {},
      }),
    );
    expect(view).toMatchObject({ kind: "tool", tool: "MysteryOp", detail: "did things" });
  });

  it("reads dynamic read/grep tools by name", () => {
    const read = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-3",
        status: "completed",
        data: { tool: "read", state: { status: "completed", input: { filePath: "C:/repo/package.json" } } },
      }),
    );
    expect(read).toMatchObject({ kind: "read", path: "repo/package.json" });

    const grep = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-4",
        status: "completed",
        title: "pattern",
        data: {
          tool: "grep",
          state: { status: "completed", input: { pattern: "pattern", include: "*.ts" } },
        },
      }),
    );
    expect(grep).toMatchObject({ kind: "grep", pattern: "pattern", scope: "*.ts" });
  });

  it("resolves read sections to 1-indexed line ranges", () => {
    const section = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-3",
        status: "completed",
        data: {
          tool: "read",
          state: { status: "completed", input: { filePath: "C:/repo/src/tui/app.tsx", offset: 700, limit: 101 } },
        },
      }),
    );
    expect(section).toMatchObject({ kind: "read", path: "src/tui/app.tsx", startLine: 700, endLine: 800 });

    const unbounded = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-3",
        status: "completed",
        data: {
          tool: "read",
          state: { status: "completed", input: { filePath: "C:/repo/src/tui/app.tsx", offset: 700 } },
        },
      }),
    );
    expect(unbounded).toMatchObject({ kind: "read", startLine: 700, endLine: null });

    const head = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-3",
        status: "completed",
        data: {
          tool: "read",
          state: { status: "completed", input: { filePath: "C:/repo/src/tui/app.tsx", limit: 50 } },
        },
      }),
    );
    expect(head).toMatchObject({ kind: "read", startLine: 1, endLine: 50 });

    const whole = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-3",
        status: "completed",
        data: { tool: "read", state: { status: "completed", input: { filePath: "C:/repo/package.json" } } },
      }),
    );
    expect(whole).toMatchObject({ kind: "read", startLine: null, endLine: null });
  });

  it("labels read ranges as LNS-LNE", () => {
    expect(readRangeLabel(700, 800)).toBe("L700-L800");
    expect(readRangeLabel(700, null)).toBe("L700+");
    expect(readRangeLabel(null, null)).toBeNull();
  });

  it("maps namespaced harness tool names by trailing segment", () => {
    const read = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-4",
        status: "completed",
        title: "default.read",
        data: {
          toolName: "default.read",
          input: { filePath: "C:/repo/src/tui/app.tsx" },
        },
      }),
    );
    expect(read).toMatchObject({ kind: "read", path: "src/tui/app.tsx" });
  });

  it("maps namespaced harness grep rows to the grep view", () => {
    const grep = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-4",
        status: "completed",
        title: "default.grep",
        data: {
          toolName: "default.grep",
          input: { pattern: "name", path: "C:/repo/src/tui/model/activity.ts" },
        },
      }),
    );
    expect(grep).toMatchObject({ kind: "grep", pattern: "name", scope: "src/tui/model/activity.ts" });
  });

  it("maps nameless stripped grep rows by server title instead of dumping results", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-4",
        status: "completed",
        title: "grep",
        detail: "Found 2 matches\nC:/repo/src/tui/features/timeline/timeline.tsx:\n… 3 more lines",
        data: {},
      }),
    );
    expect(view).toMatchObject({ kind: "grep", pattern: "Found 2 matches", scope: null });
  });

  it("maps nameless stripped bash rows by server title", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-9",
        status: "completed",
        title: "Bash",
        detail: "1.136.1\n",
        data: {},
      }),
    );
    expect(view).toMatchObject({ kind: "command", tool: "bash", command: "" });
  });

  it("leaves path-titled nameless rows on the existing paths", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-4",
        status: "completed",
        title: "src/tools/grep",
        data: {},
      }),
    );
    expect(view.kind).toBe("tool");
  });

  it("recovers the pattern from a pattern-titled completed grep row", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-4",
        status: "completed",
        title: "withCompletedInput|missingCompletedInput",
        detail: "Found 14 matches\nC:/repo/src/tui/model/activity.ts:\n… 3 more lines",
        data: {},
      }),
    );
    expect(view).toMatchObject({
      kind: "grep",
      pattern: "withCompletedInput|missingCompletedInput",
      scope: null,
    });
  });

  it("recovers regex patterns containing backslashes from the title", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-4",
        status: "completed",
        title: "\\bname\\b",
        detail: "Found 61 matches\nC:/repo/src/tui/model/attachments.ts:\n… 3 more lines",
        data: {},
      }),
    );
    expect(view).toMatchObject({ kind: "grep", pattern: "\\bname\\b", scope: null });
  });

  it("maps zero-match grep dumps to the pattern-titled grep view", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-4",
        status: "completed",
        title: "activity.test.ts",
        detail: "No files found",
        data: {},
      }),
    );
    expect(view).toMatchObject({ kind: "grep", pattern: "activity.test.ts", scope: null });
  });

  it("tolerates T3's truncation note on the match header", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-4",
        status: "completed",
        title: "attachment|clipboard",
        detail: "Found 100 matches (more matches available)\nC:/repo/AGENTS.md:\n",
        data: {},
      }),
    );
    expect(view).toMatchObject({ kind: "grep", pattern: "attachment|clipboard", scope: null });
  });

  it("collapses nameless glob path dumps to their common directory", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-6",
        status: "completed",
        title: "Tool",
        detail: "C:/repo/src/tui/ui/tests/backdrop.test.ts\nC:/repo/src/tui/ui/terminalgate.tsx\n",
        data: {},
      }),
    );
    expect(view).toMatchObject({ kind: "list", path: "src/tui/ui" });
  });

  it("leaves path-titled content dumps out of the glob collapse", () => {
    const view = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-6",
        status: "completed",
        title: "src/notes.txt",
        detail: "C:/repo/a.txt\nC:/repo/b.txt\n",
        data: {},
      }),
    );
    expect(view.kind).toBe("tool");
  });

  it("renders todowrite and plan checklists", () => {
    const todos = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "call-5",
        status: "completed",
        title: "2 todos",
        data: {
          tool: "todowrite",
          state: {
            status: "completed",
            input: {
              todos: [
                { content: "first", status: "completed" },
                { content: "second", status: "inProgress" },
              ],
            },
          },
        },
      }),
    );
    expect(todos.kind).toBe("todos");
    if (todos.kind !== "todos") throw new Error("unreachable");
    expect(todos.items).toHaveLength(2);

    const plan = describeActivity(
      activity("turn.plan.updated", {
        plan: [
          { step: "Inventory", status: "completed" },
          { step: "Migrate", status: "pending" },
        ],
      }),
    );
    expect(plan.kind).toBe("todos");
  });

  it("renders subagent tasks with type and model", () => {
    const view = describeActivity(
      activity("task.started", {
        taskId: "b1x3p48ti",
        taskType: "local_bash",
        title: "Check build",
        model: "claude-opus-5",
      }),
    );
    expect(view).toMatchObject({ kind: "task", taskType: "local_bash", model: "claude-opus-5", running: true });
  });

  it("reads provider-native toolName payloads and summarizes inputs", () => {
    const read = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_1",
        status: "completed",
        title: "Tool call",
        detail: "Read: {\"filePath\": \"C:/repo/src/tui/timeline.tsx\"}",
        data: { toolName: "Read", input: { filePath: "C:/repo/src/tui/timeline.tsx" } },
      }),
    );
    expect(read).toMatchObject({ kind: "read", path: "src/tui/timeline.tsx" });

    const fetch = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_2",
        status: "completed",
        title: "Tool call",
        detail: "WebFetch: {\"url\": \"https://example.com/x\"}",
        data: { toolName: "WebFetch", input: { url: "https://example.com/x", prompt: "summarize" } },
      }),
    );
    expect(fetch).toMatchObject({ kind: "web", tool: "WebFetch", query: "https://example.com/x" });

    const ask = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_3",
        status: "completed",
        title: "Tool call",
        detail: "AskUserQuestion: {}",
        data: {
          toolName: "AskUserQuestion",
          input: { questions: [{ question: "What next?", header: "Next", options: [] }] },
        },
      }),
    );
    expect(ask).toMatchObject({ kind: "question", title: "Asked 1 question", detail: "What next?" });
  });

  it("gives Claude's meta/orchestration tools a friendly title instead of the raw name", () => {
    const toolSearch = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_ts1",
        status: "completed",
        title: "Tool call",
        detail: 'ToolSearch: {"query":"WebFetch"}',
        data: { toolName: "ToolSearch", input: { query: "WebFetch" } },
      }),
    );
    expect(toolSearch).toMatchObject({ kind: "tool", tool: "Searching for tool", detail: "WebFetch" });
  });

  it("beautifies a raw mcp__server__tool name into 'server: tool'", () => {
    const mcpCall = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_mcp1",
        status: "completed",
        title: "Tool call",
        detail: "mcp__t3-code__preview_snapshot: {}",
        data: { toolName: "mcp__t3-code__preview_snapshot", input: {} },
      }),
    );
    expect(mcpCall).toMatchObject({ kind: "tool", tool: "t3-code: preview_snapshot" });
  });

  it("renders user-input.requested as the friendly question row", () => {
    const asked = describeActivity(
      activity("user-input.requested", {
        requestId: "req_1",
        questions: [{ id: "q1", header: "Next", question: "What do you mean?", options: [] }],
      }),
    );
    expect(asked).toMatchObject({
      kind: "question",
      title: "Asked 1 question",
      detail: "What do you mean?",
    });
  });

  it("hides the raw JSON echo under friendly-titled orchestration tools", () => {
    // Stripped wire input leaves only the `ExitPlanMode: {…}` echo — the
    // row keeps its friendly title but must not dump the JSON underneath.
    const exit = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_exit1",
        status: "completed",
        title: "Tool call",
        detail: 'ExitPlanMode: {"allowedPrompts":[{"tool":"Bash","prompt":"copy files"}]}',
        data: { toolName: "ExitPlanMode", input: {} },
      }),
    );
    expect(exit).toMatchObject({ kind: "tool", tool: "Exiting plan mode", detail: "" });
  });

  it("maps OpenCode's todo/apply_patch tool names onto the same views as Claude's", () => {
    const todo = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_todo1",
        status: "completed",
        title: "Tool call",
        detail: "todo: {}",
        data: { toolName: "todo", input: { todos: [{ content: "Ship it", status: "pending" }] } },
      }),
    );
    expect(todo).toMatchObject({ kind: "todos", items: [{ content: "Ship it", status: "pending" }] });

    const patch = describeActivity(
      activity("tool.completed", {
        itemType: "file_change",
        toolCallId: "toolu_patch1",
        status: "completed",
        title: "src/tui/app.tsx",
        data: { tool: "apply_patch", files: [{ path: "src/tui/app.tsx" }] },
      }),
    );
    expect(patch).toMatchObject({ kind: "file", verb: "Update", path: "tui/app.tsx" });
  });

  it("resolves Claude's snake_case file_path for provider-native Read and Write", () => {
    // Real shape from the live projection database: Claude's Read echoes
    // `Read: {…}` in `detail` but the row must resolve the path from
    // `input.file_path` — checking only camelCase `filePath` silently fell
    // back to the generic "Tool call" title instead.
    const read = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_011wH3XQHvvtjdNcJKvkPFhC",
        status: "completed",
        title: "Tool call",
        detail: 'Read: {"file_path":"/Users/aaron/Documents/t3code-cli/src/tui/timeline.tsx","offset":213,"limit":15}',
        data: {
          toolName: "Read",
          input: { file_path: "/Users/aaron/Documents/t3code-cli/src/tui/timeline.tsx", offset: 213, limit: 15 },
        },
      }),
    );
    expect(read).toMatchObject({ kind: "read", path: "src/tui/timeline.tsx" });

    // Same provider-native shape for Write: a `file_change` carrying
    // `toolName` (no `data.tool`/`data.files`) with the new content inline.
    // Must resolve to a Write(file) view with a real creation diff, not a
    // bare "Write(…)" row with no diff.
    const write = describeActivity(
      activity("tool.completed", {
        itemType: "file_change",
        toolCallId: "toolu_016SXsL9ZW3pFAjfZQueUTVt",
        status: "completed",
        title: "File change",
        data: {
          toolName: "Write",
          input: { file_path: "C:/repo/src/tui/notes.ts", content: "line1\nline2\nline3" },
        },
      }),
    );
    expect(write).toMatchObject({ kind: "file", verb: "Write", path: "src/tui/notes.ts", added: 3, removed: null });
    if (write.kind !== "file") throw new Error("unreachable");
    expect(write.diff).not.toBeNull();
    expect(write.diff).toContain("+line1");
  });

  it("recovers stripped wire payloads from the detail echo instead of rendering … or Tool call", () => {
    // Wire shape (what the TUI actually receives): the subscription strips
    // every `input` object, so completed Claude rows carry only
    // `data: {toolName}` plus the `Name: {json}` echo in `detail`.
    const read = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_01MxgYMc15m1DYfFwUWd39yD",
        status: "completed",
        title: "Tool call",
        detail: 'Read: {"file_path":"/Users/aaron/Documents/t3code-cli/node_modules/@opentui/core/renderables/Diff.d.ts"}',
        data: { toolName: "Read" },
      }),
    );
    expect(read).toMatchObject({ kind: "read", path: "renderables/Diff.d.ts" });

    // In-flight rows have no path anywhere (empty input, bare title), so
    // they render `Read(…)` — never the meaningless `Read(Tool call)`.
    const running = describeActivity(
      activity("tool.updated", {
        itemType: "dynamic_tool_call",
        toolCallId: "toolu_011wH3XQHvvtjdNcJKvkPFhC",
        status: "inProgress",
        title: "Tool call",
        data: { tool: "read", state: { status: "pending", input: {} } },
      }),
    );
    expect(running).toMatchObject({ kind: "read", path: "…", running: true });

    // Edit echoes are truncated to ~180 chars: the path still recovers via
    // the leading `file_path`, while the cut-off strings yield no diff.
    const edit = describeActivity(
      activity("tool.completed", {
        itemType: "file_change",
        toolCallId: "toolu_01JgXz1MGfkzznhH4qMZfQAb",
        status: "completed",
        title: "File change",
        detail:
          'Edit: {"file_path":"/Users/aaron/Documents/t3code-cli/src/catalog/catalog.ts","old_string":"export interface ProviderUsageLimits {\\n  checkedAt: string;\\n  windows: ProviderUsag...',
        data: { toolName: "Edit" },
      }),
    );
    expect(edit).toMatchObject({ kind: "file", verb: "Update", path: "src/catalog/catalog.ts", diff: null });

    // A tiny edit whose echo survives truncation still diffs normally.
    const tiny = describeActivity(
      activity("tool.completed", {
        itemType: "file_change",
        toolCallId: "toolu_tiny1",
        status: "completed",
        title: "File change",
        detail: 'Edit: {"file_path":"C:/repo/src/tui/a.ts","old_string":"x","new_string":"x\\ny"}',
        data: { toolName: "Edit" },
      }),
    );
    expect(tiny).toMatchObject({ kind: "file", verb: "Update", path: "src/tui/a.ts", added: 1, removed: 0 });
    if (tiny.kind !== "file") throw new Error("unreachable");
    expect(tiny.diff).not.toBeNull();

    // In-flight edits show the verb with an honest … path.
    const editing = describeActivity(
      activity("tool.updated", {
        itemType: "file_change",
        toolCallId: "toolu_01JgXz1MGfkzznhH4qMZfQAb",
        status: "inProgress",
        title: "File change",
        data: { toolName: "Edit", input: {} },
      }),
    );
    expect(editing).toMatchObject({ kind: "file", verb: "Update", path: "…" });
  });

  it("reads OpenCode's nameless XML result dumps as Read/List instead of a raw dump", () => {
    // File read: title already carries the relative path.
    const read = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "oc-read-1",
        status: "completed",
        title: "src/tui/timeline.tsx",
        detail:
          "<path>/Users/aaron/Documents/t3code-cli/src/tui/timeline.tsx</path>\n<type>file</type>\n<content>\n1: import type { RefObject } from \"react\";",
        data: {},
      }),
    );
    expect(read).toMatchObject({ kind: "read", path: "tui/timeline.tsx" });

    // No usable title: fall back to the absolute `<path>` tag.
    const untitled = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "oc-read-2",
        status: "completed",
        title: null,
        detail: "<path>/Users/aaron/Documents/t3code-cli/package.json</path>\n<type>file</type>\n<content>\n1: {",
        data: {},
      }),
    );
    expect(untitled).toMatchObject({ kind: "read", path: "t3code-cli/package.json" });

    // A listing row whose input survived (or came back via backfill) keeps
    // its section range instead of rendering bare.
    const ranged = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "oc-read-3",
        status: "completed",
        title: "src/tui/model/activity.ts",
        detail: "<path>C:/repo/src/tui/model/activity.ts</path>\n<type>file</type>\n<content>\n100: x",
        data: { input: { filePath: "C:/repo/src/tui/model/activity.ts", offset: 100, limit: 20 } },
      }),
    );
    expect(ranged).toMatchObject({ kind: "read", path: "model/activity.ts", startLine: 100, endLine: 119 });

    // Directory listings get their own header instead of an entries dump.
    const dir = describeActivity(
      activity("tool.completed", {
        itemType: "dynamic_tool_call",
        toolCallId: "oc-list-1",
        status: "completed",
        title: "src",
        detail: "<path>/Users/aaron/Documents/t3code-cli/src</path>\n<type>directory</type>\n<entries>\ncatalog/",
        data: {},
      }),
    );
    expect(dir).toMatchObject({ kind: "list", path: "t3code-cli/src" });
  });

  it("merges stripped inputs back without clobbering what the wire carried", () => {
    const stripped = activity("tool.completed", {
      itemType: "file_change",
      toolCallId: "call-db-1",
      status: "completed",
      title: "File change",
      data: { toolName: "Edit" },
    });
    expect(toolCallIdOf(stripped)).toBe("call-db-1");
    expect(toolCallIdOf(activity("tool.completed", {}))).toBeNull();
    // Bare diff-less file row wants its input back.
    expect(missingCompletedInput(stripped)).toBe("call-db-1");
    const merged = withCompletedInput(stripped, { file_path: "C:/repo/src/tui/a.ts", old_string: "x", new_string: "x\ny" });
    const view = describeActivity(merged);
    expect(view).toMatchObject({ kind: "file", verb: "Update", path: "src/tui/a.ts", added: 1, removed: 0 });
    // Never clobbers: rows that already carry input are left alone.
    const full = activity("tool.completed", {
      itemType: "file_change",
      toolCallId: "call-db-2",
      status: "completed",
      title: "File change",
      data: { toolName: "Edit", state: { status: "completed", input: { file_path: "C:/repo/keep.ts" } } },
    });
    expect(missingCompletedInput(full)).toBeNull();
    expect(withCompletedInput(full, { file_path: "C:/repo/other.ts" })).toBe(full);
    // In-flight and contentful rows never qualify.
    expect(missingCompletedInput(activity("tool.updated", { itemType: "file_change", toolCallId: "call-db-3", status: "inProgress", title: "edit", data: {} }))).toBeNull();
  });

  it("backfills stripped grep patterns and commands from the local DB", () => {
    const bareGrep = activity("tool.completed", {
      itemType: "dynamic_tool_call",
      toolCallId: "call-db-4",
      status: "completed",
      title: "grep",
      detail: "Found 2 matches\nC:/repo/src/tui/a.ts:\n",
      data: {},
    });
    expect(missingCompletedInput(bareGrep)).toBe("call-db-4");
    const mergedGrep = withCompletedInput(bareGrep, { pattern: "name", include: "*.ts" });
    expect(describeActivity(mergedGrep)).toMatchObject({ kind: "grep", pattern: "name", scope: "*.ts" });
    // A row whose pattern survived needs no backfill.
    const fullGrep = activity("tool.completed", {
      itemType: "dynamic_tool_call",
      toolCallId: "call-db-5",
      status: "completed",
      title: "grep",
      data: { toolName: "grep", input: { pattern: "name" } },
    });
    expect(missingCompletedInput(fullGrep)).toBeNull();
  });

  it("backfills stripped read ranges so repeated section reads stay distinct", () => {
    const bareRead = activity("tool.completed", {
      itemType: "dynamic_tool_call",
      toolCallId: "call-db-6",
      status: "completed",
      title: "src/tui/model/activity.ts",
      data: { toolName: "read" },
    });
    expect(describeActivity(bareRead)).toMatchObject({ kind: "read", startLine: null });
    expect(missingCompletedInput(bareRead)).toBe("call-db-6");
    const mergedRead = withCompletedInput(bareRead, {
      filePath: "C:/repo/src/tui/model/activity.ts",
      offset: 487,
      limit: 30,
    });
    expect(describeActivity(mergedRead)).toMatchObject({
      kind: "read",
      path: "src/tui/model/activity.ts",
      startLine: 487,
      endLine: 516,
    });
    expect(readRangeLabel(487, 516)).toBe("L487-L516");
  });

  it("matches subtitle counts to the hunks that actually render", () => {
    const view = {
      kind: "file" as const,
      verb: "Update",
      path: "src/tui/a.ts",
      fileCount: null,
      added: 1,
      removed: 1,
      diff: "diff",
      diffMore: 0,
      filetype: undefined,
      running: false,
    };
    // Exact per-edit counts beat turn-net checkpoint stats…
    expect(fileRowCounts(view, { added: 30, removed: 1 }, { additions: 30, deletions: 1 })).toEqual({
      added: 1,
      removed: 1,
    });
    // …checkpoint nets cover content-less rows…
    expect(
      fileRowCounts({ ...view, added: null, removed: null, diff: null }, { added: 30, removed: 1 }, null),
    ).toEqual({ added: 30, removed: 1 });
    // …and overlay counts cover the live working-tree case, which has neither.
    expect(fileRowCounts({ ...view, added: null, removed: null, diff: null }, null, { additions: 5, deletions: 0 })).toEqual({
      added: 5,
      removed: 0,
    });
    expect(fileRowCounts({ ...view, added: null, removed: null, diff: null }, null, null)).toEqual({
      added: null,
      removed: null,
    });
  });
});

describe("formatMs", () => {
  it("formats seconds and minutes", () => {
    expect(formatMs(5500)).toBe("5.5s");
    expect(formatMs(125_000)).toBe("2m 5s");
  });
});
