import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../errors.js";
import { ClaudeDriver } from "../../providers/claude/driver.js";
import {
  assistantText,
  FakeTransport,
  initMessage,
  successResult,
} from "../../providers/claude/tests/fakes.js";
import { CodexDriver } from "../../providers/codex/driver.js";
import { FakeCodexTransport } from "../../providers/codex/tests/fakes.js";
import { GrokDriver } from "../../providers/grok/driver.js";
import { FakeGrokTransport } from "../../providers/grok/tests/fakes.js";
import { openThreadStore } from "../../threads/store.js";
import { createThread, readThread } from "../../threads/threads.js";
import { createBackend, isBackendKind, resolveBackendKind } from "../backend.js";
import { DirectBackend, resolveStoreRoot } from "../direct.js";
const MODEL = { instanceId: "claude", model: "test-model" };

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForTurn(
  store: Awaited<ReturnType<typeof openThreadStore>>,
  threadId: string,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const read = await readThread(store, threadId);
    const last = read.turns[read.turns.length - 1];
    if (last && last.status !== "running" && last.status !== "queued") return;
    if (Date.now() > deadline) throw new Error("direct turn did not settle");
    await sleep(20);
  }
}

async function waitForRequest(
  server: { requestsTo(method: string): unknown[] },
  method: string,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (server.requestsTo(method).length > 0) return;
    if (Date.now() > deadline) throw new Error(`no ${method} observed`);
    await sleep(20);
  }
}

