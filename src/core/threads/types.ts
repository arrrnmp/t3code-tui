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

export interface StoredThread {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
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
}

export type TurnStatus = "queued" | "running" | "completed" | "interrupted" | "failed";

export type TurnDelivery = "started" | "queued" | "steered" | "restarted" | "injected";

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
  readonly error: string | null;
  /** Tokens spent by the provider run; null when the driver reported none. */
  readonly usage: TurnUsage | null;
  readonly createdAt: string;
  readonly updatedAt: string;
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
}

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
  readonly createdAt: string;
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
}

export type ReadView = "messages" | "turn-items" | "plans" | "checkpoints" | "transfers";

export interface ThreadReadResult {
  readonly thread: StoredThread;
  readonly turns: StoredTurn[];
  readonly messages: StoredMessage[];
  readonly activities: StoredActivity[];
  readonly checkpoints: StoredCheckpoint[];
}
