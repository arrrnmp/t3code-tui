import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { CliError } from "../../../errors.js";
import type { ProviderRuntimeEvent } from "../../spi.js";
import { ClaudeDriver } from "../driver.js";
import {
  assistantText,
  assistantToolUse,
  compactBoundary,
  errorResult,
  FakeSessionApi,
  FakeTransport,
  historyToolResult,
  historyUser,
  initMessage,
  permissionCallbackOptions,
  rateLimitEvent,
  successResult,
} from "./fakes.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function collectEvents(driver: ClaudeDriver, count: number): Promise<ProviderRuntimeEvent[]> {
  const chunk = await Effect.runPromise(Stream.runCollect(Stream.take(driver.streamEvents, count)));
  return [...chunk];
}

function openedRequestId(events: ProviderRuntimeEvent[], type: string): string {
  const opened = events.find((event) => event.type === type);
  expect(opened).toBeDefined();
  return (opened as { requestId: string }).requestId;
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (cause) {
    if (cause instanceof CliError) return cause.code;
    throw cause;
  }
  throw new Error("expected a CliError");
}

const START = { threadId: "thread-1", workingDirectory: "/repo" };

describe("claude driver turns", () => {
  it("starts a session and runs a turn to completion", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    expect(await Effect.runPromise(driver.hasSession("thread-1"))).toBe(true);
    await sleep(20);

    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    transport.created[0]!.push(assistantText("hello", { input_tokens: 10, output_tokens: 5 }));
    transport.created[0]!.push(successResult("hello", 0.02));
    const outcome = await outcomePromise;
    expect(outcome.status).toBe("completed");
    expect(outcome.text).toBe("hello");
    expect(outcome.usage).toMatchObject({ input: 10, output: 5, costUsd: 0.02 });

    const snapshot = await Effect.runPromise(driver.readThread("thread-1"));
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]!.items.map((item) => (item as { kind: string }).kind)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("rejects sends without a session and concurrent turns", async () => {
    const driver = new ClaudeDriver({ transport: new FakeTransport([]) });
    expect(await codeOf(() => Effect.runPromise(driver.sendTurn({ threadId: "t-x", prompt: "hi" })))).toBe(
      "CLAUDE_NOT_STARTED",
    );

    const driver2 = new ClaudeDriver({ transport: new FakeTransport([[initMessage()]]) });
    await Effect.runPromise(driver2.startSession(START));
    await Effect.runPromise(driver2.sendTurn({ threadId: "thread-1", prompt: "one" }));
    expect(await codeOf(() => Effect.runPromise(driver2.sendTurn({ threadId: "thread-1", prompt: "two" })))).toBe(
      "TURN_BUSY",
    );
  });

  it("interrupts a running turn", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    await expect(outcomePromise).resolves.toMatchObject({ status: "interrupted" });
    expect(transport.created[0]!.interrupted).toBe(1);
  });

  it("fails turns on error results", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    transport.created[0]!.push(errorResult());
    const outcome = await outcomePromise;
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("boom");
  });
});

