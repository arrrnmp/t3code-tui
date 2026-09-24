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

describe("grok session resume", () => {
  it("loads the previous session and keeps its replay out of the live turn", async () => {
    const { transport, driver } = startedDriver({ loadSession: true });
    await Effect.runPromise(driver.startSession({ ...START, resumeCursor: "acp-session-old" }));
    const server = transport.sessions[0]!.server;
    expect(server.requestsTo("session/load")[0]!.params).toMatchObject({ sessionId: "acp-session-old", cwd: "/repo" });
    expect(server.requestsTo("session/new")).toEqual([]);
    expect(driver.resumeCursor("thread-1")).toBe("acp-session-old");

    server.promptHandler = async () => {
      server.update("acp-session-old", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } });
      return { stopReason: "end_turn" };
    };
    // Everything the driver published, from the load through the turn's
    // end: a replayed chunk would surface here as live assistant text.
    const published = Effect.runPromise(
      Stream.runCollect(Stream.takeUntil(driver.streamEvents, (event) => event.type === "turn.completed")),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    expect(await driver.awaitTurn("thread-1", sent.turnId)).toMatchObject({ status: "completed", text: "hello" });
    const texts = [...(await published)].flatMap((event) => (event.type === "message.part.updated" ? [event.text] : []));
    expect(texts).toEqual(["hello"]);
  });

  it("starts a new session when the agent cannot load, or lost, the old one", async () => {
    for (const script of [{}, { loadSession: true, lostSessions: ["acp-session-old"] }]) {
      const { transport, driver } = startedDriver(script);
      await Effect.runPromise(driver.startSession({ ...START, resumeCursor: "acp-session-old" }));
      expect(transport.sessions[0]!.server.requestsTo("session/new")).toHaveLength(1);
      expect(driver.resumeCursor("thread-1")).toBe("acp-session-1");
    }
  });
});

