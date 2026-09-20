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
      createDriver: () => new ClaudeDriver({ transport }),
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

    const deadline = Date.now() + 3000;
    for (;;) {
      const read = await readThread(store, thread.id);
      if (read.turns[read.turns.length - 1]?.status === "completed") break;
      if (Date.now() > deadline) throw new Error("direct turn did not complete");
      await sleep(20);
    }
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
});
