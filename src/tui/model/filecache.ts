import { readFile } from "node:fs/promises";

import { createPatch } from "diff";

import { GIT_DIFF_MAX_BYTES } from "./gitdiff.js";
import { splitPatchByFile, type PatchFile } from "./patch.js";

/**
 * Last-known file contents for the non-git fallback diff layer. Checkpoints
 * are git-ref based (the server captures nothing without a repo) and the
 * live `git diff` overlay fails the same way, so on those projects stripped
 * Edit rows would stay bare forever. Instead: snapshot a file's content when
 * the transcript first shows it (a Read row — roughly what the agent saw),
 * and diff that baseline against the current disk content when a later Edit
 * row needs hunks. Same staleness contract as the git overlay (open turn
 * only — later turns may have moved the file on), so callers restrict it
 * the same way. Never guesses creations: a file with no baseline stays
 * stats-only, even if it exists on disk now.
 */
export const FILE_CACHE_MAX_ENTRIES = 200;
export const FILE_CACHE_MAX_BYTES = 256 * 1024;

export interface FileContentCache {
  get(normalized: string): string | undefined;
  has(normalized: string): boolean;
  set(normalized: string, content: string): void;
  readonly size: number;
}

export function createFileContentCache(maxEntries: number = FILE_CACHE_MAX_ENTRIES): FileContentCache {
  const store = new Map<string, string>();
  return {
    get: (key) => store.get(key),
    has: (key) => store.has(key),
    get size() {
      return store.size;
    },
    set: (key, content) => {
      if (store.has(key)) store.delete(key);
      store.set(key, content);
      while (store.size > maxEntries) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
    },
  };
}

function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Resolves a row path to an absolute disk path inside the workspace root.
 * Accepts absolute paths, `~`-led paths, and root-relative paths; returns
 * null for empty/marker paths, unresolvable `~`, and anything escaping the
 * root. Display-shortened paths ("tui/app.tsx") only resolve when they
 * exist verbatim under the root — callers prefer full paths and treat a
 * null as "skip this row", never as an error.
 */
export function resolveCachePath(root: string, path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed.length === 0 || trimmed === "…") return null;
  const normRoot = normalizeRoot(root);
  if (normRoot.length === 0) return null;
  let expanded = trimmed;
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (home.length === 0) return null;
    expanded = home.replace(/\\/g, "/").replace(/\/+$/, "") + trimmed.slice(1);
  }
  const absolute =
    expanded.startsWith("/") || /^[A-Za-z]:\//.test(expanded) ? expanded : `${normRoot}/${expanded}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const drive = /^[A-Za-z]:$/.test(parts[0] ?? "") ? `${parts.shift()}/` : absolute.startsWith("/") ? "/" : "";
  const resolved = `${drive}${parts.join("/")}`;
  const rootLower = normRoot.toLowerCase();
  const resolvedLower = resolved.toLowerCase();
  if (resolvedLower !== rootLower && !resolvedLower.startsWith(`${rootLower}/`)) return null;
  return resolved;
}

export type FileReader = (path: string) => Promise<string>;

/**
 * Snapshots current disk content for paths with no baseline yet (or refreshes
 * a Read row's baseline — the agent just saw the current content). Best
 * effort per path: missing/oversized/unreadable files are skipped, never
 * errors. No version bump comes out of this — snapshots only feed later
 * diffs.
 */
export async function snapshotFiles(
  root: string,
  fullPaths: readonly string[],
  cache: FileContentCache,
  read: FileReader = (path) => readFile(path, "utf8"),
): Promise<void> {
  for (const full of new Set(fullPaths)) {
    const resolved = resolveCachePath(root, full);
    if (resolved === null) continue;
    let content: string;
    try {
      content = await read(resolved);
    } catch {
      continue;
    }
    if (content.length === 0 || content.length > FILE_CACHE_MAX_BYTES) continue;
    cache.set(resolved.toLowerCase(), content);
  }
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

/**
 * Diffs baselined paths against current disk content for rows the overlay
 * left uncovered. Identical content, missing baselines, and oversized
 * patches resolve to nothing — the row stays stats-only. Every successfully
 * read path refreshes its baseline, so a second edit diffs against the
 * post-first-edit content, not the original snapshot.
 */
export async function diffCachedFiles(
  root: string,
  cache: FileContentCache,
  wanted: readonly { full: string; display: string }[],
  read: FileReader = (path) => readFile(path, "utf8"),
): Promise<PatchFile[]> {
  const out: PatchFile[] = [];
  const seen = new Set<string>();
  for (const item of wanted) {
    const resolved = resolveCachePath(root, item.full);
    if (resolved === null) continue;
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const baseline = cache.get(key);
    if (baseline === undefined) continue;
    let current: string;
    try {
      current = await read(resolved);
    } catch {
      continue;
    }
    if (current.length === 0 || current.length > FILE_CACHE_MAX_BYTES) continue;
    cache.set(key, current);
    if (current === baseline) continue;
    let patch: string;
    try {
      // createPatch emits `Index:`/`---`/`+++` without a `diff --git`
      // header, which splitPatchByFile keys on — prepend it (same as the
      // git overlay's untracked-file path) so the section carries the
      // display path like every other file patch.
      patch =
        `diff --git a/${item.display} b/${item.display}\n` +
        createPatch(
          item.display,
          withTrailingNewline(baseline),
          withTrailingNewline(current),
          undefined,
          undefined,
          { context: 3 },
        );
    } catch {
      continue;
    }
    if (patch.length === 0 || patch.length > GIT_DIFF_MAX_BYTES) continue;
    try {
      out.push(...splitPatchByFile(patch));
    } catch {
      continue;
    }
  }
  return out;
}
