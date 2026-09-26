/**
 * The pinned tasks panel shows a window of the checklist, never a scroll of
 * it: past its row cap, the window slides so the step being worked on stays
 * in view (with one row of context above it) while order and numbering stay
 * the checklist's own.
 */

export interface TaskItem {
  readonly content: string;
  readonly status: string;
}

export interface TaskCounts {
  readonly done: number;
  readonly inProgress: number;
  readonly open: number;
}

export function taskCounts(items: readonly TaskItem[]): TaskCounts {
  const done = items.filter((item) => item.status === "completed").length;
  const inProgress = items.filter((item) => item.status === "inProgress").length;
  return { done, inProgress, open: items.length - done - inProgress };
}

/** Rows `start` (inclusive) to `end` (exclusive) of the checklist to show. */
export function taskWindow(items: readonly TaskItem[], maxRows: number): { start: number; end: number } {
  if (items.length <= maxRows) return { start: 0, end: items.length };
  // The step to keep in view: the one in progress, else the next one open,
  // else (all done) the end of the list.
  const active = items.findIndex((item) => item.status === "inProgress");
  const nextOpen = items.findIndex((item) => item.status !== "completed");
  const focus = active !== -1 ? active : nextOpen !== -1 ? nextOpen : items.length - 1;
  const start = Math.min(Math.max(0, focus - 1), items.length - maxRows);
  return { start, end: start + maxRows };
}
