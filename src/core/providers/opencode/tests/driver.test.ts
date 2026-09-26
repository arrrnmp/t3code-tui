import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../../errors.js";
import type { ProviderRuntimeEvent } from "../../spi.js";
import { answersFor, OpenCodeDriver, parseOpencodeModel } from "../driver.js";
import { FakeOpencodeTransport } from "./fakes.js";

async function waitFor(label: string, check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function assistantMessages() {
  return [
    {
      info: {
        id: "msg-1",
        role: "user",
      },
      parts: [{ id: "p-0", type: "text", text: "hi" }],
    },
    {
      info: {
        id: "msg-2",
        role: "assistant",
        tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 3, write: 7 } },
      },
      parts: [{ id: "p-1", type: "text", text: "done" }],
    },
  ];
}

describe("parseOpencodeModel", () => {
  it("splits provider/model slugs and rejects anything else", () => {
    expect(parseOpencodeModel({ instanceId: "opencode", model: "anthropic/claude-opus-4-6" })).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
    });
    expect(parseOpencodeModel({ instanceId: "opencode", model: "openai/gpt-5.4/mini" })).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4/mini",
    });
    expect(parseOpencodeModel({ instanceId: "opencode", model: "bare" })).toBeNull();
    expect(parseOpencodeModel(undefined)).toBeNull();
  });

  it("supplies the provider from opencode/<provider> instance ids", () => {
    expect(parseOpencodeModel({ instanceId: "opencode/anthropic", model: "claude-opus-4-6" })).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
    });
    expect(parseOpencodeModel({ instanceId: "opencode", model: "claude-opus-4-6" })).toBeNull();
    expect(parseOpencodeModel({ instanceId: "claude", model: "claude-opus-4-6" })).toBeNull();
  });
});

describe("answersFor", () => {
  it("matches answers by header, then q<index>, else skips", () => {
    const questions = JSON.stringify([{ header: "Pick one" }, { header: "Other" }]);
    expect(answersFor({ "Pick one": "a", q1: "b" }, questions)).toEqual([["a"], ["b"]]);
    expect(answersFor({}, questions)).toEqual([[], []]);
    expect(answersFor({ only: "x" }, "corrupt")).toEqual([["x"]]);
  });
});

