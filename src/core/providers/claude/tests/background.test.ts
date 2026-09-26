/**
 * In-between notes, turns Claude Code starts itself, and background tasks —
 * the message sequences below are the ones claude 2.1.281 was observed
 * sending (one SDK message per content block, blocks of one API response
 * sharing its `message.id`; a woken turn arriving after the previous
 * `result` with no prompt of ours, ending in a `result` whose `origin.kind`
 * is `task-notification`).
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Fiber from "effect/Fiber";
import { afterEach, describe, expect, it } from "vitest";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { ProviderRuntimeEvent } from "../../spi.js";
import { ClaudeDriver } from "../driver.js";
import { FakeTransport, initMessage, successResult } from "./fakes.js";

const START = { threadId: "thread-1", workingDirectory: "/repo" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function text(messageId: string, value: string): SDKMessage {
  return {
    type: "assistant",
    message: { id: messageId, content: [{ type: "text", text: value }], usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null,
    uuid: `u-${messageId}-${value.length}`,
    session_id: "session-1",
  } as unknown as SDKMessage;
}

function toolUse(messageId: string, id: string, name: string, input: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "assistant",
    message: { id: messageId, content: [{ type: "tool_use", id, name, input }], usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null,
    uuid: `u-${id}`,
    session_id: "session-1",
  } as unknown as SDKMessage;
}

function system(fields: Record<string, unknown>): SDKMessage {
  return { type: "system", uuid: `s-${Math.random()}`, session_id: "session-1", ...fields } as unknown as SDKMessage;
}

async function started() {
  const transport = new FakeTransport([[initMessage()]]);
  const driver = new ClaudeDriver({ transport });
  const events: ProviderRuntimeEvent[] = [];
  const fiber = Effect.runFork(Stream.runForEach(driver.streamEvents, (event) => Effect.sync(() => void events.push(event))));
  await Effect.runPromise(driver.startSession(START));
  await sleep(20);
  const push = (message: SDKMessage) => transport.created[0]!.push(message);
  const stop = () => Effect.runPromise(Fiber.interrupt(fiber));
  return { driver, events, push, stop, transport };
}

const ofType = <T extends ProviderRuntimeEvent["type"]>(events: ProviderRuntimeEvent[], type: T) =>
  events.filter((event): event is Extract<ProviderRuntimeEvent, { type: T }> => event.type === type);

describe("claude in-between notes", () => {
  it("publishes text followed by a tool call as a note, and never the final answer", async () => {
    const { driver, events, push, stop } = await started();
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    const outcome = driver.awaitTurn("thread-1", sent.turnId);
    push(text("msg_1", "Let me look at the config first."));
    push(toolUse("msg_1", "tu-1", "Read", { file_path: "/repo/a.ts" }));
    push(text("msg_2", "It exports one function."));
    push(successResult("It exports one function."));
    expect((await outcome).text).toBe("It exports one function.");
    await sleep(10);
    await stop();
    expect(ofType(events, "assistant.note").map((note) => [note.messageId, note.text])).toEqual([
      ["msg_1", "Let me look at the config first."],
    ]);
    // Every streamed delta names the message it belongs to.
    expect(ofType(events, "message.part.updated").map((part) => part.messageId)).toEqual(["msg_1", "msg_2"]);
  });
});

describe("claude background turns and tasks", () => {
  it("records a turn Claude Code starts itself, and settles it on its own result", async () => {
    const { driver, events, push, stop } = await started();
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "watch it" }));
    const first = driver.awaitTurn("thread-1", sent.turnId);
    push(toolUse("msg_1", "tu-m", "Monitor", { command: "tail -f log", description: "log" }));
    push(system({ subtype: "background_tasks_changed", tasks: [{ task_id: "t1", task_type: "local_bash", description: "log" }] }));
    push(system({ subtype: "task_started", task_id: "t1", tool_use_id: "tu-m", description: "log", task_type: "local_bash", is_backgrounded: true }));
    push(text("msg_2", "Monitor armed."));
    push(successResult("Monitor armed."));
    expect((await first).status).toBe("completed");

    // Woken by a Monitor event: no prompt of ours.
    push(system({ subtype: "init", session_id: "session-1", model: "claude-opus-5" }));
    push(text("msg_3", "tick-1"));
    await sleep(10);
    const woke = ofType(events, "turn.started");
    expect(woke).toHaveLength(1);
    expect(woke[0]!.origin).toBe("background");
    const second = driver.awaitTurn("thread-1", woke[0]!.turnId);
    push(successResult("tick-1", 0.01, { origin: { kind: "task-notification" } }));
    expect(await second).toMatchObject({ status: "completed", text: "tick-1" });

    expect(driver.backgroundTasks("thread-1")).toEqual([
      { taskId: "t1", taskType: "local_bash", description: "log", toolName: "Monitor", command: "tail -f log", startedAt: expect.any(String) },
    ]);
    push(system({ subtype: "task_notification", task_id: "t1", tool_use_id: "tu-m", status: "completed", output_file: "/tmp/o", summary: "done" }));
    push(system({ subtype: "background_tasks_changed", tasks: [] }));
    await sleep(10);
    await stop();
    // The completion notice has no description; it is the one from the start.
    expect(ofType(events, "background.task").map((task) => [task.taskId, task.status, task.description])).toEqual([
      ["t1", "started", "log"],
      ["t1", "completed", "log"],
    ]);
    expect(driver.backgroundTasks("thread-1")).toEqual([]);
  });

  it("ignores ambient tasks, and never mistakes an interrupted run's tail for a new turn", async () => {
    const { driver, events, push, stop } = await started();
    push(system({ subtype: "task_started", task_id: "amb", description: "housekeeping", ambient: true }));
    push(system({ subtype: "background_tasks_changed", tasks: [{ task_id: "amb", task_type: "local_bash", description: "x", ambient: true }] }));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    const outcome = driver.awaitTurn("thread-1", sent.turnId);
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    expect((await outcome).status).toBe("interrupted");
    // The cut-off run's stragglers, then its own result.
    push(text("msg_9", "partial"));
    push(successResult("partial"));
    await sleep(10);
    await stop();
    expect(ofType(events, "turn.started")).toHaveLength(0);
    expect(ofType(events, "background.task")).toHaveLength(0);
    expect(driver.backgroundTasks("thread-1")).toEqual([]);
  });

  it("tracks a task auto-backgrounded mid-flight even when the CLI never sends background_tasks_changed for it", async () => {
    // Observed on claude 2.1.281: a plain `Bash` call the CLI promotes to
    // background after it runs long gets `task_started`/`task_notification`
    // but no matching level update — the live set must still reflect it, or
    // any client that only reads `background_tasks_changed` (the panel this
    // was reported against) never shows it running.
    const { driver, push, stop } = await started();
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "run the tests" }));
    const outcome = driver.awaitTurn("thread-1", sent.turnId);
    push(toolUse("msg_1", "tu-check", "Bash", { command: "bun run check", description: "Typecheck and run test suite" }));
    push(system({ subtype: "task_started", task_id: "b1", tool_use_id: "tu-check", description: "Typecheck and run test suite", task_type: "local_bash" }));
    push(text("msg_2", "Running checks."));
    push(successResult("Running checks."));
    await outcome;
    expect(driver.backgroundTasks("thread-1")).toEqual([
      {
        taskId: "b1",
        taskType: "local_bash",
        description: "Typecheck and run test suite",
        toolName: "Bash",
        command: "bun run check",
        startedAt: expect.any(String),
      },
    ]);
    push(system({ subtype: "task_notification", task_id: "b1", tool_use_id: "tu-check", status: "completed", output_file: "/tmp/o", summary: "done" }));
    await sleep(10);
    await stop();
    expect(driver.backgroundTasks("thread-1")).toEqual([]);
  });

  it("keeps a task's name when the ids-only level signal arrives before its task_started", async () => {
    // The SDK documents `background_tasks_changed` as ids-only and preceding
    // the edges in practice: the entry it creates must pick its description
    // up from the `task_started` that follows, not stay nameless.
    const { driver, push, stop } = await started();
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "tick" }));
    push(toolUse("msg_1", "tu-tick", "Bash", { command: "for i in 1 2 3; do sleep 1; done" }));
    push(system({ subtype: "background_tasks_changed", tasks: [{ task_id: "b1", task_type: "local_bash", description: "" }] }));
    push(system({ subtype: "task_started", task_id: "b1", tool_use_id: "tu-tick", description: "Tick every second", task_type: "local_bash" }));
    await sleep(10);
    expect(driver.backgroundTasks("thread-1")).toEqual([
      expect.objectContaining({ taskId: "b1", description: "Tick every second", toolName: "Bash", command: "for i in 1 2 3; do sleep 1; done" }),
    ]);
    // A later level update without a description keeps the known one.
    push(system({ subtype: "background_tasks_changed", tasks: [{ task_id: "b1", task_type: "local_bash", description: "" }] }));
    await sleep(10);
    expect(driver.backgroundTasks("thread-1")[0]?.description).toBe("Tick every second");
    await stop();
  });

  it("treats a foreground task as background work only once task_updated backgrounds it, and drops it on a terminal patch", async () => {
    const { driver, events, push, stop } = await started();
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "sleep" }));
    push(toolUse("msg_1", "tu-long", "Bash", { command: "sleep 60" }));
    push(system({ subtype: "task_started", task_id: "b2", tool_use_id: "tu-long", description: "Sleep a minute", task_type: "local_bash", is_backgrounded: false }));
    await sleep(10);
    expect(driver.backgroundTasks("thread-1")).toEqual([]);
    expect(events.some((event) => event.type === "background.task")).toBe(false);

    push(system({ subtype: "task_updated", task_id: "b2", patch: { is_backgrounded: true } }));
    await sleep(10);
    expect(driver.backgroundTasks("thread-1")).toEqual([
      expect.objectContaining({ taskId: "b2", description: "Sleep a minute", toolName: "Bash", command: "sleep 60" }),
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: "background.task", taskId: "b2", status: "started", description: "Sleep a minute" }));

    // No task_notification and no level update: the patch alone settles it.
    push(system({ subtype: "task_updated", task_id: "b2", patch: { status: "completed", end_time: Date.now() } }));
    await sleep(10);
    expect(driver.backgroundTasks("thread-1")).toEqual([]);
    await stop();
  });

  it("records nothing for a task that settles while still in the foreground", async () => {
    const { driver, events, push, stop } = await started();
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "explore" }));
    push(system({ subtype: "task_started", task_id: "a1", description: "Explore the repo", task_type: "local_agent", is_backgrounded: false }));
    push(system({ subtype: "task_notification", task_id: "a1", status: "completed", output_file: "/tmp/o", summary: "done" }));
    await sleep(10);
    expect(driver.backgroundTasks("thread-1")).toEqual([]);
    expect(events.some((event) => event.type === "background.task" || event.type === "background.tasks.changed")).toBe(false);
    await stop();
  });

  it("refuses to stop a task that is not running", async () => {
    const { driver, stop } = await started();
    const failure = await Effect.runPromise(Effect.flip(driver.stopBackgroundTask("thread-1", "nope")));
    await stop();
    expect(failure.code).toBe("BACKGROUND_TASK_NOT_FOUND");
  });

  describe("output file", () => {
    const outputDir = path.join(os.tmpdir(), "claude", "-repo", "session-1", "tasks");
    afterEach(() => rm(path.join(os.tmpdir(), "claude", "-repo"), { recursive: true, force: true }));

    it("reads a task's output off the CLI's own file convention", async () => {
      const { driver, stop } = await started();
      await mkdir(outputDir, { recursive: true });
      await writeFile(path.join(outputDir, "t1.output"), "tick 1\ntick 2\n");
      expect(await driver.backgroundTaskOutput("thread-1", "t1")).toEqual({ lines: ["tick 1", "tick 2"] });
      await stop();
    });

    it("degrades to null instead of throwing when nothing has been written yet", async () => {
      const { driver, stop } = await started();
      expect(await driver.backgroundTaskOutput("thread-1", "never-written")).toBeNull();
      await stop();
    });

    it("returns null once the session is gone", async () => {
      const transport = new FakeTransport([[initMessage()]]);
      const driver = new ClaudeDriver({ transport });
      expect(await driver.backgroundTaskOutput("thread-1", "t1")).toBeNull();
    });
  });
});

describe("claude live checklist (TodoWrite)", () => {
  it("publishes a checklist from the call itself, mapping content/in_progress to step/inProgress", async () => {
    const { driver, events, push, stop } = await started();
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    const outcome = driver.awaitTurn("thread-1", sent.turnId);
    push(
      toolUse("msg_1", "tu-1", "TodoWrite", {
        todos: [
          { content: "Write the plan", status: "completed", activeForm: "Writing the plan" },
          { content: "Implement it", status: "in_progress", activeForm: "Implementing it" },
          { content: "Ship it", status: "pending", activeForm: "Shipping it" },
        ],
      }),
    );
    push(text("msg_2", "On it."));
    push(successResult("Done."));
    await outcome;
    await stop();
    const plans = ofType(events, "turn.plan.updated");
    expect(plans).toHaveLength(1);
    expect((plans[0]!.raw as { plan: unknown }).plan).toEqual([
      { step: "Write the plan", status: "completed" },
      { step: "Implement it", status: "inProgress" },
      { step: "Ship it", status: "pending" },
    ]);
  });

  it("ignores a malformed TodoWrite call instead of publishing a bad checklist", async () => {
    const { driver, events, push, stop } = await started();
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    const outcome = driver.awaitTurn("thread-1", sent.turnId);
    push(toolUse("msg_1", "tu-1", "TodoWrite", { notTodos: true }));
    push(successResult("Done."));
    await outcome;
    await stop();
    expect(ofType(events, "turn.plan.updated")).toHaveLength(0);
  });
});

/** A tool's result as the SDK delivers it: a `user` message with the `tool_result` block and the structured output beside it. */
function toolResult(toolUseId: string, output: unknown, isError = false): SDKMessage {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok", is_error: isError }] },
    parent_tool_use_id: null,
    tool_use_result: output,
    uuid: `r-${toolUseId}`,
    session_id: "session-1",
  } as unknown as SDKMessage;
}

