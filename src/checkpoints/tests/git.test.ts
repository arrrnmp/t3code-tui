import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureWorktree,
  checkpointRef,
  diffCheckpointRange,
  diffCheckpointStat,
  pinCheckpointRef,
  pruneCheckpointRefs,
  restoreWorktree,
} from "../git.js";

const GIT_AVAILABLE = (() => {
  try {
    return spawnSync("git", ["--version"], { timeout: 10_000 }).status === 0;
  } catch {
    return false;
  }
})();

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, timeout: 15_000, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "t3code-checkpoints-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(dir, "file.txt"), "one\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("checkpointRef", () => {
  it("namespaces and sanitizes thread/turn ids", () => {
    expect(checkpointRef("thread-1", "turn-1")).toBe("refs/t3code/checkpoints/thread-1/turn-1/post");
    expect(checkpointRef("thread-1", "turn-1", "pre")).toBe("refs/t3code/checkpoints/thread-1/turn-1/pre");
    expect(checkpointRef("a/b", "c d")).toBe("refs/t3code/checkpoints/a-b/c-d/post");
  });
});

describe.runIf(GIT_AVAILABLE)("git checkpoints", () => {
  it("captures, diffs, restores, and prunes", async () => {
    const dir = await initRepo();
    await writeFile(path.join(dir, "file.txt"), "one\ntwo\n");
    const pre = await captureWorktree(dir, "pre");
    expect(pre).toMatch(/^[0-9a-f]{40}$/);

    await writeFile(path.join(dir, "file.txt"), "one\ntwo\nthree\n");
    const post = await captureWorktree(dir, "post");
    expect(post).toMatch(/^[0-9a-f]{40}$/);
    expect(post).not.toBe(pre);

    expect(await pinCheckpointRef("thread-1", "turn-1", pre!, dir, "pre")).toBe(true);
    expect(await pinCheckpointRef("thread-1", "turn-1", post!, dir, "post")).toBe(true);

    const diff = await diffCheckpointRange(dir, pre!, post!);
    expect(diff).toContain("+three");
    const stat = await diffCheckpointStat(dir, pre!, post!);
    expect(stat).toEqual([{ path: "file.txt", additions: 1, deletions: 0 }]);

    await writeFile(path.join(dir, "file.txt"), "changed\n");
    expect(await restoreWorktree(dir, pre!)).toBe(true);
    const restored = await import("node:fs/promises").then((fs) => fs.readFile(path.join(dir, "file.txt"), "utf8"));
    expect(restored).toBe("one\ntwo\n");

    await pinCheckpointRef("thread-1", "turn-2", post!, dir, "post");
    await pruneCheckpointRefs(dir, "thread-1", ["turn-2"]);
    const refs = spawnSync("git", ["for-each-ref", "--format=%(refname)", "refs/t3code/checkpoints/"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout;
    expect(refs).not.toContain("turn-1");
    expect(refs).toContain("turn-2/post");
  });

  it("returns null outside git repos", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "t3code-nogit-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    expect(await captureWorktree(dir, "msg")).toBeNull();
    expect(await diffCheckpointRange(dir, "a", "b")).toBeNull();
    expect(await restoreWorktree(dir, "a")).toBe(false);
  });
});