describe("opencode driver", () => {
  const drivers: OpenCodeDriver[] = [];
  afterEach(async () => {
    for (const driver of drivers.splice(0)) {
      await Effect.runPromise(driver.stopAll()).catch(() => undefined);
    }
  });

  function start(script: ConstructorParameters<typeof FakeOpencodeTransport>[0] = {}) {
    const transport = new FakeOpencodeTransport(script);
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    drivers.push(driver);
    return { transport, driver };
  }

  async function startSession(
    driver: OpenCodeDriver,
    threadId = "thread-1",
    modelSelection = { instanceId: "opencode", model: "anthropic/claude-opus-4-6" },
  ) {
    return await Effect.runPromise(
      driver.startSession({ threadId, workingDirectory: "/repo", modelSelection }),
    );
  }

  it("starts sessions once and routes servers per working directory", async () => {
    const { transport, driver } = start();
    await startSession(driver);
    await startSession(driver);
    await Effect.runPromise(driver.startSession({ threadId: "thread-2", workingDirectory: "/repo" }));
    await Effect.runPromise(driver.startSession({ threadId: "thread-3", workingDirectory: "/other" }));
    expect(transport.ensureCalls.length).toBe(2);
    expect(transport.servers.length).toBe(2);
    const sessions = await Effect.runPromise(driver.listSessions());
    expect(sessions.length).toBe(3);
    expect(await Effect.runPromise(driver.hasSession("thread-1"))).toBe(true);
  });

  it("sends turns with the parsed model and completes on idle with usage", async () => {
    const { transport, driver } = start({ messages: assistantMessages() });
    await startSession(driver);
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const prompt = transport.servers[0]?.callsTo("session.promptAsync")[0]?.args as {
      model?: { providerID: string; modelID: string };
      parts: Array<{ text: string }>;
    };
    expect(prompt.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" });
    expect(prompt.parts).toEqual([{ type: "text", text: "hi" }]);

    await expect(Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "again" }))).rejects.toMatchObject({
      code: "TURN_BUSY",
    });

    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await transport.servers[0]?.push({
      type: "message.part.updated",
      properties: {
        sessionID: "opencode-session-1",
        part: { id: "p-1", type: "text", text: "hel" },
      },
    });
    await transport.servers[0]?.push({
      type: "message.part.updated",
      properties: {
        sessionID: "opencode-session-1",
        part: { id: "p-1", type: "text", text: "hello" },
      },
    });
    await transport.servers[0]?.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    const outcome = await outcomePromise;
    expect(outcome.status).toBe("completed");
    expect(outcome.text).toBe("hello");
    expect(outcome.usage).toMatchObject({ input: 10, output: 20, thinking: 5, cacheRead: 3, cacheCreate: 7 });

    // Settled turns resolve immediately.
    await expect(driver.awaitTurn("thread-1", sent.turnId)).resolves.toMatchObject({ status: "completed" });
  });

  it("fails turns on session.error and maps auth text to sign-in", async () => {
    const { transport, driver } = start();
    await startSession(driver);
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await transport.servers[0]?.push({
      type: "session.error",
      properties: { sessionID: "opencode-session-1", error: { message: "Request failed with 401" } },
    });
    const outcome = await outcomePromise;
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("opencode auth login");
  });

  it("parks permission requests until answered", async () => {
    const { transport, driver } = start();
    await startSession(driver);
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    void sent;
    const opened: string[] = [];
    const collect = Effect.runPromise(
      Stream.runCollect(Stream.take(driver.streamEvents, 1)).pipe(Effect.map((chunk) => [...chunk])),
    );
    await transport.servers[0]?.push({
      type: "permission.asked",
      properties: { id: "perm-1", sessionID: "opencode-session-1", permission: "edit" },
    });
    const events = await collect;
    expect(events.map((event) => event.type)).toEqual(["permission.request.opened"]);
    opened.push("seen");

    await Effect.runPromise(driver.respondToRequest("thread-1", "perm-1", { kind: "acceptForSession" }));
    expect(transport.servers[0]?.callsTo("permission.reply")).toMatchObject([
      { args: { requestID: "perm-1", reply: "always" } },
    ]);
    expect(opened).toEqual(["seen"]);

    await expect(
      Effect.runPromise(driver.respondToRequest("thread-1", "perm-1", { kind: "accept" })),
    ).rejects.toMatchObject({ code: "REQUEST_UNKNOWN" });
  });

  it("releases a parked question when it is dismissed", async () => {
    // Dismissal used to throw REQUEST_MISMATCH, so closing the panel left
    // the server still blocked on the question until the next interrupt.
    const { transport, driver } = start();
    await startSession(driver);
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    await transport.servers[0]?.push({
      type: "question.asked",
      properties: { id: "q-9", sessionID: "opencode-session-1", questions: [{ header: "Pick" }] },
    });
    await waitFor("question park", () => true);
    await Effect.runPromise(driver.respondToRequest("thread-1", "q-9", { kind: "decline" }));
    expect(transport.servers[0]?.callsTo("question.reply")).toMatchObject([
      { args: { requestID: "q-9", answers: [[]] } },
    ]);
  });

  it("maps decline/cancel to reject and guards mismatched kinds", async () => {
    const { transport, driver } = start();
    await startSession(driver);
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    await transport.servers[0]?.push({
      type: "question.asked",
      properties: { id: "q-1", sessionID: "opencode-session-1", questions: [{ header: "Pick" }] },
    });
    await waitFor("question park", () => true);
    // Accepting a question is a miscall — there is no answer to accept.
    await expect(
      Effect.runPromise(driver.respondToRequest("thread-1", "q-1", { kind: "accept" })),
    ).rejects.toMatchObject({ code: "REQUEST_MISMATCH" });

    await Effect.runPromise(driver.respondToUserInput("thread-1", "q-1", { Pick: "a" }));
    expect(transport.servers[0]?.callsTo("question.reply")).toMatchObject([
      { args: { requestID: "q-1", answers: [["a"]] } },
    ]);

    await transport.servers[0]?.push({
      type: "permission.asked",
      properties: { id: "perm-2", sessionID: "opencode-session-1", permission: "bash" },
    });
    await waitFor("permission park", () => true);
    await Effect.runPromise(driver.respondToRequest("thread-1", "perm-2", { kind: "cancel" }));
    expect(transport.servers[0]?.callsTo("permission.reply")).toMatchObject([
      { args: { requestID: "perm-2", reply: "reject" } },
    ]);
  });

  it("interrupts reject parked requests, aborts, and settles the turn", async () => {
    const { transport, driver } = start();
    await startSession(driver);
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    await transport.servers[0]?.push({
      type: "permission.asked",
      properties: { id: "perm-1", sessionID: "opencode-session-1", permission: "edit" },
    });
    await waitFor("permission park", () => (transport.servers[0]?.callsTo("event.subscribe").length ?? 0) > 0);
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    expect(transport.servers[0]?.callsTo("permission.reply")).toMatchObject([
      { args: { requestID: "perm-1", reply: "reject" } },
    ]);
    expect(transport.servers[0]?.aborted).toEqual(["opencode-session-1"]);
    await expect(outcomePromise).resolves.toMatchObject({ status: "interrupted" });
  });

  it("rejects unknown turns and aborted waits", async () => {
    const { driver } = start();
    await startSession(driver);
    await expect(driver.awaitTurn("thread-1", "missing")).rejects.toMatchObject({ code: "TURN_NOT_FOUND" });
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const controller = new AbortController();
    const waiting = driver.awaitTurn("thread-1", sent.turnId, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "TURN_ABORTED" });
  });

  it("reads threads and rolls back by forking", async () => {
    const { transport, driver } = start({ messages: assistantMessages() });
    await startSession(driver);
    const snapshot = await Effect.runPromise(driver.readThread("thread-1"));
    expect(snapshot.turns.map((turn) => turn.id)).toEqual(["msg-1", "msg-2"]);

    await expect(Effect.runPromise(driver.rollbackThread("thread-1", 0))).rejects.toMatchObject({
      code: "INVALID_ROLLBACK",
    });
    await expect(Effect.runPromise(driver.rollbackThread("thread-1", 5))).rejects.toMatchObject({
      code: "ROLLBACK_UNAVAILABLE",
    });
    await Effect.runPromise(driver.rollbackThread("thread-1", 1));
    expect(transport.servers[0]?.callsTo("session.fork")).toMatchObject([
      { args: { sessionID: "opencode-session-1", messageID: "msg-1" } },
    ]);
  });

  it("compacts natively and wraps transport failures", async () => {
    const { transport, driver } = start();
    await startSession(driver);
    await Effect.runPromise(driver.compaction.start("thread-1"));
    expect(transport.servers[0]?.callsTo("session.summarize").length).toBe(1);

    const failing = start({ failMethods: { "session.promptAsync": "nope" } });
    drivers.push(failing.driver);
    await Effect.runPromise(
      failing.driver.startSession({ threadId: "thread-9", workingDirectory: "/repo" }),
    );
    await expect(
      Effect.runPromise(failing.driver.sendTurn({ threadId: "thread-9", prompt: "hi" })),
    ).rejects.toBeInstanceOf(CliError);

    const unreachable = start({ failMethods: { ensureServer: "down" } });
    drivers.push(unreachable.driver);
    await expect(
      Effect.runPromise(unreachable.driver.startSession({ threadId: "thread-9", workingDirectory: "/repo" })),
    ).rejects.toMatchObject({ code: "OPENCODE_SPAWN_FAILED" });
  });

  it("stops sessions and the driver", async () => {
    const { transport, driver } = start();
    await startSession(driver);
    await Effect.runPromise(driver.stopSession("thread-1"));
    expect(await Effect.runPromise(driver.hasSession("thread-1"))).toBe(false);
    await Effect.runPromise(driver.stopAll());
    expect(transport.servers.every((server) => server.disposed)).toBe(true);
  });

  it("sends without a credential and names the setup step on the server's rejection", async () => {
    // Never gate the send on our own credential guess: the guess misses
    // arrangements upstream honors, and the server answers in seconds.
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: {} });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/claude-sonnet-4-6" },
      }),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    expect(transport.servers[0]?.callsTo("session.promptAsync")).toHaveLength(1);

    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await transport.servers[0]?.push({
      type: "session.error",
      properties: {
        sessionID: "opencode-session-1",
        error: { message: "Model not found: opencode/claude-sonnet-4-6." },
      },
    });
    const outcome = await outcomePromise;
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("Model not found");
    expect(outcome.error).toContain("OPENCODE_API_KEY");
    expect(outcome.error).toContain("opencode auth login");
  });

  it("adds no credential hint for free opencode models or unknown providers", async () => {
    for (const model of ["opencode/muse-spark-1.3-contributor-free", "custom-provider/custom-model"]) {
      const transport = new FakeOpencodeTransport();
      const driver = new OpenCodeDriver({ transport, env: {} });
      drivers.push(driver);
      await Effect.runPromise(
        driver.startSession({
          threadId: "thread-1",
          workingDirectory: "/repo",
          modelSelection: { instanceId: "opencode", model },
        }),
      );
      const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
      const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
      await transport.servers[0]?.push({
        type: "session.error",
        properties: { sessionID: "opencode-session-1", error: { message: `Model not found: ${model}.` } },
      });
      const outcome = await outcomePromise;
      expect(outcome.error).toBe(`Model not found: ${model}.`);
    }
  });

  it("fails the open turn on a server error that names no session", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" },
      }),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await transport.servers[0]?.push({
      type: "session.error",
      properties: { error: { message: "Failed to load plugin /p/xai.ts: boom" } },
    });
    const outcome = await outcomePromise;
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("Failed to load plugin");
  });

  it("keeps the prompt's own message parts out of the answer text", async () => {
    // The server streams the user message back on the same
    // `message.part.updated` channel as the reply; accumulating both
    // echoes the prompt into the answer (seen live on a free model).
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" },
      }),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "ping" }));
    const prompt = transport.servers[0]?.callsTo("session.promptAsync")[0]?.args as { messageID: string };
    expect(prompt.messageID).toMatch(/^msg_/);

    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await transport.servers[0]?.push({
      type: "message.part.updated",
      properties: {
        sessionID: "opencode-session-1",
        part: { id: "p-user", messageID: prompt.messageID, type: "text", text: "ping" },
      },
    });
    await transport.servers[0]?.push({
      type: "message.part.updated",
      properties: {
        sessionID: "opencode-session-1",
        part: { id: "p-1", messageID: "msg_assistant", type: "text", text: "pong" },
      },
    });
    await transport.servers[0]?.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    const outcome = await outcomePromise;
    expect(outcome.text).toBe("pong");
  });

  it("reads the context window the way OpenCode counts it", async () => {
    const transport = new FakeOpencodeTransport({
      limits: { "opencode/muse": { context: 1_048_576, output: 65_536 } },
      messages: [
        { info: { id: "msg_u", role: "user" }, parts: [] },
        {
          info: {
            id: "msg_a",
            role: "assistant",
            parentID: "msg_u",
            providerID: "opencode",
            modelID: "muse",
            tokens: { input: 12310, output: 11, reasoning: 6, cache: { read: 113, write: 0 } },
          },
          parts: [],
        },
      ],
    });
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/muse" },
      }),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "ping" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await transport.servers[0]?.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    await outcomePromise;
    // Output is not context (upstream `contextTokens`); the threshold is
    // upstream's `usable()`: context minus min(output limit, 32k).
    expect(await driver.contextUsage("thread-1")).toEqual({
      usedTokens: 12310 + 113,
      maxTokens: 1_048_576,
      cachedInputTokens: 113,
      autoCompactThreshold: 1_048_576 - 32_000,
      compactsAutomatically: true,
    });
  });

  it("steers the running turn, and settles only once the steer is answered", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/muse" },
      }),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "story" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    let settled = false;
    void outcomePromise.then(() => {
      settled = true;
    });
    await Effect.runPromise(driver.steerTurn("thread-1", "just say BANANA"));
    const server = transport.servers[0]!;
    const prompts = server.callsTo("session.promptAsync").map((call) => call.args as { messageID: string; parts: unknown[] });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.parts).toEqual([{ type: "text", text: "just say BANANA" }]);
    const [first, steer] = prompts.map((prompt) => prompt.messageID);
    const part = (p: Record<string, unknown>) =>
      server.push({ type: "message.part.updated", properties: { sessionID: "opencode-session-1", part: p } });
    // The steer's own text echoes back; it must not become answer text.
    await part({ id: "p-s", messageID: steer, type: "text", text: "just say BANANA" });
    await part({ id: "p-1", messageID: "msg_a1", type: "text", text: "Once upon a time" });

    // The steer landed as the loop finished: the first idle leaves it unanswered.
    server.messages = [
      { info: { id: first, role: "user" }, parts: [] },
      { info: { id: "msg_a1", role: "assistant", parentID: first, time: { completed: 1 } }, parts: [] },
      { info: { id: steer, role: "user" }, parts: [] },
    ];
    await server.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    await part({ id: "p-2", messageID: "msg_a2", type: "text", text: "BANANA" });
    server.messages = [
      ...server.messages,
      { info: { id: "msg_a2", role: "assistant", parentID: steer, time: { completed: 2 } }, parts: [] },
    ];
    await server.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    const outcome = await outcomePromise;
    expect(outcome).toMatchObject({ status: "completed", text: "BANANA" });
  });

  it("sends runtime instructions as system, and plan mode as the read-only plan agent", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({ threadId: "thread-1", workingDirectory: "/repo", instructions: "Report back." }),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "a", interactionMode: "plan" }));
    const server = transport.servers[0]!;
    expect(server.callsTo("session.promptAsync")[0]!.args).toMatchObject({ system: "Report back.", agent: "plan" });
    const outcome = driver.awaitTurn("thread-1", sent.turnId);
    await server.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    await outcome;
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "b", interactionMode: "default" }));
    expect(server.callsTo("session.promptAsync")[1]!.args).not.toHaveProperty("agent");
  });

  it("lists skills and commands from the directory's server", async () => {
    const transport = new FakeOpencodeTransport({
      commands: [
        { name: "init", description: "Create AGENTS.md", source: "command", hints: [] },
        { name: "wait-what", description: "Explain", source: "skill", hints: [] },
        { name: "docs", description: "MCP prompt", source: "mcp", hints: ["$1"] },
      ],
    });
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    const inventory = await driver.skillInventory("/repo");
    expect(transport.ensureCalls[0]!.workingDirectory).toBe("/repo");
    expect(inventory.trigger).toBe("/");
    expect(inventory.skills.map((skill) => skill.name)).toEqual(["wait-what"]);
    expect(inventory.commands).toEqual([
      { name: "init", description: "Create AGENTS.md", argumentHint: null, builtin: false },
      { name: "docs", description: "MCP prompt", argumentHint: "$1", builtin: false },
    ]);
  });

  it("streams part deltas, and publishes a step's text as a note once the next step speaks", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    const events: ProviderRuntimeEvent[] = [];
    const fiber = Effect.runFork(Stream.runForEach(driver.streamEvents, (event) => Effect.sync(() => void events.push(event))));
    await Effect.runPromise(driver.startSession({ threadId: "thread-1", workingDirectory: "/repo" }));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    const outcome = driver.awaitTurn("thread-1", sent.turnId);
    const part = (p: Record<string, unknown>) =>
      transport.servers[0]!.push({ type: "message.part.updated", properties: { sessionID: "opencode-session-1", part: p } });
    // Cumulative snapshots of one part, then a tool, then the next step.
    await part({ id: "p1", messageID: "step1", type: "text", text: "Reading" });
    await part({ id: "p1", messageID: "step1", type: "text", text: "Reading it." });
    await part({ id: "p2", messageID: "step1", type: "tool", tool: "read", state: { status: "completed" } });
    await part({ id: "p3", messageID: "step2", type: "text", text: "moxen" });
    await transport.servers[0]!.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    expect((await outcome).text).toBe("moxen");
    await Effect.runPromise(Fiber.interrupt(fiber));
    const deltas = events.flatMap((event) => (event.type === "message.part.updated" ? [[event.messageId, event.text]] : []));
    expect(deltas).toEqual([
      ["step1", "Reading"],
      ["step1", " it."],
      ["step2", "moxen"],
    ]);
    expect(events.flatMap((event) => (event.type === "assistant.note" ? [[event.messageId, event.text]] : []))).toEqual([
      ["step1", "Reading it."],
    ]);
  });

  it("refuses to steer when no turn is running", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(driver.startSession({ threadId: "thread-1", workingDirectory: "/repo" }));
    const failure = await Effect.runPromise(Effect.flip(driver.steerTurn("thread-1", "hi")));
    expect(failure.code).toBe("TURN_NOT_RUNNING");
  });

  it("answers with the last step's message, not the notes of earlier steps", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" },
      }),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "ping" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    const part = (part: Record<string, unknown>) =>
      transport.servers[0]?.push({
        type: "message.part.updated",
        properties: { sessionID: "opencode-session-1", part },
      });
    await part({ id: "p-1", messageID: "msg_step1", type: "reasoning", text: "thinking hard" });
    await part({ id: "p-2", messageID: "msg_step1", type: "text", text: "Checking the tests." });
    await part({ id: "p-3", messageID: "msg_step1", type: "tool", tool: "read", state: { status: "completed" } });
    await part({ id: "p-4", messageID: "msg_step2", type: "text", text: "They pass." });
    await transport.servers[0]?.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    const outcome = await outcomePromise;
    expect(outcome.text).toBe("They pass.");
  });

  it("accepts sends for credentialed and unknown providers alike", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" },
      }),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    expect(sent.turnId).toMatch(/^turn-/);

    const transport2 = new FakeOpencodeTransport();
    const driver2 = new OpenCodeDriver({ transport: transport2, env: {} });
    drivers.push(driver2);
    await Effect.runPromise(
      driver2.startSession({
        threadId: "thread-9",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "custom-provider/custom-model" },
      }),
    );
    const sent2 = await Effect.runPromise(driver2.sendTurn({ threadId: "thread-9", prompt: "hi" }));
    expect(sent2.turnId).toMatch(/^turn-/);
  });

  it("fails silent turns on the stall watchdog", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" }, stallTimeoutMs: 60 });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" },
      }),
    );
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    const outcome = await driver.awaitTurn("thread-1", sent.turnId);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("No response from the provider");
  });
});

