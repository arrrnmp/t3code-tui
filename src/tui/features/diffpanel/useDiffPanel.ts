import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";

import type { TuiClient } from "../../app/app.js";
import { SIDEBAR_WIDTH } from "../../app/constants.js";
import {
  activityFilePath,
  describeActivity,
  missingCompletedInput,
  withCompletedInput,
  toolCallIdOf,
  type ActivityView,
} from "../../model/activity.js";
import { createFileContentCache, diffCachedFiles, snapshotFiles } from "../../model/filecache.js";
import { fetchWorkingTreeDiff } from "../../model/gitdiff.js";
import { markModalDismissed } from "../../model/modalDismiss.js";
import { findPatchFile, splitPatchByFile, type PatchFile } from "../../model/patch.js";
import { proportionalTarget, type TurnGroup } from "../../model/turns.js";
import { type ThreadState } from "../../model/thread.js";
import { readCompletedToolInputs } from "../../../cli/infra/toolInputs.js";
import type { T3Project, T3Thread } from "../../../types.js";

/**
 * Owns the diff panel: which turn is expanded, its patch, the checkpoint /
 * working-tree / content-cache backfill caches that feed inline per-edit
 * diffs, and the timeline-jump scroll math the diff-turn picker uses.
 */
export function useDiffPanel(params: {
  client: TuiClient;
  width: number;
  openThreadId: string | null;
  selected: T3Thread | null;
  shellProjects: T3Project[];
  threadState: ThreadState;
  threadStateRef: MutableRefObject<ThreadState>;
  stateDir: string | null;
  groups: TurnGroup[];
  selectedIdRef: MutableRefObject<string | null>;
  chatScrollRef: MutableRefObject<ScrollBoxRenderable | null>;
  setThreadState: Dispatch<SetStateAction<ThreadState>>;
  setFocus: (focus: "chat" | "diff") => void;
  setError: (message: string) => void;
}) {
  const { client, width, openThreadId, selected, shellProjects, threadState, threadStateRef, stateDir, groups, selectedIdRef, chatScrollRef, setThreadState, setFocus, setError } = params;

  const [expandedTurn, setExpandedTurn] = useState<number | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  /**
   * Checkpoint patches by checkpoint turn count, backfilling the inline
   * per-edit diffs whose tool input the wire stripped. Rendered through a
   * version bump (the map itself lives in a ref so the backfill effect never
   * re-fires off its own writes); cleared whenever the open thread changes.
   */
  const turnPatchCache = useRef(new Map<number, PatchFile[]>());
  const patchInflight = useRef(new Set<number>());
  /**
   * Working-tree hunks for the running turn's bare rows (whole-tree patch,
   * matched per row by path suffix). Checkpoint patches shadow it wherever
   * present — historical turns must never render current-tree hunks, since
   * the tree moved on. Refreshed only when the wanted set below changes.
   */
  const gitPatchCache = useRef<PatchFile[]>([]);
  const lastGitWanted = useRef<string | null>(null);
  /**
   * Last-known file contents for the non-git fallback diff layer (see
   * `model/filecache.ts`): checkpoints are git-ref based and the overlay
   * needs a repo, so without either, stripped Edit rows diff a Read-time
   * snapshot against current disk content. Bounded; workspace-scoped, so it
   * survives thread switches like the tree it mirrors.
   */
  const contentCache = useRef(createFileContentCache());
  const lastSnapshotWanted = useRef<string | null>(null);
  /** Completed tool calls whose input was already merged back from the
      local projection database (or confirmed missing) — cleared with the
      rest of the per-thread caches below. */
  const mergedToolInput = useRef(new Set<string>());
  const [, bumpTurnPatches] = useState(0);
  const [diffFileIndex, setDiffFileIndex] = useState(0);
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedWork, setExpandedWork] = useState<ReadonlySet<string>>(() => new Set());

  /** Clears every per-thread cache — called when the open thread changes. */
  const resetCaches = () => {
    turnPatchCache.current.clear();
    gitPatchCache.current = [];
    lastGitWanted.current = null;
    mergedToolInput.current.clear();
  };

  /**
   * Fetches one turn's checkpoint patch into the shared cache (one fetch per
   * turn per thread-open). Failures stay uncached and retry on the next
   * expansion or resync — the backfill effect only runs on change, so a
   * failed fetch never hot-loops. Background failures stay silent: unlike
   * the diff panel there is no user action to attribute an error toast to.
   */
  const ensureTurnPatch = (threadId: string, turnCount: number) => {
    const cache = turnPatchCache.current;
    if (cache.has(turnCount) || patchInflight.current.has(turnCount)) return;
    patchInflight.current.add(turnCount);
    void client
      .turnDiff(threadId, turnCount)
      .then((result) => {
        patchInflight.current.delete(turnCount);
        if (selectedIdRef.current !== threadId) return;
        if (result !== null) {
          try {
            cache.set(turnCount, splitPatchByFile(result));
          } catch {
            cache.delete(turnCount);
          }
        } else {
          cache.delete(turnCount);
        }
        bumpTurnPatches((version) => version + 1);
      })
      .catch(() => {
        patchInflight.current.delete(turnCount);
        cache.delete(turnCount);
        bumpTurnPatches((version) => version + 1);
      });
  };

  /**
   * Opening or closing the diff panel resizes the chat pane on the same
   * click that triggered it — the reflow can land the mouse-up half of that
   * click on a message row that just shifted into this exact spot, opening
   * its actions unintentionally. Same swallow window as a modal dismiss.
   */
  const openDiff = (turnCount: number) => {
    if (openThreadId === null) return;
    markModalDismissed();
    if (expandedTurn === turnCount) {
      setExpandedTurn(null);
      setFocus("chat");
      return;
    }
    setExpandedTurn(turnCount);
    setPatch(null);
    setDiffFileIndex(0);
    setCollapsedFiles(new Set());
    setFocus("diff");
    const id = openThreadId;
    void client
      .turnDiff(id, turnCount)
      .then((result) => {
        setPatch(result);
        // Warm the inline backfill cache with the same patch so rows for
        // this turn show hunks without a second fetch.
        if (result !== null && selectedIdRef.current === id) {
          try {
            turnPatchCache.current.set(turnCount, splitPatchByFile(result));
            bumpTurnPatches((version) => version + 1);
          } catch {
            turnPatchCache.current.delete(turnCount);
          }
        }
      })
      .catch((cause: unknown) => setError(String(cause).slice(0, 120)));
  };

  /** Closes the diff panel without touching anything else — used by flows
      (like a conversation revert) whose target turn may no longer exist. */
  const closeDiff = () => {
    setExpandedTurn(null);
    setPatch(null);
  };

  /**
   * Resolves a checkpoint turn count to a group index: the rendered diff
   * entry by the picker's own count first (immune to foreign absorption),
   * the turnId lookup as fallback.
   */
  const timelineIndexForTurnCount = (turnCount: number): number | null => {
    const byDiff = groups.findIndex((group) => group.diff?.checkpoint?.checkpointTurnCount === turnCount);
    if (byDiff !== -1) return byDiff;
    const turnId = threadState.checkpoints.find((row) => row.checkpointTurnCount === turnCount)?.turnId ?? null;
    if (turnId === null) return null;
    const byTurn = groups.findIndex((group) => group.turnId === turnId);
    return byTurn === -1 ? null : byTurn;
  };

  /**
   * Drives the chat pane to a proportional target, re-asserting on a short
   * schedule: reflows landing after the jump (slow patch fetch, streaming
   * events) can snap a sticky-bottom box back, so each follow-up re-reads
   * fresh measurements via `getTarget` and stops once the position holds.
   */
  const assertChatScroll = (getTarget: () => number | null, attempt = 0): void => {
    const pane = chatScrollRef.current;
    const target = getTarget();
    if (pane === null || target === null) return;
    pane.scrollTo(target);
    if (attempt < 2) {
      setTimeout(() => {
        const later = chatScrollRef.current;
        const fresh = getTarget();
        if (later === null || fresh === null) return;
        if (Math.abs(later.scrollTop - fresh) > 2) assertChatScroll(getTarget, attempt + 1);
      }, 150);
    }
  };

  /** Scrolls the chat pane to `index` of `groups` (stable under appends). */
  const scrollTimelineToIndex = (index: number, attempt = 0): void => {
    assertChatScroll(() => {
      const pane = chatScrollRef.current;
      if (pane === null || groups.length === 0 || index < 0 || index >= groups.length) return null;
      return proportionalTarget(index, groups.length, pane.scrollHeight, pane.viewport.height);
    }, attempt);
  };

  /** Jumps the chat pane to the turn that owns `turnCount`'s checkpoint. */
  const scrollTimelineToTurn = (turnCount: number): void => {
    const index = timelineIndexForTurnCount(turnCount);
    if (index === null) return;
    scrollTimelineToIndex(index);
  };

  /**
   * Folding or unfolding the Worked row adds or removes rows below it — the
   * same reflow hazard as opening the diff panel: the chat pane resizes on
   * the same click that triggered it, so the mouse-up half can land on a
   * message row that just shifted under the cursor. Same swallow window as a
   * modal dismiss.
   */
  const toggleWork = (id: string) => {
    markModalDismissed();
    setFocus("chat");
    setExpandedWork((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const patchFiles = useMemo(() => (patch === null ? [] : splitPatchByFile(patch)), [patch]);

  const toggleDiffFile = (index: number) => {
    setFocus("diff");
    setDiffFileIndex(index);
    const target = patchFiles[index];
    if (target === undefined) return;
    setCollapsedFiles((current) => {
      const next = new Set(current);
      if (next.has(target.path)) next.delete(target.path);
      else next.add(target.path);
      return next;
    });
  };

  /**
   * Backfills inline per-edit diffs from each turn's checkpoint patch: the
   * wire strips tool input, so rows whose activity carries no content match
   * their file against the turn diff instead. Runs on transcript change
   * (new activities, fresh checkpoints, resyncs) — the cache + inflight
   * guards make it one fetch per turn, and failures stay uncached without
   * hot-looping since nothing here re-fires off a settled fetch.
   *
   * Rows in the still-running turn have no checkpoint yet, so they backfill
   * from a live working-tree diff instead (one `git diff` per wanted-set
   * change, matched per row the same way). Completed turns never consult
   * the tree — its hunks may belong to later turns.
   */
  useEffect(() => {
    if (openThreadId === null) return;
    const id = openThreadId;
    const lastId = groups.length === 0 ? null : (groups[groups.length - 1]?.id ?? null);
    // Declared below — read live here since the effect only ever runs
    // post-render (same pattern as sessionRunningRef/threadStateRef).
    const runningNow = threadState.session?.status === "running" || threadState.session?.status === "starting";
    const root =
      selected === null ? null : (shellProjects.find((project) => project.id === selected.projectId)?.workspaceRoot ?? null);
    const gitParts: string[] = [];
    const gitWanted: string[] = [];
    const gitFullWanted: { full: string; display: string }[] = [];
    const readWanted: string[] = [];
    const mergeIds: string[] = [];
    for (const group of groups) {
      const turnCount = group.diff?.checkpoint?.checkpointTurnCount;
      const open = runningNow && group.id === lastId;
      let groupBare = false;
      for (const entry of group.work) {
        if (entry.kind !== "activity" || entry.activity === null) continue;
        let view: ActivityView | null = null;
        try {
          view = describeActivity(entry.activity);
        } catch {
          continue;
        }
        if (view.kind === "read") {
          // Baseline for the content-cache fallback: what the agent just
          // saw on disk, for a later stripped Edit row to diff against.
          const full = activityFilePath(entry.activity);
          if (full !== null) readWanted.push(full);
        }
        if (view.kind === "file" && view.diff === null) {
          groupBare = true;
          if (open && view.path !== "…") {
            gitParts.push(`${group.id}\n${view.path.toLowerCase()}\n${entry.id}`);
            gitWanted.push(view.path);
            const full = activityFilePath(entry.activity);
            if (full !== null) gitFullWanted.push({ full, display: view.path });
          }
        }
        const missing = missingCompletedInput(entry.activity, view);
        if (missing !== null && !mergedToolInput.current.has(missing)) mergeIds.push(missing);
      }
      if (turnCount !== undefined && groupBare) ensureTurnPatch(id, turnCount);
    }
    // Completed rows recover their stripped input from the local projection
    // database (exact per-edit diffs, no git needed). Merged rows re-render
    // through the normal pipeline; misses simply retry on the next new row
    // instead of hot-looping, since nothing here re-fires without change.
    if (stateDir !== null && mergeIds.length > 0) {
      const wanted = [...new Set(mergeIds)];
      for (const toolCallId of wanted) mergedToolInput.current.add(toolCallId);
      void readCompletedToolInputs(stateDir, id)
        .then((found) => {
          if (found === null || selectedIdRef.current !== id) return;
          let changed = false;
          const activities = threadStateRef.current.activities.map((row) => {
            const toolCallId = toolCallIdOf(row);
            const input = toolCallId === null ? undefined : found.get(toolCallId);
            if (toolCallId === null || input === undefined) return row;
            const next = withCompletedInput(row, input);
            if (next !== row) {
              changed = true;
              mergedToolInput.current.add(toolCallId);
            }
            return next;
          });
          if (!changed) return;
          setThreadState((current) => ({ ...current, activities }));
        })
        .catch(() => {});
    }
    if (root !== null && gitParts.length > 0) {
      gitParts.sort();
      const wanted = `${root}\n${gitParts.join("\n")}`;
      if (wanted !== lastGitWanted.current) {
        lastGitWanted.current = wanted;
        const fullPaths = [...new Map(gitFullWanted.map((item) => [item.full.toLowerCase(), item])).values()];
        void fetchWorkingTreeDiff(root, [...new Set(gitWanted)])
          .then(async (files) => {
            if (selectedIdRef.current !== id) return;
            const overlay = files ?? [];
            // Rows the overlay left uncovered (not a repo, or an untracked
            // miss) fall through to content-cache diffs on non-git projects.
            const missing = fullPaths.filter((item) => findPatchFile(overlay, item.display) === null);
            const cacheDiffs =
              missing.length === 0
                ? []
                : await diffCachedFiles(root, contentCache.current, missing).catch(() => []);
            if (selectedIdRef.current !== id) return;
            gitPatchCache.current = [...overlay, ...cacheDiffs];
            bumpTurnPatches((version) => version + 1);
          })
          .catch(() => {
            gitPatchCache.current = [];
          });
      }
    } else if (gitPatchCache.current.length > 0) {
      gitPatchCache.current = [];
      bumpTurnPatches((version) => version + 1);
    }
    // Snapshot Read-row contents for the fallback above: new paths only
    // (deduped by root+paths), fire-and-forget with no version bump since
    // snapshots alone change nothing visible.
    if (root !== null && readWanted.length > 0) {
      const unique = [...new Set(readWanted)].sort();
      const key = `${root}\n${unique.join("\n")}`;
      if (key !== lastSnapshotWanted.current) {
        lastSnapshotWanted.current = key;
        void snapshotFiles(root, unique, contentCache.current).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, openThreadId, client, selected, shellProjects, stateDir]);

  const diffWidth = Math.max(40, Math.floor((width - SIDEBAR_WIDTH) / 2));

  return {
    expandedTurn,
    patch,
    diffFileIndex,
    collapsedFiles,
    expandedWork,
    patchFiles,
    diffWidth,
    turnPatchCache,
    gitPatchCache,
    openDiff,
    closeDiff,
    scrollTimelineToTurn,
    scrollTimelineToIndex,
    toggleWork,
    toggleDiffFile,
    resetCaches,
  };
}
