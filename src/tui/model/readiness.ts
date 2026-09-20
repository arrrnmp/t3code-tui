import type { ShellState } from "./shell.js";
import type { ThreadState } from "./thread.js";

export type BootStage = "threads" | "transcript";

/**
 * Boot gate: the app renders its loading screen until the shell snapshot has
 * landed (thread list, projects) and — once launch-selection has picked a
 * thread — that thread's own snapshot has landed too. An empty but
 * synchronized workspace counts as ready (it routes to the creating view);
 * `openThreadId === null` only persists before launch-selection runs, so it
 * must not block on the thread leg. Resyncs reset `synchronized` to false
 * via `emptyThreadState()`, so the gate re-holds for free mid-session —
 * but only the transcript pane re-gates there (see `App`), never boot.
 */
export function isBootReady(
  shell: ShellState,
  openThreadId: string | null,
  thread: ThreadState,
): boolean {
  if (!shell.synchronized) return false;
  if (openThreadId === null) return true;
  return thread.synchronized;
}

/** Which leg of the boot the loading screen names while `isBootReady` is false. */
export function bootLoadingStage(shell: ShellState): BootStage {
  return shell.synchronized ? "transcript" : "threads";
}
