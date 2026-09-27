import { describe, expect, it } from "vitest";

import { applySubagentActivity } from "../subagents.js";
import type { StoredNativeSubagent } from "../types.js";

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