describe("claude live checklist (Task tools)", () => {
  const lastPlan = (events: ProviderRuntimeEvent[]) => {
    const plans = ofType(events, "turn.plan.updated");
    return (plans[plans.length - 1]?.raw as { plan: unknown } | undefined)?.plan;
  };

  it("opts every session into the task-tracking tools, which newer models otherwise lack", async () => {
    const { transport, stop } = await started();
    expect(transport.created[0]!.options.env?.["CLAUDE_CODE_ENABLE_TODO_TOOLS"]).toBe("1");
    await stop();
  });

  it("keeps a user's explicit opt-out", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport, env: { ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: "0" } });
    await Effect.runPromise(driver.startSession(START));
    expect(transport.created[0]!.options.env?.["CLAUDE_CODE_ENABLE_TODO_TOOLS"]).toBe("0");
  });

  it("builds the checklist from TaskCreate results and TaskUpdate calls, in creation order", async () => {
    const { driver, events, push, stop } = await started();
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    push(toolUse("msg_1", "tc-1", "TaskCreate", { subject: "Fix the popover", description: "…", activeForm: "Fixing the popover" }));
    push(toolResult("tc-1", { task: { id: "1", subject: "Fix the popover" } }));
    push(toolUse("msg_2", "tc-2", "TaskCreate", { subject: "Fix background tasks", description: "…" }));
    push(toolResult("tc-2", { task: { id: "2", subject: "Fix background tasks" } }));
    await sleep(10);
    expect(lastPlan(events)).toEqual([
      { step: "Fix the popover", status: "pending" },
      { step: "Fix background tasks", status: "pending" },
    ]);

    push(toolUse("msg_3", "tu-1", "TaskUpdate", { taskId: "1", status: "completed" }));
    // The streamed input is the model's raw shape: `id` instead of `taskId`.
    push(toolUse("msg_4", "tu-2", "TaskUpdate", { id: "2", status: "in_progress" }));
    await sleep(10);
    expect(lastPlan(events)).toEqual([
      { step: "Fix the popover", status: "completed" },
      { step: "Fix background tasks", status: "inProgress" },
    ]);

    push(toolUse("msg_5", "tu-3", "TaskUpdate", { taskId: "1", status: "deleted" }));
    await sleep(10);
    expect(lastPlan(events)).toEqual([{ step: "Fix background tasks", status: "inProgress" }]);
    await stop();
  });

  it("adds nothing for a failed TaskCreate, and resyncs to a TaskList result", async () => {
    const { driver, events, push, stop } = await started();
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    push(toolUse("msg_1", "tc-1", "TaskCreate", { subject: "Doomed" }));
    push(toolResult("tc-1", null, true));
    await sleep(10);
    expect(ofType(events, "turn.plan.updated")).toHaveLength(0);

    push(toolUse("msg_2", "tl-1", "TaskList", {}));
    push(
      toolResult("tl-1", {
        tasks: [
          { id: "7", subject: "Restored one", status: "completed", blockedBy: [] },
          { id: "8", subject: "Restored two", status: "in_progress", blockedBy: [] },
        ],
      }),
    );
    await sleep(10);
    expect(lastPlan(events)).toEqual([
      { step: "Restored one", status: "completed" },
      { step: "Restored two", status: "inProgress" },
    ]);
    await stop();
  });
});
