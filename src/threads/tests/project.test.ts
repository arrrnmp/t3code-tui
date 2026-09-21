import { describe, expect, it } from "vitest";

import { toT3Activity, toT3Checkpoint, toT3Message, toT3Thread } from "../project.js";
import type { StoredThread, StoredTurn } from "../types.js";

function thread(overrides: Partial<StoredThread> = {}): StoredThread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Thread",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    env: { mode: "local", path: "/repo", branch: "main" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    settledAt: null,
    unsettledAt: null,
    settledOverride: null,
    snoozedUntil: null,
    snoozedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...overrides,
  };
}

function turn(overrides: Partial<StoredTurn> = {}): StoredTurn {
  return {
    id: "turn-1",
    threadId: "thread-1",
    status: "completed",
    delivery: "started",
    messageId: "msg-1",
    runtimeMode: "full-access",
    interactionMode: "default",
    modelSelection: null,
    parentTurnId: null,
    error: null,
    usage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

describe("toT3Thread", () => {
  it("projects catalog rows without ledgers", () => {
    const projected = toT3Thread(thread(), [turn()]);
    expect(projected.latestTurn).toMatchObject({ turnId: "turn-1", state: "completed" });
    expect(projected.session).toMatchObject({ status: "idle", providerName: "codex", activeTurnId: null });
    expect(projected.branch).toBe("main");
    expect(projected.worktreePath).toBeNull();
    expect(projected.proposedPlans).toEqual([]);
    expect(projected).not.toHaveProperty("messages");
  });

  it("marks running sessions and skips queued turns", () => {
    const projected = toT3Thread(thread(), [
      turn({ id: "t1", status: "completed" }),
      turn({ id: "t2", status: "queued" }),
      turn({ id: "t3", status: "running" }),
    ]);
    expect(projected.latestTurn).toMatchObject({ turnId: "t3", state: "running" });
    expect(projected.session).toMatchObject({ status: "running", activeTurnId: "t3" });

    const queuedOnly = toT3Thread(thread(), [turn({ id: "q", status: "queued" })]);
    expect(queuedOnly.latestTurn).toBeNull();
    expect(queuedOnly.session?.status).toBe("idle");
  });

  it("maps failure states and worktree env", () => {
    const failed = toT3Thread(thread(), [turn({ status: "failed" })]);
    expect(failed.latestTurn?.state).toBe("error");
    const interrupted = toT3Thread(thread(), [turn({ status: "interrupted" })]);
    expect(interrupted.latestTurn?.state).toBe("interrupted");
    const worktree = toT3Thread(thread({ env: { mode: "worktree", path: "/wt", branch: "feat" } }), []);
    expect(worktree.worktreePath).toBe("/wt");
    expect(worktree.latestTurn).toBeNull();
  });

  it("attaches ledgers with checkpoint turn counts", () => {
    const projected = toT3Thread(
      thread(),
      [turn({ id: "t1" }), turn({ id: "t2" })],
      {
        messages: [{ id: "m1", threadId: "thread-1", turnId: "t1", role: "user", text: "hi", createdAt: "2026-01-01T00:00:00.000Z" }],
        activities: [{ id: "a1", threadId: "thread-1", turnId: "t1", kind: "turn.started", summary: "hi", createdAt: "2026-01-01T00:00:00.000Z" }],
        checkpoints: [{ id: "c1", threadId: "thread-1", turnId: "t2", status: "available", ref: "abc", baseRef: "def", createdAt: "2026-01-01T00:00:00.000Z" }],
      },
    );
    expect(projected.messages?.[0]).toMatchObject({ id: "m1", streaming: false });
    expect(projected.latestUserMessageAt).toBe("2026-01-01T00:00:00.000Z");
    expect(projected.activities?.[0]).toMatchObject({ tone: "info" });
    expect(projected.checkpoints?.[0]).toMatchObject({ turnId: "t2", checkpointTurnCount: 1, ref: "abc" });
  });
});

describe("row projections", () => {
  it("maps messages, activities, and checkpoints", () => {
    expect(
      toT3Message({ id: "m", threadId: "t", turnId: "u", role: "assistant", text: "x", createdAt: "c" }),
    ).toMatchObject({ streaming: false, updatedAt: "c" });
    expect(
      toT3Activity({ id: "a", threadId: "t", turnId: null, kind: "k", summary: "s", createdAt: "c" }),
    ).toMatchObject({ tone: "info", turnId: null });
    expect(
      toT3Checkpoint({ id: "c", threadId: "t", turnId: "u", status: "available", ref: "r", baseRef: "b", createdAt: "c" }, 3),
    ).toMatchObject({ checkpointTurnCount: 3, ref: "r" });
  });
});
