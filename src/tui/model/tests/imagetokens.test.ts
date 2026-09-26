import { describe, expect, it } from "vitest";

import { nextImageLabel, pairImageTokens } from "../imagetokens.js";

describe("image tokens", () => {
  it("numbers the next image past the highest in use, gaps and all", () => {
    expect(nextImageLabel([])).toBe("[Image 1]");
    expect(nextImageLabel(["[Image 1]", "[Image 3]"])).toBe("[Image 4]");
  });

  it("pairs a restored draft's tokens with the pending attachments, in order", () => {
    const text = "look at [Image 1] and [Image 2] please";
    expect(pairImageTokens(text, ["a.png", "b.png", "c.png"])).toEqual({
      paired: [
        { name: "a.png", label: "[Image 1]", start: 8, end: 17 },
        { name: "b.png", label: "[Image 2]", start: 22, end: 31 },
      ],
      unpaired: ["c.png"],
    });
    expect(pairImageTokens("[Image 1] [Image 2]", ["a.png"]).paired).toHaveLength(1);
  });
});
