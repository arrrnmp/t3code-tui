/**
 * Store-native thread model. This is ours — not the envelope shape.
 *
 * A thread carries its lifecycle flags (settled/snoozed/archived), its
 * model selection, and its environment; turns, messages, activity rows,
 * and checkpoint refs live in per-thread append-only JSONL ledgers.
 * The CLI projection to envelope shapes happens at the boundary, not here.
 * See ARCHITECTURE.md §9.
 */
import type { ImageAttachmentUpload } from "../attachments.js";
import type { TaskNotification } from "./notify.js";
import type {
  InteractionMode,
  ModelSelection,
  RuntimeMode,
} from "../types.js";

export type ThreadStatus = "active" | "settled" | "snoozed";
export type ThreadListStatus = ThreadStatus | "all";

export type ThreadEnvMode = "local" | "worktree";

export interface ThreadEnv {
  readonly mode: ThreadEnvMode;
  readonly path: string;
  readonly branch: string | null;
}

/**
 * Where a thread's title came from: `seed` is moxen's own (a placeholder or
 * the first message's line), `provider` the provider's native session title,
 * `user` an explicit name. A provider title never replaces a `user` one.
 */
export type ThreadTitleSource = "seed" | "provider" | "user";

export interface StoredThread {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  /** Absent on threads stored before titles were tracked; read as `seed`. */
  readonly titleSource?: ThreadTitleSource;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly env: ThreadEnv;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly settledAt: string | null;
  readonly unsettledAt: string | null;
  readonly settledOverride: "settled" | "active" | null;
  readonly snoozedUntil: string | null;
  readonly snoozedAt: string | null;
  /** Set by drivers; settle is blocked while either is true. */
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  /**
   * Native provider session handle per provider instance (Claude session
   * id, Codex thread id, ACP session id, OpenCode session id), so a thread
   * resumes its provider-side history after the process that started the
   * session exits. Keyed by instance so switching providers and back
   * resumes rather than restarts. Absent on threads that never ran.
   */
  readonly providerSessions?: Readonly<Record<string, string>>;
  /** The provider's own subagents, running and latest finished (`subagents.ts`). Absent until the first. */
  readonly nativeSubagents?: readonly StoredNativeSubagent[];
}

/** One native subagent (Claude's Agent tool) as the thread record keeps it. */
export interface StoredNativeSubagent {
  readonly agentId: string;
  /** "Explore", "Plan", … ; "subagent" until its start hook names it. */
  readonly agentType: string;
  /** What it was asked to do (its Agent call's description), when known. */
  readonly description: string | null;
  readonly status: "running" | "completed" | "failed" | "stopped";
  readonly startedAt: string;
  readonly stoppedAt: string | null;
}

export type TurnStatus = "queued" | "running" | "completed" | "interrupted" | "failed";

/** `background`: a turn the provider started itself, woken by a finished background task or a Monitor event. */
export type TurnDelivery = "started" | "queued" | "steered" | "restarted" | "injected" | "background";

export interface StoredTurn {
  readonly id: string;
  readonly threadId: string;
  readonly status: TurnStatus;
  readonly delivery: TurnDelivery;
  readonly messageId: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  /**
   * The model the turn ran on. Always set on new turns; `null` only on
   * turns written before the turn recorded it (read those as unknown).
   */
  readonly modelSelection: ModelSelection | null;
  /** Steer/restart chains reference the turn they superseded. */
  readonly parentTurnId: string | null;
  /**
   * A queued turn that waits for this instant before it may run — a message
   * scheduled for later, or a continue set for when a usage limit resets.
   * Absent on turns that run as soon as the thread is free.
   */
  readonly scheduledFor?: string | null;
  /**
   * Why it was scheduled: the user's own choice; a continue set for when a
   * usage limit resets; or `usage-hold` — a message the user queued that
   * came up while a limit still stood, held for the reset rather than sent
   * into the wall.
   */
  readonly scheduleReason?: "user" | "usage-reset" | "usage-hold" | null;
  /** For an automatic continue after a usage limit: which attempt in a row (1-based). */
  readonly continueAttempt?: number;
  readonly error: string | null;
  /** Tokens spent by the provider run; null when the driver reported none. */
  readonly usage: TurnUsage | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** When a queued or scheduled turn actually started; a turn that ran at once started at `createdAt`. */
  readonly startedAt?: string;
  readonly completedAt: string | null;
  /**
   * The process expected to run the turn, set when it becomes `running`.
   * A running turn whose owner has died is orphaned — nothing will ever
   * settle it — and is interrupted the next time the thread is touched
   * (`reconcileOrphanedTurn`). Absent on turns written before it existed.
   */
  readonly owner?: TurnOwner | null;
}

