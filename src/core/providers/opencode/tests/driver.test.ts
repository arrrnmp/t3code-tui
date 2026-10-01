import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../../errors.js";
import type { ProviderRuntimeEvent } from "../../spi.js";
import type { RuntimeMode } from "../../../types.js";
import { userInputActivityRow } from "../../../threads/requestactivity.js";
import { answersFor, OpenCodeDriver, opencodeCompactionThreshold, opencodeContextOf, parseOpencodeModel } from "../driver.js";
import { translateTimeline } from "../translate.js";
import { FakeOpencodeTransport } from "./fakes.js";
import { QUESTION_EVENTS, SHELL_TURN_EVENTS, STEER_AND_CANCEL_EVENTS, TIMELINE_ITEMS } from "./v2samples.js";

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
  it("matches answers by question text (with requestactivity's duplicate suffix), then header, then q<index>", () => {
    const questions = JSON.stringify([
      { header: "Color", question: "Which color?" },
      { header: "Color", question: "Which color?" },
      { header: "Size", question: "How big?" },
      { header: "Shape", question: "What shape?" },
    ]);
    expect(
      answersFor({ "Which color?": "Red", "Which color? (2)": "Blue", Size: "XL", q3: "Round" }, questions),
    ).toEqual([["Red"], ["Blue"], ["XL"], ["Round"]]);
    // Text wins over header when both are present.
    expect(answersFor({ "How big?": "S", Size: "L" }, JSON.stringify([{ header: "Size", question: "How big?" }]))).toEqual([["S"]]);
  });

  it("splits a multiselect answer, keeping an option label that contains the separator whole", () => {
    const questions = JSON.stringify([
      { header: "Seasoning", question: "Pick some", multiple: true, options: [{ label: "Salt, pepper" }, { label: "Cumin" }, { label: "Sage" }] },
    ]);
    expect(answersFor({ "Pick some": "Salt, pepper, Cumin" }, questions)).toEqual([["Salt, pepper", "Cumin"]]);
    expect(answersFor({ "Pick some": "Sage, Salt, pepper" }, questions)).toEqual([["Sage", "Salt, pepper"]]);
    expect(answersFor({ "Pick some": "Sage, Cumin, typed extra" }, questions)).toEqual([["Sage", "Cumin", "typed extra"]]);
    expect(answersFor({ "Pick some": "Cumin" }, questions)).toEqual([["Cumin"]]);
    expect(answersFor({ "Pick some": "" }, questions)).toEqual([[]]);
  });

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
    runtimeMode?: RuntimeMode,
  ) {
    return await Effect.runPromise(
      driver.startSession({ threadId, workingDirectory: "/repo", modelSelection, ...(runtimeMode ? { runtimeMode } : {}) }),
    );
  }

  /** Full access (the default) answers permissions itself; these tests need a prompt to park. */
  const startSupervised = (driver: OpenCodeDriver) => startSession(driver, undefined, undefined, "approval-required");

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
    const server = transport.servers[0]!;
    // v2 prompts carry text and files only; the model is session state.
    expect(server.callsTo("session.prompt")[0]?.args).toMatchObject({ sessionID: "opencode-session-1", text: "hi", files: [] });
    expect(server.callsTo("session.switchModel")).toMatchObject([
      { args: { sessionID: "opencode-session-1", model: { providerID: "anthropic", modelID: "claude-opus-4-6" } } },
    ]);

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
    await startSupervised(driver);
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
      { args: { sessionID: "opencode-session-1", requestID: "perm-1", reply: "always" } },
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
    // v2 has no empty reply: dismissing a question cancels its form.
    expect(transport.servers[0]?.callsTo("session.form.cancel")).toMatchObject([
      { args: { sessionID: "opencode-session-1", requestID: "q-9" } },
    ]);
    expect(transport.servers[0]?.callsTo("session.form.reply")).toEqual([]);
  });

  it("maps decline/cancel to reject and guards mismatched kinds", async () => {
    const { transport, driver } = start();
    await startSupervised(driver);
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
    expect(transport.servers[0]?.callsTo("session.form.reply")).toMatchObject([
      { args: { sessionID: "opencode-session-1", requestID: "q-1", answers: [["a"]] } },
    ]);

    await transport.servers[0]?.push({
      type: "permission.asked",
      properties: { id: "perm-2", sessionID: "opencode-session-1", permission: "bash" },
    });
    await waitFor("permission park", () => true);
    await Effect.runPromise(driver.respondToRequest("thread-1", "perm-2", { kind: "cancel" }));
    expect(transport.servers[0]?.callsTo("permission.reply")).toMatchObject([
      { args: { sessionID: "opencode-session-1", requestID: "perm-2", reply: "reject" } },
    ]);
  });

  it("interrupts reject parked requests, aborts, and settles the turn", async () => {
    const { transport, driver } = start();
    await startSupervised(driver);
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "hi" }));
    await transport.servers[0]?.push({
      type: "permission.asked",
      properties: { id: "perm-1", sessionID: "opencode-session-1", permission: "edit" },
    });
    await waitFor("permission park", () => (transport.servers[0]?.callsTo("event.subscribe").length ?? 0) > 0);
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    expect(transport.servers[0]?.callsTo("permission.reply")).toMatchObject([
      { args: { sessionID: "opencode-session-1", requestID: "perm-1", reply: "reject" } },
    ]);
    expect(transport.servers[0]?.aborted).toEqual(["opencode-session-1"]);
    await expect(outcomePromise).resolves.toMatchObject({ status: "interrupted" });
  });

  it("does not let the old run's interrupt confirmation complete the next turn", async () => {
    const { transport, driver } = start();
    await startSession(driver);
    const first = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "a" }));
    const firstOutcome = driver.awaitTurn("thread-1", first.turnId);
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    await expect(firstOutcome).resolves.toMatchObject({ status: "interrupted" });
    // The confirmation the fake pushed after abort has been consumed by the interrupt itself.
    const second = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "b" }));
    const secondOutcome = driver.awaitTurn("thread-1", second.turnId);
    let settled = false;
    void secondOutcome.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false);
    await transport.servers[0]?.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    await expect(secondOutcome).resolves.toMatchObject({ status: "completed" });
  });

  it("settles an interrupt itself when the server never confirms it", async () => {
    const transport = new FakeOpencodeTransport({ confirmInterrupts: false });
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "k" }, interruptAckTimeoutMs: 30 });
    drivers.push(driver);
    await startSession(driver);
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "a" }));
    const outcome = driver.awaitTurn("thread-1", sent.turnId);
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    await expect(outcome).resolves.toMatchObject({ status: "interrupted" });
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
    expect(transport.servers[0]?.callsTo("session.compact").length).toBe(1);

    const failing = start({ failMethods: { "session.prompt": "nope" } });
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
    expect(transport.servers[0]?.callsTo("session.prompt")).toHaveLength(1);

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
    const prompt = transport.servers[0]?.callsTo("session.prompt")[0]?.args as { messageID: string };
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
    // v2 counts input + cache + output + reasoning; with no configured buffer
    // the threshold leaves 10% of the window (floor 16k).
    expect(await driver.contextUsage("thread-1")).toEqual({
      usedTokens: 12310 + 113 + 11 + 6,
      maxTokens: 1_048_576,
      cachedInputTokens: 113,
      autoCompactThreshold: 1_048_576 - 104_857,
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
    const prompts = server.callsTo("session.prompt").map((call) => call.args as { messageID: string; text: string });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.text).toBe("just say BANANA");
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

  it("keeps runtime instructions as the session's moxen entry, put once", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({ threadId: "thread-1", workingDirectory: "/repo", instructions: "Report back." }),
    );
    const server = transport.servers[0]!;
    for (const prompt of ["a", "b"]) {
      const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt }));
      const outcome = driver.awaitTurn("thread-1", sent.turnId);
      await server.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
      await outcome;
    }
    // Sent as an instruction entry, not a per-prompt `system` (v2 drops that), and only once.
    expect(server.callsTo("session.instructions")).toMatchObject([
      { args: { sessionID: "opencode-session-1", key: "moxen", value: "Report back." } },
    ]);
    expect(server.callsTo("session.prompt")[0]!.args).not.toHaveProperty("system");
  });

  it("does not touch instructions of a fresh session that has none, but clears a resumed one's stale entry", async () => {
    const fresh = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport: fresh, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(driver.startSession({ threadId: "thread-1", workingDirectory: "/repo" }));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "a" }));
    expect(fresh.servers[0]!.callsTo("session.instructions")).toEqual([]);

    const resumedTransport = new FakeOpencodeTransport();
    const resumedDriver = new OpenCodeDriver({ transport: resumedTransport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(resumedDriver);
    await Effect.runPromise(
      resumedDriver.startSession({ threadId: "thread-2", workingDirectory: "/repo", resumeCursor: "ses_old" }),
    );
    await Effect.runPromise(resumedDriver.sendTurn({ threadId: "thread-2", prompt: "a" }));
    expect(resumedTransport.servers[0]!.callsTo("session.instructions")).toMatchObject([
      { args: { sessionID: "ses_old", key: "moxen", value: null } },
    ]);
  });

  it("switches to the plan agent once, and back to build when plan mode ends", async () => {
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(driver.startSession({ threadId: "thread-1", workingDirectory: "/repo" }));
    const server = transport.servers[0]!;
    const turn = async (prompt: string, interactionMode: "plan" | "default") => {
      const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt, interactionMode }));
      const outcome = driver.awaitTurn("thread-1", sent.turnId);
      await server.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
      await outcome;
    };
    await turn("a", "default");
    expect(server.callsTo("session.switchAgent")).toEqual([]);
    await turn("b", "plan");
    await turn("c", "plan");
    expect(server.callsTo("session.switchAgent").map((call) => (call.args as { agent: string }).agent)).toEqual(["plan"]);
    await turn("d", "default");
    await turn("e", "default");
    expect(server.callsTo("session.switchAgent").map((call) => (call.args as { agent: string }).agent)).toEqual(["plan", "build"]);
  });

  it("leaves a session on the user's own agent alone in default mode", async () => {
    const transport = new FakeOpencodeTransport({ sessionState: { agent: "reviewer" } });
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(driver.startSession({ threadId: "thread-1", workingDirectory: "/repo", resumeCursor: "ses_old" }));
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "a", interactionMode: "default" }));
    expect(transport.servers[0]!.callsTo("session.switchAgent")).toEqual([]);
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

  describe("native subagents (the `subagent` tool's child sessions)", () => {
    const PARENT = "opencode-session-1";
    const CHILD = "ses_child";
    // Shapes captured from a live v2.0.19 server running one foreground explore call.
    const call = (type: string, data: Record<string, unknown>) => ({
      type,
      created: 1790820781870,
      data: { sessionID: PARENT, assistantMessageID: "msg_parent", id: "call_sub", ...data },
    });
    const input = { agent: "explore", description: "Find one file in /tmp", prompt: "Find one file in /tmp and report its name." };

    async function running(script: ConstructorParameters<typeof FakeOpencodeTransport>[0] = {}) {
      const transport = new FakeOpencodeTransport(script);
      const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
      drivers.push(driver);
      const events: ProviderRuntimeEvent[] = [];
      const fiber = Effect.runFork(Stream.runForEach(driver.streamEvents, (event) => Effect.sync(() => void events.push(event))));
      await Effect.runPromise(driver.startSession({ threadId: "thread-1", workingDirectory: "/repo" }));
      const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
      const server = transport.servers[0]!;
      const subagents = () => events.flatMap((event) => (event.type === "subagent.updated" ? [event] : []));
      return { driver, server, sent, fiber, subagents };
    }

    it("starts one as the call names its child, and stops it with the report the call returns", async () => {
      const { server, sent, fiber, subagents } = await running();
      await server.pushRaw(call("session.tool.input.started", { name: "subagent" }));
      await server.pushRaw(call("session.tool.called", { input }));
      await server.pushRaw(call("session.tool.progress", { metadata: { sessionID: CHILD, status: "running" } }));
      expect(subagents()).toMatchObject([
        { agentId: CHILD, agentType: "explore", description: "Find one file in /tmp", status: "started", turnId: sent.turnId },
      ]);
      // The child's own work and its finish: not this thread's turn, and a
      // foreground call's end is the call's, not the child's idle.
      await server.pushRaw({ type: "session.tool.called", data: { sessionID: CHILD, id: "call_glob", input: { pattern: "*" } } });
      await server.pushRaw({ type: "session.execution.succeeded", data: { sessionID: CHILD } });
      expect(subagents()).toHaveLength(1);
      await server.pushRaw(
        call("session.tool.success", {
          content: [{ type: "text", text: `<subagent sessionID="${CHILD}" state="completed">\nI found one file: /tmp/tf-final.pdf\n</subagent>` }],
          metadata: { sessionID: CHILD, status: "completed", truncated: false },
        }),
      );
      expect(subagents()).toMatchObject([
        { status: "started" },
        { agentId: CHILD, status: "stopped", lastMessage: "I found one file: /tmp/tf-final.pdf" },
      ]);
      expect(subagents()[1]).not.toHaveProperty("description");
      await Effect.runPromise(Fiber.interrupt(fiber));
    });

    it("stops a background one when its child goes idle, with the child's last word", async () => {
      const { server, fiber, subagents } = await running({
        messages: [{ info: { id: "a1", role: "assistant" }, parts: [{ id: "t1", type: "text", text: "Done: /tmp/x" }] }],
      });
      await server.pushRaw(call("session.tool.input.started", { name: "subagent" }));
      await server.pushRaw(call("session.tool.called", { input: { ...input, background: true } }));
      await server.pushRaw(call("session.tool.progress", { metadata: { sessionID: CHILD, status: "running" } }));
      // Returns at launch: the child is still working.
      await server.pushRaw(call("session.tool.success", { content: [{ type: "text", text: `<subagent sessionID="${CHILD}" state="running">` }], metadata: { sessionID: CHILD } }));
      expect(subagents().map((event) => event.status)).toEqual(["started"]);
      await server.pushRaw({ type: "session.execution.succeeded", data: { sessionID: CHILD } });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(subagents()).toMatchObject([{ status: "started" }, { agentId: CHILD, status: "stopped", lastMessage: "Done: /tmp/x" }]);
      expect(server.callsTo("session.messages").at(-1)?.args).toMatchObject({ sessionID: CHILD });
      await Effect.runPromise(Fiber.interrupt(fiber));
    });

    it("answers a subagent's own prompts itself: permissions allowed, questions dismissed", async () => {
      const { server, fiber, subagents } = await running({ parents: { ses_late: PARENT, ses_stranger: "ses_other_client" } });
      await server.pushRaw(call("session.tool.input.started", { name: "subagent" }));
      await server.pushRaw(call("session.tool.called", { input }));
      await server.pushRaw(call("session.tool.progress", { metadata: { sessionID: CHILD, status: "running" } }));
      const asked = (sessionID: string, id: string) =>
        server.pushRaw({ type: "permission.asked", data: { id, sessionID, action: "external_directory", resources: ["/etc/*"], save: ["/etc/*"] } });
      await asked(CHILD, "per_child");
      await server.pushRaw({
        type: "form.created",
        data: { form: { id: "frm_child", sessionID: CHILD, metadata: { kind: "question" }, fields: [{ key: "q", type: "string", title: "Which?" }] } },
      });
      // Not yet named by its call, but a child of this thread's session; and one that is not.
      await asked("ses_late", "per_late");
      await asked("ses_stranger", "per_stranger");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(server.callsTo("permission.reply").map((entry) => entry.args)).toEqual([
        expect.objectContaining({ sessionID: CHILD, requestID: "per_child", reply: "once" }),
        expect.objectContaining({ sessionID: "ses_late", requestID: "per_late", reply: "once" }),
      ]);
      expect(server.callsTo("session.form.cancel").map((entry) => entry.args)).toMatchObject([{ sessionID: CHILD, requestID: "frm_child" }]);
      expect(subagents()).toHaveLength(1);
      await Effect.runPromise(Fiber.interrupt(fiber));
    });

    it("reads a child's conversation, and only this thread's own children", async () => {
      const { driver, server, fiber } = await running({ parents: { [CHILD]: PARENT, ses_other: "ses_someone_else" } });
      server.messages = [
        { info: { id: "u1", role: "user", time: { created: 1000 } }, parts: [{ id: "u1:text", type: "text", text: "Find one file" }] },
        {
          info: { id: "a1", role: "assistant", time: { created: 2000 } },
          parts: [
            { id: "a1:0", type: "reasoning", text: "Glob it." },
            { id: "call_glob", callID: "call_glob", type: "tool", tool: "glob", state: { status: "completed", input: { pattern: "*" }, time: { start: 2500 } } },
            { id: "a1:2", type: "text", text: "Found /tmp/x" },
          ],
        },
      ];
      expect(await driver.subagentHistory("thread-1", CHILD)).toMatchObject([
        { kind: "prompt", text: "Find one file", at: new Date(1000).toISOString() },
        { kind: "reasoning", text: "Glob it." },
        { kind: "tool", tool: "glob", id: "call_glob", at: new Date(2500).toISOString() },
        { kind: "text", text: "Found /tmp/x" },
      ]);
      expect(await driver.subagentHistory("thread-1", "ses_other")).toBeNull();
      expect(await driver.subagentHistory("thread-2", CHILD)).toBeNull();
      await Effect.runPromise(Fiber.interrupt(fiber));
    });
  });
});

