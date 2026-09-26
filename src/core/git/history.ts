/**
 * Read-only git for the Git panel: branches, commit history, and what the
 * worktree currently looks like.
 *
 * Separate from `checkpoints/git.ts` on purpose. That module *writes* —
 * it builds commit objects and moves refs under `refs/moxen/` — and its
 * helpers are shaped around doing so without disturbing the user's index.
 * This one only ever reads, so it can be plainer, and keeping the two
 * apart means a bug here can never touch a checkpoint.
 *
 * Every read is best-effort: outside a repository, or with a git too old
 * for a flag, the caller gets an empty result rather than an error. A
 * panel that cannot show history should say so, not take the thread down.
 */
import { runProcess } from "../infra/process.js";

const GIT_TIMEOUT_MS = 20_000;

/**
 * `%x1f` (unit separator) between fields and `%x1e` (record separator)
 * between commits: commit subjects contain newlines, tabs and every
 * punctuation mark a person can type, so the usual `--format` with a
 * printable delimiter mis-parses on real history.
 */
const FIELD = "\u001f";
const RECORD = "\u001e";
const LOG_FORMAT = ["%H", "%h", "%an", "%ae", "%aI", "%s", "%D"].join(FIELD) + RECORD;

export interface GitCommit {
  readonly sha: string;
  readonly shortSha: string;
  readonly author: string;
  readonly authorEmail: string;
  /** ISO 8601, author date. */
  readonly date: string;
  readonly subject: string;
  /** Branch and tag names pointing here, as git resolved them. */
  readonly refs: readonly string[];
}

export interface GitBranch {
  readonly name: string;
  readonly current: boolean;
  readonly remote: boolean;
  /** The upstream this tracks, if any (`origin/main`). */
  readonly upstream: string | null;
  /** Commits ahead of / behind the upstream; null when there is none. */
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly lastCommitDate: string | null;
  readonly lastCommitSubject: string | null;
}

export interface GitWorktreeStatus {
  readonly branch: string | null;
  readonly detached: boolean;
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
  readonly conflicted: number;
}

export interface GitOverview {
  readonly isRepository: boolean;
  readonly root: string | null;
  readonly status: GitWorktreeStatus | null;
  readonly branches: readonly GitBranch[];
  readonly commits: readonly GitCommit[];
  /** The branch `commits` was read from — the checked-out one unless asked otherwise. */
  readonly branch: string | null;
}

async function git(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const result = await runProcess("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS, allowFailure: true });
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

export async function gitRoot(cwd: string): Promise<string | null> {
  const out = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return out === null ? null : out.trim() || null;
}

export async function readCommits(
  cwd: string,
  options: { readonly branch?: string; readonly limit?: number } = {},
): Promise<readonly GitCommit[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 1000));
  const args = ["log", `--max-count=${limit}`, `--format=${LOG_FORMAT}`];
  // `--` guards a branch name that also matches a path: `git log foo`
  // is ambiguous when a file called `foo` exists, and refuses outright.
  if (options.branch) args.push(options.branch, "--");
  const out = await git(cwd, args);
  if (out === null) return [];
  return out
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.trim().length > 0)
    .flatMap((record) => {
      const [sha, shortSha, author, authorEmail, date, subject, refs] = record.split(FIELD);
      if (!sha || !shortSha) return [];
      return [
        {
          sha,
          shortSha,
          author: author ?? "",
          authorEmail: authorEmail ?? "",
          date: date ?? "",
          subject: subject ?? "",
          refs: (refs ?? "")
            .split(",")
            .map((ref) => ref.trim().replace(/^HEAD -> /, ""))
            .filter((ref) => ref.length > 0),
        },
      ];
    });
}

/**
 * Local branches first, then remote-tracking ones. `for-each-ref` rather
 * than `branch -v` because the porcelain output is stable and carries
 * ahead/behind without a second call per branch.
 */
