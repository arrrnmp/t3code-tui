import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { CliError } from "../../../errors.js";
import type { ProviderRuntimeEvent } from "../../spi.js";
import { GrokDriver, grokModelStateForTests } from "../driver.js";
import { FakeGrokTransport } from "./fakes.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function collectEvents(driver: GrokDriver, count: number): Promise<ProviderRuntimeEvent[]> {
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
const MODELS = {
  currentModelId: "m-1",
  availableModels: [{ modelId: "m-1" }, { modelId: "m-2", reasoningEffort: "high" }],
};
const PERM_OPTIONS = [
  { optionId: "o-once", kind: "allow_once", name: "Allow once" },
  { optionId: "o-always", kind: "allow_always", name: "Always" },
  { optionId: "o-no", kind: "reject_once", name: "Deny" },
];

function startedDriver(script: Record<string, unknown> = {}, runtimeMode = "full-access") {
  const transport = new FakeGrokTransport(script);
  const driver = new GrokDriver({ transport, billingProbe: async () => null });
  return { transport, driver, runtimeMode };
}

describe("grok driver turns", () => {
  it("starts a session with models and sends a prompt", async () => {
    const { transport, driver } = startedDriver({ models: MODELS });
    await Effect.runPromise(driver.startSession(START));
    expect(transport.sessions[0]!.options.cwd).toBe("/repo");
    expect(grokModelStateForTests(driver, "thread-1").model).toBe("m-1");
    await expect(driver.listModels("thread-1")).resolves.toEqual([
      { id: "m-1" },
      { id: "m-2", reasoningEffort: "high" },
    ]);

    const server = transport.sessions[0]!.server;
    server.promptHandler = async (params) => {
      expect(params).toMatchObject({
        sessionId: "acp-session-1",
        prompt: [{ type: "text", text: "hi" }],
      });
      server.update("acp-session-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
      });
      return { stopReason: "end_turn", usage: { inputTokens: 7, outputTokens: 3 } };
    };
    const eventsPromise = collectEvents(driver, 3);
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toContain("token-usage.updated");
    expect(events.map((event) => event.type)).toContain("turn.completed");

    const snapshot = await Effect.runPromise(driver.readThread("thread-1"));
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]!.items.map((item) => (item as { kind: string }).kind)).toEqual([
      "user",
      "assistant",
    ]);
    const outcome = await driver.awaitTurn("thread-1", sent.turnId);
    expect(outcome).toMatchObject({ status: "completed", text: "hello" });
  });

  it("rejects concurrent turns", async () => {
    const transport = new FakeGrokTransport();
    const driver = new GrokDriver({ transport, billingProbe: async () => null });
    expect(await codeOf(() => Effect.runPromise(driver.sendTurn({ threadId: "t-x", prompt: "hi" })))).toBe(
      "GROK_NOT_STARTED",
    );
    await Effect.runPromise(driver.startSession(START));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    transport.sessions[0]!.server.promptHandler = async () => {
      await gate;
      return { stopReason: "end_turn" };
    };
    const first = Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "one" }));
    await sleep(20);
    expect(await codeOf(() => Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "two" })))).toBe(
      "TURN_BUSY",
    );
    release();
    await first;
  });

  it("fails refused turns", async () => {
    const transport = new FakeGrokTransport();
    const driver = new GrokDriver({ transport, billingProbe: async () => null });
    await Effect.runPromise(driver.startSession(START));
    transport.sessions[0]!.server.promptHandler = async () => ({ stopReason: "refusal" });
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcome = await driver.awaitTurn("thread-1", sent.turnId);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("refusal");
  });
});

