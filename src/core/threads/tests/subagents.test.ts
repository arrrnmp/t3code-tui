import { describe, expect, it } from "vitest";

import { applySubagentActivity, subagentTranscript } from "../subagents.js";
import type { ThreadStore } from "../store.js";
import type { StoredNativeSubagent, StoredThread } from "../types.js";

const at = (second: number) => `2026-09-25T10:00:${String(second).padStart(2, "0")}.000Z`;
const fold = (rows: { kind: string; payload: Record<string, unknown>; createdAt: string }[]) =>
  rows.reduce<StoredNativeSubagent[]>((list, row) => applySubagentActivity(list, row) ?? list, []);

describe("native subagents on the thread record", () => {
  it("follows a background subagent from its task and hook rows", () => {
    const list = fold([
      { kind: "background.started", payload: { taskId: "ag", taskType: "local_agent", description: "Count TODOs" }, createdAt: at(1) },
      { kind: "subagent", payload: { agentId: "ag", agentType: "Explore", status: "started" }, createdAt: at(1) },
      { kind: "background.completed", payload: { taskId: "ag", status: "completed" }, createdAt: at(14) },
    ]);
    expect(list).toEqual([
      { agentId: "ag", agentType: "Explore", description: "Count TODOs", status: "completed", startedAt: at(1), stoppedAt: at(14) },
    ]);
  });

  it("follows a foreground one from its hooks, and ignores internal agents and shells", () => {
    const list = fold([
      { kind: "subagent", payload: { agentId: "fg", agentType: "Plan", status: "started" }, createdAt: at(1) },
      { kind: "subagent", payload: { agentId: "fg", agentType: "Plan", status: "stopped" }, createdAt: at(5) },
      // A prompt suggestion: a stop with no start.
      { kind: "subagent", payload: { agentId: "ps", agentType: "agent", status: "stopped" }, createdAt: at(6) },
      { kind: "background.started", payload: { taskId: "sh", taskType: "local_bash", description: "tail -f log" }, createdAt: at(7) },
    ]);
    expect(list.map((entry) => [entry.agentId, entry.status])).toEqual([["fg", "completed"]]);
  });

  it("takes the description an OpenCode subagent starts with", () => {
    const list = fold([
      { kind: "subagent", payload: { agentId: "ses_child", agentType: "explore", status: "started", description: "Map auth" }, createdAt: at(1) },
      { kind: "subagent", payload: { agentId: "ses_child", agentType: "explore", status: "stopped", lastMessage: "Done" }, createdAt: at(9) },
    ]);
    expect(list).toEqual([
      { agentId: "ses_child", agentType: "explore", description: "Map auth", status: "completed", startedAt: at(1), stoppedAt: at(9) },
    ]);
  });

  it("keeps every running one and only the latest finished", () => {
    const rows = Array.from({ length: 8 }, (_, index) => [
      { kind: "subagent", payload: { agentId: `a${index}`, agentType: "Explore", status: "started" }, createdAt: at(index * 2) },
      ...(index === 0 ? [] : [{ kind: "subagent", payload: { agentId: `a${index}`, agentType: "Explore", status: "stopped" }, createdAt: at(index * 2 + 1) }]),
    ]).flat();
    const list = fold(rows);
    expect(list).toHaveLength(6);
    // a0 never stopped: it stays, however old.
    expect(list.map((entry) => entry.agentId)).toEqual(["a0", "a3", "a4", "a5", "a6", "a7"]);
  });
});

describe("subagentTranscript", () => {
  const thread = {
    id: "thread-1",
    createdAt: at(0),
    providerSessions: { opencode: "ses_parent" },
    nativeSubagents: [{ agentId: "ses_child", agentType: "explore", description: "Map auth", status: "completed", startedAt: at(1), stoppedAt: at(9) }],
    env: { path: "/repo" },
  } as unknown as StoredThread;
  const store = { readThreadRecord: async () => thread } as unknown as ThreadStore;

  it("builds an OpenCode subagent's turn from the history its live driver reads", async () => {
    const transcript = await subagentTranscript(store, "thread-1", "ses_child", async (agentId) => {
      expect(agentId).toBe("ses_child");
      return [
        { kind: "prompt", id: "u1", at: at(1), text: "Map auth" },
        { kind: "reasoning", id: "r1", at: at(2), text: "Grep first." },
        {
          kind: "tool",
          id: "call_grep",
          at: at(3),
          tool: "grep",
          raw: { id: "call_grep", callID: "call_grep", type: "tool", tool: "grep", state: { status: "completed", input: { pattern: "auth", path: "/repo/src" }, output: "Found 2 matches" } },
        },
        { kind: "text", id: "t1", at: at(4), text: "Auth lives in src/auth.ts" },
      ];
    });
    expect(transcript.available).toBe(true);
    expect(transcript.agent?.agentId).toBe("ses_child");
    expect(transcript.messages).toMatchObject([
      { role: "user", text: "Map auth", origin: "subagent-prompt", turnId: "subagent:ses_child" },
      { role: "assistant", text: "Auth lives in src/auth.ts" },
    ]);
    expect(transcript.activities).toMatchObject([
      { kind: "reasoning", payload: { text: "Grep first." } },
      { kind: "tool-call.completed", summary: "grep /repo/src", payload: { toolCallId: "call_grep", status: "completed" } },
    ]);
  });

  it("is unavailable when the driver cannot read it (no live session)", async () => {
    expect(await subagentTranscript(store, "thread-1", "ses_child", async () => null)).toMatchObject({ available: false, messages: [] });
    expect(await subagentTranscript(store, "thread-1", "ses_child")).toMatchObject({ available: false });
  });
});