describe("opencode images", () => {
  it("sends images as files carrying a data URL", async () => {
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
    expect(transport.servers[0]?.callsTo("session.prompt")[0]?.args).toMatchObject({
      text: "look",
      files: [{ uri: "data:image/png;base64,iVBORw0KGgo=", name: "a.png" }],
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

const REAL_SESSION = "ses_f0ddba907ffeHoSABAb2zhuSrx";

describe("opencode driver on OpenCode v2", () => {
  const drivers: OpenCodeDriver[] = [];
  afterEach(async () => {
    for (const driver of drivers.splice(0)) {
      await Effect.runPromise(driver.stopAll()).catch(() => undefined);
    }
  });

  async function setup(
    script: ConstructorParameters<typeof FakeOpencodeTransport>[0] = {},
    model = "opencode/longcat-2.5-preview-free",
    resumeCursor?: string,
    runtimeMode?: RuntimeMode,
  ) {
    const transport = new FakeOpencodeTransport({ sessionID: REAL_SESSION, ...script });
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    const events: ProviderRuntimeEvent[] = [];
    const fiber = Effect.runFork(Stream.runForEach(driver.streamEvents, (event) => Effect.sync(() => void events.push(event))));
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model },
        ...(resumeCursor ? { resumeCursor } : {}),
        ...(runtimeMode ? { runtimeMode } : {}),
      }),
    );
    return { transport, driver, events, server: transport.servers[0]!, stop: () => Effect.runPromise(Fiber.interrupt(fiber)) };
  }

  it("runs a real recorded shell turn: streamed text, tool lifecycle, usage and context", async () => {
    const { driver, events, server, stop } = await setup({
      messages: translateTimeline(TIMELINE_ITEMS),
      limits: { "opencode/longcat-2.5-preview-free": { context: 1_000_000, output: 131_072 } },
    });
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "Run `echo probe-ok`" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    for (const event of SHELL_TURN_EVENTS) await server.pushRaw(event);
    const outcome = await outcomePromise;
    await stop();

    expect(outcome.status).toBe("completed");
    expect(outcome.text).toBe("The shell command executed successfully and printed `probe-ok`.");
    const deltas = events.flatMap((event) => (event.type === "message.part.updated" ? [event.text] : []));
    expect(deltas.join("")).toBe(outcome.text);

    const tools = events.flatMap((event) =>
      event.type.startsWith("tool.execute.") ? [[event.type, (event as { raw?: { state?: { status?: string } } }).raw?.state?.status]] : [],
    );
    expect(tools).toEqual([
      ["tool.execute.started", "pending"],
      ["tool.execute.updated", "running"],
      ["tool.execute.updated", "running"],
      ["tool.execute.completed", "completed"],
    ]);
    const completed = events.find((event) => event.type === "tool.execute.completed") as { tool: string; raw: Record<string, any> };
    expect(completed.tool).toBe("shell");
    expect(completed.raw.state).toMatchObject({ input: { command: "echo probe-ok" }, output: "probe-ok\n" });

    // The last reply's tokens: input 3094 + cache 5632 + output 15 + reasoning 24.
    expect(outcome.usage).toMatchObject({ input: 3094, cacheRead: 5632, output: 15, thinking: 24 });
    expect(await driver.contextUsage("thread-1")).toMatchObject({
      usedTokens: 3094 + 5632 + 15 + 24,
      maxTokens: 1_000_000,
      autoCompactThreshold: 900_000,
    });
    // Full access: the recorded shell prompt is allowed once, never shown.
    expect(events.map((event) => event.type)).not.toContain("permission.request.opened");
    expect(server.callsTo("permission.reply")).toMatchObject([
      { args: { sessionID: REAL_SESSION, requestID: "per_0f2247778001tngDfYafZ62Aag", reply: "once" } },
    ]);
  });

  it("answers a question form with the form's own field keys", async () => {
    const { driver, events, server, stop } = await setup();
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "ask" }));
    await server.pushRaw(QUESTION_EVENTS[0]!);
    const opened = events.find((event) => event.type === "user-input.request.opened") as { requestId: string; raw: any };
    expect(opened.requestId).toBe("frm_0f225d0f8001PFnM3IuuA7iufm");
    expect(opened.raw.questions[0]).toMatchObject({ header: "Color", multiSelect: false });

    await Effect.runPromise(driver.respondToUserInput("thread-1", opened.requestId, { Color: "Red" }));
    await stop();
    expect(server.callsTo("session.form.reply")).toMatchObject([
      { args: { sessionID: REAL_SESSION, requestID: "frm_0f225d0f8001PFnM3IuuA7iufm", answer: { q0: "Red" } } },
    ]);
  });

  it("replies to a permission with the session it belongs to", async () => {
    const { driver, server, events, stop } = await setup({}, undefined, undefined, "approval-required");
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "go" }));
    for (const event of SHELL_TURN_EVENTS.filter((entry) => entry.type === "permission.asked")) await server.pushRaw(event);
    const opened = events.find((event) => event.type === "permission.request.opened") as { requestId: string; raw: any };
    expect(opened.raw).toMatchObject({ permission: "shell", patterns: ["echo probe-ok"], toolName: "shell" });
    await Effect.runPromise(driver.respondToRequest("thread-1", opened.requestId, { kind: "accept" }));
    await stop();
    expect(server.callsTo("permission.reply")).toMatchObject([
      { args: { sessionID: REAL_SESSION, requestID: "per_0f2247778001tngDfYafZ62Aag", reply: "once" } },
    ]);
  });

  it("settles a turn that spans two executions once, after the steer's run", async () => {
    const { driver, server, stop } = await setup({ messages: [] });
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "ask" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    let settled = 0;
    void outcomePromise.then(() => (settled += 1));
    const last = STEER_AND_CANCEL_EVENTS.length - 1;
    expect(STEER_AND_CANCEL_EVENTS[last]!.type).toBe("session.execution.succeeded");
    for (const event of STEER_AND_CANCEL_EVENTS.slice(0, last)) await server.pushRaw(event);
    // The cancelled form interrupted the first execution; the steer is still to run.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(0);
    await server.pushRaw(STEER_AND_CANCEL_EVENTS[last]!);
    await expect(outcomePromise).resolves.toMatchObject({ status: "completed" });
    await stop();
    expect(settled).toBe(1);
  });

  it("switches the model only when it changed, and passes a listed reasoning variant", async () => {
    const models = [
      { providerID: "opencode", modelID: "space-bunny-free", variants: ["low", "high"], limit: { context: 1_000, output: 100 } },
      { providerID: "opencode", modelID: "longcat-2.5-preview-free", variants: [], limit: { context: 1_000, output: 100 } },
    ];
    const { driver, server, stop } = await setup({ models }, "opencode/longcat-2.5-preview-free");
    const turn = async (modelSelection: { instanceId: string; model: string; options?: Array<{ id: string; value: string }> }) => {
      const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "x", modelSelection }));
      const outcome = driver.awaitTurn("thread-1", sent.turnId);
      await server.push({ type: "session.idle", properties: { sessionID: REAL_SESSION } });
      await outcome;
    };
    const switches = () => server.callsTo("session.switchModel").map((call) => (call.args as { model: unknown }).model);
    await turn({ instanceId: "opencode", model: "opencode/longcat-2.5-preview-free" });
    await turn({ instanceId: "opencode", model: "opencode/longcat-2.5-preview-free" });
    expect(switches()).toEqual([{ providerID: "opencode", modelID: "longcat-2.5-preview-free" }]);

    await turn({ instanceId: "opencode", model: "opencode/space-bunny-free", options: [{ id: "reasoningEffort", value: "high" }] });
    await turn({ instanceId: "opencode", model: "opencode/space-bunny-free", options: [{ id: "reasoningEffort", value: "high" }] });
    expect(switches().at(-1)).toEqual({ providerID: "opencode", modelID: "space-bunny-free", variant: "high" });
    expect(switches()).toHaveLength(2);

    // A new effort is a new variant; one the model does not list is not sent at all.
    await turn({ instanceId: "opencode", model: "opencode/space-bunny-free", options: [{ id: "reasoningEffort", value: "low" }] });
    expect(switches().at(-1)).toMatchObject({ variant: "low" });
    await turn({ instanceId: "opencode", model: "opencode/space-bunny-free", options: [{ id: "reasoningEffort", value: "warp" }] });
    expect(switches().at(-1)).toEqual({ providerID: "opencode", modelID: "space-bunny-free" });
    await stop();
  });

  it("does not switch when the resumed session already runs the model", async () => {
    const models = [{ providerID: "opencode", modelID: "m", variants: [], limit: { context: 1_000, output: 100 } }];
    const { driver, server } = await setup({ models, sessionState: { model: { providerID: "opencode", modelID: "m" } } }, "opencode/m", "ses_old");
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "x" }));
    expect(server.callsTo("session.switchModel")).toEqual([]);
  });

  it("fails the send clearly for a model the server does not list, without a prompt or a stuck turn", async () => {
    const models = [{ providerID: "opencode", modelID: "real", variants: [], limit: { context: 1_000, output: 100 } }];
    const { driver, server } = await setup({ models }, "opencode/nope");
    const failure = await Effect.runPromise(Effect.flip(driver.sendTurn({ threadId: "thread-1", prompt: "hi" })));
    expect(failure.code).toBe("OPENCODE_MODEL_UNAVAILABLE");
    expect(failure.message).toContain("opencode/nope");
    expect(server.callsTo("session.prompt")).toEqual([]);
    expect(server.callsTo("session.switchModel")).toEqual([]);
    // The failed send left no running turn behind.
    const again = await Effect.runPromise(
      driver.sendTurn({ threadId: "thread-1", prompt: "hi", modelSelection: { instanceId: "opencode", model: "opencode/real" } }),
    );
    expect(again.turnId).toMatch(/^turn-/);
    // One fetch, one refresh for the miss; the second send finds its model in the cached list.
    expect(server.callsTo("model.list")).toHaveLength(2);
  });

  it("rolls back onto the fork and re-applies what the fork does not report", async () => {
    const { driver, server } = await setup(
      { messages: translateTimeline(TIMELINE_ITEMS), sessionState: { agent: "plan" } },
      "opencode/longcat-2.5-preview-free",
      REAL_SESSION,
    );
    await Effect.runPromise(driver.rollbackThread("thread-1", 1));
    expect(server.callsTo("session.fork")).toMatchObject([{ args: { sessionID: REAL_SESSION, messageID: "msg_6f89c3f0317c3TtJp3TRZuOMpO" } }]);
    expect(driver.resumeCursor("thread-1")).toBe("opencode-session-fork");
    // The fork inherits plan mode; default mode leaves it.
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "x", interactionMode: "default" }));
    expect(server.callsTo("session.switchAgent")).toMatchObject([{ args: { sessionID: "opencode-session-fork", agent: "build" } }]);
  });

  it("fails open turns when the event stream drops, and restarts it for the next send", async () => {
    const { driver, server, transport } = await setup();
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "x" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    server.endStream();
    const outcome = await outcomePromise;
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("event stream");
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "again" }));
    // A server whose stream died is dropped, not reused: the send lands on a fresh one.
    expect(server.disposed).toBe(true);
    expect(transport.servers).toHaveLength(2);
    expect(transport.servers[1]?.callsTo("event.subscribe")).toHaveLength(1);
    expect(transport.servers[1]?.callsTo("session.prompt")).toHaveLength(1);
  });

  it("respawns a server whose process exited, re-registering MCP on the new one", async () => {
    const transport = new FakeOpencodeTransport({ sessionID: REAL_SESSION });
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" } });
    drivers.push(driver);
    await Effect.runPromise(
      driver.startSession({
        threadId: "thread-1",
        workingDirectory: "/repo",
        modelSelection: { instanceId: "opencode", model: "opencode/longcat-2.5-preview-free" },
        mcpServers: [{ name: "moxen", type: "http", url: "http://127.0.0.1:1/mcp", headers: {} } as never],
      }),
    );
    const first = transport.servers[0]!;
    expect(first.callsTo("mcp.add")).toHaveLength(1);
    first.kill();
    await waitFor("the dead server to be dropped", () => first.disposed);
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "after the crash" }));
    expect(transport.servers).toHaveLength(2);
    const second = transport.servers[1]!;
    expect(second.callsTo("session.prompt")).toMatchObject([{ args: { text: "after the crash" } }]);
    expect(second.callsTo("mcp.add")).toHaveLength(1);
  });

  it("re-arms the silence watchdog on activity, so a long but chatty turn is not failed", async () => {
    const transport = new FakeOpencodeTransport({ sessionID: REAL_SESSION });
    const driver = new OpenCodeDriver({ transport, env: { OPENCODE_API_KEY: "k" }, stallTimeoutMs: 120 });
    drivers.push(driver);
    await Effect.runPromise(driver.startSession({ threadId: "thread-1", workingDirectory: "/repo" }));
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "x" }));
    const outcomePromise = driver.awaitTurn("thread-1", sent.turnId);
    let settled = false;
    void outcomePromise.then(() => (settled = true));
    for (let index = 0; index < 5; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await transport.servers[0]!.push({ type: "message.part.updated", properties: { sessionID: REAL_SESSION, part: { id: "p", messageID: "m", type: "text", text: "." .repeat(index + 1) } } });
    }
    expect(settled).toBe(false);
    await expect(outcomePromise).resolves.toMatchObject({ status: "failed" });
  });
});

