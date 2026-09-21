import { describe, expect, it } from "vitest";

import type { StoredTurn } from "../../threads/types.js";
import { emptyUsageTotals, summarizeUsage } from "../usage.js";

function turn(usage: StoredTurn["usage"]): StoredTurn {
  return {
    id: "t",
    threadId: "th",
    status: "completed",
    delivery: "started",
    messageId: "m",
    runtimeMode: "full-access",
    interactionMode: "default",
    modelSelection: null,
    parentTurnId: null,
    error: null,
    usage,
    createdAt: "c",
    updatedAt: "c",
    completedAt: "c",
  };
}

describe("summarizeUsage", () => {
  it("sums reported turns and skips silent ones", () => {
    expect(summarizeUsage([])).toEqual(emptyUsageTotals());
    expect(
      summarizeUsage([
        turn({ input: 10, cacheRead: 1, cacheCreate: 2, output: 5, thinking: 3 }),
        turn(null),
        turn({ input: 1, cacheRead: 0, cacheCreate: 0, output: 1, thinking: 0 }),
      ]),
    ).toEqual({ input: 11, cacheRead: 1, cacheCreate: 2, output: 6, thinking: 3, turns: 2 });
  });
});
