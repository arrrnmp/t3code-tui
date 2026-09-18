import { describe, expect, it } from "vitest";

import type { T3Thread } from "../../../types.js";
import type { ShellState } from "../shell.js";
import { buildSidebarSections } from "../sidebar.js";

const NOW = Date.parse("2026-09-16T03:30:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function thread(id: string, extra: Partial<T3Thread> = {}): T3Thread {
  return {
    id,
    projectId: "p1",
    title: id,
    archivedAt: null,
    updatedAt: ago(60_000),
    ...extra,
  };
}

function shellWith(threads: T3Thread[]): ShellState {
  return {
    snapshotSequence: 1,
    projects: [{ id: "p1", title: "demo", workspaceRoot: "/repo", defaultModelSelection: null }],
    threads,
    synchronized: true,
    unhandled: {},
  };
}

describe("buildSidebarSections", () => {
  it("sorts active threads by latest activity first", () => {
    const sections = buildSidebarSections(
      shellWith([thread("old", { updatedAt: ago(3_600_000) }), thread("new", { updatedAt: ago(60_000) })]),
      { settledExpanded: false, settledLimit: 10, now: NOW },
    );
    expect(sections.active.map((row) => row.thread.id)).toEqual(["new", "old"]);
  });

  it("ages running threads from the turn start, not the last message", () => {
    const sections = buildSidebarSections(
      shellWith([
        thread("running", {
          updatedAt: ago(5_000),
          latestUserMessageAt: ago(5_000),
          session: {
            threadId: "running",
            status: "running",
            providerName: null,
            runtimeMode: "full-access",
            activeTurnId: "turn-9",
            lastError: null,
            updatedAt: ago(5_000),
          },
          latestTurn: {
            turnId: "turn-9",
            state: "running",
            requestedAt: ago(5 * 60_000),
            startedAt: ago(5 * 60_000),
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      ]),
      { settledExpanded: false, settledLimit: 10, now: NOW },
    );
    expect(sections.active[0]?.age).toBe("5m");
    expect(sections.active[0]?.status).toBe("running");
  });

  it("ages idle threads from their latest activity", () => {
    const sections = buildSidebarSections(shellWith([thread("idle", { updatedAt: ago(14 * 60_000) })]), {
      settledExpanded: false,
      settledLimit: 10,
      now: NOW,
    });
    expect(sections.active[0]?.age).toBe("14m");
  });

  it("filters the settled section to the selected project in project mode", () => {
    const shell: ShellState = {
      snapshotSequence: 1,
      projects: [
        { id: "p1", title: "demo one", workspaceRoot: "/repo1", defaultModelSelection: null },
        { id: "p2", title: "demo two", workspaceRoot: "/repo2", defaultModelSelection: null },
      ],
      threads: [
        thread("p1-settled", { projectId: "p1", settledOverride: "settled" }),
        thread("p2-settled", { projectId: "p2", settledOverride: "settled" }),
      ],
      synchronized: true,
      unhandled: {},
    };
    const sections = buildSidebarSections(shell, {
      settledExpanded: true,
      settledLimit: 10,
      now: NOW,
      mode: "project",
      projectId: "p1",
    });
    expect(sections.settledTotal).toBe(1);
    expect(sections.settled.map((row) => row.thread.id)).toEqual(["p1-settled"]);
  });

  it("marks threads with pending input or approvals as waiting", () => {
    const sections = buildSidebarSections(
      shellWith([
        thread("plain"),
        thread("question", { hasPendingUserInput: true }),
        thread("approval", { hasPendingApprovals: true }),
      ]),
      { settledExpanded: false, settledLimit: 10, now: NOW },
    );
    const waiting = new Map(sections.active.map((row) => [row.thread.id, row.waiting]));
    expect(waiting.get("plain")).toBe(false);
    expect(waiting.get("question")).toBe(true);
    expect(waiting.get("approval")).toBe(true);
  });
});
