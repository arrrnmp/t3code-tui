import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gitRoot, readBranches, readCommits, readOverview, readStatus } from "../history.js";

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
  const dir = await mkdtemp(path.join(os.tmpdir(), "moxen-githistory-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  git(dir, ["init", "--initial-branch=main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

async function commit(dir: string, file: string, body: string, subject: string): Promise<void> {
  await writeFile(path.join(dir, file), body, "utf8");
  git(dir, ["add", "--all"]);
  git(dir, ["commit", "-m", subject]);
}

describe.runIf(GIT_AVAILABLE)("git history", () => {
  it("reads nothing at all outside a repository", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "moxen-nogit-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    expect(await gitRoot(dir)).toBeNull();
    expect(await readCommits(dir)).toEqual([]);
    expect(await readBranches(dir)).toEqual([]);
    const overview = await readOverview(dir);
    expect(overview).toMatchObject({ isRepository: false, root: null, status: null, branch: null });
  });

  it("reads commits newest first, with their refs", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "one", "first commit");
    await commit(dir, "b.txt", "two", "second commit");
    const commits = await readCommits(dir);
    expect(commits.map((entry) => entry.subject)).toEqual(["second commit", "first commit"]);
    expect(commits[0]?.author).toBe("test");
    expect(commits[0]?.refs).toContain("main");
    expect(commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0]?.shortSha.length).toBeGreaterThan(3);
    expect(Number.isFinite(Date.parse(commits[0]?.date ?? ""))).toBe(true);
  });

  it("survives a subject containing the delimiters and newlines", async () => {
    // The whole reason the format uses unit/record separators: a subject
    // with tabs, pipes and commas must not split into extra fields.
    const dir = await initRepo();
    await commit(dir, "a.txt", "one", "fix: a\tb | c, d — and \"quotes\"");
    const commits = await readCommits(dir);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.subject).toBe('fix: a\tb | c, d — and "quotes"');
  });

  it("honours the limit and reads one branch at a time", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "one", "on main");
    git(dir, ["checkout", "-b", "side"]);
    await commit(dir, "b.txt", "two", "on side");
    expect((await readCommits(dir, { limit: 1 })).map((entry) => entry.subject)).toEqual(["on side"]);
    expect((await readCommits(dir, { branch: "main" })).map((entry) => entry.subject)).toEqual(["on main"]);
  });

  it("reads a branch whose name also names a file", async () => {
    // `git log foo` is ambiguous when a path `foo` exists; the reader
    // passes `--` so the name is always taken as a revision.
    const dir = await initRepo();
    await commit(dir, "release", "contents", "initial");
    git(dir, ["checkout", "-b", "release"]);
    await commit(dir, "other.txt", "x", "on release");
    expect((await readCommits(dir, { branch: "release" })).map((entry) => entry.subject)).toEqual([
      "on release",
      "initial",
    ]);
  });

  it("marks the checked-out branch and leaves ahead/behind unknown without an upstream", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "one", "initial");
    git(dir, ["branch", "feature"]);
    const branches = await readBranches(dir);
    const main = branches.find((branch) => branch.name === "main");
    const feature = branches.find((branch) => branch.name === "feature");
    expect(main).toMatchObject({ current: true, remote: false, upstream: null, ahead: null, behind: null });
    expect(feature).toMatchObject({ current: false, remote: false });
    expect(main?.lastCommitSubject).toBe("initial");
  });

  it("counts staged, unstaged and untracked separately", async () => {
    const dir = await initRepo();
    await commit(dir, "tracked.txt", "one", "initial");
    await writeFile(path.join(dir, "tracked.txt"), "changed", "utf8");
    await writeFile(path.join(dir, "staged.txt"), "new", "utf8");
    git(dir, ["add", "staged.txt"]);
    await writeFile(path.join(dir, "loose.txt"), "loose", "utf8");
    const status = await readStatus(dir);
    expect(status).toMatchObject({ branch: "main", detached: false, staged: 1, unstaged: 1, untracked: 1, conflicted: 0 });
  });

  it("reports a detached head without a branch name", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "one", "initial");
    const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
    git(dir, ["checkout", "--detach", sha]);
    expect(await readStatus(dir)).toMatchObject({ branch: null, detached: true });
  });

  it("gathers the panel's whole first paint in one call", async () => {
    const dir = await initRepo();
    await commit(dir, "a.txt", "one", "initial");
    const overview = await readOverview(dir, { limit: 5 });
    expect(overview.isRepository).toBe(true);
    expect(overview.branch).toBe("main");
    expect(overview.commits).toHaveLength(1);
    expect(overview.branches.some((branch) => branch.name === "main")).toBe(true);
  });
});
