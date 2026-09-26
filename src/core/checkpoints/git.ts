/**
 * Git-backed turn checkpoints: snapshot the worktree diff around each
 * provider run so the timeline can show per-turn diffs and rollback can
 * restore the pre-turn tree.
 *
 * Mechanics (all best-effort, never load-bearing for the turn itself):
 * - Capture through a throwaway copy of the index (`add --all`,
 *   `write-tree`, `commit-tree`): a commit object holding the worktree as
 *   it is, untracked files included (ignored ones not), with neither the
 *   worktree nor the user's index touched. Null outside git repos.
 * - Each capture is pinned under `refs/moxen/checkpoints/<thread>/<turn>`
 *   so GC can prune per thread without touching user refs.
 * - Diff = `git diff <pre> <post>`; restore (`restoreWorktreeTo`) puts the
 *   worktree back to a capture — deleting files created since — after
 *   capturing the state it replaces, so a restore can itself be undone.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { APP_NAME } from "../config.js";

export const CHECKPOINT_REF_NAMESPACE = `refs/${APP_NAME}/checkpoints`;

export function checkpointRef(threadId: string, turnId: string, which: "pre" | "post" = "post"): string {
  return `${CHECKPOINT_REF_NAMESPACE}/${sanitizeRefComponent(threadId)}/${sanitizeRefComponent(turnId)}/${which}`;
}

function sanitizeRefComponent(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^(-+|\.+)|(-+|\.+)$/g, "");
  return cleaned.length > 0 ? cleaned : "unknown";
}

const GIT_TIMEOUT_MS = 30_000;

async function runGit(cwd: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv): Promise<{ stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", [...args], { cwd, stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}) });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`git ${args[0] ?? ""} timed out`));
    }, GIT_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout });
      else reject(new Error(`git ${args[0] ?? ""} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/** Checkpoints are moxen's own objects: they never need the user's git identity configured. */
const CHECKPOINT_IDENTITY = {
  GIT_AUTHOR_NAME: "moxen",
  GIT_AUTHOR_EMAIL: "moxen@localhost",
  GIT_COMMITTER_NAME: "moxen",
  GIT_COMMITTER_EMAIL: "moxen@localhost",
};

/**
 * Capture the worktree as it is — tracked changes *and* untracked files
 * (ignored ones excepted) — as an unreferenced commit object on top of HEAD.
 * It goes through a throwaway copy of the index, so neither the worktree
 * nor the user's own index (their staged changes) is touched; copying the
 * real index keeps git's stat cache, so only changed files are hashed.
 * Returns the sha, or null outside a git repo. Never throws — callers treat
 * null as "checkpoint unavailable".
 */
export async function captureWorktree(cwd: string, message: string): Promise<string | null> {
  const scratch = path.join(os.tmpdir(), `moxen-index-${randomUUID()}`);
  try {
    if (!(await isGitRepository(cwd))) return null;
    const head = await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]).then(
      ({ stdout }) => stdout.trim() || null,
      () => null,
    );
    const realIndex = path.resolve(cwd, (await runGit(cwd, ["rev-parse", "--git-path", "index"])).stdout.trim());
    const env = { ...process.env, ...CHECKPOINT_IDENTITY, GIT_INDEX_FILE: scratch };
    const copied = await copyFile(realIndex, scratch).then(
      () => true,
      () => false,
    );
    if (!copied && head !== null) await runGit(cwd, ["read-tree", head], env);
    await runGit(cwd, ["add", "--all"], env);
    const tree = (await runGit(cwd, ["write-tree"], env)).stdout.trim();
    const sha = (await runGit(cwd, ["commit-tree", tree, ...(head !== null ? ["-p", head] : []), "-m", message], env)).stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  } finally {
    await rm(scratch, { force: true }).catch(() => undefined);
  }
}

/** Pin a captured sha under the thread/turn ref. Never throws. */
export async function pinCheckpointRef(
  threadId: string,
  turnId: string,
  sha: string,
  cwd: string,
  which: "pre" | "post" = "post",
): Promise<boolean> {
  try {
    await runGit(cwd, ["update-ref", checkpointRef(threadId, turnId, which), sha]);
    return true;
  } catch {
    return false;
  }
}

