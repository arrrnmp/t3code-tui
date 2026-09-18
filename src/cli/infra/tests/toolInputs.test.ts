import { describe, expect, it } from "vitest";

import { readCompletedToolInputs } from "../toolInputs.js";

function row(toolCallId: string, input: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  return {
    activity_id: `a-${toolCallId}`,
    payload_json: JSON.stringify({
      itemType: "file_change",
      toolCallId,
      status: "completed",
      title: "File change",
      data: {
        toolName: "Edit",
        ...(input === null ? {} : { state: { status: "completed", input } }),
        ...extra,
      },
    }),
  };
}

describe("readCompletedToolInputs", () => {
  it("maps tool calls to their full inputs, skipping empties", async () => {
    const found = await readCompletedToolInputs(
      "/state",
      "thread-1",
      async () =>
        ({
          stdout: JSON.stringify([
            row("call-1", { file_path: "/repo/a.ts", old_string: "a", new_string: "b" }),
            row("call-2", {}),
            row("call-3", null),
          ]),
        }),
    );
    expect(found?.get("call-1")).toMatchObject({ file_path: "/repo/a.ts" });
    expect(found?.has("call-2")).toBe(false);
    expect(found?.has("call-3")).toBe(false);
  });

  it("returns null when the database is unavailable or the ids are suspect", async () => {
    await expect(readCompletedToolInputs("/state", "thread-1", async () => ({ stdout: "not json" }))).resolves.toBeNull();
    await expect(
      readCompletedToolInputs("/state", "thread-1", async () => {
        throw new Error("no sqlite3");
      }),
    ).resolves.toBeNull();
    await expect(readCompletedToolInputs("/state", "../../etc", async () => ({ stdout: "[]" }))).resolves.toBeNull();
  });
});
