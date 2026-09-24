/**
 * Ledger-local projection into the envelope shapes (`ThreadEnvelope`,
 * `MessageEnvelope`, …). The store owns the truth; this module renders it in
 * the shapes the CLI envelopes and the TUI projectors already speak, so
 * cutover repoints the transport without renegotiating behavior.
 *
 * Derivations (documented once, applied everywhere):
 * - `latestTurn`: latest non-queued turn (`queued` has no envelope state);
 *   `error` → `"error"`, everything else maps 1:1.
 * - `session`: `running` while a turn runs (activeTurnId set), else
 *   `idle`; provider from the thread's model selection.
 * - `branch`/`worktreePath` from `env` (`worktreePath` set only in
 *   worktree mode).
 * - messages carry `streaming: false`, `updatedAt = createdAt`
 *   (streaming state is a subscription-frame concern, not ledger state).
 * - activities default to tone `"info"`; plans are always `[]` (no
 *   plan capture is wired yet — empty, never invented).
 */
import type {
  CheckpointEnvelope,
  LatestTurnEnvelope,
  MessageEnvelope,
  ProposedPlanEnvelope,
  SessionEnvelope,
  ThreadEnvelope,
  ActivityEnvelope,
} from "../types.js";
import type {
  StoredActivity,
  StoredCheckpoint,
  StoredMessage,
  StoredThread,
  StoredTurn,
} from "./types.js";

function latestMeaningfulTurn(turns: StoredTurn[]): StoredTurn | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]!.status !== "queued") return turns[index]!;
  }
  return null;
}

function latestTurnOf(turns: StoredTurn[]): LatestTurnEnvelope | null {
  const latest = latestMeaningfulTurn(turns);
  if (!latest) return null;
  return {
    turnId: latest.id,
    state:
      latest.status === "running"
        ? "running"
        : latest.status === "interrupted"
          ? "interrupted"
          : latest.status === "failed"
            ? "error"
            : "completed",
    requestedAt: latest.createdAt,
    startedAt: latest.status === "queued" ? null : latest.createdAt,
    completedAt: latest.completedAt,
    assistantMessageId: null,
  };
}

function sessionOf(thread: StoredThread, turns: StoredTurn[]): SessionEnvelope {
  const running = turns.find((turn) => turn.status === "running") ?? null;
  return {
    threadId: thread.id,
    status: running ? "running" : "idle",
    providerName: thread.modelSelection.instanceId,
    runtimeMode: thread.runtimeMode,
    activeTurnId: running?.id ?? null,
    lastError: null,
    updatedAt: thread.updatedAt,
  };
}

export function toMessageEnvelope(message: StoredMessage): MessageEnvelope {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
    streaming: false,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
  };
}

export function toActivityEnvelope(activity: StoredActivity): ActivityEnvelope {
  return {
    id: activity.id,
    tone: "info",
    kind: activity.kind,
    summary: activity.summary,
    turnId: activity.turnId,
    createdAt: activity.createdAt,
    // Tool rows only render as rich cards when their payload survives the
    // projection; without it every one degrades to a bare summary note.
    ...(activity.payload === undefined ? {} : { payload: activity.payload }),
  };
}

export function toCheckpointEnvelope(checkpoint: StoredCheckpoint, turnCount: number): CheckpointEnvelope {
  return {
    turnId: checkpoint.turnId,
    status: checkpoint.status,
    checkpointTurnCount: turnCount,
    ref: checkpoint.ref,
    baseRef: checkpoint.baseRef,
  };
}

export interface ProjectThreadInput {
  readonly messages?: StoredMessage[] | undefined;
  readonly activities?: StoredActivity[] | undefined;
  readonly checkpoints?: StoredCheckpoint[] | undefined;
  readonly plans?: ProposedPlanEnvelope[] | undefined;
}

/** Ledger-local projection into the envelope thread shape. */
export function toThreadEnvelope(thread: StoredThread, turns: StoredTurn[], input: ProjectThreadInput = {}): ThreadEnvelope {
  const running = turns.find((turn) => turn.status === "running") ?? null;
  const latestUser = [...(input.messages ?? [])].reverse().find((message) => message.role === "user") ?? null;
  // `checkpointTurnCount` is how many turns the thread had once this one
  // finished — 1-based, as every consumer reads it (the TUI's revert target
  // is `count - 1`; `turnDiff(threadId, count)` reads `turns[count - 1]`).
  const turnCount = new Map(turns.map((turn, index) => [turn.id, index + 1] as const));
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.env.branch,
    worktreePath: thread.env.mode === "worktree" ? thread.env.path : null,
    latestTurn: latestTurnOf(turns),
    session: sessionOf(thread, turns),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    deletedAt: thread.deletedAt,
    settledOverride: thread.settledOverride,
    settledAt: thread.settledAt,
    unsettledAt: thread.unsettledAt,
    snoozedUntil: thread.snoozedUntil,
    snoozedAt: thread.snoozedAt,
    latestUserMessageAt: latestUser?.createdAt ?? null,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    ...(input.messages ? { messages: input.messages.map(toMessageEnvelope) } : {}),
    ...(input.activities ? { activities: input.activities.map(toActivityEnvelope) } : {}),
    ...(input.checkpoints
      ? { checkpoints: input.checkpoints.map((checkpoint) => toCheckpointEnvelope(checkpoint, turnCount.get(checkpoint.turnId) ?? 0)) }
      : {}),
    proposedPlans: input.plans ?? [],
    turnModelSelections: Object.fromEntries(
      turns.flatMap((turn) => (turn.modelSelection ? [[turn.id, turn.modelSelection] as const] : [])),
    ),
  };
}
