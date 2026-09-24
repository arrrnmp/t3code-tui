import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OpenCodeDriver } from "../../providers/opencode/driver.js";
import { FakeOpencodeTransport } from "../../providers/opencode/tests/fakes.js";
import type { ProviderRuntimeEvent } from "../../providers/spi.js";
import { openThreadStore } from "../store.js";
import { createThread, readThread } from "../threads.js";
import { driverForInstance, ensureDriverSession, executeTurn, type TurnDriver } from "../execute.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

describe("driverForInstance", () => {
  it("routes known providers and shares opencode/* drivers", () => {
    const owner = {};
    const factories = { opencode: () => new OpenCodeDriver({ transport: new FakeOpencodeTransport() }) };
    const first = driverForInstance(owner, "opencode/anthropic", factories);
    expect(driverForInstance(owner, "opencode/openai", factories)).toBe(first);
    expect(driverForInstance(owner, "OPENCODE", factories)).toBe(first);
    expect(() => driverForInstance(owner, "cursor", factories)).toThrowError(
      expect.objectContaining({ code: "PROVIDER_UNKNOWN" }),
    );
    expect(driverForInstance({}, "opencode/x", factories)).not.toBe(first);
  });
});

describe("executeTurn", () => {
  it("converges completion, usage, checkpoints, and events into the ledger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moxen-execute-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Execute",
      modelSelection: { instanceId: "opencode/anthropic", model: "claude-opus-4-6" },
      env: { mode: "local", path: root, branch: null },
    });
    const { turn } = await (
      await import("../threads.js")
    ).sendTurn(store, thread.id, { prompt: "do it" });

    const transport = new FakeOpencodeTransport({
      messages: [
        {
          info: { id: "m", role: "assistant", tokens: { input: 4, output: 8, reasoning: 1, cache: { read: 0, write: 2 } } },
          parts: [],
        },
      ],
    });
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    await Effect.runPromise(driver.startSession({ threadId: thread.id, workingDirectory: root }));
    const seen: ProviderRuntimeEvent[] = [];
    const running = executeTurn({
      store,
      driver,
      threadId: thread.id,
      storeTurnId: turn.id,
      prompt: "do it",
      modelSelection: thread.modelSelection,
      workingDirectory: root,
      onEvent: (event) => seen.push(event),
    });
    const deadline = Date.now() + 3000;
    for (;;) {
      if ((transport.servers[0]?.callsTo("session.promptAsync").length ?? 0) > 0) break;
      if (Date.now() > deadline) throw new Error("promptAsync was never called");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await transport.servers[0]?.push({
      type: "message.part.updated",
      properties: { sessionID: "opencode-session-1", part: { id: "p-1", type: "text", text: "answer" } },
    });
    await transport.servers[0]?.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    await running;

    const read = await readThread(store, thread.id);
    expect(read.turns[0]?.status).toBe("completed");
    expect(read.turns[0]?.usage).toMatchObject({ input: 4, output: 8 });
    expect(read.messages.filter((message) => message.role === "assistant").map((message) => message.text)).toEqual([
      "answer",
    ]);
    const checkpoints = await store.readCheckpoints(thread.id);
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0]?.status).toBe("unavailable");
    expect(seen.map((event) => event.type)).toContain("message.part.updated");
  });

  it("records the turn's tool calls as replayable activity rows", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moxen-execute-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Tools",
      modelSelection: { instanceId: "opencode/anthropic", model: "claude-opus-4-6" },
      env: { mode: "local", path: root, branch: null },
    });
    const { turn } = await (await import("../threads.js")).sendTurn(store, thread.id, { prompt: "run it" });

    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    await Effect.runPromise(driver.startSession({ threadId: thread.id, workingDirectory: root }));
    const running = executeTurn({
      store,
      driver,
      threadId: thread.id,
      storeTurnId: turn.id,
      prompt: "run it",
      modelSelection: thread.modelSelection,
    });
    const deadline = Date.now() + 3000;
    for (;;) {
      if ((transport.servers[0]?.callsTo("session.promptAsync").length ?? 0) > 0) break;
      if (Date.now() > deadline) throw new Error("promptAsync was never called");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const toolPart = (status: string, output?: string) => ({
      type: "message.part.updated" as const,
      properties: {
        sessionID: "opencode-session-1",
        part: {
          id: "prt-1",
          callID: "call-1",
          type: "tool",
          tool: "bash",
          state: {
            status,
            input: { command: "git status" },
            ...(output === undefined ? {} : { output }),
            time: { start: 1000, ...(status === "completed" ? { end: 2000 } : {}) },
          },
        },
      },
    });
    await transport.servers[0]?.push(toolPart("running"));
    // A repeat of the same state must not add a row.
    await transport.servers[0]?.push(toolPart("running"));
    await transport.servers[0]?.push(toolPart("completed", "on branch main"));
    await transport.servers[0]?.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    await running;

    const read = await readThread(store, thread.id);
    const tools = read.activities.filter((activity) => activity.kind.startsWith("tool-call."));
    expect(tools.map((activity) => activity.kind)).toEqual(["tool-call.started", "tool-call.completed"]);
    expect(tools[0]?.summary).toBe("$ git status");
    // Both rows share the call id, so the transcript folds them into one card.
    expect(tools.map((activity) => (activity.payload as { toolCallId: string }).toolCallId)).toEqual([
      "call-1",
      "call-1",
    ]);
    expect((tools[1]?.payload as { status: string }).status).toBe("completed");
  });

  it("records failures without losing the prompt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moxen-execute-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Execute",
      modelSelection: { instanceId: "opencode/anthropic", model: "x" },
      env: { mode: "local", path: root, branch: null },
    });
    const { turn } = await (
      await import("../threads.js")
    ).sendTurn(store, thread.id, { prompt: "do it" });

    const transport = new FakeOpencodeTransport({ failMethods: { "session.promptAsync": "nope" } });
    const failing = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    await Effect.runPromise(failing.startSession({ threadId: thread.id, workingDirectory: root }));
    await executeTurn({
      store,
      driver: failing,
      threadId: thread.id,
      storeTurnId: turn.id,
      prompt: "do it",
    });
    const read = await readThread(store, thread.id);
    expect(read.turns[0]?.status).toBe("failed");
  });
});

