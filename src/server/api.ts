/**
 * The client API: everything a frontend needs from the core, and the only
 * thing it is allowed to need.
 *
 * This contract used to live in `tui/app/app.tsx` as `TuiClient`, which
 * had it backwards — the TUI owned the surface the CLI and any future
 * app also talk through. It is six methods wide — subscriptions, commands,
 * queries, and two reads the TUI needs directly — and nothing above it
 * reaches past it into `core/`.
 *
 * It is typed end to end: `dispatch` narrows on the literal `type` of the
 * command it is handed and resolves to that command's result, so a
 * misspelled field is a compile error rather than a silently ignored key.
 * The shapes themselves live in `./protocol.ts`, next to the runtime
 * decoder a transport uses for frames that arrive untyped.
 *
 * `DirectConnection` (`./connection.ts`) is the in-process implementation.
 * A transport-backed one (socket or stdio, for an out-of-process app)
 * implements the same interface, which is the point of naming it here.
 */
import type {
  CommandOf,
  CommandResult,
  CommandType,
  ConfigPayload,
  QueryOf,
  QueryResult,
  QueryType,
  ShellFrame,
  ThreadFrame,
} from "./protocol.js";

export type {
  Command,
  CommandOf,
  CommandResult,
  CommandType,
  ConfigPayload,
  Query,
  QueryOf,
  QueryResult,
  QueryType,
  SettingsSnapshot,
  ShellFrame,
  ThreadFrame,
  GitBranch,
  GitCommit,
  GitOverview,
  GitWorktreeStatus,
  ForgeChecks,
  ForgeDetection,
  ForgeKind,
  ForgeRequest,
  ForgeRequestDetail,
  ForgeRequestState,
  MergeStrategy,
} from "./protocol.js";

export interface ClientApi {
  /** Shell-level state: projects and the thread list. */
  subscribeShell(
    options: { afterSequence?: number },
    onItem: (item: ShellFrame) => void,
    onError: (error: unknown) => void,
  ): () => void;
  /** One thread's snapshots plus live streaming frames. */
  subscribeThread(
    threadId: string,
    options: { afterSequence?: number },
    onItem: (item: ThreadFrame) => void,
    onError: (error: unknown) => void,
  ): () => void;
  /**
   * Every mutation: thread/project/turn commands, keyed by `type`.
   * `commandId` is optional correlation — a transport assigns one when the
   * caller does not, so clients never hand-roll it.
   */
  dispatch<T extends CommandType>(command: CommandOf<T>): Promise<CommandResult<T>>;
  /** Reads — projects, thread lists and views, task status. Never changes anything. */
  query<T extends QueryType>(query: QueryOf<T>): Promise<QueryResult<T>>;
  turnDiff(threadId: string, toTurnCount: number): Promise<string | null>;
  getConfig(): Promise<ConfigPayload>;
}
