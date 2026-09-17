import { describe, expect, it } from "vitest";

import { findPatchFile, splitPatchByFile, type PatchFile } from "./patch.js";

const PATCH = [
  "diff --git a/src/tui/app.tsx b/src/tui/app.tsx",
  "index 111..222 100644",
  "--- a/src/tui/app.tsx",
  "+++ b/src/tui/app.tsx",
  "@@ -1,2 +1,3 @@",
  " context",
  "-old",
  "+new",
  "+added",
  "diff --git a/src/tui/timeline.tsx b/src/tui/timeline.tsx",
  "index 333..444 100644",
  "--- a/src/tui/timeline.tsx",
  "+++ b/src/tui/timeline.tsx",
  "@@ -5,2 +5,2 @@",
  " context",
  "-gone",
  "+here",
].join("\n");

function files(): PatchFile[] {
  return splitPatchByFile(PATCH);
}

describe("splitPatchByFile", () => {
  it("splits a multi-file patch with per-file counts", () => {
    const split = files();
    expect(split.map((file) => file.path)).toEqual(["src/tui/app.tsx", "src/tui/timeline.tsx"]);
    expect(split[0]).toMatchObject({ additions: 2, deletions: 1, binary: false });
    expect(split[0]?.filetype).toBe("typescript");
  });
});

describe("findPatchFile", () => {
  it("matches exact and shortened row paths by suffix", () => {
    const split = files();
    expect(findPatchFile(split, "src/tui/app.tsx")?.path).toBe("src/tui/app.tsx");
    // Rows render shortened (`tui/app.tsx`); patch headers stay full.
    expect(findPatchFile(split, "tui/app.tsx")?.path).toBe("src/tui/app.tsx");
  });

  it("ignores unresolved and empty paths instead of matching everything", () => {
    const split = files();
    expect(findPatchFile(split, "…")).toBeNull();
    expect(findPatchFile(split, "")).toBeNull();
    expect(findPatchFile(split, "src/tui/missing.ts")).toBeNull();
    expect(findPatchFile([], "src/tui/app.tsx")).toBeNull();
  });
});
