import { describe, expect, it } from "vitest";

import type { T3Thread } from "../../../types.js";
import { isSettledThread, threadStatus } from "../shell.js";

function thread(overrides: Partial<T3Thread> = {}): T3Thread {
  return {
    id: "t-1",
    projectId: "p-1",
    title: "thread",
    archivedAt: null,
    ...overrides,
  };
}

describe("isSettledThread", () => {
  it("settles on the override alone (wire shape with no settledAt)", () => {
    expect(isSettledThread(thread({ settledOverride: "settled" }))).toBe(true);
  });

  it("settles on settledAt alone (server projection without the override)", () => {
    expect(isSettledThread(thread({ settledAt: "2026-09-16T01:00:00.000Z" }))).toBe(true);
  });

  it("reopens when unsettledAt is later than settledAt", () => {
    expect(
      isSettledThread(
        thread({ settledAt: "2026-09-16T01:00:00.000Z", unsettledAt: "2026-09-16T02:00:00.000Z" }),
      ),
    ).toBe(false);
  });

  it("reopens on an explicit active override even with settledAt set", () => {
    expect(
      isSettledThread(thread({ settledAt: "2026-09-16T01:00:00.000Z", settledOverride: "active" })),
    ).toBe(false);
  });

  it("is active with neither signal", () => {
    expect(isSettledThread(thread())).toBe(false);
  });
});

describe("threadStatus", () => {
  it("keeps settledAt-projected threads out of the active list", () => {
    expect(threadStatus(thread({ settledAt: "2026-09-16T01:00:00.000Z" }), Date.now())).toBe("settled");
  });

  it("lets settlement beat snooze and stale usage-limit errors", () => {
    const snoozed = thread({
      settledOverride: "settled",
      snoozedUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(threadStatus(snoozed, Date.now())).toBe("settled");
    const blocked = thread({
      settledOverride: "settled",
      session: {
        threadId: "t-1",
        status: "stopped",
        providerName: null,
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: "Claude usage limit reached.",
        updatedAt: new Date().toISOString(),
      },
    });
    expect(threadStatus(blocked, Date.now())).toBe("settled");
  });

  it("still reads a live session as running even on a settled thread", () => {
    const running = thread({
      settledOverride: "settled",
      session: {
        threadId: "t-1",
        status: "running",
        providerName: null,
        runtimeMode: "full-access",
        activeTurnId: "turn-1",
        lastError: null,
        updatedAt: new Date().toISOString(),
      },
    });
    expect(threadStatus(running, Date.now())).toBe("running");
  });
});
