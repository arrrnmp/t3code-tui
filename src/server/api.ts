/**
 * The client API: everything a frontend needs from the core, and the only
 * thing it is allowed to need.
 *
 * This contract used to live in `tui/app/app.tsx` as `TuiClient`, which
 * had it backwards — the TUI owned the surface the CLI and any future
 * app also talk through. It is five methods wide, and nothing above it
 * reaches past it into `core/`.
 *
 * `DirectConnection` (`./connection.ts`) is the in-process implementation.
 * A transport-backed one (socket or stdio, for an out-of-process app)
 * implements the same interface, which is the point of naming it here.
 */

export interface ClientApi {
  /** Shell-level state: projects and the thread list. */
  subscribeShell(
    options: { afterSequence?: number },
    onItem: (item: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void;
  /** One thread's snapshots plus live streaming frames. */
  subscribeThread(
    threadId: string,
    options: { afterSequence?: number },
    onItem: (item: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void;
  /** Every mutation: thread/project/turn commands, keyed by `type`. */
  dispatch(command: unknown): Promise<unknown>;
  turnDiff(threadId: string, toTurnCount: number): Promise<string | null>;
  getConfig(): Promise<unknown>;
}
