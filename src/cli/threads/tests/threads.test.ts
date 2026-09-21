import { realpath } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ensureStoredProject } from "../../../projects/projects.js";
import {
  archiveThread,
  createThread,
  readThread as readStoredThread,
  sendTurn,
  settleThread as settleStoredThread,
} from "../../../threads/threads.js";
import { testHarness, type TestHarness } from "../../testing/harness.js";
import {
  cancelTask,
  delegateTask,
  inspectThread,
  interruptThread,
  listThreads,
  readThread,
  sendThreadMessage,
  settleThread,
  snoozeThread,
  taskStatus,
  unsettleThread,
  unsnoozeThread,
} from "../threads.js";

function storeRoot(): string {
  return process.env.T3CODE_STORE_ROOT!;
}

async function seedProject(harness: TestHarness, overrides: Record<string, unknown> = {}) {
  const workspaceRoot = await realpath(harness.work);
  return await ensureStoredProject(storeRoot(), {
    id: "project-existing",
    title: "Existing project",
    workspaceRoot,
    defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    ...(overrides as object),
  });
}

async function seedThread(harness: TestHarness, overrides: Record<string, unknown> = {}) {
  return await createThread(harness.store, {
    id: "thread-existing",
    projectId: "project-existing",
    title: "Existing thread",
    modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    ...(overrides as object),
  });
}

async function seededHarness() {
  const harness = await testHarness();
  await seedProject(harness);
  await seedThread(harness);
  return harness;
}