/** Unified diff between two captured shas. Null when unavailable. */
export async function diffCheckpointRange(
  cwd: string,
  fromSha: string,
  toSha: string,
  ignoreWhitespace = false,
): Promise<string | null> {
  try {
    const args = ["diff", ...(ignoreWhitespace ? ["-w"] : []), fromSha, toSha, "--"];
    const { stdout } = await runGit(cwd, args);
    return stdout;
  } catch {
    return null;
  }
}

/** Numstat summary (path + additions/deletions) for checkpoint display. */
export async function diffCheckpointStat(
  cwd: string,
  fromSha: string,
  toSha: string,
): Promise<Array<{ path: string; additions: number; deletions: number }>> {
  try {
    const { stdout } = await runGit(cwd, ["diff", "--numstat", fromSha, toSha, "--"]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        const [added, deleted, ...rest] = line.split("\t");
        const filePath = rest.join("\t");
        // A binary file reads "-\t-": it changed, with no line counts.
        const additions = added === "-" ? 0 : Number(added);
        const deletions = deleted === "-" ? 0 : Number(deleted);
        if (!filePath || !Number.isFinite(additions) || !Number.isFinite(deletions)) return [];
        return [{ path: filePath, additions, deletions }];
      });
  } catch {
    return [];
  }
}

/**
 * Restore tracked files to a captured sha. Destructive by nature — callers
 * gate it behind explicit confirmation (CLI `--confirm` flows, TUI
 * two-step). Returns false instead of throwing on failure.
 */
export async function restoreWorktree(cwd: string, sha: string): Promise<boolean> {
  return (await restoreWorktreeTo(cwd, sha)) !== null;
}

export interface WorktreeRestore {
  /** Files the restore wrote back, recreated or deleted. */
  readonly files: number;
  /** A capture of the worktree as it was just before, to undo the restore by. */
  readonly before: string;
}

/**
 * Put the whole worktree back the way `sha` (a `captureWorktree` capture)
 * recorded it: files changed or deleted since come back, files created since
 * — untracked ones included — go. Ignored files are never touched, and
 * neither is the user's index. The state just before is captured first and
 * returned, so nothing this does is beyond undoing. Null when it could not
 * run (no repo, unreadable capture); throws nothing.
 */
export async function restoreWorktreeTo(cwd: string, sha: string): Promise<WorktreeRestore | null> {
  try {
    const before = await captureWorktree(cwd, `moxen: before restoring ${sha.slice(0, 12)}`);
    if (before === null) return null;
    const root = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).stdout.trim();
    const changed = (await runGit(root, ["diff", "--name-status", "--no-renames", sha, before])).stdout
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((parts): parts is [string, string] => parts.length >= 2 && parts[0]!.length > 0);
    // Created since the capture: gone once restored.
    for (const [status, file] of changed) {
      if (status === "A") await rm(path.join(root, file), { force: true });
    }
    // Everything the capture holds, written back without touching the index.
    const restorable = changed.filter(([status]) => status !== "A").map(([, file]) => file);
    for (let index = 0; index < restorable.length; index += 100) {
      await runGit(root, ["restore", `--source=${sha}`, "--worktree", "--", ...restorable.slice(index, index + 100)]);
    }
    return { files: changed.length, before };
  } catch {
    return null;
  }
}

/** Drop checkpoint refs for turns outside `keepTurnIds`. Never throws. */
export async function pruneCheckpointRefs(cwd: string, threadId: string, keepTurnIds: ReadonlyArray<string>): Promise<void> {
  try {
    const prefix = `${CHECKPOINT_REF_NAMESPACE}/${sanitizeRefComponent(threadId)}/`;
    const { stdout } = await runGit(cwd, ["for-each-ref", "--format=%(refname)", prefix]);
    const keep = new Set(keepTurnIds.flatMap((turnId) => {
      const turn = sanitizeRefComponent(turnId);
      return [`${prefix}${turn}/pre`, `${prefix}${turn}/post`];
    }));
    for (const ref of stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)) {
      if (!keep.has(ref)) await runGit(cwd, ["update-ref", "-d", ref]).catch(() => undefined);
    }
  } catch {
    // GC is advisory.
  }
}