/**
 * A thread's provider-side history has to outlive the process that started
 * it. The native session handle only ever lived in the driver's memory, so
 * closing the TUI (or a CLI `send` from a fresh process) silently began an
 * empty provider conversation under the old transcript.
 */
describe("provider session resume", () => {
  async function ranThread() {
    const root = await mkdtemp(path.join(os.tmpdir(), "moxen-resume-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Resume",
      modelSelection: { instanceId: "opencode/anthropic", model: "claude-opus-4-6" },
      env: { mode: "local", path: root, branch: null },
    });
    const { turn } = await (await import("../threads.js")).sendTurn(store, thread.id, { prompt: "remember 7" });
    const transport = new FakeOpencodeTransport();
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    await ensureDriverSession(driver, thread);
    const running = executeTurn({
      store,
      driver,
      threadId: thread.id,
      storeTurnId: turn.id,
      prompt: "remember 7",
      workingDirectory: root,
    });
    const deadline = Date.now() + 3000;
    while ((transport.servers[0]?.callsTo("session.promptAsync").length ?? 0) === 0) {
      if (Date.now() > deadline) throw new Error("promptAsync was never called");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await transport.servers[0]?.push({ type: "session.idle", properties: { sessionID: "opencode-session-1" } });
    await running;
    return { store, threadId: thread.id };
  }

  it("records the native session on the thread, keyed by driver", async () => {
    const { store, threadId } = await ranThread();
    const record = await store.readThreadRecord(threadId);
    expect(record?.providerSessions).toEqual({ opencode: "opencode-session-1" });
  });

  it("resumes that session from a fresh driver instead of starting an empty one", async () => {
    const { store, threadId } = await ranThread();
    // A new driver is what a new process gets: nothing in memory.
    const transport = new FakeOpencodeTransport({ sessionID: "opencode-session-2" });
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    const record = await store.readThreadRecord(threadId);
    await ensureDriverSession(driver, record!);
    const server = transport.servers[0]!;
    expect(server.callsTo("session.get").map((call) => call.args)).toEqual([{ sessionID: "opencode-session-1" }]);
    expect(server.callsTo("session.create")).toEqual([]);
    expect(driver.resumeCursor(threadId)).toBe("opencode-session-1");
  });

  it("starts fresh when the provider no longer has the session", async () => {
    const { store, threadId } = await ranThread();
    const transport = new FakeOpencodeTransport({
      sessionID: "opencode-session-2",
      lostSessions: ["opencode-session-1"],
    });
    const driver = new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } });
    await ensureDriverSession(driver, (await store.readThreadRecord(threadId))!);
    expect(transport.servers[0]!.callsTo("session.create")).toHaveLength(1);
    expect(driver.resumeCursor(threadId)).toBe("opencode-session-2");
  });
});