export async function readBranches(cwd: string): Promise<readonly GitBranch[]> {
  const format = [
    "%(refname)",
    "%(refname:short)",
    "%(HEAD)",
    "%(upstream:short)",
    "%(upstream:track)",
    "%(committerdate:iso-strict)",
    "%(contents:subject)",
  ].join(FIELD);
  const out = await git(cwd, ["for-each-ref", `--format=${format}`, "--sort=-committerdate", "refs/heads", "refs/remotes"]);
  if (out === null) return [];
  return out
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      const [fullRef, name, head, upstream, track, date, subject] = line.split(FIELD);
      // The full refname is the only reliable local/remote tell: a short
      // name like `origin/main` could in principle be either.
      if (!fullRef || !name || fullRef.endsWith("/HEAD")) return [];
      // An in-sync branch prints an empty `%(upstream:track)`, which is
      // not the same as having no upstream at all: with one configured,
      // empty means level, so report 0/0 rather than "unknown".
      const hasUpstream = upstream !== undefined && upstream.length > 0;
      const counts = hasUpstream ? parseTrack(track ?? "", true) : { ahead: null, behind: null };
      return [
        {
          name,
          current: head === "*",
          remote: fullRef.startsWith("refs/remotes/"),
          upstream: upstream && upstream.length > 0 ? upstream : null,
          ahead: counts.ahead,
          behind: counts.behind,
          lastCommitDate: date && date.length > 0 ? date : null,
          lastCommitSubject: subject && subject.length > 0 ? subject : null,
        },
      ];
    });
}

/**
 * `[ahead 2, behind 1]`, `[gone]`, or empty. Only called with an upstream
 * configured; `gone` (the upstream was deleted) reads as unknown rather
 * than level, because there is nothing left to be level with.
 */
function parseTrack(track: string, hasUpstream: boolean): { ahead: number | null; behind: number | null } {
  if (!hasUpstream || track.includes("gone")) return { ahead: null, behind: null };
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 };
}

export async function readStatus(cwd: string): Promise<GitWorktreeStatus | null> {
  const out = await git(cwd, ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]);
  if (out === null) return null;
  let branch: string | null = null;
  let detached = false;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      if (head === "(detached)") detached = true;
      else branch = head;
      continue;
    }
    if (line.startsWith("?")) {
      untracked += 1;
      continue;
    }
    if (line.startsWith("u ")) {
      conflicted += 1;
      continue;
    }
    // `1`/`2` records carry XY at a fixed offset: X is the index state,
    // Y the worktree state, and `.` means unchanged on that side.
    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const xy = line.slice(2, 4);
      if (xy[0] !== undefined && xy[0] !== ".") staged += 1;
      if (xy[1] !== undefined && xy[1] !== ".") unstaged += 1;
    }
  }
  return { branch, detached, staged, unstaged, untracked, conflicted };
}

/** Best-effort `git fetch`; failure is silent, since it only means staler data. */
export async function fetch(cwd: string): Promise<void> {
  await git(cwd, ["fetch", "--quiet", "--prune"]);
}

/** The full diff of one commit against its first parent. */
export async function readCommitDiff(cwd: string, sha: string): Promise<string | null> {
  return await git(cwd, ["show", "--format=", "--patch", sha]);
}

export interface GitOverviewOptions {
  readonly branch?: string;
  readonly limit?: number;
  readonly autoFetch?: boolean;
}

/** One round trip for the panel: everything it draws on open. */
export async function readOverview(cwd: string, options: GitOverviewOptions = {}): Promise<GitOverview> {
  const root = await gitRoot(cwd);
  if (root === null) {
    return { isRepository: false, root: null, status: null, branches: [], commits: [], branch: null };
  }
  if (options.autoFetch === true) await fetch(cwd);
  const [status, branches] = await Promise.all([readStatus(cwd), readBranches(cwd)]);
  const branch = options.branch ?? status?.branch ?? null;
  const commits = await readCommits(cwd, {
    ...(branch ? { branch } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });
  return { isRepository: true, root, status, branches, commits, branch };
}