describe("grok driver permissions", () => {
  it("parks requests until answered", async () => {
    const { transport, driver } = startedDriver({}, "approval-required");
    await Effect.runPromise(driver.startSession({ ...START, runtimeMode: "approval-required" }));
    const server = transport.sessions[0]!.server;
    let answer: unknown = null;
    server.promptHandler = async () => {
      answer = await server.askPermission(
        "acp-session-1",
        { toolCallId: "tc-1", title: "Bash ls" },
        PERM_OPTIONS,
      );
      return { stopReason: "end_turn" };
    };
    const eventsPromise = collectEvents(driver, 1);
    const sendPromise = Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const events = await eventsPromise;
    const requestId = openedRequestId(events, "permission.request.opened");
    await Effect.runPromise(driver.respondToRequest("thread-1", requestId, { kind: "accept" }));
    await sendPromise;
    expect(answer).toEqual({ outcome: "selected", optionId: "o-once" });
  });

  it("accepts for the session with fallback and declines explicitly", async () => {
    const { transport, driver } = startedDriver({}, "approval-required");
    await Effect.runPromise(driver.startSession({ ...START, runtimeMode: "approval-required" }));
    const server = transport.sessions[0]!.server;
    const answers: unknown[] = [];
    server.promptHandler = async () => {
      answers.push(
        await server.askPermission("acp-session-1", { toolCallId: "tc-1", title: "Bash" }, [
          { optionId: "o-once", kind: "allow_once" },
        ]),
      );
      answers.push(
        await server.askPermission("acp-session-1", { toolCallId: "tc-2", title: "Bash" }, [
          { optionId: "o-once", kind: "allow_once" },
        ]),
      );
      return { stopReason: "end_turn" };
    };
    const eventsPromise = collectEvents(driver, 1);
    const sendPromise = Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const events = await eventsPromise;
    const requestId = openedRequestId(events, "permission.request.opened");
    await Effect.runPromise(
      driver.respondToRequest("thread-1", requestId, { kind: "acceptForSession" }),
    );
    await sendPromise;
    // allow_always missing → falls back to allow_once, second ask auto-approves.
    expect(answers).toEqual([
      { outcome: "selected", optionId: "o-once" },
      { outcome: "selected", optionId: "o-once" },
    ]);
  });

  it("cancels, declines, and rejects unknown requests", async () => {
    const { transport, driver } = startedDriver({}, "approval-required");
    await Effect.runPromise(driver.startSession({ ...START, runtimeMode: "approval-required" }));
    const server = transport.sessions[0]!.server;
    const answers: unknown[] = [];
    server.promptHandler = async () => {
      answers.push(
        await server.askPermission("acp-session-1", { toolCallId: "tc-1", title: "T" }, PERM_OPTIONS),
      );
      answers.push(
        await server.askPermission("acp-session-1", { toolCallId: "tc-2", title: "T" }, [
          { optionId: "o-once", kind: "allow_once" },
        ]),
      );
      return { stopReason: "end_turn" };
    };
    const firstOpened = collectEvents(driver, 1);
    const sendPromise = Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const firstEvents = await firstOpened;
    const firstId = openedRequestId(firstEvents, "permission.request.opened");
    expect(
      await codeOf(() => Effect.runPromise(driver.respondToRequest("thread-1", "nope", { kind: "accept" }))),
    ).toBe("REQUEST_UNKNOWN");
    await Effect.runPromise(driver.respondToRequest("thread-1", firstId, { kind: "cancel" }));
    // The second ask only fires after the first is answered; the queue still
    // holds the first resolved event, so take two and find the opened one.
    const secondEvents = await collectEvents(driver, 2);
    const secondId = openedRequestId(secondEvents, "permission.request.opened");
    await Effect.runPromise(driver.respondToRequest("thread-1", secondId, { kind: "decline" }));
    await sendPromise;
    // No reject option offered → decline degrades to cancelled.
    expect(answers).toEqual([{ outcome: "cancelled" }, { outcome: "cancelled" }]);
  });

  it("auto-approves in full-access and answers questions", async () => {
    const { transport, driver } = startedDriver();
    await Effect.runPromise(driver.startSession(START));
    const server = transport.sessions[0]!.server;
    let answer: unknown = null;
    let questionAnswer: unknown = null;
    server.promptHandler = async () => {
      answer = await server.askPermission(
        "acp-session-1",
        { toolCallId: "tc-1", title: "Bash" },
        PERM_OPTIONS,
      );
      questionAnswer = await server.askQuestion({ questions: [{ id: "q" }] });
      return { stopReason: "end_turn" };
    };
    const eventsPromise = collectEvents(driver, 1);
    const sendPromise = Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const events = await eventsPromise;
    const requestId = openedRequestId(events, "user-input.request.opened");
    await Effect.runPromise(driver.respondToUserInput("thread-1", requestId, { q: "a" }));
    await sendPromise;
    expect(answer).toEqual({ outcome: "selected", optionId: "o-once" });
    expect(questionAnswer).toEqual({ answers: { q: "a" } });
  });

  it("settles parked permissions as cancelled on interrupt", async () => {
    const { transport, driver } = startedDriver({}, "approval-required");
    await Effect.runPromise(driver.startSession({ ...START, runtimeMode: "approval-required" }));
    const server = transport.sessions[0]!.server;
    let gate!: () => void;
    const blocked = new Promise<void>((resolve) => {
      gate = resolve;
    });
    let answer: unknown = null;
    server.promptHandler = async () => {
      const asking = server.askPermission("acp-session-1", { toolCallId: "tc-1", title: "T" }, PERM_OPTIONS);
      await blocked;
      answer = await asking;
      return { stopReason: "cancelled" };
    };
    const sendPromise = Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    await sleep(30);
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    expect(server.cancels).toHaveLength(1);
    gate();
    await sendPromise;
    expect(answer).toEqual({ outcome: "cancelled" });
  });
});

