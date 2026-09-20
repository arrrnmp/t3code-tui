import { visibleThreads, type ShellState } from "./shell.js";
import type { ThreadState } from "./thread.js";

export type BootStage = "threads" | "transcript";

/**
 * Boot gate: the app renders its loading screen until the shell snapshot has
 * landed (thread list, projects) and — once launch-selection has picked a
 * thread — that thread's own snapshot has landed too. `openThreadId === null`
 * with threads present is the transient render between shell sync and the
 * pick: NOT ready (latching there would skip the transcript leg and flash
 * the chrome). Only an empty workspace is ready with no thread picked — it
 * routes to the creating view and nothing will ever be picked. Resyncs reset
 * `synchronized` to false via `emptyThreadState()`, so the predicate drops
 * again mid-session — `App` latches it for boot and only the transcript pane
 * re-gates afterwards, never the whole app.
 */
export function isBootReady(
  shell: ShellState,
  openThreadId: string | null,
  thread: ThreadState,
): boolean {
  if (!shell.synchronized) return false;
  if (openThreadId !== null) return thread.synchronized;
  return visibleThreads(shell).length === 0;
}

/** Which leg of the boot the loading screen names while `isBootReady` is false. */
export function bootLoadingStage(shell: ShellState): BootStage {
  return shell.synchronized ? "transcript" : "threads";
}
