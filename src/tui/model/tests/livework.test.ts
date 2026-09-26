/**
 * The in-between messages and background work as the TUI receives them:
 * streamed text in the wire's own shape (`payload.message`), snapshots that
 * must not wipe it, notes folding between tool calls, background tasks.
 */
import { describe, expect, it } from "vitest";

import type { ActivityEnvelope } from "../../../core/types.js";
import { describeActivity } from "../activity.js";
import {
  applyThreadFrame,
  backgroundSummaryLabel,
  backgroundTaskKind,
  backgroundTaskTitle,
  emptyThreadState,
  latestBackgroundTasks,
  timeline,
  type ThreadState,
} from "../thread.js";
import { groupTurns, segmentWork } from "../turns.js";

const T = (seconds: number) => new Date(Date.UTC(2026, 8, 24, 10, 0, seconds)).toISOString();

/** A streamed delta exactly as the server bridge sends it. */
function streamed(id: string, text: string, at: number, turnId = "turn-1") {
  return {
    kind: "event",
    event: {
      type: "thread.message-sent",
      payload: { message: { id, role: "assistant", text, turnId, streaming: true, createdAt: T(at), updatedAt: T(at) } },
    },
  };
}

function snapshot(fields: { messages?: unknown[]; activities?: unknown[]; running?: boolean }) {
  return {
    kind: "snapshot",
    snapshot: {
      snapshotSequence: 1,
      thread: {
        id: "thread-1",
        messages: fields.messages ?? [],
        activities: fields.activities ?? [],
        latestTurn: { turnId: "turn-1", state: fields.running === false ? "completed" : "running", requestedAt: T(0), startedAt: T(0), completedAt: null, assistantMessageId: null },
      },
    },
  };
}

const prompt = { id: "u1", role: "user", text: "Fix the build", turnId: "turn-1", createdAt: T(0) };
const tool = (id: string, at: number) => ({
  id,
  kind: "tool.completed",
  summary: "Read",
  turnId: "turn-1",
  createdAt: T(at),
  payload: { itemType: "dynamic_tool_call", toolCallId: id, status: "completed", title: "Read", data: { toolName: "Read", input: { file_path: "/repo/a.ts" } } },
});

