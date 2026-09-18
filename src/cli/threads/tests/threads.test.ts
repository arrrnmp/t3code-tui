import { realpath } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { testHarness } from "../../testing/harness.js";
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

async function withFastVerification<T>(run: () => Promise<T>): Promise<T> {
  const previousTimeout = process.env.T3CODE_VERIFICATION_TIMEOUT_MS;
  const previousInterval = process.env.T3CODE_VERIFICATION_INTERVAL_MS;
  process.env.T3CODE_VERIFICATION_TIMEOUT_MS = "400";
  process.env.T3CODE_VERIFICATION_INTERVAL_MS = "25";
  try {
    return await run();
  } finally {
    if (previousTimeout === undefined) delete process.env.T3CODE_VERIFICATION_TIMEOUT_MS;
    else process.env.T3CODE_VERIFICATION_TIMEOUT_MS = previousTimeout;
    if (previousInterval === undefined) delete process.env.T3CODE_VERIFICATION_INTERVAL_MS;
    else process.env.T3CODE_VERIFICATION_INTERVAL_MS = previousInterval;
  }
}

describe("sendThreadMessage", () => {
  async function seededHarness() {
    const harness = await testHarness();
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-existing",
      title: "Existing project",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-existing",
      projectId: "project-existing",
      title: "Existing thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    return harness;
  }

  it("sends a follow-up as a single turn start on the existing thread", async () => {
    const harness = await seededHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Run the 5am skill.",
      openMode: "none",
    });

    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.start"]);
    const turn = harness.commands[0] as {
      threadId: string;
      message: { role: string; text: string; attachments: unknown[] };
      runtimeMode: string;
      interactionMode: string;
    };
    expect(turn.threadId).toBe("thread-existing");
    expect(turn.message).toMatchObject({ role: "user", text: "Run the 5am skill.", attachments: [] });
    expect(turn.runtimeMode).toBe("full-access");
    expect(turn.interactionMode).toBe("default");
    expect(harness.commands[0]).not.toHaveProperty("modelSelection");
    expect(harness.commands[0]).not.toHaveProperty("bootstrap");
    expect(result.thread.id).toBe("thread-existing");
    expect(result.project?.id).toBe("project-existing");
    expect(result.opened.kind).toBe("none");
    expect(result.verification).toMatchObject({ accepted: true, method: "message-id" });
    expect(result.message.textLength).toBe("Run the 5am skill.".length);
  });

  it("rejects unknown thread ids without dispatching", async () => {
    const harness = await seededHarness();

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-missing",
        prompt: "Hello",
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND", details: { threadId: "thread-missing" } });
    expect(harness.commands).toHaveLength(0);
  });

  it("rejects archived threads", async () => {
    const harness = await seededHarness();
    harness.threads[0]!.archivedAt = new Date().toISOString();

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "THREAD_ARCHIVED" });
    expect(harness.commands).toHaveLength(0);
  });

  it("rejects empty prompts and thread ids", async () => {
    const harness = await seededHarness();

    await expect(
      sendThreadMessage(harness.config, { threadId: "thread-existing", prompt: "  ", openMode: "none" }),
    ).rejects.toMatchObject({ code: "PROMPT_REQUIRED" });
    await expect(
      sendThreadMessage(harness.config, { threadId: "  ", prompt: "Hello", openMode: "none" }),
    ).rejects.toMatchObject({ code: "THREAD_ID_REQUIRED" });
    expect(harness.commands).toHaveLength(0);
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
    expect(harness.commands).toHaveLength(0);
  });

  it("applies explicit model, speed, and effort overrides for the turn", async () => {
    const harness = await seededHarness();

    await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      model: "gpt-5.3-codex",
      speedMode: "fast",
      thinkingEffort: "high",
      openMode: "none",
    });

    const turn = harness.commands[0] as {
      modelSelection: { instanceId: string; model: string; options: Array<{ id: string; value: string | boolean }> };
    };
    expect(turn.modelSelection).toMatchObject({ instanceId: "codex", model: "gpt-5.3-codex" });
    expect(turn.modelSelection.options).toEqual(
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
      }),
    ).rejects.toMatchObject({ code: "MODEL_REQUIRED_FOR_PROVIDER" });
    expect(harness.commands).toHaveLength(0);
  });

  it("leaves the thread untouched when its turn fails", async () => {
    const harness = await testHarness([], { failTurn: true });
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-existing",
      title: "Existing project",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-existing",
      projectId: "project-existing",
      title: "Existing thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "THREAD_START_FAILED", details: { threadId: "thread-existing" } });
    // Unlike a failed handover, a failed follow-up must not delete the thread.
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.start"]);
  });

  it("rejects busy threads by default and injects with --if-busy inject", async () => {
    const harness = await seededHarness();
    harness.threads[0]!.session = {
      threadId: "thread-existing",
      status: "running",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: "turn-active",
      lastError: null,
      updatedAt: new Date().toISOString(),
    };

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "THREAD_BUSY" });
    expect(harness.commands).toHaveLength(0);

    const injected = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      ifBusy: "inject",
      openMode: "none",
    });
    expect(injected.verification).toMatchObject({ accepted: true });
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.start"]);
  });

  it("requires --wake-settled for settled threads and honors declines", async () => {
    const harness = await seededHarness();
    harness.threads[0]!.settledAt = new Date().toISOString();

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "SETTLED_THREAD_CONFIRMATION_REQUIRED" });
    expect(harness.commands).toHaveLength(0);

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Hello",
        openMode: "none",
        confirmSettled: async () => false,
      }),
    ).rejects.toMatchObject({ code: "SETTLED_THREAD_DECLINED" });
    expect(harness.commands).toHaveLength(0);

    const woken = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      wakeSettled: true,
      openMode: "none",
    });
    expect(woken.thread.statusBeforeSend).toBe("settled");
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.start"]);
  });
});

