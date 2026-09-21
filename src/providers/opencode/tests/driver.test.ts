import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../../errors.js";
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

  it("maps decline/cancel to reject and guards mismatched kinds", async () => {
    const { transport, driver } = start();
    await startSession(driver);
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    await transport.servers[0]?.push({
      type: "question.asked",
      properties: { id: "q-1", sessionID: "opencode-session-1", questions: [{ header: "Pick" }] },
    });
    await waitFor("question park", () => true);
    await expect(
      Effect.runPromise(driver.respondToRequest("thread-1", "q-1", { kind: "decline" })),
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

  it("fails fast without a provider credential", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: {} });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/muse-spark-1.3-contributor-free" },
      }),
    );
    await expect(
      Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" })),
    ).rejects.toMatchObject({ code: "OPENCODE_AUTH_REQUIRED" });
    expect(transport.servers[0]?.callsTo("session.promptAsync")).toHaveLength(0);
  });

  it("passes the preflight with an env key or an unknown provider", async () => {
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