describe("grok driver lifecycle extras", () => {
  it("declares slash-command compaction and no rollback", async () => {
    const { driver } = startedDriver();
    expect(driver.compaction).toMatchObject({ type: "slash-command", command: "/compact" });
    await Effect.runPromise(driver.startSession(START));
    expect(await codeOf(() => Effect.runPromise(driver.rollbackThread("thread-1", 0)))).toBe(
      "INVALID_ROLLBACK",
    );
    expect(await codeOf(() => Effect.runPromise(driver.rollbackThread("thread-1", 1)))).toBe(
      "ROLLBACK_UNAVAILABLE",
    );
  });

  it("fails stalled turns on silence and tool budgets", async () => {
    const { transport, driver } = startedDriver();
    await Effect.runPromise(driver.startSession(START));
    const server = transport.sessions[0]!.server;
    let gate!: () => void;
    const blocked = new Promise<void>((resolve) => {
      gate = resolve;
    });
    server.promptHandler = async () => {
      await blocked;
      return { stopReason: "end_turn" };
    };
    const sendPromise = Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    await sleep(20);
    driver.checkStalls(Date.now() + 11 * 60_000);
    gate();
    const sent = await sendPromise;
    const outcome = await driver.awaitTurn("thread-1", sent.turnId);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("10 minutes");
  });

  it("extends the budget while tools progress", async () => {
    const { transport, driver } = startedDriver();
    await Effect.runPromise(driver.startSession(START));
    const server = transport.sessions[0]!.server;
    let gate!: () => void;
    const blocked = new Promise<void>((resolve) => {
      gate = resolve;
    });
    server.promptHandler = async () => {
      await blocked;
      return { stopReason: "end_turn" };
    };
    const sendPromise = Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    await sleep(20);
    server.update("acp-session-1", { sessionUpdate: "tool_call", toolCallId: "tc-1", title: "Bash" });
    await sleep(20);
    const read = await Effect.runPromise(driver.readThread("thread-1"));
    const turnId = read.turns[0]!.id;
    driver.checkStalls(Date.now() + 11 * 60_000);
    const race = await Promise.race([
      driver.awaitTurn("thread-1", turnId).then(() => "settled"),
      sleep(50).then(() => "pending"),
    ]);
    expect(race).toBe("pending");
    driver.checkStalls(Date.now() + 31 * 60_000);
    gate();
    await sendPromise;
    const outcome = await driver.awaitTurn("thread-1", turnId);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("30 minutes");
  });

  it("never sends grok-build and switches models with effort", async () => {
    const { transport, driver } = startedDriver({ models: MODELS });
    await Effect.runPromise(driver.startSession(START));
    const server = transport.sessions[0]!.server;
    server.promptHandler = async () => ({ stopReason: "end_turn" });
    await Effect.runPromise(
      driver.sendTurn({
        threadId: "thread-1",
        prompt: "hi",
        modelSelection: { instanceId: "grok", model: "grok-build" },
      }),
    );
    expect(server.requestsTo("session/set_model")).toEqual([]);

    await Effect.runPromise(
      driver.sendTurn({
        threadId: "thread-1",
        prompt: "again",
        modelSelection: {
          instanceId: "grok",
          model: "m-2",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
      }),
    );
    const sets = server.requestsTo("session/set_model");
    expect(sets).toHaveLength(2);
    expect(sets[0]!.params).toMatchObject({ modelId: "m-2" });
    expect(sets[1]!.params).toMatchObject({ modelId: "m-2", _meta: { reasoningEffort: "high" } });
  });

  it("stops sessions", async () => {
    const { driver } = startedDriver();
    await Effect.runPromise(driver.startSession(START));
    await Effect.runPromise(driver.stopSession("thread-1"));
    expect(await Effect.runPromise(driver.hasSession("thread-1"))).toBe(false);
  });
});