describe("live in-between messages", () => {
  it("shows streamed text sent in the wire's nested shape", () => {
    let state: ThreadState = applyThreadFrame(emptyThreadState(), snapshot({ messages: [prompt] }));
    state = applyThreadFrame(state, streamed("turn-1:m1", "Checking ", 1));
    state = applyThreadFrame(state, streamed("turn-1:m1", "the config.", 1));
    expect(state.messages.find((message) => message.id === "turn-1:m1")?.text).toBe("Checking the config.");
  });

  it("keeps a message streaming across a snapshot, and lets the stored note replace it", () => {
    let state: ThreadState = applyThreadFrame(emptyThreadState(), snapshot({ messages: [prompt] }));
    state = applyThreadFrame(state, streamed("turn-1:m1", "Checking the config.", 1));
    // A tool row lands: the snapshot lists stored rows only.
    state = applyThreadFrame(state, snapshot({ messages: [prompt], activities: [tool("c1", 2)] }));
    expect(state.messages.find((message) => message.id === "turn-1:m1")?.text).toBe("Checking the config.");
    // The note is stored under the same id: one row, no longer streaming.
    const note = { id: "turn-1:m1", role: "assistant", text: "Checking the config.", turnId: "turn-1", createdAt: T(1) };
    state = applyThreadFrame(state, snapshot({ messages: [prompt, note], activities: [tool("c1", 2)] }));
    const rows = state.messages.filter((message) => message.id === "turn-1:m1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.streaming).toBe(false);
  });

  it("drops leftover stream text once the turn is over", () => {
    let state: ThreadState = applyThreadFrame(emptyThreadState(), snapshot({ messages: [prompt] }));
    state = applyThreadFrame(state, streamed("turn-1:m9", "partial", 1));
    state = applyThreadFrame(state, snapshot({ messages: [prompt], running: false }));
    expect(state.messages.map((message) => message.id)).toEqual(["u1"]);
  });

  it("folds notes between the tool calls they narrate, with the answer closing the turn", () => {
    const messages = [
      prompt,
      { id: "turn-1:m1", role: "assistant", text: "Checking the config.", turnId: "turn-1", createdAt: T(1) },
      { id: "turn-1:m2", role: "assistant", text: "Found it; fixing the import.", turnId: "turn-1", createdAt: T(3) },
      { id: "a-final", role: "assistant", text: "Fixed: the build passes.", turnId: "turn-1", createdAt: T(5) },
    ];
    const state = applyThreadFrame(emptyThreadState(), snapshot({ messages, activities: [tool("c1", 2), tool("c2", 4)], running: false }));
    const [group] = groupTurns(timeline(state));
    expect(group!.reply?.text).toBe("Fixed: the build passes.");
    const segments = segmentWork(group!.work, group!.reply);
    expect(segments.map((segment) => [segment.tools.length, segment.message?.text ?? null])).toEqual([
      [0, "Checking the config."],
      [1, "Found it; fixing the import."],
      [1, "Fixed: the build passes."],
    ]);
  });
});

describe("background work in the TUI", () => {
  const row = (id: string, kind: string, at: number, payload: Record<string, unknown>, summary = kind): ActivityEnvelope =>
    ({ id, kind, summary, turnId: "turn-1", createdAt: T(at), tone: "info", payload }) as ActivityEnvelope;

  it("never shows a nameless task: description, else the command's first line, else the id", () => {
    expect(backgroundTaskTitle({ taskId: "b1", description: "Tick every 10s", command: "sleep 10" })).toBe("Tick every 10s");
    expect(backgroundTaskTitle({ taskId: "b1", description: "  ", command: "for i in 1 2; do\n  sleep 1\ndone" })).toBe("for i in 1 2; do");
    expect(backgroundTaskTitle({ taskId: "b1", description: "", command: null })).toBe("b1");
  });

  it("names each kind by its tool, falling back to the task type", () => {
    expect(backgroundTaskKind({ toolName: "Bash", taskType: "local_bash" })).toBe("shell");
    expect(backgroundTaskKind({ toolName: "Monitor", taskType: "local_bash" })).toBe("monitor");
    expect(backgroundTaskKind({ toolName: null, taskType: "local_agent" })).toBe("agent");
    expect(backgroundTaskKind({ toolName: null, taskType: "local_bash" })).toBe("shell");
    expect(
      backgroundSummaryLabel([
        { taskId: "a", taskType: "local_bash", description: "", toolName: "Bash", command: null, startedAt: null },
        { taskId: "b", taskType: "local_agent", description: "", toolName: null, command: null, startedAt: null },
      ]),
    ).toBe("1 shell, 1 agent");
  });

  it("lists what the latest background set says is running", () => {
    const tasks = [{ taskId: "b1", taskType: "local_bash", description: "watch the log", toolName: "Bash", command: "tail -f build.log" }];
    let state = applyThreadFrame(emptyThreadState(), snapshot({ activities: [row("r1", "background.tasks", 1, { tasks })] }));
    expect(latestBackgroundTasks(state)).toEqual([{ ...tasks[0], startedAt: null }]);
    state = applyThreadFrame(state, snapshot({ activities: [row("r1", "background.tasks", 1, { tasks }), row("r2", "background.tasks", 2, { tasks: [] })] }));
    expect(latestBackgroundTasks(state)).toEqual([]);
  });

  it("collapses a background task into one card that goes running → finished, and hides the live-set rows", () => {
    const finished = row("r3", "background.completed", 3, { title: "watch the log", taskId: "b1", status: "completed", taskType: "local_bash" });
    expect(describeActivity(finished)).toMatchObject({ kind: "task", title: "watch the log", status: "completed", running: false });
    const state = applyThreadFrame(
      emptyThreadState(),
      snapshot({
        messages: [prompt],
        activities: [row("r1", "background.tasks", 1, { tasks: [] }), row("r2", "background.started", 2, { taskId: "b1" }), finished],
      }),
    );
    const cards = timeline(state).filter((entry) => entry.kind === "activity");
    // One card, at the task's start, carrying its latest state.
    expect(cards.map((entry) => [entry.id, entry.activity?.kind])).toEqual([["r2", "background.completed"]]);
    const running = row("r2", "background.started", 2, { title: "watch the log", taskId: "b1", status: "started" });
    expect(describeActivity(running)).toMatchObject({ kind: "task", running: true });
  });

  it("renders a Monitor call as a command card", () => {
    const monitor = row("m1", "tool.completed", 1, {
      itemType: "command_execution",
      toolCallId: "tu-m",
      status: "completed",
      title: "Monitor",
      data: { tool: "Monitor", state: { status: "completed", input: { command: "tail -f build.log", description: "build" } } },
    });
    expect(describeActivity(monitor)).toMatchObject({ kind: "command", tool: "Monitor", command: "tail -f build.log" });
  });
});
