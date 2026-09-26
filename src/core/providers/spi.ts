/**
 * Provider SPI — the driver contract for direct provider runtimes.
 *
 * Own code, mirroring the shape of the upstream reference's
 * `provider/Services/ProviderAdapter.ts` (capabilities, lifecycle, state,
 * streaming) without lifting its Layers or host services. Imports only our
 * own root types plus `effect` type-level modules, so drivers stay
 * dependency-clean. See ARCHITECTURE.md §4.
 */
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { McpServerSpec } from "../mcp.js";
import type { InteractionMode, ModelSelection, RuntimeMode } from "../types.js";

/** Provider surfaces we own. Cursor and Antigravity are out of scope. */
export type ProviderDriverKind = "claude" | "codex" | "grok" | "opencode";

export const PROVIDER_DRIVER_KINDS: readonly ProviderDriverKind[] = [
  "claude",
  "codex",
  "grok",
  "opencode",
];

export function isProviderDriverKind(value: unknown): value is ProviderDriverKind {
  return (
    typeof value === "string" &&
    (PROVIDER_DRIVER_KINDS as readonly string[]).includes(value)
  );
}

export type ThreadId = string;
export type TurnId = string;
export type ApprovalRequestId = string;

export type ProviderSessionModelSwitchMode = "in-session" | "unsupported";

export interface ProviderSessionStartInput {
  readonly threadId: ThreadId;
  readonly workingDirectory: string;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: InteractionMode;
  /**
   * The native session handle a previous process left behind (see
   * `ProviderAdapter.resumeCursor`). A driver resumes that provider-side
   * session — history included — when it still exists, and starts fresh
   * when it does not; a stale cursor must never fail the start.
   */
  readonly resumeCursor?: string;
  /**
   * MCP servers to expose in this session (`core/mcp.ts`), in addition to
   * whatever the provider's own config already loads. Each driver maps
   * them to its native form; a server the provider cannot run (Grok
   * without `mcpCapabilities.http`) is dropped rather than failing.
   */
  readonly mcpServers?: readonly McpServerSpec[];
  /**
   * Runtime instructions (`core/threads/instructions.ts`), appended to the
   * provider's own system prompt through its native channel. Absent when
   * none apply; a driver must then leave the prompt exactly as it is.
   */
  readonly instructions?: string;
}

/**
 * How full the provider's context window is right now — what the model
 * will see on its next request, not tokens spent (`TokenUsageDelta`).
 * Every field but `usedTokens` is null when the provider does not say.
 */
export interface ContextWindowUsage {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
  /** Of `usedTokens`, how much the last request read from the prompt cache. */
  readonly cachedInputTokens: number | null;
  /** Where the provider compacts on its own, when it does. */
  readonly autoCompactThreshold: number | null;
  readonly compactsAutomatically: boolean | null;
  /**
   * Running session total in USD, from the provider's own accounting
   * (Claude: the SDK's `total_cost_usd`) — an estimate, not a bill.
   * Absent when the provider reports no cost figure.
   */
  readonly costUsd?: number;
}

/**
 * What fills the context window, by category — the detail behind a
 * `ContextWindowUsage` reading. `estimated` is true when the shares are
 * moxen's estimate (message sizes scaled to the provider's real total)
 * rather than the provider's own count.
 */
export interface ContextBreakdown extends ContextWindowUsage {
  readonly categories: ReadonlyArray<{
    readonly name: string;
    readonly tokens: number;
    /** `used` fills the window; `free` is what is left; `buffer` is held back for compaction. */
    readonly kind: "used" | "free" | "buffer";
  }>;
  readonly estimated: boolean;
  /** Per-tool shares of the conversation, heaviest first, when the provider reports them. */
  readonly tools?: ReadonlyArray<{ readonly name: string; readonly tokens: number }>;
}

export interface ProviderSession {
  readonly threadId: ThreadId;
  readonly provider: ProviderDriverKind;
  readonly workingDirectory: string;
  readonly startedAt: string;
}

