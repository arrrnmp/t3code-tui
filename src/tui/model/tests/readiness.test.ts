import { describe, expect, it } from "vitest";

import type { T3Thread } from "../../../types.js";
import { emptyShellState, type ShellState } from "../shell.js";
import { emptyThreadState, type ThreadState } from "../thread.js";
import { bootLoadingStage, isBootReady } from "../readiness.js";

function syncedShell(): ShellState {
  return { ...emptyShellState(), synchronized: true };
}

function shellWithThread(): ShellState {
  const thread: T3Thread = {
    id: "t-1",
    projectId: "p1",
    title: "t-1",
    archivedAt: null,
    updatedAt: new Date(0).toISOString(),
  };
  return { ...emptyShellState(), synchronized: true, threads: [thread] };
}

function syncedThread(): ThreadState {
  return { ...emptyThreadState(), synchronized: true };
}

describe("isBootReady", () => {
  it("holds the gate until the shell snapshot lands", () => {
    expect(isBootReady(emptyShellState(), null, emptyThreadState())).toBe(false);
  });

  it("passes with no thread picked once the shell is synchronized (empty workspace routes to creating)", () => {
    expect(isBootReady(syncedShell(), null, emptyThreadState())).toBe(true);
  });

  it("holds while launch-selection still has a thread to pick", () => {
    expect(isBootReady(shellWithThread(), null, emptyThreadState())).toBe(false);
  });

  it("holds on the transcript leg until the picked thread synchronizes", () => {
    expect(isBootReady(syncedShell(), "t-1", emptyThreadState())).toBe(false);
    expect(isBootReady(syncedShell(), "t-1", syncedThread())).toBe(true);
  });
});

describe("bootLoadingStage", () => {
  it("names the threads leg before the shell lands and the transcript leg after", () => {
    expect(bootLoadingStage(emptyShellState())).toBe("threads");
    expect(bootLoadingStage(syncedShell())).toBe("transcript");
  });
});
