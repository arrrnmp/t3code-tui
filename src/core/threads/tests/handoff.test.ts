import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildHandoff, continuedTitle } from "../handoff.js";
import { openThreadStore } from "../store.js";
import { completeTurn, createThread, failTurn, sendTurn } from "../threads.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

async function thread() {
  const root = await mkdtemp(path.join(os.tmpdir(), "moxen-handoff-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = await openThreadStore(root);
  const created = await createThread(store, {
    projectId: "p",
    title: "Auth audit",
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
    env: { mode: "worktree", path: path.join(root, "wt"), branch: "moxen/auth" },
  });
  return { store, threadId: created.id };
}

describe("buildHandoff", () => {
  it("leads with where it stopped, then what is on disk, then the conversation", async () => {
    const { store, threadId } = await thread();
    const first = await sendTurn(store, threadId, { prompt: "Audit every route for missing auth checks." });
    await store.appendLedger(threadId, "activity", {
      id: "a1",
      threadId,
      turnId: first.turn.id,
      kind: "tool.completed",
      summary: "$ rg requireAuth src/routes",
      payload: { toolCallId: "call-1", status: "completed" },
      createdAt: store.nowIso(),
    });
    await store.appendLedger(threadId, "checkpoints", {
      id: "c1",
      threadId,
      turnId: first.turn.id,
      status: "available",
      ref: "b",
      baseRef: "a",
      files: [{ path: "src/routes/admin.ts", additions: 12, deletions: 3 }],
      createdAt: store.nowIso(),
    });
    await completeTurn(store, threadId, first.turn.id, { text: "Found two routes without checks; fixed admin.ts." });
    const second = await sendTurn(store, threadId, { prompt: "Now fix users.ts too." });
    await store.appendLedger(threadId, "activity", {
      id: "l1",
      threadId,
      turnId: second.turn.id,
      kind: "usage.limit",
      summary: "Usage limit reached",
      payload: { label: "Session", resetsAt: "2026-09-26T15:00:00.000Z" },
      createdAt: store.nowIso(),
    });
    await failTurn(store, threadId, second.turn.id, { error: "You've hit your session limit" });
    await sendTurn(store, threadId, { prompt: "And add a test for it.", delivery: "queue" });

    const doc = await buildHandoff(store, threadId, { projectTitle: "moxen" });

    expect(doc.startsWith("# Continuing: Auth audit")).toBe(true);
    expect(doc).toContain("(branch moxen/auth)");
    expect(doc).toContain("- Project: moxen");
    expect(doc).toContain("claudeAgent/claude-opus-5");
    // The reason reads as the limit, not as the bare provider error.
    expect(doc).toContain("stopped on a plan usage limit (Session window)");
    expect(doc).toContain("The last request, verbatim:\n\nNow fix users.ts too.");
    expect(doc).toContain("The thread began with:");
    // A queued message that never went out is part of the task.
    expect(doc).toContain("never sent");
    expect(doc).toContain("1. And add a test for it.");
    expect(doc).toContain("- src/routes/admin.ts +12 −3");
    expect(doc).toContain("- $ rg requireAuth src/routes");
    expect(doc).toContain("Found two routes without checks; fixed admin.ts.");
    // Order: the reader needs where it stopped before the history.
    expect(doc.indexOf("## Where it stopped")).toBeLessThan(doc.indexOf("## Files already changed"));
    expect(doc.indexOf("## Files already changed")).toBeLessThan(doc.indexOf("## Conversation"));
    expect(doc.trimEnd().endsWith("then finish what is left.")).toBe(true);
  });

  it("shrinks older turns to one line each when the thread is long", async () => {
    const { store, threadId } = await thread();
    for (let index = 0; index < 20; index += 1) {
      const sent = await sendTurn(store, threadId, { prompt: `Step ${index}: ${"detail ".repeat(20)}` });
      await completeTurn(store, threadId, sent.turn.id, { text: `Done with step ${index}.` });
    }
    const doc = await buildHandoff(store, threadId);
    expect(doc).toContain("Earlier turns, in brief:");
    expect(doc).toContain('- Turn 1: asked "Step 0:');
    // The latest turns stay word for word.
    expect(doc).toContain("### Turn 20");
    expect(doc).toContain("Done with step 19.");
    expect(doc).not.toContain("### Turn 1\n");
  });

  it("says so for a thread that never ran", async () => {
    const { store, threadId } = await thread();
    expect(await buildHandoff(store, threadId)).toContain("had not run a turn yet");
  });
});

describe("continuedTitle", () => {
  it("marks the title once, then numbers further continuations", () => {
    expect(continuedTitle("Auth audit")).toBe("Auth audit (continued)");
    expect(continuedTitle("Auth audit (continued)")).toBe("Auth audit (continued 2)");
    expect(continuedTitle("Auth audit (continued 2)")).toBe("Auth audit (continued 3)");
  });
});
