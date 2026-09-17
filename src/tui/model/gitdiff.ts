import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

import { createPatch } from "diff";

import { splitPatchByFile, type PatchFile } from "./patch.js";

/** Working-tree patches bigger than this never render inline — a truncated
    patch would show misleading partial hunks, so oversized scopes stay
    stats-only. */
export const GIT_DIFF_MAX_BYTES = 65536;

/** New-file creations feed at most this many lines to the differ (same cap
    as the activity layer) so every produced hunk stays well-formed. Longer
    creations stay stats-only mid-turn; their full diff arrives with the
    checkpoint patch once the turn completes. */
const MAX_CREATED_FILE_LINES = 40;

const NUL = String.fromCharCode(0);

/** `git` argv scoped to a repo root. Array form — never concatenated into a
    shell command. */
export function gitArgs(root: string, ...extra: string[]): string[] {
  return ["-C", root, ...extra];
}

export type GitRunner = (args: string[]) => Promise<{ stdout: string }>;

/** Live runner with a timeout and output cap (root is baked in by the caller). */
export function runGit(root: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile("git", gitArgs(root, ...args), { timeout: 15_000, maxBuffer: 256 * 1024 }, (error, stdout) => {
      if (error !== null) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve({ stdout: typeof stdout === "string" ? stdout : String(stdout) });
    });
  });
}

function normPath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

/** Repo-relative changed paths matching any wanted row path, by suffix in
    either direction (rows render shortened). */
export function matchChangedPaths(changed: readonly string[], wanted: readonly string[]): string[] {
  const want = wanted.map(normPath).filter((path) => path.length > 0 && path !== "…");
  const matched: string[] = [];
  for (const candidate of changed) {
    const norm = normPath(candidate);
    if (norm.length === 0) continue;
    if (want.some((path) => norm.endsWith(path) || path.endsWith(norm))) matched.push(candidate);
  }
  return matched;
}

/** Untracked-file paths from `git status --porcelain=v1` (directories skipped). */
export function parseUntrackedFiles(status: string): string[] {
  const paths: string[] = [];
  for (const line of status.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const path = line.slice(3).trim();
    if (path.length > 0 && !path.endsWith("/")) paths.push(path);
  }
  return paths;
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

/**
 * The working tree's current hunks for exactly the wanted row paths.
 * Tracked modifications diff against HEAD; untracked creations render
 * all-added. Returns null when there is nothing usable: not a repo, git
 * missing/timed out, or an oversized patch. Callers treat null as "stay
 * stats-only" and retry on the next new row.
 */
export async function fetchWorkingTreeDiff(
  root: string,
  wanted: readonly string[],
  run: GitRunner = (args) => runGit(root, args),
  read: (path: string) => Promise<string> = (path) => readFile(path, "utf8"),
): Promise<PatchFile[] | null> {
  const want = wanted.map(normPath).filter((path) => path.length > 0 && path !== "…");
  if (want.length === 0) return null;
  let names: string;
  let status: string;
  try {
    ({ stdout: names } = await run(["diff", "HEAD", "--no-color", "--no-ext-diff", "--name-only", "-z", "--"]));
    ({ stdout: status } = await run(["status", "--porcelain=v1", "-uall", "--no-renames", "--"]));
  } catch {
    return null;
  }
  const tracked = matchChangedPaths(
    names.split(NUL).map((line) => line.trim()).filter((line) => line.length > 0),
    want,
  );
  const untracked = matchChangedPaths(parseUntrackedFiles(status), want);
  const out: PatchFile[] = [];
  if (tracked.length > 0) {
    let patch: string;
    try {
      ({ stdout: patch } = await run(["diff", "HEAD", "--no-color", "--no-ext-diff", "--", ...tracked]));
    } catch {
      return null;
    }
    if (patch.length === 0 || patch.length > GIT_DIFF_MAX_BYTES) return null;
    try {
      out.push(...splitPatchByFile(patch));
    } catch {
      return null;
    }
  }
  for (const relative of untracked) {
    let content: string;
    try {
      content = await read(`${root}/${relative}`);
    } catch {
      continue;
    }
    const lines = content.split("\n");
    if (lines.length > MAX_CREATED_FILE_LINES) continue;
    try {
      // createPatch emits `Index:`/`---`/`+++` without a `diff --git`
      // header, which splitPatchByFile keys on — prepend it so the section
      // carries its path like every other file patch.
      const patch =
        `diff --git a/${relative} b/${relative}\n` +
        createPatch(relative, "", withTrailingNewline(lines.join("\n")), undefined, undefined, { context: 3 });
      out.push(...splitPatchByFile(patch));
    } catch {
      continue;
    }
  }
  return out;
}