describe("claude driver permissions", () => {
  async function parkedSetup() {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    const eventsPromise = collectEvents(driver, 3);
    await Effect.runPromise(driver.startSession({ ...START, runtimeMode: "approval-required" }));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    transport.created[0]!.push(assistantToolUse("tu-1", "Bash"));
    await sleep(20);
    const pending = driver.handlePermissionRequest(
      "Bash",
      { command: "ls" },
      permissionCallbackOptions("tu-1"),
    );
    const events = await eventsPromise;
    return { driver, pending, events };
  }

  it("parks tool requests until answered", async () => {
    const { driver, pending, events } = await parkedSetup();
    expect(events.map((event) => event.type)).toContain("permission.request.opened");
    const requestId = openedRequestId(events, "permission.request.opened");

    await Effect.runPromise(driver.respondToRequest("thread-1", requestId, { kind: "accept" }));
    await expect(pending).resolves.toMatchObject({ behavior: "allow" });
  });

  it("acceptForSession allows later tools without parking", async () => {
    const { driver, pending, events } = await parkedSetup();
    const requestId = openedRequestId(events, "permission.request.opened");
    await Effect.runPromise(driver.respondToRequest("thread-1", requestId, { kind: "acceptForSession" }));
    await expect(pending).resolves.toMatchObject({ behavior: "allow" });

    const second = await driver.handlePermissionRequest(
      "Bash",
      { command: "pwd" },
      permissionCallbackOptions("tu-2"),
    );
    expect(second).toMatchObject({ behavior: "allow" });
  });

  it("cancels with interrupt and rejects unknown requests", async () => {
    const { driver, pending, events } = await parkedSetup();
    const requestId = openedRequestId(events, "permission.request.opened");
    expect(
      await codeOf(() => Effect.runPromise(driver.respondToRequest("thread-1", "nope", { kind: "accept" }))),
    ).toBe("REQUEST_UNKNOWN");
    await Effect.runPromise(driver.respondToRequest("thread-1", requestId, { kind: "cancel" }));
    await expect(pending).resolves.toMatchObject({ behavior: "deny", interrupt: true });
  });

  it("surfaces AskUserQuestion and resolves answers", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    const eventsPromise = collectEvents(driver, 2);
    await Effect.runPromise(driver.startSession(START));
    const pending = driver.handlePermissionRequest(
      "AskUserQuestion",
      { questions: [{ question: "Which?", options: [] }] },
      permissionCallbackOptions(),
    );
    const events = await eventsPromise;
    const requestId = openedRequestId(events, "user-input.request.opened");
    await Effect.runPromise(driver.respondToUserInput("thread-1", requestId, { Which: "this" }));
    await expect(pending).resolves.toMatchObject({
      behavior: "allow",
      updatedInput: { answers: { Which: "this" } },
    });
  });

  it("captures ExitPlanMode as a plan then denies", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    const eventsPromise = collectEvents(driver, 2);
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "plan it" }));
    const result = await driver.handlePermissionRequest(
      "ExitPlanMode",
      { plan: "# The plan" },
      permissionCallbackOptions(),
    );
    expect(result).toMatchObject({ behavior: "deny" });
    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toContain("turn.plan.updated");
  });

  it("allows everything in full-access except questions", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    const allowed = await driver.handlePermissionRequest(
      "Bash",
      { command: "ls" },
      permissionCallbackOptions(),
    );
    expect(allowed).toMatchObject({ behavior: "allow" });
  });
});

