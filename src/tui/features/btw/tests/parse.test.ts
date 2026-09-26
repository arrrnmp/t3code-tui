import { describe, expect, it } from "vitest";

import { parseSideQuestion } from "../useSideQuestion.js";

describe("parseSideQuestion", () => {
  it("takes the question after /btw, keeping line breaks in it", () => {
    expect(parseSideQuestion("/btw what did we decide about auth?")).toBe("what did we decide about auth?");
    expect(parseSideQuestion("  /btw   spaced  ")).toBe("spaced");
    expect(parseSideQuestion("/btw first\nsecond")).toBe("first\nsecond");
  });

  it("reads a bare /btw as reopening the last answer", () => {
    expect(parseSideQuestion("/btw")).toBe("");
  });

  it("leaves everything else alone, other commands included", () => {
    expect(parseSideQuestion("btw, also do this")).toBeNull();
    expect(parseSideQuestion("/btwx nope")).toBeNull();
    expect(parseSideQuestion("/compact")).toBeNull();
    expect(parseSideQuestion("please /btw later")).toBeNull();
  });
});