async function withEnv<T>(name: string, value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe("backend selection", () => {
  it("defaults to t3 and accepts direct", async () => {
    await withEnv("T3CODE_BACKEND", undefined, async () => {
      expect(resolveBackendKind()).toBe("t3");
    });
    expect(resolveBackendKind("direct")).toBe("direct");
    expect(resolveBackendKind(" T3 ")).toBe("t3");
    expect(isBackendKind("direct")).toBe(true);
    expect(isBackendKind("cursor")).toBe(false);
  });

  it("rejects unknown backends", () => {
    try {
      resolveBackendKind("cursor");
      throw new Error("expected INVALID_BACKEND");
    } catch (cause) {
      expect(cause).toBeInstanceOf(CliError);
      expect((cause as CliError).code).toBe("INVALID_BACKEND");
    }
  });

  it("resolves the store root from env or ~/.t3code", async () => {
    await withEnv("T3CODE_STORE_ROOT", "/tmp/custom-store", async () => {
      expect(resolveStoreRoot()).toBe(path.resolve("/tmp/custom-store"));
    });
    await withEnv("T3CODE_STORE_ROOT", undefined, async () => {
      expect(resolveStoreRoot().endsWith(path.join(".t3code", "threads"))).toBe(true);
    });
  });

  it("creates the direct backend from the factory", () => {
    expect(createBackend("direct", null as never, null as never)).toBeInstanceOf(DirectBackend);
  });
});

describe("DirectBackend", () => {
  async function seeded() {
    const root = await mkdtemp(path.join(os.tmpdir(), "t3code-direct-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Direct thread",
      modelSelection: MODEL,
      env: { mode: "local", path: root, branch: null },
    });
    const transport = new FakeTransport([
      [initMessage(), assistantText("answer", { input_tokens: 8, output_tokens: 4 }), successResult("answer", 0.01)],
    ]);
    const backend = new DirectBackend({
      storeRoot: root,
      drivers: { claude: () => new ClaudeDriver({ transport }) },
    });
    return { root, store, thread, backend, transport };
  }

  it("lists and inspects store threads", async () => {
    const { thread, backend } = await seeded();
    const catalog = await backend.catalog();
    expect(catalog.projects).toEqual([]);
    expect(catalog.threads.map((row) => row.id)).toEqual([thread.id]);
    expect(catalog.threads[0]!.session).toMatchObject({ providerName: "claude", status: "idle" });

    const inspected = await backend.inspectThread(thread.id);
    expect(inspected.thread.id).toBe(thread.id);
    await expect(backend.inspectThread("missing")).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
  });

  it("sends a turn and completes it in the background", async () => {
    const { store, thread, backend } = await seeded();
    const sent = await backend.send(thread.id, { prompt: "do it" });
    expect(sent.threadId).toBe(thread.id);
    expect(sent.delivery).toBe("started");
    expect(sent.turnId).toMatch(/^[0-9a-f-]{36}$/);

    await waitForTurn(store, thread.id);
    const read = await readThread(store, thread.id);
    expect(
      read.messages.filter((message) => message.role === "assistant").map((message) => message.text),
    ).toEqual(["answer"]);

    const inspected = await backend.inspectThread(thread.id);
    expect(inspected.thread.latestTurn).toMatchObject({ state: "completed" });
  });

  it("rejects sends to missing threads", async () => {
    const { backend } = await seeded();
    await expect(backend.send("missing", { prompt: "hi" })).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
    });
  });

  it("routes codex threads to the codex driver", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "t3code-direct-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Codex thread",
      modelSelection: { instanceId: "codex", model: "gpt-test" },
      env: { mode: "local", path: root, branch: null },
    });
    const transport = new FakeCodexTransport();
    const backend = new DirectBackend({
      storeRoot: root,
      drivers: { codex: () => new CodexDriver({ transport }) },
    });
    const sent = await backend.send(thread.id, { prompt: "do it" });
    expect(sent.delivery).toBe("started");
    const server = transport.sessions[0]!.server;
    // The driver's transcript turn exists once turn/start is on the wire.
    await waitForRequest(server, "turn/start");
    server.notify("turn/started", { threadId: "codex-thread-1", turn: { id: "srv-1" } });
    server.notify("item/agentMessage/delta", { text: "answer" });
    server.notify("turn/completed", {
      threadId: "codex-thread-1",
      turn: { id: "srv-1", status: "completed" },
    });
    await waitForTurn(store, thread.id);
    const read = await readThread(store, thread.id);
    expect(
      read.messages.filter((message) => message.role === "assistant").map((message) => message.text),
    ).toEqual(["answer"]);
    const inspected = await backend.inspectThread(thread.id);
    expect(inspected.thread.session).toMatchObject({ providerName: "codex" });
  });

  it("routes grok threads to the grok driver", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "t3code-direct-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Grok thread",
      modelSelection: { instanceId: "grok", model: "grok-build" },
      env: { mode: "local", path: root, branch: null },
    });
    const transport = new FakeGrokTransport({
      prompt: async (params) => {
        const sessionId = (params as { sessionId?: string }).sessionId ?? "acp-session-1";
        transport.sessions[0]!.server.update(sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "answer" },
        });
        return { stopReason: "end_turn" };
      },
    });
    const backend = new DirectBackend({
      storeRoot: root,
      drivers: {
        grok: () => new GrokDriver({ transport, billingProbe: async () => null }),
      },
    });
    const sent = await backend.send(thread.id, { prompt: "do it" });
    expect(sent.delivery).toBe("started");
    await waitForTurn(store, thread.id);
    const read = await readThread(store, thread.id);
    expect(
      read.messages.filter((message) => message.role === "assistant").map((message) => message.text),
    ).toEqual(["answer"]);
  });

  it("rejects unknown providers without recording a turn", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "t3code-direct-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = await openThreadStore(root);
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Cursor thread",
      modelSelection: { instanceId: "cursor", model: "x" },
      env: { mode: "local", path: root, branch: null },
    });
    const backend = new DirectBackend({ storeRoot: root });
    await expect(backend.send(thread.id, { prompt: "hi" })).rejects.toMatchObject({
      code: "PROVIDER_UNKNOWN",
    });
    expect((await readThread(store, thread.id)).turns).toEqual([]);
  });
});