/** An image sent with a prompt: raw base64, not a data URL. */
export interface ProviderImage {
  readonly name: string;
  readonly mimeType: string;
  readonly data: string;
}

export interface ProviderSendTurnInput {
  readonly threadId: ThreadId;
  readonly prompt: string;
  /**
   * Images for the model to see, in each provider's native form. A driver
   * whose provider cannot take them names them in the prompt instead —
   * see `imageMention` — so an image is never silently dropped.
   */
  readonly images?: readonly ProviderImage[];
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: InteractionMode;
}

export interface ProviderTurnStartResult {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
}

export type ProviderApprovalDecision =
  | { readonly kind: "accept" }
  | { readonly kind: "acceptForSession" }
  | { readonly kind: "decline" }
  | { readonly kind: "cancel" };

export type ProviderUserInputAnswers = Record<string, string>;

export interface ProviderUploadFeedbackInput {
  readonly threadId: ThreadId;
}

export interface ProviderUploadFeedbackResult {
  readonly threadId: ThreadId;
  readonly url: string | null;
}

/**
 * How a driver runs manual context compaction. Native drivers expose a
 * start call; slash-command drivers get the command sent as a turn.
 */
export type ProviderCompaction<TError> =
  | {
      readonly type: "native";
      readonly start: (
        threadId: ThreadId,
        modelSelection?: ModelSelection,
      ) => Effect.Effect<void, TError>;
    }
  | { readonly type: "slash-command"; readonly command: `/${string}` };

export interface ProviderAdapterCapabilities {
  readonly sessionModelSwitch: ProviderSessionModelSwitchMode;
  /** Starts a resumed turn with no synthetic user prompt when true. */
  readonly promptlessTurnContinuation?: boolean;
  /** False when native conversation history cannot be rewound. */
  readonly supportsConversationRollback?: boolean;
}

export interface ProviderThreadTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<unknown>;
}

export interface ProviderThreadSnapshot {
  readonly threadId: ThreadId;
  readonly turns: ReadonlyArray<ProviderThreadTurnSnapshot>;
}

export interface TokenUsageDelta {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheCreate: number;
  readonly output: number;
  readonly thinking: number;
}

export interface RateLimitWindow {
  readonly id: string;
  readonly label: string;
  readonly resetsAt: string | null;
  readonly exhausted: boolean;
  /** How much of the window is spent (0–100), when the provider says. */
  readonly usedPercent?: number | null;
}

/**
 * Canonical runtime events. Every event carries its `provider` source tag;
 * `raw` preserves the provider-native payload for debugging (the
 * `providerRuntime.ts` raw-tag pattern). The typed bus in `src/events/`
 * transports these plus thread-lifecycle events.
 */