async function waitForTurnStatus(
  harness: TestHarness,
  threadId: string,
  statuses: string[],
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const read = await readStoredThread(harness.store, threadId);
    const last = read.turns[read.turns.length - 1];
    if (last && statuses.includes(last.status)) return;
    if (Date.now() > deadline) throw new Error(`turn on ${threadId} did not reach ${statuses.join("/")}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("sendThreadMessage", () => {
  it("sends a follow-up as a single turn start on the existing thread", async () => {
    const harness = await seededHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Run the 5am skill.",
      openMode: "none",
      drivers: harness.drivers,
    });

    expect(result.command).toMatchObject({
      type: "thread.turn.start",
      threadId: "thread-existing",
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    expect(result.message).toMatchObject({ textLength: "Run the 5am skill.".length });
    expect(result.command).not.toHaveProperty("modelSelection");
    expect(result.command).not.toHaveProperty("bootstrap");
    expect(result.thread.id).toBe("thread-existing");
    expect(result.project?.id).toBe("project-existing");
    expect(result.opened.kind).toBe("none");
    expect(result.verification).toMatchObject({ accepted: true, method: "message-id" });
    expect(result.message.textLength).toBe("Run the 5am skill.".length);
  });

  it("rejects unknown thread ids without writing", async () => {
    const harness = await seededHarness();

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-missing",
        prompt: "Hello",
        openMode: "none",
        drivers: harness.drivers,
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND", details: { threadId: "thread-missing" } });
  });

  it("rejects archived threads", async () => {
    const harness = await seededHarness();
    await archiveThread(harness.store, "thread-existing");

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        openMode: "none",
        drivers: harness.drivers,
      }),
    ).rejects.toMatchObject({ code: "THREAD_ARCHIVED" });
  });

  it("rejects empty prompts and thread ids", async () => {
    const harness = await seededHarness();

    await expect(
      sendThreadMessage(harness.config, { threadId: "thread-existing", prompt: "  ", openMode: "none" }),
    ).rejects.toMatchObject({ code: "PROMPT_REQUIRED" });
    await expect(
      sendThreadMessage(harness.config, { threadId: "  ", prompt: "Hello", openMode: "none" }),
    ).rejects.toMatchObject({ code: "THREAD_ID_REQUIRED" });
  });

  it("supports a no-write dry run", async () => {
    const harness = await seededHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      dryRun: true,
      openMode: "none",
    });

    expect(result.dryRun).toBe(true);
    expect(result.command).toMatchObject({ type: "thread.turn.start", threadId: "thread-existing" });
    expect(result.dispatch).toBeNull();
    expect(result.verification).toBeNull();
  });

  it("applies explicit model, speed, and effort overrides for the turn", async () => {
    const harness = await seededHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      model: "gpt-5.3-codex",
      speedMode: "fast",
      thinkingEffort: "high",
      openMode: "none",
      drivers: harness.drivers,
    });

    expect(result.command).toMatchObject({
      modelSelection: { instanceId: "codex", model: "gpt-5.3-codex" },
    });
    const options = (result.command as { modelSelection: { options: Array<{ id: string; value: unknown }> } })
      .modelSelection.options;
    expect(options).toEqual(
      expect.arrayContaining([
        { id: "serviceTier", value: "fast" },
        { id: "fastMode", value: true },
        { id: "reasoningEffort", value: "high" },
      ]),
    );
  });

  it("requires a model when switching provider for the turn", async () => {
    const harness = await seededHarness();

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        provider: "claudeAgent",
        openMode: "none",
        drivers: harness.drivers,
      }),
    ).rejects.toMatchObject({ code: "MODEL_REQUIRED_FOR_PROVIDER" });
  });

  it("accepts the send and records a later driver failure in the ledger", async () => {
    const harness = await testHarness({ failTurns: true });
    await seedProject(harness);
    await seedThread(harness);

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      openMode: "none",
      drivers: harness.drivers,
    });
    expect(result.delivery).toBe("started");
    await waitForTurnStatus(harness, "thread-existing", ["failed"]);
    const read = await readStoredThread(harness.store, "thread-existing");
    expect(read.turns).toHaveLength(1);
  });

  it("rejects busy threads by default and injects with --if-busy inject", async () => {
    const harness = await seededHarness();
    await sendTurn(harness.store, "thread-existing", { prompt: "First" });

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        openMode: "none",
        drivers: harness.drivers,
      }),
    ).rejects.toMatchObject({ code: "THREAD_BUSY" });

    const injected = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      ifBusy: "inject",
      openMode: "none",
      drivers: harness.drivers,
      noWait: true,
    });
    expect(injected.verification).toMatchObject({ accepted: true });
  });

  it("requires --wake-settled for settled threads and honors declines", async () => {
    const harness = await seededHarness();
    await settleStoredThread(harness.store, "thread-existing");

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        openMode: "none",
        drivers: harness.drivers,
      }),
    ).rejects.toMatchObject({ code: "SETTLED_THREAD_CONFIRMATION_REQUIRED" });

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        openMode: "none",
        drivers: harness.drivers,
        confirmSettled: async () => false,
      }),
    ).rejects.toMatchObject({ code: "SETTLED_THREAD_DECLINED" });

    const woken = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      wakeSettled: true,
      openMode: "none",
      drivers: harness.drivers,
    });
    expect(woken.thread.statusBeforeSend).toBe("settled");
    expect(woken.command.type).toBe("thread.turn.start");
  });
});

describe("thread lifecycle", () => {
  async function lifecycleHarness() {
    const harness = await testHarness();
    const workspaceRoot = await realpath(harness.work);
    await ensureStoredProject(storeRoot(), {
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    });
    await createThread(harness.store, {
      id: "thread-active",
      projectId: "project-1",
      title: "Active thread",
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    await createThread(harness.store, {
      id: "thread-settled",
      projectId: "project-1",
      title: "Settled thread",
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    await settleStoredThread(harness.store, "thread-settled");
    return harness;
  }

  it("lists threads with status filters", async () => {
    const harness = await lifecycleHarness();
    const all = await listThreads(harness.config, {});
    expect(all.threads.map((thread) => thread.id).sort()).toEqual(["thread-active", "thread-settled"]);
    const active = await listThreads(harness.config, { status: "active" });
    expect(active.threads.map((thread) => thread.id)).toEqual(["thread-active"]);
    const settled = await listThreads(harness.config, { status: "settled" });
    expect(settled.threads.map((thread) => thread.id)).toEqual(["thread-settled"]);
  });

  it("inspects and reads a thread", async () => {
    const harness = await lifecycleHarness();
    const inspected = await inspectThread(harness.config, "thread-active");
    expect(inspected.thread.id).toBe("thread-active");
    expect(inspected.thread.status).toBe("active");
    const read = await readThread(harness.config, "thread-active");
    expect(read.thread.view).toBe("messages");
    if (read.thread.view === "messages") expect(read.thread.messageCount).toBe(0);
  });

  it("settles and unsettles a thread with verification", async () => {
    const harness = await lifecycleHarness();
    const settled = await settleThread(harness.config, "thread-active");
    expect(settled.thread.statusAfter).toBe("settled");
    expect(settled.verification).toMatchObject({ accepted: true, state: "settled" });
    const active = await unsettleThread(harness.config, "thread-active");
    expect(active.thread.statusAfter).toBe("active");
    expect(active.verification).toMatchObject({ accepted: true, state: "active" });
  });

  it("snoozes, lists snoozed, and unsnoozes a thread with verification", async () => {
    const harness = await lifecycleHarness();

    const snoozed = await snoozeThread(harness.config, "thread-active", "2030-01-01T00:00:00.000Z");
    expect(snoozed.command).toMatchObject({
      type: "thread.snooze",
      threadId: "thread-active",
      snoozedUntil: "2030-01-01T00:00:00.000Z",
    });
    expect(snoozed.verification).toMatchObject({ accepted: true, snoozedUntil: "2030-01-01T00:00:00.000Z" });
    expect(snoozed.thread.snoozedUntil).toBe("2030-01-01T00:00:00.000Z");

    const onlySnoozed = await listThreads(harness.config, { status: "snoozed" });
    expect(onlySnoozed.threads.map((thread) => thread.id)).toEqual(["thread-active"]);
    expect(onlySnoozed.threads[0]).toMatchObject({ status: "snoozed" });
    const active = await listThreads(harness.config, { status: "active" });
    expect(active.threads).toHaveLength(0);

    const inspected = await inspectThread(harness.config, "thread-active");
    expect(inspected.thread.status).toBe("snoozed");
    expect(inspected.thread.snoozedUntil).toBe("2030-01-01T00:00:00.000Z");

    const unsnoozed = await unsnoozeThread(harness.config, "thread-active");
    expect(unsnoozed.command).toMatchObject({ type: "thread.unsnooze", threadId: "thread-active", reason: "user" });
    expect(unsnoozed.verification).toMatchObject({ accepted: true, snoozedUntil: null });
    expect(unsnoozed.thread.snoozedUntil).toBeNull();
  });

  it("treats an expired snooze as active", async () => {
    const harness = await lifecycleHarness();
    await snoozeThread(harness.config, "thread-active", "2020-01-01T00:00:00.000Z");

    const snoozed = await listThreads(harness.config, { status: "snoozed" });
    expect(snoozed.threads).toHaveLength(0);
    const active = await listThreads(harness.config, { status: "active" });
    expect(active.threads.map((thread) => thread.id)).toEqual(["thread-active"]);
  });

  it("rejects invalid snooze targets and timestamps", async () => {
    const harness = await lifecycleHarness();

    await expect(snoozeThread(harness.config, "thread-missing", "2030-01-01T00:00:00.000Z")).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
    });
    await expect(snoozeThread(harness.config, "thread-active", "not-a-datetime")).rejects.toMatchObject({
      code: "SNOOZE_UNTIL_INVALID",
    });
    await expect(unsnoozeThread(harness.config, "thread-missing")).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
    });

    await archiveThread(harness.store, "thread-active");
    await expect(snoozeThread(harness.config, "thread-active", "2030-01-01T00:00:00.000Z")).rejects.toMatchObject({
      code: "THREAD_ARCHIVED",
    });
    await expect(unsnoozeThread(harness.config, "thread-active")).rejects.toMatchObject({
      code: "THREAD_ARCHIVED",
    });
  });

  it("interrupts a running turn and reports no_active_run when idle", async () => {
    const harness = await lifecycleHarness();
    await sendTurn(harness.store, "thread-active", { prompt: "Work" });

    const interrupted = await interruptThread(harness.config, "thread-active");
    expect(interrupted.command).toMatchObject({ type: "thread.turn.interrupt", threadId: "thread-active" });
    expect(interrupted.command).not.toHaveProperty("turnId");
    expect(interrupted.result).toBe("interrupt_requested");
    expect(interrupted.verification).toMatchObject({ accepted: true, method: "interrupt" });

    const settled = await interruptThread(harness.config, "thread-settled");
    expect(settled.result).toBe("no_active_run");
    expect(settled.command).toBeNull();
    expect(settled.dispatch).toBeNull();
  });

  it("targets a specific turn with --run and rejects bad interrupt targets", async () => {
    const harness = await lifecycleHarness();
    const sent = await sendTurn(harness.store, "thread-active", { prompt: "Work" });

    const interrupted = await interruptThread(harness.config, "thread-active", { run: sent.turn.id });
    expect(interrupted.command).toMatchObject({
      type: "thread.turn.interrupt",
      threadId: "thread-active",
      turnId: sent.turn.id,
    });

    await expect(interruptThread(harness.config, "thread-missing")).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
    });
    await expect(interruptThread(harness.config, "thread-active", { run: "  " })).rejects.toMatchObject({
      code: "INVALID_THREAD_OPTION",
    });
    await archiveThread(harness.store, "thread-active");
    await expect(interruptThread(harness.config, "thread-active")).rejects.toMatchObject({
      code: "THREAD_ARCHIVED",
    });
  });

  it("reads turn-items, plans, checkpoints, and transfers views", async () => {
    const harness = await lifecycleHarness();
    await harness.store.appendLedger("thread-active", "activity", {
      id: "activity-1",
      threadId: "thread-active",
      turnId: "turn-1",
      kind: "tool_execution",
      summary: "Ran tests",
      createdAt: "2026-09-04T10:01:00.000Z",
    });
    await harness.store.appendLedger("thread-active", "checkpoints", {
      id: "checkpoint-1",
      threadId: "thread-active",
      turnId: "turn-1",
      status: "ready",
      ref: null,
      baseRef: null,
      createdAt: "2026-09-04T10:01:00.000Z",
    });

    const items = await readThread(harness.config, "thread-active", { view: "turn-items" });
    if (items.thread.view !== "turn-items") throw new Error("expected turn-items view");
    expect(items.thread.itemCount).toBe(1);
    expect(items.thread.items[0]).toMatchObject({ id: "activity-1", kind: "tool_execution" });

    const plans = await readThread(harness.config, "thread-active", { view: "plans" });
    if (plans.thread.view !== "plans") throw new Error("expected plans view");
    expect(plans.thread.planCount).toBe(0);

    const checkpoints = await readThread(harness.config, "thread-active", { view: "checkpoints" });
    if (checkpoints.thread.view !== "checkpoints") throw new Error("expected checkpoints view");
    expect(checkpoints.thread.checkpointCount).toBe(1);

    const transfers = await readThread(harness.config, "thread-active", { view: "transfers" });
    if (transfers.thread.view !== "transfers") throw new Error("expected transfers view");
    expect(transfers.thread.transferCount).toBe(0);
    expect(transfers.thread.transfers).toEqual([]);

    await expect(readThread(harness.config, "thread-active", { view: "bogus" as never })).rejects.toMatchObject({
      code: "INVALID_THREAD_OPTION",
    });
  });

  it("refuses to settle a thread with pending work", async () => {
    const harness = await lifecycleHarness();
    const stored = await harness.store.readThreadRecord("thread-active");
    await harness.store.writeThreadRecord({ ...stored!, hasPendingApprovals: true });

    await expect(settleThread(harness.config, "thread-active")).rejects.toMatchObject({
      code: "THREAD_SETTLE_BLOCKED",
      details: { threadId: "thread-active", hasPendingApprovals: true },
    });
  });
});

describe("send delivery modes", () => {
  async function busyHarness() {
    const harness = await testHarness();
    await seedProject(harness);
    await seedThread(harness);
    await sendTurn(harness.store, "thread-existing", { prompt: "First" });
    return harness;
  }

  it("reports started delivery by default with no handoff note", async () => {
    const harness = await seededHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      openMode: "none",
      drivers: harness.drivers,
    });
    expect(result.delivery).toBe("started");
    expect(result.handoffNote).toBeNull();
    expect(result.command.type).toBe("thread.turn.start");
  });

  it("queues behind busy threads with --delivery queue", async () => {
    const harness = await busyHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Follow-up",
      delivery: "queue",
      openMode: "none",
      drivers: harness.drivers,
      noWait: true,
    });
    expect(result.delivery).toBe("queued");
  });

  it("steers only busy threads", async () => {
    const busy = await busyHarness();
    const steered = await sendThreadMessage(busy.config, {
      threadId: "thread-existing",
      prompt: "Steer this",
      delivery: "steer",
      openMode: "none",
      drivers: busy.drivers,
      noWait: true,
    });
    expect(steered.delivery).toBe("steered");

    const idle = await seededHarness();
    await expect(
      sendThreadMessage(idle.config, {
        threadId: "thread-existing",
        prompt: "Steer this",
        delivery: "steer",
        openMode: "none",
        drivers: idle.drivers,
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_STEERABLE", details: { delivery: "steer" } });
  });

  it("restarts by interrupting before sending", async () => {
    const harness = await busyHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Start over with this",
      delivery: "restart",
      openMode: "none",
      drivers: harness.drivers,
      noWait: true,
    });
    expect(result.delivery).toBe("restarted");
    const read = await readStoredThread(harness.store, "thread-existing");
    const interrupted = read.turns.filter((turn) => turn.status === "interrupted");
    expect(interrupted).toHaveLength(1);
    expect(read.turns[read.turns.length - 1]?.status).toBe("running");

    const idle = await seededHarness();
    await expect(
      sendThreadMessage(idle.config, {
        threadId: "thread-existing",
        prompt: "Start over",
        delivery: "restart",
        openMode: "none",
        drivers: idle.drivers,
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_STEERABLE" });
  });

  it("records a handoff note without changing the recorded turn", async () => {
    const harness = await seededHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Continue on claudeAgent",
      handoffNote: "Switched provider; prior context summarized.",
      openMode: "none",
      drivers: harness.drivers,
    });
    expect(result.handoffNote).toBe("Switched provider; prior context summarized.");
    const read = await readStoredThread(harness.store, "thread-existing");
    expect(read.turns).toHaveLength(1);
    await waitForTurnStatus(harness, "thread-existing", ["completed", "failed"]);

    const dryRun = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Continue",
      handoffNote: "note",
      dryRun: true,
      openMode: "none",
    });
    expect(dryRun.handoffNote).toBe("note");

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        delivery: "bogus" as never,
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "INVALID_THREAD_OPTION" });
    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        handoffNote: "   ",
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "INVALID_THREAD_OPTION" });
  });
});

describe("delegated tasks", () => {
  async function parentHarness() {
    const harness = await testHarness();
    const workspaceRoot = await realpath(harness.work);
    await ensureStoredProject(storeRoot(), {
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    });
    await createThread(harness.store, {
      id: "thread-parent",
      projectId: "project-1",
      title: "Parent thread",
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    return harness;
  }

  it("delegates to a same-project child with only the task prompt, then waits", async () => {
    const harness = await parentHarness();

    const result = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Research the retry policy.",
      openMode: "none",
      drivers: harness.drivers,
    });

    expect(result.createCommand.projectId).toBe("project-1");
    expect(result.createCommand.runtimeMode).toBe("full-access");
    expect(result.turnCommand.message.text).toBe("Research the retry policy.");
    expect(result.turnCommand.threadId).toBe(result.child.id);
    expect(result.child.projectId).toBe("project-1");
    expect(result.task.taskId).toBe(result.child.id);
    expect(result.task.status).toBe("completed");
    expect(result.task.workState).toBe("result_available");
    expect(result.task.summary).toBe("Completed: Research the retry policy.");
    expect(result.task.waitTimedOut).toBe(false);
    expect(result.verification).toMatchObject({ accepted: true, method: "message-id" });
  });

  it("returns waitTimedOut instead of cancelling on timeout", async () => {
    const harness = await testHarness({ leaveTurnsRunning: true });
    const workspaceRoot = await realpath(harness.work);
    await ensureStoredProject(storeRoot(), {
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    });
    await createThread(harness.store, {
      id: "thread-parent",
      projectId: "project-1",
      title: "Parent thread",
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    const result = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Long task",
      timeoutMs: 250,
      openMode: "none",
      drivers: harness.drivers,
    });
    expect(result.task.waitTimedOut).toBe(true);
    expect(result.task.status).toBe("running");
  });

  it("supports no-wait dispatch and dry runs", async () => {
    const running = await testHarness({ leaveTurnsRunning: true });
    const runningRoot = await realpath(running.work);
    await ensureStoredProject(storeRoot(), {
      id: "project-1",
      title: "Project One",
      workspaceRoot: runningRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    });
    await createThread(running.store, {
      id: "thread-parent",
      projectId: "project-1",
      title: "Parent thread",
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    const asyncResult = await delegateTask(running.config, {
      parentThreadId: "thread-parent",
      task: "Background task",
      wait: false,
      openMode: "none",
      drivers: running.drivers,
    });
    expect(asyncResult.task.status).toBe("running");
    expect(asyncResult.task.waitTimedOut).toBe(false);

    const harness = await parentHarness();
    const dryRun = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Planned task",
      dryRun: true,
      openMode: "none",
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.task.childRunId).toBeNull();
  });

  it("rejects bad delegate input without writing", async () => {
    const harness = await parentHarness();

    await expect(
      delegateTask(harness.config, { parentThreadId: "thread-missing", task: "Work", openMode: "none" }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });
    await expect(
      delegateTask(harness.config, { parentThreadId: "thread-parent", task: "   ", openMode: "none" }),
    ).rejects.toMatchObject({ code: "PROMPT_REQUIRED" });
    await expect(
      delegateTask(harness.config, {
        parentThreadId: "thread-parent",
        task: "Work",
        timeoutMs: -5,
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "INVALID_THREAD_OPTION" });
  });

  it("reads task status and rejects foreign tasks", async () => {
    const harness = await parentHarness();
    const delegated = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Research the retry policy.",
      openMode: "none",
      drivers: harness.drivers,
    });

    const status = await taskStatus(harness.config, "thread-parent", delegated.child.id);
    expect(status.task).toMatchObject({
      taskId: delegated.child.id,
      childThreadId: delegated.child.id,
      status: "completed",
      workState: "result_available",
      hasPendingChildRuns: false,
      waitTimedOut: false,
    });
    expect(status.task.summary).toBe("Completed: Research the retry policy.");

    await expect(taskStatus(harness.config, "thread-parent", "task-missing")).rejects.toMatchObject({
      code: "TASK_NOT_FOUND",
      details: { taskId: "task-missing" },
    });

    await ensureStoredProject(storeRoot(), {
      id: "project-2",
      title: "Project Two",
      workspaceRoot: "/elsewhere",
    });
    await createThread(harness.store, {
      id: "thread-foreign",
      projectId: "project-2",
      title: "Foreign thread",
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    await expect(taskStatus(harness.config, "thread-parent", "thread-foreign")).rejects.toMatchObject({
      code: "TASK_NOT_FOUND",
    });
  });

  it("cancels a running task with a real interrupt", async () => {
    const harness = await testHarness({ leaveTurnsRunning: true });
    const workspaceRoot = await realpath(harness.work);
    await ensureStoredProject(storeRoot(), {
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
    });
    await createThread(harness.store, {
      id: "thread-parent",
      projectId: "project-1",
      title: "Parent thread",
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    const delegated = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Long task",
      wait: false,
      openMode: "none",
      drivers: harness.drivers,
    });

    const cancelled = await cancelTask(harness.config, "thread-parent", delegated.child.id);
    expect(cancelled.task.status).toBe("interrupted");
    expect(cancelled.command).toMatchObject({ type: "thread.turn.interrupt" });
    expect(cancelled.verification).toMatchObject({ accepted: true, method: "interrupt" });
  });

  it("treats terminal task cancel as idempotent and rejects unknown tasks", async () => {
    const harness = await parentHarness();
    const delegated = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Quick task",
      openMode: "none",
      drivers: harness.drivers,
    });
    const childBefore = (await readStoredThread(harness.store, delegated.child.id)).turns.length;

    const cancelled = await cancelTask(harness.config, "thread-parent", delegated.child.id);
    expect(cancelled.task.status).toBe("completed");
    expect(cancelled.command).toBeNull();

    const childAfter = (await readStoredThread(harness.store, delegated.child.id)).turns.length;
    expect(childAfter).toBe(childBefore);

    await expect(cancelTask(harness.config, "thread-parent", "task-missing")).rejects.toMatchObject({
      code: "TASK_NOT_FOUND",
    });
  });
});