describe("context usage", () => {
  it("records the driver's context reading before the turn's outcome", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moxen-context-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Context",
      modelSelection: { instanceId: "claude", model: "m" },
      env: { mode: "local", path: root, branch: null },
    });
    const { turn } = await (await import("../threads.js")).sendTurn(store, thread.id, { prompt: "go" });
    const reading = { usedTokens: 12_000, maxTokens: 200_000, cachedInputTokens: 11_000, autoCompactThreshold: null, compactsAutomatically: true };
    const driver: TurnDriver = {
      hasSession: () => Effect.succeed(true),
      startSession: () => Effect.succeed({}),
      sendTurn: (input) => Effect.succeed({ threadId: input.threadId, turnId: "d-1" }),
      interruptTurn: () => Effect.void,
      awaitTurn: async () => ({ status: "completed", text: "done", usage: null, error: null }),
      streamEvents: Stream.never,
      contextUsage: async () => reading,
    };
    await executeTurn({ store, driver, threadId: thread.id, storeTurnId: turn.id, prompt: "go" });

    const kinds = (await store.readActivities(thread.id)).map((row) => row.kind);
    const context = kinds.indexOf("context-window.updated");
    expect(context).toBeGreaterThan(-1);
    expect(context).toBeLessThan(kinds.indexOf("turn.completed"));
    const row = (await store.readActivities(thread.id))[context]!;
    expect(row.payload).toEqual(reading);
    expect(row.summary).toBe("12000 / 200000 tokens in context");
  });

  it("does not hold the turn hostage to a slow or failing reading", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moxen-context-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Context",
      modelSelection: { instanceId: "claude", model: "m" },
      env: { mode: "local", path: root, branch: null },
    });
    const { turn } = await (await import("../threads.js")).sendTurn(store, thread.id, { prompt: "go" });
    const driver: TurnDriver = {
      hasSession: () => Effect.succeed(true),
      startSession: () => Effect.succeed({}),
      sendTurn: (input) => Effect.succeed({ threadId: input.threadId, turnId: "d-1" }),
      interruptTurn: () => Effect.void,
      awaitTurn: async () => ({ status: "completed", text: "done", usage: null, error: null }),
      streamEvents: Stream.never,
      contextUsage: async () => {
        throw new Error("control request timed out");
      },
    };
    await executeTurn({ store, driver, threadId: thread.id, storeTurnId: turn.id, prompt: "go" });
    expect((await store.readTurns(thread.id))[0]?.status).toBe("completed");
    expect((await store.readActivities(thread.id)).some((row) => row.kind === "context-window.updated")).toBe(false);
  });
});