export type ProviderRuntimeEvent =
  | {
      /**
       * Streamed assistant text. `text` is a *delta*, appended to the
       * message named by `messageId` (one assistant message of possibly
       * several in a turn); a driver that only sees cumulative snapshots
       * sends the difference.
       */
      readonly type: "message.part.updated";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly messageId?: string;
      readonly text: string;
      readonly raw?: unknown;
    }
  | {
      /**
       * An assistant message that turned out *not* to be the turn's answer:
       * the notes the model writes between tool calls ("Now checking X…").
       * Sent once, whole, when the next tool call or message shows it was
       * interim. The turn's final message is never sent as a note.
       */
      readonly type: "assistant.note";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly messageId: string;
      readonly text: string;
    }
  | {
      /**
       * A turn the provider started on its own — Claude Code waking the
       * session for a finished background task or a Monitor event. It is
       * awaited and settled like any other turn (`awaitTurn`).
       */
      readonly type: "turn.started";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly origin: "background";
    }
  | {
      /** One background task (a `run_in_background` command, a Monitor watch, a background subagent) starting or ending. */
      readonly type: "background.task";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly taskId: string;
      readonly status: "started" | "completed" | "failed" | "stopped";
      readonly description: string;
      readonly taskType: string | null;
      readonly toolUseId: string | null;
      readonly summary: string | null;
    }
  | {
      /** The full live set of background tasks (a level, not an edge). */
      readonly type: "background.tasks.changed";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly tasks: ReadonlyArray<BackgroundTaskSummary>;
    }
  | {
      readonly type: "tool.execute.started" | "tool.execute.updated" | "tool.execute.completed";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly tool: string;
      readonly raw?: unknown;
    }
  | {
      readonly type: "turn.plan.updated";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly raw?: unknown;
    }
  | {
      readonly type: "permission.request.opened" | "permission.request.resolved";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly requestId: ApprovalRequestId;
      readonly raw?: unknown;
    }
  | {
      readonly type: "user-input.request.opened" | "user-input.request.resolved";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly requestId: ApprovalRequestId;
      readonly raw?: unknown;
    }
  | {
      readonly type: "token-usage.updated";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly usage: TokenUsageDelta;
      readonly raw?: unknown;
    }
  | {
      /**
       * One stretch of the model's reasoning: sent as it starts (`running`)
       * and once it ends (`completed`, with how long it took). `text` is the
       * whole readable summary so far — empty when the provider shows none.
       * The same `reasoningId` names both, so they fold into one row.
       */
      readonly type: "reasoning.updated";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly reasoningId: string;
      readonly status: "running" | "completed";
      readonly text: string;
      readonly startedAt: string | null;
      readonly durationMs: number | null;
    }
  | {
      /**
       * Readable reasoning as it streams, between a `reasoning.updated`
       * `running` and its `completed`: `text` is a delta of the
       * `reasoningId` stretch. Live only — the completed event carries the
       * whole text for the record.
       */
      readonly type: "reasoning.delta";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly reasoningId: string;
      readonly text: string;
    }
  | {
      /**
       * The provider switched models on its own mid-turn — Claude re-running
       * a request its safety classifiers flagged (`refusal-fallback`). With
       * `scope: "session"` the switch sticks: later turns run on `to`.
       * `local` means only a subagent's or side question's response moved.
       */
      readonly type: "model.changed";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly from: string | null;
      readonly to: string;
      /** Display names for `from` / `to`, when the driver knows them. */
      readonly fromLabel?: string | null;
      readonly toLabel?: string | null;
      /** `auto`: any other switch the provider made itself (an overloaded model's fallback, say). */
      readonly reason: "refusal-fallback" | "auto";
      readonly scope: "session" | "local";
      /** Why the request was flagged ("bio", "cyber", …), when the provider says. */
      readonly category: string | null;
    }
  | {
      /**
       * Something the provider did to the session that the transcript should
       * say: it compacted the conversation (`detail` is the summary it kept),
       * or its auto mode refused a tool call (`detail` is why).
       */
      readonly type: "session.notice";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly notice: "compacted" | "permission-denied";
      readonly title: string;
      readonly detail: string | null;
    }
  | {
      /**
       * What the user will likely ask next, predicted after a turn ends
       * (Claude's prompt suggestions). Arrives after the turn has settled.
       */
      readonly type: "prompt.suggested";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly suggestion: string;
    }
  | {
      /**
       * A provider-native subagent (Claude's Agent tool) starting or
       * stopping, with the last thing it said. Moxen's own delegated threads
       * are threads, not this.
       */
      readonly type: "subagent.updated";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly agentId: string;
      readonly agentType: string;
      readonly status: "started" | "stopped";
      readonly lastMessage: string | null;
    }
  | {
      /**
       * Output already streamed that the provider took back — the partial a
       * refused request produced before it was re-run. `messageIds` name
       * assistant messages (as `message.part.updated` / `assistant.note`
       * carried them); `toolUseIds` name tool calls.
       */
      readonly type: "message.retracted";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly messageIds: ReadonlyArray<string>;
      readonly toolUseIds: ReadonlyArray<string>;
    }
  | {
      readonly type: "rate-limits.updated";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly windows: ReadonlyArray<RateLimitWindow>;
      readonly raw?: unknown;
    }
  | {
      readonly type: "turn.completed" | "turn.failed" | "turn.interrupted";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly raw?: unknown;
    }
  | {
      readonly type: "thread.state.changed";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly state: string;
      readonly raw?: unknown;
    };

