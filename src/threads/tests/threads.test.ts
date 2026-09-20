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
  delegateTask,
  failTurn,
  inspectThread,
  interruptTurn,
  listThreads,
  readThread,
  sendTurn,
  settleThread,
  snoozeThread,
  taskCancel,
  taskStatus,
  threadStatus,
  unsettleThread,
  unsnoozeThread,
} from "../threads.js";

const MODEL = { instanceId: "claude", model: "test-model" };

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

async function testStore(options: { clock?: () => number; bus?: ReturnType<typeof createEventBus<BackendEvent>> } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "t3code-threads-"));
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
    const root = await mkdtemp(path.join(os.tmpdir(), "t3code-threads-"));
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

describe("delegation", () => {
  it("delegates without waiting, then reports status and cancels", async () => {
    const store = await testStore();
    const parent = await createThread(store, { projectId: "p", title: "parent", modelSelection: MODEL });
    const { delegation, child } = await delegateTask(store, parent.id, {
      task: "do the thing",
      wait: false,
    });
    expect(delegation.status).toBe("running");
    expect(child.projectId).toBe("p");

    expect((await taskStatus(store, delegation.id)).delegation.status).toBe("running");
    const cancelled = await taskCancel(store, delegation.id);
    expect(cancelled.delegation.status).toBe("cancelled");
    expect(cancelled.interrupted).toBe(true);
    const again = await taskCancel(store, delegation.id);
    expect(again.delegation.status).toBe("cancelled");
    expect(again.interrupted).toBe(false);
  });

  it("waits for the child to finish and times out on a stuck child", async () => {
    const store = await testStore();
    const parent = await createThread(store, { projectId: "p", title: "parent", modelSelection: MODEL });
    const pending = await delegateTask(store, parent.id, { task: "slow", wait: false });
    const childTurns = (await readThread(store, pending.child.id)).turns;
    await completeTurn(store, pending.child.id, childTurns[0]!.id, { text: "done" });
    expect((await taskStatus(store, pending.delegation.id)).delegation.status).toBe("completed");

    const stuck = await delegateTask(store, parent.id, {
      task: "stuck",
      wait: true,
      timeoutMs: 50,
    });
    expect(stuck.delegation.status).toBe("waitTimedOut");
  });

  it("rejects empty tasks and unknown delegations", async () => {
    const store = await testStore();
    const parent = await createThread(store, { projectId: "p", title: "parent", modelSelection: MODEL });
    expect(await codeOf(() => delegateTask(store, parent.id, { task: "  " }))).toBe("PROMPT_REQUIRED");
    expect(await codeOf(() => taskStatus(store, "missing"))).toBe("DELEGATION_NOT_FOUND");
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