describe("opencode images", () => {
  it("sends images as file parts carrying a data URL", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "anthropic/claude-opus-4-6" },
      }),
    );
    await Effect.runPromise(
      driver.sendTurn({ threadId: "thread-1", prompt: "look", images: [{ name: "a.png", mimeType: "image/png", data: "iVBORw0KGgo=" }] }),
    );
    expect(transport.servers[0]?.callsTo("session.promptAsync")[0]?.args).toMatchObject({
      parts: [
        { type: "text", text: "look" },
        { type: "file", mime: "image/png", filename: "a.png", url: "data:image/png;base64,iVBORw0KGgo=" },
      ],
    });
    await Effect.runPromise(driver.stopAll());
  });
});
const MCP = [
  { name: "docs", type: "http" as const, url: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } },
  { name: "fs", type: "stdio" as const, command: "npx", args: ["-y", "fs-mcp"], env: { ROOT: "/" } },
];

describe("opencode MCP injection", () => {
  it("adds each server to the directory's instance once, not once per session", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    try {
      await Effect.runPromise(driver.startSession({ threadId: "thread-1", workingDirectory: "/repo", mcpServers: MCP }));
      await Effect.runPromise(driver.startSession({ threadId: "thread-2", workingDirectory: "/repo", mcpServers: MCP }));
      expect(transport.servers).toHaveLength(1);
      expect(transport.servers[0]!.callsTo("mcp.add").map((call) => call.args)).toEqual([
        { name: "docs", config: { type: "remote", url: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } } },
        { name: "fs", config: { type: "local", command: ["npx", "-y", "fs-mcp"], environment: { ROOT: "/" } } },
      ]);
    } finally {
      await Effect.runPromise(driver.stopAll()).catch(() => undefined);
    }
  });

  it("does not fail the session when an add fails, and retries on the next start", async () => {
    const transport = new FakeOpencodeTransport({ failMethods: { "mcp.add": "boom" } });
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    try {
      await Effect.runPromise(driver.startSession({ threadId: "thread-1", workingDirectory: "/repo", mcpServers: MCP.slice(1) }));
      await Effect.runPromise(driver.startSession({ threadId: "thread-2", workingDirectory: "/repo", mcpServers: MCP.slice(1) }));
      expect(await Effect.runPromise(driver.hasSession("thread-2"))).toBe(true);
      // Not remembered as added, so the second start tried again.
      expect(transport.servers[0]!.callsTo("mcp.add")).toHaveLength(2);
    } finally {
      await Effect.runPromise(driver.stopAll()).catch(() => undefined);
    }
  });
});
