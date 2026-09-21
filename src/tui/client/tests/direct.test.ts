import { realpath } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { testHarness } from "../../../cli/testing/harness.js";
import { ensureStoredProject } from "../../../projects/projects.js";
import { OpenCodeDriver } from "../../../providers/opencode/driver.js";
import { FakeOpencodeTransport } from "../../../providers/opencode/tests/fakes.js";
import { createThread, readThread } from "../../../threads/threads.js";
import { DirectConnection } from "../direct.js";

function storeRoot(): string {
  return process.env.T3CODE_STORE_ROOT!;
}

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("DirectConnection dispatch", () => {
  it("creates threads and runs turns to completion", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      const created = (await connection.dispatch({
        type: "thread.create",
        commandId: "c-1",
        threadId: "thread-1",
        projectId: ensured.project.id,
        title: "Hello",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: null,
        createdAt: new Date().toISOString(),
      })) as { threadId: string };
      expect(created.threadId).toBe("thread-1");

      const sent = (await connection.dispatch({
        type: "thread.turn.start",
        commandId: "c-2",
        threadId: "thread-1",
        message: { messageId: "m-1", role: "user", text: "hi", attachments: [] },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      })) as { messageId: string; accepted: boolean };
      expect(sent.accepted).toBe(true);

      await waitFor("turn completion", async () => {
        const read = await readThread(harness.store, "thread-1");
        return read.turns[0]?.status === "completed";
      });
      const read = await readThread(harness.store, "thread-1");
      expect(read.messages.map((message) => message.text)).toContain("Completed: hi");
    } finally {
      await connection.close();
    }
  });

  it("rejects unknown threads and command types", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      await expect(
        connection.dispatch({
          type: "thread.turn.start",
          threadId: "missing",
          message: { messageId: "m", role: "user", text: "hi", attachments: [] },
        }),
      ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
      await expect(connection.dispatch({ type: "thread.frobnicate" })).rejects.toMatchObject({
        code: "UNKNOWN_COMMAND",
      });
      await expect(connection.dispatch(null)).rejects.toMatchObject({ code: "UNKNOWN_COMMAND" });
    } finally {
      await connection.close();
    }
  });

  it("applies lifecycle and meta dispatches", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({ storeRoot: harness.root, drivers: harness.drivers });
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await createThread(harness.store, {
        id: "thread-1",
        projectId: ensured.project.id,
        title: "T",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      });

      await connection.dispatch({ type: "thread.meta.update", threadId: "thread-1", title: "Renamed" });
      await connection.dispatch({
        type: "thread.model-selection.set",
        threadId: "thread-1",
        modelSelection: { instanceId: "grok", model: "grok-build" },
      });
      await connection.dispatch({ type: "thread.runtime-mode.set", threadId: "thread-1", runtimeMode: "auto" });
      await connection.dispatch({ type: "thread.snooze", threadId: "thread-1", snoozedUntil: "2030-01-01T00:00:00.000Z" });
      await connection.dispatch({ type: "thread.settle", threadId: "thread-1" });
      await connection.dispatch({ type: "thread.unsettle", threadId: "thread-1" });
      await connection.dispatch({ type: "thread.unsnooze", threadId: "thread-1" });
      const read = await readThread(harness.store, "thread-1");
      expect(read.thread.title).toBe("Renamed");
      expect(read.thread.modelSelection).toMatchObject({ instanceId: "grok" });
      expect(read.thread.runtimeMode).toBe("auto");
      expect(read.thread.settledAt).toBeNull();
      expect(read.thread.snoozedUntil).toBeNull();

      await connection.dispatch({ type: "thread.archive", threadId: "thread-1" });
      await connection.dispatch({ type: "thread.delete", threadId: "thread-1" });
      const gone = await harness.store.readThreadRecord("thread-1");
      expect(gone?.archivedAt).not.toBeNull();
      expect(gone?.deletedAt).not.toBeNull();

      const project = (await connection.dispatch({
        type: "project.create",
        projectId: "project-2",
        title: "Two",
        workspaceRoot: "/elsewhere",
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: null,
        createdAt: new Date().toISOString(),
      })) as { projectId: string; created: boolean };
      expect(project.created).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it("serves getConfig and null turn diffs", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({
      storeRoot: harness.root,
      drivers: harness.drivers,
      catalog: async () => ({ providers: [], settings: {} }),
    });
    try {
      expect(await connection.getConfig()).toEqual({ providers: [], settings: {} });
      expect(await connection.turnDiff("missing", 1)).toBeNull();
    } finally {
      await connection.close();
    }
  });
});

describe("DirectConnection subscriptions", () => {
  it("publishes shell snapshots and picks up new threads", async () => {
    const harness = await testHarness();
    const connection = new DirectConnection({
      storeRoot: harness.root,
      drivers: harness.drivers,
      shellPollMs: 30,
      threadPollMs: 30,
    });
    const frames: unknown[] = [];
    const unsubscribe = connection.subscribeShell(
      {},
      (item) => frames.push(item),
      () => undefined,
    );
    try {
      await waitFor("shell sync", async () =>
        frames.some((frame) => (frame as { kind?: string }).kind === "synchronized"),
      );
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await createThread(harness.store, {
        id: "thread-shell",
        projectId: ensured.project.id,
        title: "Shell",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      });
      await waitFor("thread row", async () =>
        frames.some((frame) => JSON.stringify(frame).includes("thread-shell")),
      );
    } finally {
      unsubscribe();
      await connection.close();
    }
  });

  it("streams provider text deltas into thread frames", async () => {
    const harness = await testHarness();
    const transport = new FakeOpencodeTransport();
    const connection = new DirectConnection({
      storeRoot: harness.root,
      drivers: { opencode: () => new OpenCodeDriver({ transport, env: { ANTHROPIC_API_KEY: "test-key" } }) },
      shellPollMs: 30,
      threadPollMs: 30,
    });
    const frames: unknown[] = [];
    try {
      const workspaceRoot = await realpath(harness.work);
      const ensured = await ensureStoredProject(storeRoot(), { workspaceRoot });
      await createThread(harness.store, {
        id: "thread-stream",
        projectId: ensured.project.id,
        title: "Stream",
        modelSelection: { instanceId: "opencode/anthropic", model: "claude-opus-4-6" },
      });
      const unsubscribe = connection.subscribeThread(
        "thread-stream",
        {},
        (item) => frames.push(item),
        () => undefined,
      );
      try {
        await connection.dispatch({
          type: "thread.turn.start",
          threadId: "thread-stream",
          message: { messageId: "m-1", role: "user", text: "hi", attachments: [] },
        });
        await waitFor("prompt on the wire", async () => transport.servers[0]?.callsTo("session.promptAsync").length === 1);
        // The subscription bridge attaches on the thread poll interval;
        // pushed events have no replay, so let it attach first. (In
        // production the snapshot polls converge anything missed here.)
        await new Promise((resolve) => setTimeout(resolve, 250));
        await transport.servers[0]?.push({
          type: "message.part.updated",
          properties: {
            sessionID: "opencode-session-1",
            part: { id: "p-1", type: "text", text: "hel" },
          },
        });
        await waitFor("stream frame", async () =>
          frames.some((frame) => JSON.stringify(frame).includes("thread.message-sent")),
        );
        const frame = frames.find((entry) => JSON.stringify(entry).includes("thread.message-sent"));
        expect(JSON.stringify(frame)).toContain("hel");
      } finally {
        unsubscribe();
      }
    } finally {
      await connection.close();
    }
  });
});