describe("thread lifecycle", () => {
  async function lifecycleHarness() {
    const harness = await testHarness();
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-active",
      projectId: "project-1",
      title: "Active thread",
      archivedAt: null,
      settledAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      updatedAt: "2026-09-04T10:00:00.000Z",
      messages: [],
    });
    harness.threads.push({
      id: "thread-settled",
      projectId: "project-1",
      title: "Settled thread",
      archivedAt: null,
      settledAt: "2026-09-04T11:00:00.000Z",
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      updatedAt: "2026-09-04T11:00:00.000Z",
      messages: [],
    });
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
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.snooze"]);
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
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.snooze", "thread.unsnooze"]);
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
    expect(harness.commands).toHaveLength(0);

    harness.threads[0]!.archivedAt = new Date().toISOString();
    await expect(snoozeThread(harness.config, "thread-active", "2030-01-01T00:00:00.000Z")).rejects.toMatchObject({
      code: "THREAD_ARCHIVED",
    });
    await expect(unsnoozeThread(harness.config, "thread-active")).rejects.toMatchObject({
      code: "THREAD_ARCHIVED",
    });
    expect(harness.commands).toHaveLength(0);
  });

  it("reports unverified snooze and unsnooze dispatches without retrying", async () => {
    const harness = await testHarness([], {
      suppressProjectionFor: ["thread.snooze", "thread.unsnooze"],
    });
    const { realpath: resolveRealpath } = await import("node:fs/promises");
    const workspaceRoot = await resolveRealpath(harness.root);
    harness.projects.push({
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-active",
      projectId: "project-1",
      title: "Active thread",
      archivedAt: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      snoozedUntil: "2030-01-01T00:00:00.000Z",
      snoozedAt: "2026-09-04T10:00:00.000Z",
    });

    await withFastVerification(() =>
      expect(snoozeThread(harness.config, "thread-active", "2031-01-01T00:00:00.000Z")).rejects.toMatchObject({
        code: "THREAD_SNOOZE_NOT_VERIFIED",
        details: { threadId: "thread-active" },
      }),
    );
    await withFastVerification(() =>
      expect(unsnoozeThread(harness.config, "thread-active")).rejects.toMatchObject({
        code: "THREAD_UNSNOOZE_NOT_VERIFIED",
        details: { threadId: "thread-active" },
      }),
    );
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.snooze", "thread.unsnooze"]);
  });

  it("interrupts a running turn and reports no_active_run when idle", async () => {
    const harness = await lifecycleHarness();
    harness.threads[0]!.session = {
      threadId: "thread-active",
      status: "running",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: "turn-active",
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
    harness.threads[0]!.latestTurn = {
      turnId: "turn-active",
      state: "running",
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      assistantMessageId: null,
    };

    const interrupted = await interruptThread(harness.config, "thread-active");
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.interrupt"]);
    expect(interrupted.command).toMatchObject({ type: "thread.turn.interrupt", threadId: "thread-active" });
    expect(interrupted.command).not.toHaveProperty("turnId");
    expect(interrupted.result).toBe("interrupt_requested");
    expect(interrupted.verification).toMatchObject({ accepted: true, method: "interrupt" });

    const settled = await interruptThread(harness.config, "thread-settled");
    expect(settled.result).toBe("no_active_run");
    expect(settled.command).toBeNull();
    expect(settled.dispatch).toBeNull();
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.interrupt"]);
  });

  it("targets a specific turn with --run and rejects bad interrupt targets", async () => {
    const harness = await lifecycleHarness();
    harness.threads[0]!.latestTurn = {
      turnId: "turn-active",
      state: "running",
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      assistantMessageId: null,
    };

    const interrupted = await interruptThread(harness.config, "thread-active", { run: "turn-active" });
    expect(interrupted.command).toMatchObject({
      type: "thread.turn.interrupt",
      threadId: "thread-active",
      turnId: "turn-active",
    });

    await expect(interruptThread(harness.config, "thread-missing")).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
    });
    await expect(interruptThread(harness.config, "thread-active", { run: "  " })).rejects.toMatchObject({
      code: "INVALID_THREAD_OPTION",
    });
    harness.threads[0]!.archivedAt = new Date().toISOString();
    await expect(interruptThread(harness.config, "thread-active")).rejects.toMatchObject({
      code: "THREAD_ARCHIVED",
    });
  });

  it("reports failed and unverified interrupt dispatches", async () => {
    const failing = await testHarness([], { failCommands: ["thread.turn.interrupt"] });
    const workspaceRoot = await realpath(failing.root);
    failing.projects.push({
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    failing.threads.push({
      id: "thread-busy",
      projectId: "project-1",
      title: "Busy thread",
      archivedAt: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      latestTurn: {
        turnId: "turn-active",
        state: "running",
        requestedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        assistantMessageId: null,
      },
    });
    await expect(interruptThread(failing.config, "thread-busy")).rejects.toMatchObject({
      code: "THREAD_INTERRUPT_FAILED",
    });

    const suppressed = await testHarness([], { suppressProjectionFor: ["thread.turn.interrupt"] });
    const suppressedRoot = await realpath(suppressed.root);
    suppressed.projects.push({
      id: "project-1",
      title: "Project One",
      workspaceRoot: suppressedRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    suppressed.threads.push({
      id: "thread-busy",
      projectId: "project-1",
      title: "Busy thread",
      archivedAt: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      latestTurn: {
        turnId: "turn-active",
        state: "running",
        requestedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        assistantMessageId: null,
      },
      session: {
        threadId: "thread-busy",
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: "turn-active",
        lastError: null,
        updatedAt: new Date().toISOString(),
      },
    });
    await withFastVerification(() =>
      expect(interruptThread(suppressed.config, "thread-busy")).rejects.toMatchObject({
        code: "THREAD_INTERRUPT_NOT_VERIFIED",
      }),
    );
  });

  it("reads turn-items, plans, checkpoints, and transfers views", async () => {
    const harness = await lifecycleHarness();
    harness.threads[0]!.activities = [
      {
        id: "activity-1",
        tone: "tool",
        kind: "tool_execution",
        summary: "Ran tests",
        turnId: "turn-1",
        createdAt: "2026-09-04T10:01:00.000Z",
      },
    ];
    harness.threads[0]!.proposedPlans = [{ id: "plan-1", turnId: "turn-1" }];
    harness.threads[0]!.checkpoints = [{ turnId: "turn-1", status: "ready" }];

    const items = await readThread(harness.config, "thread-active", { view: "turn-items" });
    if (items.thread.view !== "turn-items") throw new Error("expected turn-items view");
    expect(items.thread.itemCount).toBe(1);
    expect(items.thread.items[0]).toMatchObject({ id: "activity-1", kind: "tool_execution" });

    const plans = await readThread(harness.config, "thread-active", { view: "plans" });
    if (plans.thread.view !== "plans") throw new Error("expected plans view");
    expect(plans.thread.planCount).toBe(1);
    expect(plans.thread.plans[0]).toMatchObject({ id: "plan-1" });

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

  it("refuses to settle a thread with shell-reported pending work", async () => {
    const harness = await lifecycleHarness();
    // The detail endpoint never carries these flags; the guard must read them
    // from the shell snapshot, where the mock keeps them.
    harness.threads[0]!.hasPendingApprovals = true;

    await expect(settleThread(harness.config, "thread-active")).rejects.toMatchObject({
      code: "THREAD_SETTLE_BLOCKED",
      details: { threadId: "thread-active", hasPendingApprovals: true },
    });
    expect(harness.commands).toHaveLength(0);
  });
});

describe("send delivery modes", () => {
  async function busyHarness() {
    const harness = await testHarness();
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-existing",
      title: "Existing project",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-existing",
      projectId: "project-existing",
      title: "Existing thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      latestTurn: {
        turnId: "turn-active",
        state: "running",
        requestedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        assistantMessageId: null,
      },
      session: {
        threadId: "thread-existing",
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: "turn-active",
        lastError: null,
        updatedAt: new Date().toISOString(),
      },
    });
    return harness;
  }

  it("reports started delivery by default with no handoff note", async () => {
    const harness = await testHarness();
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-existing",
      title: "Existing project",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-existing",
      projectId: "project-existing",
      title: "Existing thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Hello",
      openMode: "none",
    });
    expect(result.delivery).toBe("started");
    expect(result.handoffNote).toBeNull();
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.start"]);
  });

  it("queues behind busy threads with --delivery queue", async () => {
    const harness = await busyHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Follow-up",
      delivery: "queue",
      openMode: "none",
    });
    expect(result.delivery).toBe("queued");
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.start"]);
  });

  it("steers only busy threads", async () => {
    const busy = await busyHarness();
    const steered = await sendThreadMessage(busy.config, {
      threadId: "thread-existing",
      prompt: "Steer this",
      delivery: "steer",
      openMode: "none",
    });
    expect(steered.delivery).toBe("steered");
    expect(busy.commands.map((command) => command.type)).toEqual(["thread.turn.start"]);

    const idle = await testHarness();
    const workspaceRoot = await realpath(idle.root);
    idle.projects.push({
      id: "project-existing",
      title: "Existing project",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    idle.threads.push({
      id: "thread-existing",
      projectId: "project-existing",
      title: "Existing thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    await expect(
      sendThreadMessage(idle.config, {
        threadId: "thread-existing",
        prompt: "Steer this",
        delivery: "steer",
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_STEERABLE", details: { delivery: "steer" } });
    expect(idle.commands).toHaveLength(0);
  });

  it("restarts by interrupting before sending", async () => {
    const harness = await busyHarness();

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Start over with this",
      delivery: "restart",
      openMode: "none",
    });
    expect(result.delivery).toBe("restarted");
    expect(harness.commands.map((command) => command.type)).toEqual([
      "thread.turn.interrupt",
      "thread.turn.start",
    ]);

    const idle = await testHarness();
    const workspaceRoot = await realpath(idle.root);
    idle.projects.push({
      id: "project-existing",
      title: "Existing project",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    idle.threads.push({
      id: "thread-existing",
      projectId: "project-existing",
      title: "Existing thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    await expect(
      sendThreadMessage(idle.config, {
        threadId: "thread-existing",
        prompt: "Start over",
        delivery: "restart",
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "THREAD_NOT_STEERABLE" });
    expect(idle.commands).toHaveLength(0);
  });

  it("fails a restart loudly when the interrupt fails", async () => {
    const harness = await testHarness([], { failCommands: ["thread.turn.interrupt"] });
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-existing",
      title: "Existing project",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-existing",
      projectId: "project-existing",
      title: "Existing thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      latestTurn: {
        turnId: "turn-active",
        state: "running",
        requestedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        assistantMessageId: null,
      },
    });

    await expect(
      sendThreadMessage(harness.config, {
        threadId: "thread-existing",
        prompt: "Start over",
        delivery: "restart",
        openMode: "none",
      }),
    ).rejects.toMatchObject({ code: "THREAD_RESTART_FAILED" });
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.turn.interrupt"]);
  });

  it("records a handoff note without changing the dispatched turn", async () => {
    const harness = await testHarness();
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-existing",
      title: "Existing project",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-existing",
      projectId: "project-existing",
      title: "Existing thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    const result = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Continue on claudeAgent",
      handoffNote: "Switched provider; prior context summarized.",
      openMode: "none",
    });
    expect(result.handoffNote).toBe("Switched provider; prior context summarized.");
    expect(harness.commands[0]).not.toHaveProperty("handoffNote");

    const dryRun = await sendThreadMessage(harness.config, {
      threadId: "thread-existing",
      prompt: "Continue",
      handoffNote: "note",
      dryRun: true,
      openMode: "none",
    });
    expect(dryRun.handoffNote).toBe("note");
    expect(harness.commands).toHaveLength(1);

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
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-parent",
      projectId: "project-1",
      title: "Parent thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
    });
    return harness;
  }

  it("delegates to a same-project child with only the task prompt, then waits", async () => {
    const harness = await parentHarness();

    const result = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Research the retry policy.",
      openMode: "none",
    });

    expect(harness.commands.map((command) => command.type)).toEqual(["thread.create", "thread.turn.start"]);
    const create = harness.commands[0] as { projectId: string; title: string; runtimeMode: string };
    expect(create.projectId).toBe("project-1");
    expect(create.runtimeMode).toBe("full-access");
    const turn = harness.commands[1] as { threadId: string; message: { text: string } };
    expect(turn.threadId).toBe(result.child.id);
    expect(turn.message.text).toBe("Research the retry policy.");
    expect(result.child.projectId).toBe("project-1");
    expect(result.task.taskId).toBe(result.child.id);
    expect(result.task.status).toBe("completed");
    expect(result.task.workState).toBe("result_available");
    expect(result.task.summary).toBe("Completed: Research the retry policy.");
    expect(result.task.waitTimedOut).toBe(false);
    expect(result.verification).toMatchObject({ accepted: true, method: "message-id" });
  });

  it("returns waitTimedOut instead of cancelling on timeout", async () => {
    const harness = await testHarness([], { leaveTurnsRunning: true });
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-parent",
      projectId: "project-1",
      title: "Parent thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    const result = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Long task",
      timeoutMs: 250,
      openMode: "none",
    });
    expect(result.task.waitTimedOut).toBe(true);
    expect(result.task.status).toBe("running");
    expect(harness.commands.map((command) => command.type)).toEqual(["thread.create", "thread.turn.start"]);
  });

  it("supports no-wait dispatch and dry runs", async () => {
    const running = await testHarness([], { leaveTurnsRunning: true });
    const runningRoot = await realpath(running.root);
    running.projects.push({
      id: "project-1",
      title: "Project One",
      workspaceRoot: runningRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    running.threads.push({
      id: "thread-parent",
      projectId: "project-1",
      title: "Parent thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    const asyncResult = await delegateTask(running.config, {
      parentThreadId: "thread-parent",
      task: "Background task",
      wait: false,
      openMode: "none",
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
    expect(harness.commands).toHaveLength(0);
  });

  it("rejects bad delegate input without dispatching", async () => {
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
    expect(harness.commands).toHaveLength(0);
  });

  it("reads task status and rejects foreign tasks", async () => {
    const harness = await parentHarness();
    const delegated = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Research the retry policy.",
      openMode: "none",
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

    harness.projects.push({
      id: "project-2",
      title: "Project Two",
      workspaceRoot: "/elsewhere",
      defaultModelSelection: null,
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-foreign",
      projectId: "project-2",
      title: "Foreign thread",
      archivedAt: null,
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    await expect(taskStatus(harness.config, "thread-parent", "thread-foreign")).rejects.toMatchObject({
      code: "TASK_NOT_FOUND",
    });
  });

  it("cancels a running task with a real interrupt", async () => {
    const harness = await testHarness([], { leaveTurnsRunning: true });
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-parent",
      projectId: "project-1",
      title: "Parent thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    const delegated = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Long task",
      wait: false,
      openMode: "none",
    });
    const before = harness.commands.length;

    const cancelled = await cancelTask(harness.config, "thread-parent", delegated.child.id);
    expect(cancelled.task.status).toBe("interrupted");
    expect(harness.commands.slice(before).map((command) => command.type)).toEqual(["thread.turn.interrupt"]);
    expect(cancelled.verification).toMatchObject({ accepted: true, method: "interrupt" });
  });

  it("treats terminal task cancel as idempotent and rejects unknown tasks", async () => {
    const harness = await parentHarness();
    const delegated = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Quick task",
      openMode: "none",
    });
    const before = harness.commands.length;

    const cancelled = await cancelTask(harness.config, "thread-parent", delegated.child.id);
    expect(cancelled.task.status).toBe("completed");
    expect(cancelled.command).toBeNull();
    expect(harness.commands).toHaveLength(before);

    await expect(cancelTask(harness.config, "thread-parent", "task-missing")).rejects.toMatchObject({
      code: "TASK_NOT_FOUND",
    });
  });

  it("returns TASK_CANCEL_UNSUPPORTED when the interrupt cannot dispatch", async () => {
    const harness = await testHarness([], { leaveTurnsRunning: true, failCommands: ["thread.turn.interrupt"] });
    const workspaceRoot = await realpath(harness.root);
    harness.projects.push({
      id: "project-1",
      title: "Project One",
      workspaceRoot,
      defaultModelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      deletedAt: null,
    });
    harness.threads.push({
      id: "thread-parent",
      projectId: "project-1",
      title: "Parent thread",
      archivedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    const delegated = await delegateTask(harness.config, {
      parentThreadId: "thread-parent",
      task: "Long task",
      wait: false,
      openMode: "none",
    });

    await expect(cancelTask(harness.config, "thread-parent", delegated.child.id)).rejects.toMatchObject({
      code: "TASK_CANCEL_UNSUPPORTED",
      details: { taskId: delegated.child.id },
    });
  });
});
