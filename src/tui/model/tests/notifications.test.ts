import { describe, expect, it } from "vitest";

import type { ThreadEnvelope } from "../../../core/types.js";
import { threadAlerts } from "../notifications.js";

function thread(id: string, overrides: Partial<ThreadEnvelope> = {}): ThreadEnvelope {
  return { id, projectId: "p", title: `Thread ${id}`, archivedAt: null, ...overrides } as ThreadEnvelope;
}

const running = (turnId: string): Partial<ThreadEnvelope> => ({
  session: { threadId: "x", status: "running" } as NonNullable<ThreadEnvelope["session"]>,
  latestTurn: { turnId, state: "running", requestedAt: "", startedAt: null, completedAt: null, assistantMessageId: null },
});
const settled = (turnId: string, state: "completed" | "error" | "interrupted"): Partial<ThreadEnvelope> => ({
  session: { threadId: "x", status: "ready" } as NonNullable<ThreadEnvelope["session"]>,
  latestTurn: { turnId, state, requestedAt: "", startedAt: null, completedAt: "", assistantMessageId: null },
});

describe("thread alerts", () => {
  it("says nothing about threads it is seeing for the first time", () => {
    expect(threadAlerts(new Map(), [thread("a", settled("t1", "completed"))]).alerts).toEqual([]);
  });

  it("reports a turn finishing, failing, and not an interruption", () => {
    const first = threadAlerts(new Map(), [thread("a", running("t1")), thread("b", running("t2")), thread("c", running("t3"))]);
    const second = threadAlerts(first.next, [
      thread("a", settled("t1", "completed")),
      thread("b", settled("t2", "error")),
      thread("c", settled("t3", "interrupted")),
    ]);
    expect(second.alerts).toEqual([
      { kind: "finished", threadId: "a", title: "Thread a" },
      { kind: "failed", threadId: "b", title: "Thread b" },
    ]);
    // Nothing changed since: nothing new to say.
    expect(threadAlerts(second.next, [thread("a", settled("t1", "completed"))]).alerts).toEqual([]);
  });

  it("catches a whole turn that ran between two snapshots", () => {
    const first = threadAlerts(new Map(), [thread("a", settled("t1", "completed"))]);
    expect(threadAlerts(first.next, [thread("a", settled("t2", "completed"))]).alerts).toEqual([
      { kind: "finished", threadId: "a", title: "Thread a" },
    ]);
  });

  it("reports a usage limit stopping a thread", () => {
    const first = threadAlerts(new Map(), [thread("a", running("t1"))]);
    const blocked = thread("a", {
      ...settled("t1", "error"),
      session: { threadId: "a", status: "error", lastError: "Claude usage limit reached" } as NonNullable<ThreadEnvelope["session"]>,
    });
    expect(threadAlerts(first.next, [blocked]).alerts).toEqual([{ kind: "blocked", threadId: "a", title: "Thread a" }]);
  });
});