/** A live background task, as a driver reports it. */
export interface BackgroundTaskSummary {
  readonly taskId: string;
  readonly taskType: string | null;
  readonly description: string;
  /** The tool that started it ("Bash", "Monitor", …) — same `taskType` covers both, so this is what tells them apart. */
  readonly toolName?: string | null;
  /** The originating command/script text, when the driver can recover it. */
  readonly command?: string | null;
  readonly startedAt?: string | null;
}

export interface ProviderAdapter<TError = unknown> {
  readonly provider: ProviderDriverKind;
  readonly capabilities: ProviderAdapterCapabilities;

  readonly startSession: (
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, TError>;

  /**
   * The native handle that resumes this thread's provider-side session in a
   * later process, or null while there is none yet. The turn runner
   * persists it on the thread; without it every restart of the host
   * process silently started the provider with an empty history.
   */
  readonly resumeCursor: (threadId: ThreadId) => string | null;

  /**
   * The thread's current context-window reading, or null when the driver
   * has none. Read by the turn runner as a turn settles and recorded as a
   * `context-window.updated` activity, which is what the TUI's context
   * indicator shows. Omitted by drivers whose provider reports nothing.
   */
  readonly contextUsage?: (threadId: ThreadId) => Promise<ContextWindowUsage | null>;

  /**
   * Hand the running turn more input without interrupting it: the model
   * picks the text up at its next step (Claude folds it in between tool
   * rounds; Codex `turn/steer`). Fails when no turn is running. Omitted by
   * drivers whose provider cannot take input mid-turn (Grok's ACP has no
   * such request) — a steer then stays recorded in the ledger only.
   */
  readonly steerTurn?: (threadId: ThreadId, text: string) => Effect.Effect<void, TError>;

  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  /** Omitted when the driver does not support manual context compaction. */
  readonly compaction?: ProviderCompaction<TError>;

  readonly interruptTurn: (
    threadId: ThreadId,
    turnId?: TurnId,
  ) => Effect.Effect<void, TError>;

  readonly respondToRequest: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Effect.Effect<void, TError>;

  readonly respondToUserInput: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Effect.Effect<void, TError>;

  readonly stopSession: (threadId: ThreadId) => Effect.Effect<void, TError>;

  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  readonly hasSession: (threadId: ThreadId) => Effect.Effect<boolean>;

  readonly readThread: (
    threadId: ThreadId,
  ) => Effect.Effect<ProviderThreadSnapshot, TError>;

  readonly rollbackThread: (
    threadId: ThreadId,
    numTurns: number,
  ) => Effect.Effect<ProviderThreadSnapshot, TError>;

  readonly uploadFeedback?: (
    input: ProviderUploadFeedbackInput,
  ) => Effect.Effect<ProviderUploadFeedbackResult, TError>;

  readonly stopAll: () => Effect.Effect<void, TError>;

  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}

/** A side question (`/btw`); see `TurnDriver.sideQuestion`. */
export interface SideQuestionInput {
  /** The thread's native session (`resumeCursor`); null answers without its context. */
  readonly cursor: string | null;
  readonly workingDirectory: string;
  readonly question: string;
  /** The thread's model, so the side answer comes from the same one. */
  readonly model?: string;
  readonly signal?: AbortSignal;
}

export interface SideAnswer {
  readonly text: string;
  /** False when there was no session to copy, so the answer had no thread context. */
  readonly withContext: boolean;
}
