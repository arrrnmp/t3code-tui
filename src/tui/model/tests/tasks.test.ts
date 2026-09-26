import { describe, expect, it } from "vitest";

import { taskCounts, taskWindow, type TaskItem } from "../tasks.js";

function list(statuses: string[]): TaskItem[] {
  return statuses.map((status, index) => ({ content: `step ${index + 1}`, status }));
}

describe("tasks panel window", () => {
  it("shows everything while it fits", () => {
    expect(taskWindow(list(["completed", "inProgress", "pending"]), 8)).toEqual({ start: 0, end: 3 });
  });

  it("follows the step in progress, one row of context above it", () => {
    // Step 7 (index 6) is running in a 16-step list: rows 6–13 show, step 6 above it for context.
    const items = list([...Array(6).fill("completed"), "inProgress", ...Array(9).fill("pending")]);
    expect(taskWindow(items, 8)).toEqual({ start: 5, end: 13 });
  });

  it("never runs past the end, and rests on the next open step when none is in progress", () => {
    const nearEnd = list([...Array(10).fill("completed"), "inProgress", "pending"]);
    expect(taskWindow(nearEnd, 8)).toEqual({ start: 4, end: 12 });
    const between = list([...Array(3).fill("completed"), ...Array(9).fill("pending")]);
    expect(taskWindow(between, 8)).toEqual({ start: 2, end: 10 });
    const allDone = list(Array(12).fill("completed"));
    expect(taskWindow(allDone, 8)).toEqual({ start: 4, end: 12 });
  });

  it("counts done, in progress and open separately", () => {
    expect(taskCounts(list(["completed", "completed", "inProgress", "pending", "pending", "pending"]))).toEqual({
      done: 2,
      inProgress: 1,
      open: 3,
    });
  });
});
