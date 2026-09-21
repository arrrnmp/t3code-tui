/**
 * Git-backed turn checkpoints: snapshot the worktree diff around each
 * provider run so the timeline can show per-turn diffs and rollback can
 * restore the pre-turn tree.
 *
 * Mechanics (all best-effort, never load-bearing for the turn itself):
 * - Capture with `git stash create <message>`: builds a commit object
 *   from tracked worktree+index state without touching either. Untracked
 *   files are not captured (documented gap — `git stash -u` would touch
 *   the worktree). Returns null outside git repos or when there is
 *   nothing to capture.
 * - Each capture is pinned under `refs/t3code/checkpoints/<thread>/<turn>`
 *   so GC can prune per thread without touching user refs.
 * - Diff = `git diff <pre> <post>`; rollback = `git checkout <pre> -- .`
 *   (tracked files only, same untracked caveat).
 */
import { spawn } from "node:child_process";

export const CHECKPOINT_REF_NAMESPACE = "refs/t3code/checkpoints";

export function checkpointRef(threadId: string, turnId: string, which: "pre" | "post" = "post"): string {
  return `${CHECKPOINT_REF_NAMESPACE}/${sanitizeRefComponent(threadId)}/${sanitizeRefComponent(turnId)}/${which}`;
}

function sanitizeRefComponent(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^(-+|\.+)|(-+|\.+)$/g, "");
  return cleaned.length > 0 ? cleaned : "unknown";
}

const GIT_TIMEOUT_MS = 30_000;

async function runGit(cwd: string, args: ReadonlyArray<string>): Promise<{ stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
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

/**
 * Capture tracked worktree+index state as an unreferenced commit object.
 * Returns the sha, or null when there is nothing to capture / no repo.
 * Never throws — callers treat null as "checkpoint unavailable".
 */
export async function captureWorktree(cwd: string, message: string): Promise<string | null> {
  try {
    if (!(await isGitRepository(cwd))) return null;
    const { stdout } = await runGit(cwd, ["stash", "create", message]);
    const sha = stdout.trim().split(/\s+/)[0] ?? "";
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
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
        const additions = Number(added);
        const deletions = Number(deleted);
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
  try {
    await runGit(cwd, ["checkout", sha, "--", "."]);
    return true;
  } catch {
    return false;
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