describe("opencode auto-compaction threshold", () => {
  it("follows v2's formula: usable window less a buffer (10% of it, floor 16k from 32k up)", () => {
    expect(opencodeCompactionThreshold({ context: 200_000 }, null)).toBe(180_000);
    expect(opencodeCompactionThreshold({ context: 128_000 }, null)).toBe(112_000);
    expect(opencodeCompactionThreshold({ context: 20_000 }, null)).toBe(18_000);
    expect(opencodeCompactionThreshold({ context: 1_000_000 }, null)).toBe(900_000);
    // A model with an input limit is measured against that instead.
    expect(opencodeCompactionThreshold({ context: 1_048_576, input: 524_288 }, null)).toBe(524_288 - 52_428);
    // A configured buffer replaces the derived one, however small.
    expect(opencodeCompactionThreshold({ context: 200_000 }, 30_000)).toBe(170_000);
    expect(opencodeCompactionThreshold({ context: 200_000 }, 0)).toBe(200_000);
    expect(opencodeCompactionThreshold({ context: 0 }, null)).toBeNull();
  });

  it("counts input, cache, output and reasoning, and reads the model's limit from the message", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: {
          role: "assistant",
          providerID: "p",
          modelID: "m",
          tokens: { input: 1000, output: 200, reasoning: 50, cache: { read: 300, write: 40 } },
        },
      },
      // A step cut short reports no tokens; the reply before it still counts.
      { info: { role: "assistant", providerID: "p", modelID: "m" } },
    ];
    const settings = { limits: new Map([["p/m", { context: 200_000, output: 8_000 }]]), autoCompact: false, buffer: 20_000 };
    expect(opencodeContextOf(messages, settings)).toEqual({
      usedTokens: 1590,
      maxTokens: 200_000,
      cachedInputTokens: 300,
      autoCompactThreshold: 180_000,
      compactsAutomatically: false,
    });
    expect(opencodeContextOf(messages, null)).toMatchObject({ maxTokens: null, autoCompactThreshold: null, compactsAutomatically: null });
    expect(opencodeContextOf([{ info: { role: "user" } }], settings)).toBeNull();
  });
});


