import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RESEARCH_GUIDANCE, buildRuntimeInstructions, harnessName, projectInstructions } from "../instructions.js";

const LOCAL = { mode: "local" as const, path: "/repo", branch: "main" };
const WORKTREE = { mode: "worktree" as const, path: "/store/worktrees/t1", branch: "moxen/t1" };
const CLAUDE = "claudeAgent";

describe("runtime instructions", () => {
  it("tells every session it runs through Moxen, in its own harness, and names no model", () => {
    const text = buildRuntimeInstructions({ instanceId: CLAUDE, env: LOCAL });
    expect(text).toBe(
      "In case you're asked: you are running in Moxen, a terminal app that runs coding agents as threads, " +
        "through the Claude Code harness. No need to mention this otherwise.\n\n" +
        RESEARCH_GUIDANCE,
    );
    expect(RESEARCH_GUIDANCE).toContain("read the official documentation");
    expect(buildRuntimeInstructions({ instanceId: "opencode/anthropic", env: LOCAL, userInstructions: ["  ", ""] })).toContain(
      "through the OpenCode harness.",
    );
  });

  it("names each provider's harness the way its users do", () => {
    expect(harnessName("claudeAgent")).toBe("Claude Code");
    expect(harnessName("codex")).toBe("Codex");
    expect(harnessName("grok")).toBe("Grok");
    expect(harnessName("opencode/openai")).toBe("OpenCode");
    expect(harnessName("somethingNew")).toBe("somethingNew");
  });

  it("tells a worktree session where it runs", () => {
    const text = buildRuntimeInstructions({ instanceId: CLAUDE, env: WORKTREE });
    expect(text).toContain("/store/worktrees/t1");
    expect(text).toContain("moxen/t1");
  });

  it("tells a delegated task it reports back, and where to commit in its own worktree", () => {
    const text = buildRuntimeInstructions({
      instanceId: CLAUDE,
      env: WORKTREE,
      delegation: { parentTitle: "Release prep", baseBranch: "main" },
    });
    expect(text).toContain('"Release prep"');
    expect(text).toContain("self-contained report");
    expect(text).toContain("cut from main");
    expect(text).toContain("Commit your work on moxen/t1");
  });

  it("warns a delegated task that shares the checkout", () => {
    const text = buildRuntimeInstructions({ instanceId: CLAUDE, env: LOCAL, delegation: { parentTitle: "P", baseBranch: null } });
    expect(text).toContain("share the other agent's checkout");
    expect(text).not.toContain("Commit your work");
  });

  it("appends the user's instructions, config first then project", () => {
    const text = buildRuntimeInstructions({ instanceId: CLAUDE, env: WORKTREE, userInstructions: ["Use pnpm.", "Never push."] });
    expect(text.indexOf("running in Moxen")).toBeLessThan(text.indexOf("moxen/t1"));
    expect(text.indexOf("moxen/t1")).toBeLessThan(text.indexOf("Use pnpm."));
    expect(text.indexOf("Use pnpm.")).toBeLessThan(text.indexOf("Never push."));
  });

  it("reads moxen.json instructions as a string or a list of lines", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "moxen-instr-"));
    try {
      expect(await projectInstructions(dir)).toBeNull();
      await writeFile(path.join(dir, "moxen.json"), JSON.stringify({ instructions: "One rule." }));
      expect(await projectInstructions(dir)).toBe("One rule.");
      await writeFile(path.join(dir, "moxen.json"), JSON.stringify({ instructions: ["A.", "B."] }));
      expect(await projectInstructions(dir)).toBe("A.\nB.");
      await writeFile(path.join(dir, "moxen.json"), "{ not json");
      expect(await projectInstructions(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
