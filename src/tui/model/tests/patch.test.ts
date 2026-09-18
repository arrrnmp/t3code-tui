import { describe, expect, it } from "vitest";

import { detectFiletype, findPatchFile, splitPatchByFile, type PatchFile } from "../patch.js";

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

describe("detectFiletype", () => {
  it.each([
    ["Main.kt", "kotlin"],
    ["build.kts", "kotlin"],
    ["data.json", "json"],
    ["tsconfig.jsonc", "json"],
    ["config.toml", "toml"],
    ["app.py", "python"],
    ["types.pyi", "python"],
    ["main.rs", "rust"],
    ["main.go", "go"],
    ["Main.java", "java"],
    ["app.rb", "ruby"],
    ["index.php", "php"],
    ["run.sh", "bash"],
    ["run.zsh", "bash"],
    ["style.css", "css"],
    ["index.html", "html"],
    ["main.c", "c"],
    ["lib.hpp", "cpp"],
    ["lib.cc", "cpp"],
  ])("maps %s to %s", (file, expected) => {
    expect(detectFiletype(file)).toBe(expected);
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
