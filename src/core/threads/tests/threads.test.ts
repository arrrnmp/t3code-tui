import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../../errors.js";
import { createEventBus, type BackendEvent } from "../../events/bus.js";
import { openThreadStore, ThreadStore } from "../store.js";
import {
  completeTurn,
  createThread,
  failTurn,
  inspectThread,
  interruptTurn,
  listThreads,
  readThread,
  sendTurn,
  settleThread,
  snoozeThread,
  threadStatus,
  unsettleThread,
  unsnoozeThread,
  updateThreadMeta,
} from "../threads.js";
import { toThreadEnvelope } from "../project.js";

const MODEL = { instanceId: "claude", model: "test-model" };

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

async function testStore(options: { clock?: () => number; bus?: ReturnType<typeof createEventBus<BackendEvent>> } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "moxen-threads-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return await openThreadStore(root, options);
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

describe("thread store", () => {
  it("creates, lists, and inspects threads", async () => {
    const store = await testStore();
    const thread = await createThread(store, {
      projectId: "project-1",
      title: "Hello",
      modelSelection: MODEL,
    });
    expect(thread.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(thread.runtimeMode).toBe("full-access");
    expect(threadStatus(thread)).toBe("active");

    expect((await listThreads(store)).map((row) => row.id)).toEqual([thread.id]);
    expect(await listThreads(store, { projectId: "other" })).toEqual([]);
    expect(await inspectThread(store, thread.id)).toMatchObject({ id: thread.id });
    await expect(inspectThread(store, "missing")).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
  });

  it("persists across reopen", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moxen-threads-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const first = await openThreadStore(root);
    const thread = await createThread(first, {
      projectId: "project-1",
      title: "Persist me",
      modelSelection: MODEL,
    });
    const sent = await sendTurn(first, thread.id, { prompt: "hi" });

    const second = await openThreadStore(root);
    expect(await inspectThread(second, thread.id)).toMatchObject({ title: "Persist me" });
    const read = await readThread(second, thread.id);
    expect(read.turns.map((turn) => turn.id)).toEqual([sent.turn.id]);
    expect(read.messages.map((message) => message.text)).toEqual(["hi"]);
  });

  it("rejects empty ids, projects, titles, and prompts", async () => {
    const store = await testStore();
    expect(await codeOf(() => createThread(store, { projectId: " ", title: "t", modelSelection: MODEL }))).toBe(
      "PROJECT_ID_REQUIRED",
    );
    expect(await codeOf(() => createThread(store, { projectId: "p", title: " ", modelSelection: MODEL }))).toBe(
      "INVALID_THREAD_OPTION",
    );
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    expect(await codeOf(() => sendTurn(store, thread.id, { prompt: "  " }))).toBe("PROMPT_REQUIRED");
    expect(await codeOf(() => sendTurn(store, "  ", { prompt: "hi" }))).toBe("THREAD_ID_REQUIRED");
  });
});

describe("send busy policies", () => {
  it("rejects a second turn by default and injects with inject", async () => {
    const store = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    const first = await sendTurn(store, thread.id, { prompt: "one" });
    expect(first.delivery).toBe("started");

    expect(await codeOf(() => sendTurn(store, thread.id, { prompt: "two" }))).toBe("THREAD_BUSY");

    const injected = await sendTurn(store, thread.id, { prompt: "two", ifBusy: "inject" });
    expect(injected.delivery).toBe("injected");
    expect(injected.turn.id).toBe(first.turn.id);
    const read = await readThread(store, thread.id);
    expect(read.turns).toHaveLength(1);
    expect(read.messages.map((message) => message.text)).toEqual(["one", "two"]);
  });

  it("serializes concurrent sends so exactly one wins", async () => {
    const store = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    const outcomes = await Promise.allSettled([
      sendTurn(store, thread.id, { prompt: "a" }),
      sendTurn(store, thread.id, { prompt: "b" }),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(((rejected[0] as PromiseRejectedResult).reason as CliError).code).toBe("THREAD_BUSY");
  });

  it("steers and restarts only busy threads", async () => {
    const store = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    expect(await codeOf(() => sendTurn(store, thread.id, { prompt: "x", delivery: "steer" }))).toBe(
      "THREAD_NOT_STEERABLE",
    );
    expect(await codeOf(() => sendTurn(store, thread.id, { prompt: "x", delivery: "restart" }))).toBe(
      "THREAD_NOT_STEERABLE",
    );

    const first = await sendTurn(store, thread.id, { prompt: "one" });
    const steered = await sendTurn(store, thread.id, { prompt: "steer me", delivery: "steer" });
    expect(steered.delivery).toBe("steered");
    expect(steered.turn.id).toBe(first.turn.id);

    const restarted = await sendTurn(store, thread.id, { prompt: "fresh", delivery: "restart" });
    expect(restarted.delivery).toBe("restarted");
    expect(restarted.turn.parentTurnId).toBe(first.turn.id);
    const read = await readThread(store, thread.id);
    expect(read.turns.map((turn) => `${turn.delivery}:${turn.status}`)).toEqual([
      "started:interrupted",
      "restarted:running",
    ]);
  });

  it("queues while busy and promotes on completion", async () => {
    const store = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    const first = await sendTurn(store, thread.id, { prompt: "one" });
    const queued = await sendTurn(store, thread.id, { prompt: "two", delivery: "queue" });
    expect(queued.delivery).toBe("queued");
    expect(queued.turn.status).toBe("queued");

    await completeTurn(store, thread.id, first.turn.id, { text: "answer one" });
    const read = await readThread(store, thread.id);
    expect(read.turns.map((turn) => turn.status)).toEqual(["completed", "running"]);
    expect(read.messages.filter((message) => message.role === "assistant").map((message) => message.text)).toEqual([
      "answer one",
    ]);

    // The promoted turn still holds the session; completing it idles the thread.
    await completeTurn(store, thread.id, queued.turn.id);
    const idle = await sendTurn(store, thread.id, { prompt: "three", delivery: "queue" });
    expect(idle.delivery).toBe("started");
  });

  it("fails turns and guards double completion", async () => {
    const store = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    const sent = await sendTurn(store, thread.id, { prompt: "one" });
    const failed = await failTurn(store, thread.id, sent.turn.id, { error: "boom" });
    expect(failed.turn.status).toBe("failed");
    expect(failed.turn.error).toBe("boom");
    expect(await codeOf(() => completeTurn(store, thread.id, sent.turn.id))).toBe("TURN_NOT_RUNNING");
  });
});

describe("settlement and snooze", () => {
  it("settles, blocks sends until woken, and unsettles", async () => {
    const store = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    const settled = await settleThread(store, thread.id);
    expect(threadStatus(settled)).toBe("settled");
    expect(await listThreads(store, { status: "settled" })).toHaveLength(1);
    expect(await listThreads(store, { status: "active" })).toHaveLength(0);

    expect(await codeOf(() => sendTurn(store, thread.id, { prompt: "hi" }))).toBe(
      "SETTLED_THREAD_CONFIRMATION_REQUIRED",
    );
    const woken = await sendTurn(store, thread.id, { prompt: "hi", wakeSettled: true });
    expect(woken.delivery).toBe("started");
    expect(threadStatus(woken.thread)).toBe("active");
  });

  it("blocks settle while a turn runs or approvals pend", async () => {
    const store = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    const sent = await sendTurn(store, thread.id, { prompt: "one" });
    expect(await codeOf(() => settleThread(store, thread.id))).toBe("THREAD_SETTLE_BLOCKED");
    await completeTurn(store, thread.id, sent.turn.id);
    await settleThread(store, thread.id);
    const unsettled = await unsettleThread(store, thread.id);
    expect(threadStatus(unsettled)).toBe("active");
  });

  it("settles and unsettles a whole family from any member, all or nothing", async () => {
    const store = await testStore();
    const make = async (title: string, parentThreadId?: string) => {
      const created = await createThread(store, { projectId: "p", title, modelSelection: MODEL });
      if (parentThreadId) {
        const at = created.createdAt;
        await store.appendDelegation({ id: `d-${title}`, parentThreadId, childThreadId: created.id, prompt: title, status: "running", createdAt: at, updatedAt: at });
      }
      return created;
    };
    const root = await make("root");
    const child = await make("child", root.id);
    const grandchild = await make("grandchild", child.id);
    const other = await make("other");
    const statuses = async () =>
      (await Promise.all([root, child, grandchild, other].map((t) => inspectThread(store, t.id)))).map((t) => threadStatus(t));

    // A running grandchild blocks settling from the root, the child or itself — and nothing is written.
    const sent = await sendTurn(store, grandchild.id, { prompt: "work" });
    for (const start of [root, child, grandchild]) {
      const error = await settleThread(store, start.id).catch((caught: unknown) => caught as CliError);
      expect((error as CliError).code).toBe("THREAD_SETTLE_BLOCKED");
      expect((error as CliError).details).toMatchObject({ threadId: start.id, blockedThreadIds: [grandchild.id] });
    }
    expect(await statuses()).not.toContain("settled");

    await completeTurn(store, grandchild.id, sent.turn.id);
    expect((await settleThread(store, child.id)).id).toBe(child.id);
    expect(await statuses()).toEqual(["settled", "settled", "settled", "active"]);
    await unsettleThread(store, grandchild.id);
    expect(await statuses()).toEqual(["active", "active", "active", "active"]);
  });

  it("snoozes into the future and treats expiry as active", async () => {
    let now = Date.parse("2026-09-20T12:00:00.000Z");
    const bus = createEventBus<BackendEvent>();
    const store = await testStore({ clock: () => now, bus });
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    await snoozeThread(store, thread.id, "2026-09-20T13:00:00.000Z");
    expect(threadStatus(await inspectThread(store, thread.id), now)).toBe("snoozed");
    expect(await listThreads(store, { status: "snoozed" })).toHaveLength(1);
    expect(await listThreads(store)).toHaveLength(0);

    now = Date.parse("2026-09-20T14:00:00.000Z");
    expect(threadStatus(await inspectThread(store, thread.id), now)).toBe("active");
    expect(await listThreads(store)).toHaveLength(1);

    await unsnoozeThread(store, thread.id);
    expect((await inspectThread(store, thread.id)).snoozedUntil).toBeNull();
    expect(await codeOf(() => snoozeThread(store, thread.id, "not-a-date"))).toBe("SNOOZE_UNTIL_INVALID");
  });
});

describe("interrupt", () => {
  it("reports idle threads and aborts tracked runners", async () => {
    const store = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    const idle = await interruptTurn(store, thread.id);
    expect(idle.interrupted).toBe(false);

    const sent = await sendTurn(store, thread.id, { prompt: "one" });
    let aborted = false;
    store.trackRunning(sent.turn.id, () => {
      aborted = true;
    });
    const result = await interruptTurn(store, thread.id);
    expect(result.interrupted).toBe(true);
    expect(result.turn?.status).toBe("interrupted");
    expect(aborted).toBe(true);
  });
});

describe("events", () => {
  it("publishes lifecycle reasons", async () => {
    const bus = createEventBus<BackendEvent>();
    const seen: string[] = [];
    bus.subscribe((event) => {
      if (event.type === "backend.thread.changed") seen.push(`${event.threadId}:${event.reason}`);
    });
    const store = await testStore({ bus });
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    const sent = await sendTurn(store, thread.id, { prompt: "hi" });
    await completeTurn(store, thread.id, sent.turn.id);
    await settleThread(store, thread.id);
    expect(seen).toEqual([
      `${thread.id}:created`,
      `${thread.id}:turn-started`,
      `${thread.id}:turn-completed`,
      `${thread.id}:settled`,
    ]);
  });
});

describe("archived threads", () => {
  it("refuses sends, snooze, and interrupt once archived", async () => {
    const store: ThreadStore = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    await store.writeThreadRecord({ ...thread, archivedAt: store.nowIso() });
    expect(await listThreads(store, { status: "all" })).toEqual([]);
    expect(await codeOf(() => sendTurn(store, thread.id, { prompt: "hi" }))).toBe("THREAD_ARCHIVED");
    expect(await codeOf(() => snoozeThread(store, thread.id, "2026-09-21T00:00:00.000Z"))).toBe(
      "THREAD_ARCHIVED",
    );
    expect(await codeOf(() => interruptTurn(store, thread.id))).toBe("THREAD_ARCHIVED");
  });
});

/**
 * A turn used to store `modelSelection: null` unless the send overrode the
 * model, which reads back as "whatever the thread says now" — so switching
 * models mid-conversation relabelled every earlier turn with the new one.
 */
describe("per-turn model", () => {
  it("records the model each turn ran on, surviving a later switch", async () => {
    const store = await testStore();
    const thread = await createThread(store, { projectId: "p", title: "t", modelSelection: MODEL });
    const first = await sendTurn(store, thread.id, { prompt: "one" });
    await completeTurn(store, thread.id, first.turn.id, { text: "done" });

    const next = { instanceId: "claude", model: "next-model" };
    await updateThreadMeta(store, thread.id, { modelSelection: next });
    const second = await sendTurn(store, thread.id, { prompt: "two" });
    const override = { instanceId: "codex", model: "gpt-override" };
    await completeTurn(store, thread.id, second.turn.id, { text: "done" });
    const third = await sendTurn(store, thread.id, { prompt: "three", modelSelection: override });

    expect(first.turn.modelSelection).toEqual(MODEL);
    expect(second.turn.modelSelection).toEqual(next);
    expect(third.turn.modelSelection).toEqual(override);

    const turns = await store.readTurns(thread.id);
    const envelope = toThreadEnvelope((await store.readThreadRecord(thread.id))!, turns);
    expect(envelope.modelSelection).toEqual(next);
    expect(envelope.turnModelSelections).toEqual({
      [first.turn.id]: MODEL,
      [second.turn.id]: next,
      [third.turn.id]: override,
    });
  });
});
