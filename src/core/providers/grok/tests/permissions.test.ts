import { describe, expect, it } from "vitest";

import {
  readPermissionOptions,
  selectGrokPermissionOptionId,
  selectGrokRejectOptionId,
} from "../permissions.js";

const OPTIONS = [
  { optionId: "once", kind: "allow_once" },
  { optionId: "always", kind: "allow_always" },
  { optionId: "no", kind: "reject_once" },
];

describe("grok permissions", () => {
  it("prefers allow_once for accept and allow_always for sessions", () => {
    expect(selectGrokPermissionOptionId(OPTIONS, "accept")).toBe("once");
    expect(selectGrokPermissionOptionId(OPTIONS, "acceptForSession")).toBe("always");
  });

  it("falls back to allow_once when the agent omits allow_always", () => {
    const without = [{ optionId: "once", kind: "allow_once" }];
    expect(selectGrokPermissionOptionId(without, "acceptForSession")).toBe("once");
    expect(selectGrokPermissionOptionId([], "accept")).toBeNull();
  });

  it("selects reject options and parses raw lists", () => {
    expect(selectGrokRejectOptionId(OPTIONS)).toBe("no");
    expect(selectGrokRejectOptionId([])).toBeNull();
    expect(
      readPermissionOptions([
        { optionId: "a", kind: "allow_once", name: "Allow" },
        { optionId: 1, kind: "x" },
        null,
      ]),
    ).toEqual([{ optionId: "a", kind: "allow_once" }]);
  });
});