describe("opencode driver: findings of the v2 port review", () => {
  const drivers: OpenCodeDriver[] = [];
  afterEach(async () => {
    for (const driver of drivers.splice(0)) await Effect.runPromise(driver.stopAll()).catch(() => undefined);
  });

  async function setup(
    script: ConstructorParameters<typeof FakeOpencodeTransport>[0] = {},
    model = "opencode/longcat-2.5-preview-free",
    env: NodeJS.ProcessEnv = { OPENCODE_API_KEY: "k" },
  ) {
    const transport = new FakeOpencodeTransport({ sessionID: REAL_SESSION, ...script });
    const driver = new OpenCodeDriver({ transport, env });
    drivers.push(driver);
    const events: ProviderRuntimeEvent[] = [];
    const fiber = Effect.runFork(Stream.runForEach(driver.streamEvents, (event) => Effect.sync(() => void events.push(event))));
    await Effect.runPromise(
      driver.startSession({ threadId: "thread-1", workingDirectory: "/repo", modelSelection: { instanceId: "opencode", model } }),
    );
    return { transport, driver, events, server: transport.servers[0]!, stop: () => Effect.runPromise(Fiber.interrupt(fiber)) };
  }

  it("carries the panel's answers (keyed by question text, multiselect joined) into the form reply", async () => {
    const { driver, events, server, stop } = await setup();
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "ask" }));
    await server.pushRaw({
      created: 1,
      type: "form.created",
      data: {
        form: {
          id: "frm_e2e",
          sessionID: REAL_SESSION,
          title: "Questions",
          metadata: { kind: "question" },
          fields: [
            { key: "q0", title: "Color", description: "Which color do you prefer?", type: "string", options: [{ value: "Red", label: "Red" }, { value: "Green", label: "Green" }] },
            { key: "q1", title: "Spice", description: "Which spices?", type: "multiselect", options: [{ value: "a", label: "Salt, pepper" }, { value: "b", label: "Cumin" }] },
            { key: "q2", title: "Color", description: "Which color do you prefer?", type: "string", options: [{ value: "Red", label: "Red" }] },
          ],
        },
      },
    });
    const opened = events.find((event) => event.type === "user-input.request.opened")!;
    const row = userInputActivityRow(opened as never);
    const questions = (row!.payload as { questions: Array<{ id: string }> }).questions;
    expect(questions.map((question) => question.id)).toEqual(["Which color do you prefer?", "Which spices?", "Which color do you prefer? (3)"]);
    // Exactly what the panel sends: id → answer, multiselect joined with ", ".
    await Effect.runPromise(
      driver.respondToUserInput("thread-1", (opened as { requestId: string }).requestId, {
        "Which color do you prefer?": "Green",
        "Which spices?": "Salt, pepper, Cumin",
        "Which color do you prefer? (3)": "Red",
      }),
    );
    await stop();
    expect(server.callsTo("session.form.reply")).toMatchObject([
      { args: { requestID: "frm_e2e", answer: { q0: "Green", q1: ["Salt, pepper", "Cumin"], q2: "Red" } } },
    ]);
  });

  async function steeredTurn(script: ConstructorParameters<typeof FakeOpencodeTransport>[0] = {}) {
    const ctx = await setup(script);
    const sent = await Effect.runPromise(ctx.driver.sendTurn({ threadId: "thread-1", prompt: "sleep" }));
    const outcome = ctx.driver.awaitTurn("thread-1", sent.turnId);
    await Effect.runPromise(ctx.driver.steerTurn("thread-1", "new instruction"));
    const [prompt, steer] = ctx.server.callsTo("session.prompt").map((call) => (call.args as { messageID: string }).messageID);
    // The server queues the steer; the run has not reached a step boundary to take it.
    await ctx.server.pushRaw({
      type: "session.inbox.enqueued",
      data: { sessionID: REAL_SESSION, inboxID: steer, item: { type: "user", payload: { text: "new instruction" } } },
    });
    return { ...ctx, outcome, prompt: prompt!, steer: steer! };
  }

  it("cancels the turn's queued prompt and steer on interrupt and acknowledges it at once", async () => {
    const { driver, server, outcome, prompt, steer, stop } = await steeredTurn();
    const started = Date.now();
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    expect(Date.now() - started).toBeLessThan(1000);
    await expect(outcome).resolves.toMatchObject({ status: "interrupted" });
    await stop();
    const cancelled = server.callsTo("session.inbox.cancel").map((call) => (call.args as { inboxID: string }).inboxID);
    expect(cancelled.sort()).toEqual([prompt, steer].sort());
    // Cancelled before the abort, so the steer cannot slip into the interrupted run's next step.
    const order = server.calls.map((call) => call.method);
    expect(order.lastIndexOf("session.inbox.cancel")).toBeLessThan(order.indexOf("session.abort"));
  });

  it("acknowledges an interrupt even when a cancel fails and the steer stays queued", async () => {
    // Every cancel throws: the steer stays queued in the translator, and the ack must not depend on it.
    const { driver, outcome, stop } = await steeredTurn({ undeliverableInbox: ["*"] });
    const started = Date.now();
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    await outcome;
    await stop();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("acknowledges an interrupt whose confirmation beats the abort reply", async () => {
    const { driver, outcome, stop } = await (async () => {
      const ctx = await setup({ confirmInterrupts: "immediately" });
      const sent = await Effect.runPromise(ctx.driver.sendTurn({ threadId: "thread-1", prompt: "x" }));
      return { ...ctx, outcome: ctx.driver.awaitTurn("thread-1", sent.turnId) };
    })();
    const started = Date.now();
    await Effect.runPromise(driver.interruptTurn("thread-1"));
    // Not the 3 s ack timeout: the event had already arrived when the driver began to wait.
    expect(Date.now() - started).toBeLessThan(1000);
    await expect(outcome).resolves.toMatchObject({ status: "interrupted" });
    await stop();
  });

  it("settles an unrequested interrupt by its reason: inactivity and superseded fail, shutdown completes", async () => {
    for (const [reason, status, message] of [
      ["inactivity", "failed", "inactivity"],
      ["superseded", "failed", "another prompt"],
      ["shutdown", "completed", ""],
    ] as const) {
      const { driver, server, stop } = await setup();
      const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "x" }));
      const outcome = driver.awaitTurn("thread-1", sent.turnId);
      await server.pushRaw({ type: "session.execution.interrupted", data: { sessionID: REAL_SESSION, reason } });
      const settled = await outcome;
      expect(settled.status).toBe(status);
      if (status === "failed") expect(settled.error).toContain(message);
      await stop();
      await Effect.runPromise(driver.stopAll());
    }
  });

  it("switches the compaction model through the applied-state cache, variant included", async () => {
    const models = [
      { providerID: "opencode", modelID: "space-bunny-free", variants: ["low", "high"], limit: { context: 1_000, output: 100 } },
    ];
    const { driver, server, stop } = await setup({ models });
    await Effect.runPromise(
      driver.compaction.start("thread-1", {
        instanceId: "opencode",
        model: "opencode/space-bunny-free",
        options: [{ id: "reasoningEffort", value: "high" }],
      }),
    );
    expect(server.callsTo("session.switchModel")).toMatchObject([{ args: { model: { modelID: "space-bunny-free", variant: "high" } } }]);
    expect(server.callsTo("session.compact")).toHaveLength(1);
    // The next send finds the model already applied: no silent switch to "no variant".
    await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "x" }));
    expect(server.callsTo("session.switchModel")).toHaveLength(1);
    await stop();
  });

  it("reads the context breakdown from the post-compaction messages only", async () => {
    const { driver, server, stop } = await setup({ messages: assistantMessages() });
    const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "x" }));
    const outcome = driver.awaitTurn("thread-1", sent.turnId);
    await server.push({ type: "session.idle", properties: { sessionID: REAL_SESSION } });
    await outcome;
    await driver.contextBreakdown("thread-1");
    await stop();
    expect(server.callsTo("session.context")).toHaveLength(1);
    // The only history reads are the bounded tail at turn end, never the full timeline.
    for (const call of server.callsTo("session.messages")) expect(call.args).toHaveProperty("tail");
  });

  it("asks its own server for credential types instead of the CLI, matching renamed providers", async () => {
    const send = async (authTypes: Record<string, string>) => {
      const { driver, server, stop } = await setup({ authTypes }, "azure-cognitive-services/gpt-5", {});
      const sent = await Effect.runPromise(driver.sendTurn({ threadId: "thread-1", prompt: "x" }));
      const outcome = driver.awaitTurn("thread-1", sent.turnId);
      await server.pushRaw({
        type: "session.execution.failed",
        data: { sessionID: REAL_SESSION, error: { type: "x", message: "Model not found: azure-cognitive-services/gpt-5" } },
      });
      const settled = await outcome;
      await stop();
      await Effect.runPromise(driver.stopAll());
      return { settled, server };
    };
    const connected = await send({ azure: "api" });
    expect(connected.server.callsTo("integration.list")).toHaveLength(1);
    expect(connected.settled.error).not.toContain("No credential found");
    const missing = await send({});
    expect(missing.settled.error).toContain("No credential found");
  });
});
