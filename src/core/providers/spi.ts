/**
 * Provider SPI — the driver contract for direct provider runtimes.
 *
 * Own code, T3-shaped: mirrors the shape of T3's
 * `provider/Services/ProviderAdapter.ts` (capabilities, lifecycle, state,
 * streaming) without lifting its Layers or host services. Imports only our
 * own root types plus `effect` type-level modules, so drivers stay
 * dependency-clean. See DECOUPLE.md §4.
 */
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { InteractionMode, ModelSelection, RuntimeMode } from "../types.js";

/** Provider surfaces we own. Cursor/Antigravity/T3 drivers are dropped. */
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
}

export interface ProviderSession {
  readonly threadId: ThreadId;
  readonly provider: ProviderDriverKind;
  readonly workingDirectory: string;
  readonly startedAt: string;
}

export interface ProviderSendTurnInput {
  readonly threadId: ThreadId;
  readonly prompt: string;
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
}

/**
 * Canonical runtime events. Every event carries its `provider` source tag;
 * `raw` preserves the provider-native payload for debugging (the
 * `providerRuntime.ts` raw-tag pattern). The typed bus in `src/events/`
 * transports these plus thread-lifecycle events.
 */
export type ProviderRuntimeEvent =
  | {
      readonly type: "message.part.updated";
      readonly provider: ProviderDriverKind;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | null;
      readonly text: string;
      readonly raw?: unknown;
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

export interface ProviderAdapter<TError = unknown> {
  readonly provider: ProviderDriverKind;
  readonly capabilities: ProviderAdapterCapabilities;

  readonly startSession: (
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, TError>;

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
