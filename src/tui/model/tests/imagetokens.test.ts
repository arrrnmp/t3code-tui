import { describe, expect, it } from "vitest";

import { nextImageLabel, pairImageTokens, relabelImageTokens } from "../imagetokens.js";

describe("image tokens", () => {
  it("numbers the next image past the highest in use, gaps and all", () => {
    expect(nextImageLabel([])).toBe("[Image #1]");
    expect(nextImageLabel(["[Image #1]", "[Image #3]"])).toBe("[Image #4]");
    // Drafts saved with the older forms still count.
    expect(nextImageLabel(["[Image 2]"])).toBe("[Image #3]");
    expect(nextImageLabel(["⟦Image#5⟧"])).toBe("[Image #6]");
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
    expect(pairImageTokens("see ⟦Image#1⟧", ["a.png"]).paired).toEqual([{ name: "a.png", label: "⟦Image#1⟧", start: 4, end: 13 }]);
  });
});

describe("relabelImageTokens", () => {
  it("renumbers a pasted copy's tokens past the draft's and pairs them with the re-attached images", () => {
    const result = relabelImageTokens("see [Image #1] then [Image #2]", ["a.png", "b.png"], ["[Image #1]"]);
    expect(result.text).toBe("see [Image #2] then [Image #3]");
    expect(result.spans).toEqual([
      { name: "a.png", label: "[Image #2]", start: 4, end: 14 },
      { name: "b.png", label: "[Image #3]", start: 20, end: 30 },
    ]);
    // More tokens than images: the rest stay as they were.
    expect(relabelImageTokens("[Image #1] [Image #2]", ["a.png"], []).text).toBe("[Image #1] [Image #2]");
  });
});