describe("claude driver compaction, limits, rollback", () => {
  it("observes compaction and resets usage", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    const eventsPromise = collectEvents(driver, 6);
    await Effect.runPromise(driver.startSession(START));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    const query = transport.created[0]!;
    query.push(assistantText("a", { input_tokens: 10, output_tokens: 5 }));
    query.push(compactBoundary(100, 20));
    query.push(assistantText("b", { input_tokens: 3, output_tokens: 1 }));
    query.push(successResult("b"));
    const outcome = await outcomePromise;
    expect(outcome.usage).toMatchObject({ input: 3, output: 1 });
    const events = await eventsPromise;
    expect(
      events.find(
        (event) => event.type === "thread.state.changed" && event.state === "compacted",
      ),
    ).toBeDefined();
  });

  it("announces rate-limited pauses once per turn", async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 5400;
    const info = { status: "rejected", rateLimitType: "five_hour", resetsAt };
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    const eventsPromise = collectEvents(driver, 6);
    await Effect.runPromise(driver.startSession(START));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    const query = transport.created[0]!;
    query.push(rateLimitEvent(info));
    query.push(rateLimitEvent(info));
    query.push(successResult("done"));
    await outcomePromise;
    const events = await eventsPromise;
    const byType = (type: ProviderRuntimeEvent["type"]): ProviderRuntimeEvent[] =>
      events.filter((event) => event.type === type);
    expect(byType("rate-limits.updated")).toHaveLength(2);
    expect(
      events.filter(
        (event) => event.type === "thread.state.changed" && event.state === "rate-limited",
      ),
    ).toHaveLength(1);
    expect(byType("rate-limits.updated")[0]).toMatchObject({
      windows: [{ id: "session", exhausted: true }],
    });
  });

  it("rolls back via fork and validates input", async () => {
    const api = new FakeSessionApi([historyUser("u-1", "one"), historyToolResult("tr-1"), historyUser("u-2", "two")]);
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport, sessionApi: api });
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "three" }));

    const snapshot = await Effect.runPromise(driver.rollbackThread("thread-1", 1));
    expect(api.forks).toEqual([{ sessionId: "session-1", upToMessageId: "u-2" }]);
    expect(transport.created[1]!.options.resume).toBe("forked-session");
    expect(snapshot.turns).toHaveLength(0);

    expect(await codeOf(() => Effect.runPromise(driver.rollbackThread("thread-1", 0)))).toBe(
      "INVALID_ROLLBACK",
    );
  });

  it("refuses rollback past a compaction boundary", async () => {
    const api = new FakeSessionApi([historyUser("u-1", "one"), historyUser("u-2", "two")]);
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport, sessionApi: api });
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "three" }));
    transport.created[0]!.push(compactBoundary());
    await sleep(20);
    expect(await codeOf(() => Effect.runPromise(driver.rollbackThread("thread-1", 1)))).toBe(
      "ROLLBACK_UNAVAILABLE",
    );
    expect(api.forks).toEqual([]);
  });
});

describe("claude driver session controls", () => {
  it("switches model and plan mode per turn", async () => {
    const transport = new FakeTransport([[initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    const first = await Effect.runPromise(
      driver.sendTurn({
        threadId: "thread-1",
        prompt: "hi",
        modelSelection: { instanceId: "claude", model: "new-model" },
        interactionMode: "plan",
      }),
    );
    const firstOutcome = driver.awaitTurn("thread-1", first.turnId);
    transport.created[0]!.push(successResult("ok"));
    await firstOutcome;
    expect(transport.created[0]!.models).toEqual(["new-model"]);
    expect(transport.created[0]!.permissionModes).toEqual(["plan"]);

    const second = await Effect.runPromise(
      driver.sendTurn({ threadId: "thread-1", prompt: "again", interactionMode: "default" }),
    );
    const secondOutcome = driver.awaitTurn("thread-1", second.turnId);
    transport.created[0]!.push(successResult("ok2"));
    await secondOutcome;
    expect(transport.created[0]!.permissionModes).toEqual(["plan", "bypassPermissions"]);
  });

  it("stops sessions", async () => {
    const transport = new FakeTransport([[initMessage()], [initMessage()]]);
    const driver = new ClaudeDriver({ transport });
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(driver.startSession({ threadId: "thread-2", workingDirectory: "/repo" }));
    expect(await Effect.runPromise(driver.listSessions())).toHaveLength(2);
    await Effect.runPromise(driver.stopSession("thread-1"));
    expect(await Effect.runPromise(driver.hasSession("thread-1"))).toBe(false);
    await Effect.runPromise(driver.stopAll());
    expect(await Effect.runPromise(driver.listSessions())).toHaveLength(0);
  });

  it("probes usage windows best-effort", async () => {
    const transport = new FakeTransport([[initMessage()]], [
      {
        session: { total_cost_usd: 2 },
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 10, resets_at: "2026-09-20T17:00:00.000Z" },
        },
      },
    ]);
    const driver = new ClaudeDriver({ transport });
    const eventsPromise = collectEvents(driver, 2);
    await Effect.runPromise(driver.startSession(START));
    const events = await eventsPromise;
    expect(events[0]!.type).toBe("thread.state.changed");
    expect(events[1]).toMatchObject({
      type: "rate-limits.updated",
      windows: [{ id: "session", exhausted: false }],
    });
  });
});