export interface TurnOwner {
  readonly pid: number;
  readonly host: string;
}

/** Token totals per turn (mirrors the provider SPI delta, kept local to avoid layer tangles). */
export interface TurnUsage {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheCreate: number;
  readonly output: number;
  readonly thinking: number;
}

export type MessageRole = "user" | "assistant" | "system";

/** An image sent with a user message, saved under the store root. */
export interface StoredAttachment {
  readonly type: "image";
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Absolute path of the saved bytes. */
  readonly path: string;
}

export interface StoredMessage {
  readonly id: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly role: MessageRole;
  readonly text: string;
  readonly createdAt: string;
  readonly attachments?: readonly StoredAttachment[];
  /** A message moxen wrote into the thread rather than the user (see `MessageOrigin`). */
  readonly origin?: MessageOrigin;
  /** The origin's structured facts (`task-notification`: the tasks), for a client to draw. */
  readonly notification?: { readonly tasks: readonly TaskNotification[] };
}

/** `task-notification`: delegated tasks settling. `usage-continue`: picking up after a usage limit reset. */
export type MessageOrigin = "task-notification" | "usage-continue";

export interface StoredActivity {
  readonly id: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly kind: string;
  readonly summary: string;
  /**
   * Structured detail for rows that have any — tool calls carry the
   * renderer's payload shape (`itemType`, `data.tool`, `data.state.input`,
   * …; see `toolactivity.ts`). Lifecycle rows carry none.
   */
  readonly payload?: Record<string, unknown> | undefined;
  readonly createdAt: string;
}

export interface StoredCheckpoint {
  readonly id: string;
  readonly threadId: string;
  readonly turnId: string;
  /** `available` when both pre/post worktree captures exist; else `unavailable`. */
  readonly status: string;
  /** Post-turn capture sha (diff head). */
  readonly ref: string | null;
  /** Pre-turn capture sha (diff base). */
  readonly baseRef: string | null;
  /**
   * What the turn changed, per file, recorded as it settles. Absent on rows
   * written before it was recorded (clients get it backfilled on read).
   */
  readonly files?: ReadonlyArray<CheckpointFileStat>;
  readonly createdAt: string;
}

export interface CheckpointFileStat {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export type DelegationStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "waitTimedOut";

export interface StoredDelegation {
  readonly id: string;
  readonly parentThreadId: string;
  readonly childThreadId: string;
  readonly prompt: string;
  /** The branch the child's own worktree was cut from; absent when it shares the parent's checkout. */
  readonly baseBranch?: string | null;
  readonly status: DelegationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateThreadInput {
  /** Client-generated id (the TUI opens the thread before the store confirms); generated when omitted. */
  readonly id?: string;
  readonly projectId: string;
  readonly title: string;
  /** `user` for a title someone chose, which the provider's own title then leaves alone. */
  readonly titleSource?: ThreadTitleSource;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: InteractionMode;
  readonly env?: Partial<ThreadEnv>;
}

export type SendIfBusy = "reject" | "inject";
export type SendDelivery = "auto" | "steer" | "restart" | "queue";

export interface SendTurnInput {
  readonly prompt: string;
  readonly ifBusy?: SendIfBusy;
  readonly delivery?: SendDelivery;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: InteractionMode;
  readonly modelSelection?: ModelSelection;
  /** Settled threads require an explicit wake before they accept turns. */
  readonly wakeSettled?: boolean;
  readonly handoffNote?: string;
  /** Images sent with the prompt; saved and recorded on the user message. */
  readonly attachments?: readonly ImageAttachmentUpload[];
  /**
   * Hold the message until this instant: it is queued, and runs once it is
   * due and the thread is free. A time already past means "now".
   */
  readonly scheduledFor?: string;
  readonly scheduleReason?: "user" | "usage-reset";
  /** Set by the automatic continue after a usage limit (which attempt in a row). */
  readonly continueAttempt?: number;
  /** A message moxen writes itself (with its facts), rather than the user. */
  readonly origin?: MessageOrigin;
  readonly notification?: { readonly tasks: readonly TaskNotification[] };
}

export type ReadView = "messages" | "turn-items" | "plans" | "checkpoints" | "transfers";

export interface ThreadReadResult {
  readonly thread: StoredThread;
  readonly turns: StoredTurn[];
  readonly messages: StoredMessage[];
  readonly activities: StoredActivity[];
  readonly checkpoints: StoredCheckpoint[];
}