describe("grok driver turns", () => {
  it("lists skills from grok inspect, under the name Grok invokes them by", async () => {
    const seen: string[] = [];
    const driver = new GrokDriver({
      transport: new FakeGrokTransport(),
      billingProbe: async () => null,
      inspect: async (cwd) => {
        seen.push(cwd);
        // Fields as grok 1.0.40 reports them.
        return JSON.stringify({
          skills: [
            { name: "pdf", description: "PDF tools", invocableAs: "/pdf", userInvocable: true, compatibilityStatus: "enabled" },
            { name: "internal", description: "Agent only", userInvocable: false },
            { name: "cursor-thing", description: "Off", compatibilityStatus: "disabled" },
          ],
        });
      },
    });
    const inventory = await driver.skillInventory("/repo");
    expect(seen).toEqual(["/repo"]);
    expect(inventory.trigger).toBe("/");
    expect(inventory.skills).toMatchObject([
      { name: "pdf", description: "PDF tools", userInvocable: true, enabled: true },
      { name: "internal", userInvocable: false },
      { name: "cursor-thing", enabled: false },
    ]);
  });

  it("passes runtime instructions as session/new _meta.rules", async () => {
    const { transport, driver } = startedDriver({ models: MODELS });
    await Effect.runPromise(driver.startSession({ ...START, instructions: "Report back." }));
    expect(transport.sessions[0]!.server.requestsTo("session/new")[0]!.params).toMatchObject({
      _meta: { rules: "Report back." },
    });
  });

  it("reads usage from _meta and the context window from Grok's extensions", async () => {
    const { transport, driver } = startedDriver({ models: MODELS });
    await Effect.runPromise(driver.startSession(START));
    const server = transport.sessions[0]!.server;
    // Shapes as observed from grok 1.0.40.
    server.notify("_x.ai/models/update", {
      currentModelId: "m-1",
      availableModels: [{ modelId: "m-1", _meta: { totalContextTokens: 500000 } }],
    });
    server.promptHandler = async () => {
      server.notify("_x.ai/session_notification", {
        sessionId: "acp-session-1",
        update: {
          sessionUpdate: "response_completed",
          usage: { input_tokens: 17461, output_tokens: 30, cache_read_input_tokens: 1152, cache_creation_input_tokens: 0 },
        },
      });
      return {
        stopReason: "end_turn",
        _meta: { usage: { inputTokens: 18613, outputTokens: 30, cachedReadTokens: 1152, cacheCreationTokens: 0, reasoningTokens: 29 } },
      };
    };
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcome = await driver.awaitTurn("thread-1", sent.turnId);
    // `_meta.usage.inputTokens` includes the cache reads; ours does not.
    expect(outcome.usage).toMatchObject({ input: 17461, cacheRead: 1152, output: 30, thinking: 29 });
    expect(await driver.contextUsage("thread-1")).toEqual({
      usedTokens: 17461 + 1152 + 30,
      maxTokens: 500000,
      cachedInputTokens: 1152,
      autoCompactThreshold: null,
      compactsAutomatically: null,
    });
  });

  it("answers with the last message, not the notes before tool calls", async () => {
    const { transport, driver } = startedDriver({ models: MODELS });
    await Effect.runPromise(driver.startSession(START));
    const server = transport.sessions[0]!.server;
    server.promptHandler = async () => {
      server.update("acp-session-1", { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
      server.update("acp-session-1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Looking." } });
      server.update("acp-session-1", { sessionUpdate: "tool_call", toolCallId: "c-1", title: "Read a.ts", kind: "read" });
      server.update("acp-session-1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Found " } });
      server.update("acp-session-1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "it." } });
      return { stopReason: "end_turn" };
    };
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcome = await driver.awaitTurn("thread-1", sent.turnId);
    expect(outcome).toMatchObject({ status: "completed", text: "Found it." });
  });

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

  it("releases a parked question when it is dismissed", async () => {
    // Dismissal used to fall through to REQUEST_UNKNOWN, so closing the
    // panel left the agent's RPC blocked until the next interrupt. It
    // resolves with no answers rather than rejecting: a dismissal releases
    // the turn, it does not fail it.
    const { transport, driver } = startedDriver();
    await Effect.runPromise(driver.startSession(START));
    const server = transport.sessions[0]!.server;
    let questionAnswer: unknown = null;
    server.promptHandler = async () => {
      questionAnswer = await server.askQuestion({ questions: [{ id: "q" }] });
      return { stopReason: "end_turn" };
    };
    const eventsPromise = collectEvents(driver, 1);
    const sendPromise = Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const requestId = openedRequestId(await eventsPromise, "user-input.request.opened");
    await Effect.runPromise(driver.respondToRequest("thread-1", requestId, { kind: "decline" }));
    await sendPromise;
    expect(questionAnswer).toEqual({ answers: {} });
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

describe("grok images", () => {
  const image = { name: "a.png", mimeType: "image/png", data: "iVBORw0KGgo=" };

  it("sends ACP image blocks when the agent advertises them", async () => {
    const { transport, driver } = startedDriver({ images: true });
    await Effect.runPromise(driver.startSession(START));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "look", images: [image] }));
    await driver.awaitTurn("thread-1", sent.turnId);
    expect(transport.sessions[0]!.server.requestsTo("session/prompt")[0]!.params).toMatchObject({
      prompt: [{ type: "text", text: "look" }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
    });
  });

  it("names them in the prompt when it does not", async () => {
    const { transport, driver } = startedDriver();
    await Effect.runPromise(driver.startSession(START));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "look", images: [image] }));
    await driver.awaitTurn("thread-1", sent.turnId);
    expect(transport.sessions[0]!.server.requestsTo("session/prompt")[0]!.params).toMatchObject({
      prompt: [{ type: "text", text: "look\n\n[attached images: a.png]" }],
    });
  });
});
const MCP = [
  { name: "docs", type: "http" as const, url: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } },
  { name: "fs", type: "stdio" as const, command: "npx", args: ["-y", "fs-mcp"], env: { ROOT: "/" } },
];

describe("grok MCP injection", () => {
  it("sends stdio servers as ACP McpServer entries, and drops http without the capability", async () => {
    const { transport, driver } = startedDriver();
    await Effect.runPromise(driver.startSession({ ...START, mcpServers: MCP }));
    expect(transport.sessions[0]!.server.requestsTo("session/new")[0]!.params).toMatchObject({
      mcpServers: [{ name: "fs", command: "npx", args: ["-y", "fs-mcp"], env: [{ name: "ROOT", value: "/" }] }],
    });
  });

  it("includes http servers when the agent advertises mcpCapabilities.http, on load too", async () => {
    const { transport, driver } = startedDriver({ mcpHttp: true, loadSession: true });
    await Effect.runPromise(driver.startSession({ ...START, resumeCursor: "acp-session-old", mcpServers: MCP }));
    const params = transport.sessions[0]!.server.requestsTo("session/load")[0]!.params as { mcpServers: unknown[] };
    expect(params.mcpServers).toEqual([
      { type: "http", name: "docs", url: "https://docs.example/mcp", headers: [{ name: "Authorization", value: "Bearer t" }] },
      { name: "fs", command: "npx", args: ["-y", "fs-mcp"], env: [{ name: "ROOT", value: "/" }] },
    ]);
  });
});
