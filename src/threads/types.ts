/**
 * Store-native thread model. This is ours — not the T3 projection shape.
 *
 * A thread carries its lifecycle flags (settled/snoozed/archived), its
 * model selection, and its environment; turns, messages, activity rows,
 * and checkpoint refs live in per-thread append-only JSONL ledgers.
 * The CLI projection to T3-shaped envelopes happens at cutover, not here.
 * See DECOUPLE.md §9.
 */
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
  readonly modelSelection: ModelSelection | null;
  /** Steer/restart chains reference the turn they superseded. */
  readonly parentTurnId: string | null;
  readonly error: string | null;
  /** Tokens spent by the provider run; null when the driver reported none. */
  readonly usage: TurnUsage | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
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

export interface StoredMessage {
  readonly id: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly role: MessageRole;
  readonly text: string;
  readonly createdAt: string;
}

export interface StoredActivity {
  readonly id: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly kind: string;
  readonly summary: string;
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
}

export type ReadView = "messages" | "turn-items" | "plans" | "checkpoints" | "transfers";

export interface ThreadReadResult {
  readonly thread: StoredThread;
  readonly turns: StoredTurn[];
  readonly messages: StoredMessage[];
  readonly activities: StoredActivity[];
  readonly checkpoints: StoredCheckpoint[];
}
