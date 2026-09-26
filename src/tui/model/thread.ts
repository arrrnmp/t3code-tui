import type { MessageEnvelope, SessionEnvelope, ThreadEnvelope, ActivityEnvelope } from "../../core/types.js";
import { describeActivity } from "./activity.js";
import { USAGE_CONTINUE_PROMPT } from "../../core/threads/views.js";

export interface TimelineEntry {
  id: string;
  at: string;
  turnId: string | null;
  kind: "user" | "assistant" | "activity" | "turn-diff" | "proposed-plan";
  text: string;
  streaming: boolean;
  tone: string | null;
  activityKind: string | null;
  message: MessageEnvelope | null;
  activity: ActivityEnvelope | null;
  checkpoint: TurnCheckpoint | null;
  /** Per-file +A/-D from the turn's checkpoint; the wire strips tool input. */
  editStats: { added: number; removed: number } | null;
  /** A plan proposed for this turn (plan-mode approval flow) — see `ProposedPlanEnvelope`. */
  proposedPlan: TurnProposedPlan | null;
  /** A user message still waiting: queued behind the running turn, or scheduled (`scheduledFor`). */
  queued?: { scheduledFor: string | null; reason: "user" | "usage-reset" | "usage-hold" | null } | undefined;
}

export interface TurnCheckpoint {
  turnId: string;
  checkpointTurnCount: number;
  status: string;
  files: TurnDiffFile[];
}

export interface TurnDiffFile {
  path: string;
  kind: string;
  additions: number;
  deletions: number;
}

/** A plan proposed while the thread ran in plan-approval mode (see `InteractionMode`). */
export interface TurnProposedPlan {
  id: string;
  turnId: string | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `ThreadTokenUsageSnapshot` — a driver-reported reading of the provider's
 * own context window, not something we compute. Lives on
 * `OrchestrationV2ProviderThread.contextUsage`, pushed live via a
 * `provider-thread.updated` event. Only Claude Code has been confirmed to
 * populate it; other drivers may never send a non-null value, in which case
 * `contextUsage` just stays null.
 */
export interface ContextUsage {
  usedTokens: number;
  maxTokens: number | null;
  totalProcessedTokens: number | null;
  cachedInputTokens: number | null;
  compactsAutomatically: boolean | null;
  autoCompactThreshold: number | null;
  /** Running session total in USD; Claude only, null when the driver never reports one. */
  costUsd: number | null;
}

export interface ContextResume {
  beforeTokens: number;
  afterTokens: number;
}

export interface ThreadState {
  snapshotSequence: number;
  thread: ThreadEnvelope | null;
  messages: MessageEnvelope[];
  activities: ActivityEnvelope[];
  checkpoints: TurnCheckpoint[];
  proposedPlans: TurnProposedPlan[];
  session: SessionEnvelope | null;
  contextUsage: ContextUsage | null;
  /** `createdAt` of the latest `context-window.updated` activity feeding
      `contextUsage` — the desktop resume-compaction banner keys its 70-minute
      staleness check off this timestamp, so the TUI needs it too. */
  contextWindowUpdatedAt: string | null;
  /** Last resume that dropped context (`thread.state.changed` carrying a
      smaller `afterTokens` than `beforeTokens`); null when the latest state
      change carried no such drop. */
  contextResume: ContextResume | null;
  synchronized: boolean;
  /** Event types this build does not model, kept so unknown traffic is visible rather than silent. */
  unhandled: Record<string, number>;
  /**
   * Reasoning text streamed live for thoughts still running, by the
   * `toolCallId` their activity rows share. Never stored: a thought's
   * completed row carries its whole text and supersedes this.
   */
  liveReasoning: Record<string, string>;
}

export function emptyThreadState(): ThreadState {
  return {
    snapshotSequence: 0,
    thread: null,
    messages: [],
    activities: [],
    checkpoints: [],
    proposedPlans: [],
    session: null,
    contextUsage: null,
    contextWindowUpdatedAt: null,
    contextResume: null,
    synchronized: false,
    unhandled: {},
    liveReasoning: {},
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => asRecord(entry) !== null) : [];
}

function decodeMessage(raw: Record<string, unknown>): MessageEnvelope | null {
  const id = raw.id ?? raw.messageId;
  if (typeof id !== "string" || typeof raw.text !== "string") return null;
  const role = raw.role;
  return {
    ...raw,
    id,
    role: role === "user" || role === "assistant" || role === "system" ? role : "assistant",
    text: raw.text,
    turnId: typeof raw.turnId === "string" ? raw.turnId : null,
    streaming: raw.streaming === true,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
  };
}

function decodeActivity(raw: Record<string, unknown>): ActivityEnvelope | null {
  if (typeof raw.id !== "string" || typeof raw.kind !== "string") return null;
  return {
    ...raw,
    id: raw.id,
    tone: typeof raw.tone === "string" ? raw.tone : "info",
    kind: raw.kind,
    summary: typeof raw.summary === "string" ? raw.summary : raw.kind,
    turnId: typeof raw.turnId === "string" ? raw.turnId : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
  };
}

function decodeCheckpoint(raw: Record<string, unknown>): TurnCheckpoint | null {
  if (typeof raw.turnId !== "string" || typeof raw.checkpointTurnCount !== "number") return null;
  const files = Array.isArray(raw.files) ? raw.files : [];
  return {
    turnId: raw.turnId,
    checkpointTurnCount: raw.checkpointTurnCount,
    status: typeof raw.status === "string" ? raw.status : "unknown",
    files: files.flatMap((entry) => {
      const file = asRecord(entry);
      if (file === null || typeof file.path !== "string") return [];
      return [
        {
          path: file.path,
          kind: typeof file.kind === "string" ? file.kind : "modified",
          additions: typeof file.additions === "number" ? file.additions : 0,
          deletions: typeof file.deletions === "number" ? file.deletions : 0,
        },
      ];
    }),
  };
}

function decodeContextUsage(raw: Record<string, unknown>): ContextUsage | null {
  if (typeof raw.usedTokens !== "number") return null;
  return {
    usedTokens: raw.usedTokens,
    maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : null,
    totalProcessedTokens: typeof raw.totalProcessedTokens === "number" ? raw.totalProcessedTokens : null,
    cachedInputTokens: typeof raw.cachedInputTokens === "number" ? raw.cachedInputTokens : null,
    compactsAutomatically: typeof raw.compactsAutomatically === "boolean" ? raw.compactsAutomatically : null,
    autoCompactThreshold: typeof raw.autoCompactThreshold === "number" ? raw.autoCompactThreshold : null,
    costUsd: typeof raw.costUsd === "number" ? raw.costUsd : null,
  };
}

/**
 * The real live signal for context usage on this server build: a
 * `context-window.updated` *activity* (`{usedTokens, maxTokens,
 * totalProcessedTokens, inputTokens, outputTokens}`) appended after tool
 * calls, not the `provider-thread.updated`/`contextUsage` shape
 * `snapshotContextUsage` below expects. The turn runner writes one as each
 * turn settles (`core/threads/execute.ts` `recordContextUsage`); cache and
 * auto-compact fields are present when the provider reports them
 * (Claude: all of them; Codex: cache only) and null otherwise.
 */
function decodeContextWindowActivity(activity: ActivityEnvelope): ContextUsage | null {
  const payload = asRecord(activity.payload);
  if (payload === null || typeof payload.usedTokens !== "number") return null;
  return {
    usedTokens: payload.usedTokens,
    maxTokens: typeof payload.maxTokens === "number" ? payload.maxTokens : null,
    totalProcessedTokens: typeof payload.totalProcessedTokens === "number" ? payload.totalProcessedTokens : null,
    cachedInputTokens: typeof payload.cachedInputTokens === "number" ? payload.cachedInputTokens : null,
    compactsAutomatically: typeof payload.compactsAutomatically === "boolean" ? payload.compactsAutomatically : null,
    autoCompactThreshold: typeof payload.autoCompactThreshold === "number" ? payload.autoCompactThreshold : null,
    costUsd: typeof payload.costUsd === "number" ? payload.costUsd : null,
  };
}

function latestContextWindowUsage(activities: readonly ActivityEnvelope[]): {
  usage: ContextUsage;
  updatedAt: string;
} | null {
  for (let index = activities.length - 1; index >= 0; index--) {
    const activity = activities[index];
    if (activity === undefined || activity.kind !== "context-window.updated") continue;
    const decoded = decodeContextWindowActivity(activity);
    if (decoded !== null) return { usage: decoded, updatedAt: activity.createdAt };
  }
  return null;
}

function decodeProposedPlan(raw: Record<string, unknown>): TurnProposedPlan | null {
  if (typeof raw.id !== "string" || typeof raw.planMarkdown !== "string") return null;
  return {
    id: raw.id,
    turnId: typeof raw.turnId === "string" ? raw.turnId : null,
    planMarkdown: raw.planMarkdown,
    implementedAt: typeof raw.implementedAt === "string" ? raw.implementedAt : null,
    implementationThreadId: typeof raw.implementationThreadId === "string" ? raw.implementationThreadId : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
  };
}

function upsertById<T extends { id: string }>(rows: readonly T[], next: T): T[] {
  const index = rows.findIndex((row) => row.id === next.id);
  if (index === -1) return [...rows, next];
  const copy = [...rows];
  copy[index] = next;
  return copy;
}

/**
 * `OrchestrationV2ProviderThread.contextUsage` off a resnapshot: nested on
 * the thread itself in this build's simplified snapshot shape, or — if a
 * server ever sends the full flat `OrchestrationV2ThreadProjection` here
 * instead — a sibling `providerThreads` array of full entities. Either way
 * it is the same `ThreadTokenUsageSnapshot`, so try both without guessing
 * which one this particular server build uses.
 */
function snapshotContextUsage(snapshot: Record<string, unknown>, thread: Record<string, unknown>): ContextUsage | null {
  const nested = asRecord(thread.contextUsage);
  if (nested !== null) {
    const decoded = decodeContextUsage(nested);
    if (decoded !== null) return decoded;
  }
  const providerThreads = Array.isArray(snapshot.providerThreads) ? snapshot.providerThreads : [];
  for (const entry of providerThreads) {
    const record = asRecord(entry);
    const usage = record === null ? null : asRecord(record.contextUsage);
    if (usage === null) continue;
    const decoded = decodeContextUsage(usage);
    if (decoded !== null) return decoded;
  }
  return null;
}

/**
 * A snapshot lists only stored messages, so replacing the list wiped any
 * text still streaming — and the next delta re-added just a fragment. Keep
 * a streaming message while its turn is still running and nothing stored
 * has taken its id; a stored note arrives under the same id and replaces it.
 */
function withLiveStreams(
  stored: readonly MessageEnvelope[],
  previous: readonly MessageEnvelope[],
  thread: Record<string, unknown>,
): MessageEnvelope[] {
  const latest = asRecord(thread.latestTurn);
  const running = latest !== null && latest.state === "running" && typeof latest.turnId === "string" ? latest.turnId : null;
  if (running === null) return [...stored];
  const ids = new Set(stored.map((message) => message.id));
  const live = previous.filter((message) => message.streaming && message.turnId === running && !ids.has(message.id));
  return [...stored, ...live];
}

function applySnapshot(state: ThreadState, snapshot: Record<string, unknown>): ThreadState {
  const thread = asRecord(snapshot.thread);
  if (thread === null) return state;
  const activities = asArray(thread.activities).flatMap((row) => decodeActivity(row) ?? []);
  const windowUsage = latestContextWindowUsage(activities);
  const stored = asArray(thread.messages).flatMap((row) => decodeMessage(row) ?? []);
  // Streamed thinking outlives a snapshot until its thought's completed row lands.
  const finished = new Set(
    activities.flatMap((activity) => {
      const payload = asRecord(activity.payload);
      return payload?.itemType === "reasoning" && payload.status === "completed" && typeof payload.toolCallId === "string" ? [payload.toolCallId] : [];
    }),
  );
  const liveReasoning = Object.fromEntries(Object.entries(state.liveReasoning).filter(([toolCallId]) => !finished.has(toolCallId)));
  return {
    ...state,
    liveReasoning,
    snapshotSequence: typeof snapshot.snapshotSequence === "number" ? snapshot.snapshotSequence : state.snapshotSequence,
    thread: thread as unknown as ThreadEnvelope,
    messages: withLiveStreams(stored, state.messages, thread),
    activities,
    checkpoints: asArray(thread.checkpoints).flatMap((row) => decodeCheckpoint(row) ?? []),
    proposedPlans: asArray(thread.proposedPlans).flatMap((row) => decodeProposedPlan(row) ?? []),
    session: (asRecord(thread.session) as SessionEnvelope | null) ?? null,
    contextUsage: snapshotContextUsage(snapshot, thread) ?? windowUsage?.usage ?? state.contextUsage,
    contextWindowUpdatedAt: windowUsage?.updatedAt ?? state.contextWindowUpdatedAt,
  };
}

/**
 * Folds one `orchestration.subscribeThread` frame into state. Frames arrive as
 * a snapshot, a `synchronized` marker, then live domain events; anything this
 * build does not model is counted rather than dropped silently.
 */
export function applyThreadFrame(state: ThreadState, frame: unknown): ThreadState {
  const record = asRecord(frame);
  if (record === null) return state;

  if (record.kind === "snapshot") {
    const snapshot = asRecord(record.snapshot);
    return snapshot === null ? state : applySnapshot(state, snapshot);
  }
  if (record.kind === "synchronized") return { ...state, synchronized: true };
  if (record.kind !== "event") return state;

  const event = asRecord(record.event);
  if (event === null) return state;
  const payload = asRecord(event.payload);
  const type = typeof event.type === "string" ? event.type : "unknown";

  if (payload !== null && type === "thread.message-sent") {
    // The wire nests the message (`payload.message`, see `server/protocol.ts`);
    // decoding the payload itself found no id and dropped every streamed
    // delta, so live text never showed. A flat payload is still accepted.
    const message = decodeMessage(asRecord(payload.message) ?? payload);
    if (message === null) return state;
    // The server streams an assistant reply as many `thread.message-sent`
    // events carrying incremental `text` with `streaming: true`, then one
    // final event with `streaming: false` and empty text. Mirror the
    // projector: append while streaming, keep what we have on an empty
    // close. Replacing here is what left replies blank until resubscribe.
    const existing = state.messages.find((row) => row.id === message.id);
    const text =
      existing === undefined
        ? message.text
        : message.streaming
          ? `${existing.text}${message.text}`
          : message.text.length > 0
            ? message.text
            : existing.text;
    return { ...state, messages: upsertById(state.messages, { ...message, text }) };
  }
  if (payload !== null && type === "thread.reasoning-delta") {
    const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : null;
    const text = typeof payload.text === "string" ? payload.text : "";
    if (toolCallId === null || text.length === 0) return state;
    return { ...state, liveReasoning: { ...state.liveReasoning, [toolCallId]: `${state.liveReasoning[toolCallId] ?? ""}${text}` } };
  }
  if (payload !== null && type === "thread.activity-appended") {
    const raw = asRecord(payload.activity);
    const activity = raw === null ? null : decodeActivity(raw);
    if (activity === null) return state;
    const windowUsage =
      activity.kind === "context-window.updated" ? decodeContextWindowActivity(activity) : null;
    const contextUsage = windowUsage ?? state.contextUsage;
    const contextWindowUpdatedAt =
      windowUsage === null ? state.contextWindowUpdatedAt : activity.createdAt;
    return { ...state, activities: upsertById(state.activities, activity), contextUsage, contextWindowUpdatedAt };
  }
  if (payload !== null && type === "thread.turn-diff-completed") {
    const checkpoint = decodeCheckpoint(payload);
    if (checkpoint === null) return state;
    const index = state.checkpoints.findIndex((row) => row.turnId === checkpoint.turnId);
    const checkpoints = index === -1 ? [...state.checkpoints, checkpoint] : [...state.checkpoints];
    if (index !== -1) checkpoints[index] = checkpoint;
    return { ...state, checkpoints };
  }
  // The exact live event name for a newly proposed plan isn't pinned down in
  // this build (plans otherwise only arrive on a resnapshot), so this matches
  // on the payload's own shape — a plan is the one payload carrying
  // `planMarkdown` — rather than a guessed `type` string.
  if (payload !== null && typeof payload.id === "string" && typeof payload.planMarkdown === "string") {
    const plan = decodeProposedPlan(payload);
    return plan === null ? state : { ...state, proposedPlans: upsertById(state.proposedPlans, plan) };
  }
  if (payload !== null && type === "thread.session-set") {
    const session = asRecord(payload.session);
    return session === null ? state : { ...state, session: session as unknown as SessionEnvelope };
  }
  // `OrchestrationV2ProviderThread` — the payload is the full entity, not a
  // wrapper, so `contextUsage` sits directly on it (`orchestrationV2.ts`'s
  // `ORCHESTRATION_V2_WS_METHODS.subscribeThread`/`OrchestrationV2ThreadProjection`
  // confirm this shape; there is no separate `thread.token-usage.updated`
  // event on the client-facing wire — that name only exists on the
  // server-internal provider-runtime adapter bus).
  if (payload !== null && type === "provider-thread.updated") {
    const usage = asRecord(payload.contextUsage);
    const contextUsage = usage === null ? null : decodeContextUsage(usage);
    return contextUsage === null ? state : { ...state, contextUsage };
  }
  // A resume that dropped context arrives as `thread.state.changed` carrying
  // `beforeTokens`/`afterTokens`: record the drop so the UI can flag it.
  // Anything else (ordinary transitions, context that grew) clears the flag
  // — the event is consumed either way, never `unhandled`.
  if (type === "thread.state.changed") {
    const before = payload !== null && typeof payload.beforeTokens === "number" ? payload.beforeTokens : null;
    const after = payload !== null && typeof payload.afterTokens === "number" ? payload.afterTokens : null;
    if (before !== null && after !== null && after < before) {
      return { ...state, contextResume: { beforeTokens: before, afterTokens: after } };
    }
    return { ...state, contextResume: null };
  }

  return { ...state, unhandled: { ...state.unhandled, [type]: (state.unhandled[type] ?? 0) + 1 } };
}

/**
 * The universal fallback name every driver reaches for when a payload
 * names no tool (`asString(...) ?? "tool"`). It identifies nothing, so it
 * must never win over a row that did name the call.
 */
const PLACEHOLDER_TOOL_NAME = "tool";

/** Does this value say anything, or is it a hole the merge should skip? */
function isInformative(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

/**
 * Later payloads win per key — but only where they actually say something.
 *
 * A call's rows are written by different provider events and are not
 * uniformly rich: the row that reports a result often knows only the
 * result. Claude's `tool_result` block carries no tool name and no input;
 * ACP `tool_call_update` sends changed fields only. Replacing wholesale
 * therefore let the *poorest* row win, turning a finished
 * `Read(note.txt)` into a nameless `tool` card with the file dumped into
 * it. Merging keeps what any row knew, so the card only ever gains
 * detail as the call progresses.
 */
function mergePayloads(older: unknown, newer: unknown): unknown {
  const base = asRecord(older);
  const next = asRecord(newer);
  if (base === null || next === null) return isInformative(newer) ? newer : older;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(next)) {
    const current = merged[key];
    if (asRecord(value) !== null && asRecord(current) !== null) {
      merged[key] = mergePayloads(current, value);
      continue;
    }
    if (!isInformative(value)) continue;
    // A placeholder name is not an update, it is the absence of one.
    if (
      (key === "tool" || key === "title") &&
      value === PLACEHOLDER_TOOL_NAME &&
      isInformative(current) &&
      current !== PLACEHOLDER_TOOL_NAME
    ) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

/**
 * A tool call emits started/updated/completed rows that all describe the same
 * work, so they collapse onto the first row's position, merging each new
 * payload into what earlier rows already knew — otherwise the transcript is
 * mostly duplicate headers. Plan checklists re-emit on every step change, so
 * they collapse per turn too.
 */
function collapseToolActivities(activities: readonly ActivityEnvelope[]): ActivityEnvelope[] {
  const positions = new Map<string, number>();
  const ordered: ActivityEnvelope[] = [];

  for (const activity of activities) {
    const payload = asRecord(activity.payload);
    const toolCallId = payload?.toolCallId;
    const taskId = payload?.taskId;
    const key =
      typeof toolCallId === "string"
        ? `tool:${toolCallId}`
        : typeof taskId === "string"
          ? `task:${taskId}`
          : activity.kind === "turn.plan.updated"
            ? `plan:${activity.turnId ?? activity.id}`
            : null;

    if (key === null) {
      ordered.push(activity);
      continue;
    }
    const index = positions.get(key);
    if (index === undefined) {
      positions.set(key, ordered.length);
      ordered.push(activity);
      continue;
    }
    const first = ordered[index];
    if (first !== undefined) {
      ordered[index] = {
        ...activity,
        id: first.id,
        createdAt: first.createdAt,
        payload: mergePayloads(first.payload, activity.payload),
      };
    }
  }
  return ordered;
}

/**
 * Plan checklists never reach the transcript: the pinned tasks panel
 * (`latestPlan`, toggled with ctrl+t) already renders the live checklist, so
 * inline `turn.plan.updated` cards and `todowrite` tool rows would only
 * duplicate it. This covers both full payloads (parsed as a `todos` view)
 * and the stripped wire shape, where only `todowrite`/`N todos` titles
 * survive.
 */
export function isPlanActivity(activity: ActivityEnvelope): boolean {
  if (activity.kind === "turn.plan.updated") return true;
  try {
    if (describeActivity(activity).kind === "todos") return true;
  } catch {
    // Fall through to the title heuristic below.
  }
  const titles = [activity.summary, asRecord(activity.payload)?.title]
    .filter((value): value is string => typeof value === "string");
  return titles.some((title) => /todowrite/i.test(title) || /^\d+\s+todos?$/i.test(title.trim()));
}

/**
 * Server bookkeeping that never carries conversational content: a
 * `context-window.updated` activity only exists to feed the context-usage
 * card (`latestContextWindowUsage` above) and a `checkpoint.captured`
 * activity only duplicates the dedicated "diff turn N" row already built
 * from `state.checkpoints`. Neither has ever had a reason to show as its own
 * transcript line — rendering them verbatim (`activity.summary`, via the
 * generic "note" fallback in `describeActivity`) is what previously printed
 * a bare "Context window updated"/"Checkpoint captured" row after nearly
 * every tool call.
 */
function isBookkeepingActivity(activity: ActivityEnvelope): boolean {
  return (
    activity.kind === "context-window.updated" ||
    activity.kind === "checkpoint.captured" ||
    // The answer itself is visible (answer panel + the user's next message);
    // a bare "User input submitted" row adds nothing.
    activity.kind === "user-input.resolved" ||
    // Tool-approval brackets: they exist so the working clock can leave the
    // wait out; the prompt itself is shown live, and the tool call that
    // follows is the visible outcome.
    activity.kind === "permission.requested" ||
    activity.kind === "permission.resolved" ||
    // Our own ledger's turn bookkeeping. These rows exist so `threads read`
    // can reconstruct a turn's lifecycle; none of them carries anything the
    // transcript doesn't already show. Left in, a plain two-message chat
    // read as "Worked for 4s · 2 steps" over a `turn.started` echo of the
    // prompt and a `turn.completed` row whose summary is a raw turn id.
    // `turn.failed` is deliberately absent: its summary is the real error.
    TURN_LIFECYCLE_KINDS.has(activity.kind) ||
    // The live set feeds the background panel. (Per-task rows stay: they
    // collapse by `taskId` into one card that goes running → finished.)
    activity.kind === "background.tasks" ||
    // A tombstone: what it names is hidden, the row itself says nothing.
    activity.kind === "message.retracted" ||
    // A native subagent's lifecycle: its Agent tool call already has a card
    // in the transcript; these rows feed the agents view.
    activity.kind === "subagent" ||
    // Offered in the composer instead (`promptSuggestion`).
    activity.kind === "prompt.suggestion"
  );
}

/** A tool call the provider took back with its refused attempt. */
function isRetractedToolActivity(activity: ActivityEnvelope, retracted: ReadonlySet<string>): boolean {
  if (retracted.size === 0) return false;
  const callId = asRecord(activity.payload)?.toolCallId;
  return typeof callId === "string" && retracted.has(callId);
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface BackgroundTaskRow {
  taskId: string;
  taskType: string | null;
  description: string;
  /** The tool that started it ("Bash", "Monitor", …); null when the driver never reported one. */
  toolName: string | null;
  command: string | null;
  startedAt: string | null;
}

/**
 * The background tasks running now — `run_in_background` commands, Monitor
 * watches, background subagents — from the latest `background.tasks` row
 * (the provider's full live set, written whenever it changes). Empty when
 * the latest set is empty or none was ever reported.
 */
export function latestBackgroundTasks(state: ThreadState): BackgroundTaskRow[] {
  for (let index = state.activities.length - 1; index >= 0; index -= 1) {
    const activity = state.activities[index];
    if (activity === undefined || activity.kind !== "background.tasks") continue;
    const payload = asRecord(activity.payload);
    const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
    return tasks.flatMap((raw) => {
      const task = asRecord(raw);
      const taskId = task === null ? null : stringOf(task.taskId);
      if (task === null || taskId === null) return [];
      return [
        {
          taskId,
          taskType: stringOf(task.taskType),
          description: stringOf(task.description) ?? taskId,
          toolName: stringOf(task.toolName),
          command: stringOf(task.command),
          startedAt: stringOf(task.startedAt),
        },
      ];
    });
  }
  return [];
}

/**
 * "1 shell, 1 monitor" / "3 shells" — the composer footer's background
 * segment, Claude Code-style. Groups by `toolName` (falling back to "task"
 * for anything else, e.g. subagents); null when nothing is running, which
 * hides the segment.
 */
export type BackgroundTaskKind = "shell" | "monitor" | "agent" | "task";

/** `Bash` → shell, `Monitor` → monitor, a subagent → agent; `taskType` covers shells and monitors alike, so the tool decides. */
export function backgroundTaskKind(task: Pick<BackgroundTaskRow, "toolName" | "taskType">): BackgroundTaskKind {
  if (task.toolName === "Bash") return "shell";
  if (task.toolName === "Monitor") return "monitor";
  if (task.toolName === "Agent" || task.toolName === "Task") return "agent";
  if (task.taskType === "local_agent" || task.taskType === "remote_agent") return "agent";
  if (task.taskType === "local_bash") return "shell";
  return "task";
}

/** What a task row is called: its description, else its command's first line, else its id — never blank. */
export function backgroundTaskTitle(task: Pick<BackgroundTaskRow, "description" | "command" | "taskId">): string {
  const description = task.description.trim();
  if (description) return description;
  const command = task.command?.trim().split("\n")[0]?.trim();
  return command || task.taskId;
}

export function backgroundSummaryLabel(tasks: readonly BackgroundTaskRow[]): string | null {
  if (tasks.length === 0) return null;
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const kind = backgroundTaskKind(task);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => `${count} ${count === 1 ? kind : `${kind}s`}`).join(", ");
}

/**
 * Ledger rows whose summary is either a raw id or an echo of a message
 * rendered elsewhere (see `isBookkeepingActivity`). `handoff-note` is not
 * one of these — it is content a human wrote for the next reader.
 */
const TURN_LIFECYCLE_KINDS: ReadonlySet<string> = new Set([
  "turn.started",
  "turn.queued",
  "turn.scheduled",
  // Held for a usage reset: the Queued panel says so, next to the message.
  "turn.held",
  "turn.promoted",
  "turn.completed",
  "turn.interrupted",
  "turn.steered",
  "message.injected",
]);

/**
 * An `AskUserQuestion`/`question` *tool* row — started/updated/completed
 * echoes with stripped input ("Tool call started / AskUserQuestion: {}").
 * The same question already renders as the friendly `? question` row from
 * its `user-input.requested` activity (see `describeActivity`), so these
 * tool echoes never reach the transcript.
 */
export function isQuestionToolActivity(activity: ActivityEnvelope): boolean {
  const payload = asRecord(activity.payload);
  if (payload === null) return false;
  const itemType = payload.itemType;
  if (itemType !== "dynamic_tool_call" && itemType !== "collab_agent_tool_call") return false;
  const data = asRecord(payload.data) ?? {};
  const rawTool = data.tool ?? data.toolName;
  if (typeof rawTool === "string") {
    const name = rawTool.toLowerCase();
    if (name === "askuserquestion" || name === "question") return true;
  }
  // Started rows can arrive nameless — match the `Name: {json}` echo instead.
  const title = typeof payload.title === "string" ? payload.title : "";
  const detail = typeof payload.detail === "string" ? payload.detail : "";
  const summary = typeof activity.summary === "string" ? activity.summary : "";
  return /askuserquestion/i.test(`${title} ${detail} ${summary}`);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function sameFile(left: string, right: string): boolean {
  const a = normalizeSlashes(left);
  const b = normalizeSlashes(right);
  return a.length > 0 && b.length > 0 && (a.endsWith(b) || b.endsWith(a));
}

/**
 * The subscription strips tool input, so per-call +/- counts cannot come
 * from the activity itself. The turn's checkpoint carries per-file additions
 * and deletions instead — match the edited file by path suffix.
 */
function editStatsFor(
  activity: ActivityEnvelope,
  checkpoint: TurnCheckpoint | null,
): { added: number; removed: number } | null {
  if (checkpoint === null) return null;
  let path: string | null = null;
  try {
    const view = describeActivity(activity);
    path = view.kind === "file" ? view.path : null;
  } catch {
    return null;
  }
  if (path === null) return null;
  const file = checkpoint.files.find((row) => sameFile(row.path, path));
  if (file === undefined) return null;
  return { added: file.additions, removed: file.deletions };
}

export interface PendingUserInputOption {
  label: string;
  description: string | null;
  value: string | null;
  /** Markdown shown while the option is highlighted (a mockup, a snippet). */
  preview: string | null;
}

export interface PendingUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: PendingUserInputOption[];
  multiSelect: boolean;
  allowCustomAnswer: boolean;
}

export interface PendingUserInputRequest {
  requestId: string;
  questions: PendingUserInputQuestion[];
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Decodes a `user-input.requested` activity (requestId + full questions with
 * options), or null when malformed. This is the only place the wire carries
 * everything needed to answer — snapshots have just pending flags, and the
 * sibling question *tool* activity has options without ids or linkage.
 */
function decodeUserInputRequest(activity: ActivityEnvelope): PendingUserInputRequest | null {
  const payload = asRecord(activity.payload);
  if (payload === null) return null;
  const requestId = asText(payload.requestId);
  const rawQuestions = payload.questions;
  if (requestId === null || requestId.length === 0 || !Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }
  const questions: PendingUserInputQuestion[] = [];
  for (const raw of rawQuestions) {
    const record = asRecord(raw);
    if (record === null) continue;
    const id = asText(record.id);
    const question = asText(record.question);
    const header = asText(record.header);
    if (id === null || question === null || header === null || !Array.isArray(record.options)) continue;
    const options: PendingUserInputOption[] = [];
    for (const rawOption of record.options) {
      const option = asRecord(rawOption);
      const label = option === null ? null : asText(option.label);
      if (label === null) continue;
      options.push({
        label,
        description: asText(option?.description),
        value: asText(option?.value),
        preview: asText(option?.preview),
      });
    }
    questions.push({
      id,
      header,
      question,
      options,
      multiSelect: record.multiSelect === true,
      allowCustomAnswer: record.allowCustomAnswer !== false,
    });
  }
  if (questions.length === 0) return null;
  return { requestId, questions };
}

/**
 * Open agent questions in arrival order: `user-input.requested` activities
 * minus answered ones (`user-input.resolved` carries the same requestId).
 */
export function pendingUserInputRequests(state: ThreadState): PendingUserInputRequest[] {
  const resolved = new Set<string>();
  const requested: PendingUserInputRequest[] = [];
  for (const activity of state.activities) {
    if (activity.kind === "user-input.resolved") {
      const requestId = asText(asRecord(activity.payload)?.requestId);
      if (requestId !== null) resolved.add(requestId);
      continue;
    }
    if (activity.kind !== "user-input.requested") continue;
    const request = decodeUserInputRequest(activity);
    if (request !== null) requested.push(request);
  }
  return requested.filter((request) => !resolved.has(request.requestId));
}

/**
 * Turns taken back before they ran: a queued or scheduled message cancelled
 * while it waited. The ledger marks the interrupt `beforeStart`; older rows
 * are recognised by a queued/scheduled turn that was interrupted without
 * ever being promoted.
 */
export function cancelledBeforeStart(activities: readonly ActivityEnvelope[]): Set<string> {
  const waited = new Set<string>();
  const promoted = new Set<string>();
  const interrupted = new Set<string>();
  const cancelled = new Set<string>();
  for (const activity of activities) {
    const turnId = activity.turnId;
    if (turnId === null) continue;
    if (activity.kind === "turn.queued" || activity.kind === "turn.scheduled") waited.add(turnId);
    else if (activity.kind === "turn.promoted") promoted.add(turnId);
    else if (activity.kind === "turn.interrupted") {
      interrupted.add(turnId);
      if (asRecord(activity.payload)?.beforeStart === true) cancelled.add(turnId);
    }
  }
  for (const turnId of interrupted) if (waited.has(turnId) && !promoted.has(turnId)) cancelled.add(turnId);
  return cancelled;
}

/** Turns that have not run: still waiting in the queue, or cancelled before they started. */
function unstartedTurnIds(state: ThreadState): Set<string> {
  const unstarted = cancelledBeforeStart(state.activities);
  for (const queued of state.thread?.queuedTurns ?? []) unstarted.add(queued.turnId);
  return unstarted;
}

/**
 * The continue moxen sends once a usage limit resets: tagged `usage-continue`,
 * or (in threads from before the tag) recognised by its fixed text.
 */
export function isUsageContinue(message: MessageEnvelope | null): boolean {
  if (message === null) return false;
  return message.origin === "usage-continue" || (message.role === "user" && message.text === USAGE_CONTINUE_PROMPT);
}

/** One message the agent has not been sent yet, for the Queued panel. */
export interface QueuedMessage {
  readonly turnId: string;
  readonly messageId: string;
  readonly text: string;
  readonly attachments: number;
  /** When it will be sent, if it waits for a time rather than for the turn. */
  readonly scheduledFor: string | null;
  readonly reason: "user" | "usage-reset" | "usage-hold" | null;
}

/**
 * Messages still waiting to reach the agent, in the order they will be
 * sent: the ones queued behind the running turn first (a settle promotes
 * the oldest ungated one), then those waiting for a time, soonest first.
 * A waiting continue is left out — the usage-limit banner owns it.
 */
export function queuedMessages(state: ThreadState): QueuedMessage[] {
  const byId = new Map(state.messages.map((message) => [message.id, message] as const));
  const items = (state.thread?.queuedTurns ?? []).flatMap((queued): QueuedMessage[] => {
    const message = byId.get(queued.messageId);
    if (message === undefined || queued.scheduleReason === "usage-reset" || isUsageContinue(message)) return [];
    const attachments = Array.isArray(message.attachments) ? message.attachments.length : 0;
    return [
      {
        turnId: queued.turnId,
        messageId: queued.messageId,
        text: message.text,
        attachments,
        scheduledFor: queued.scheduledFor,
        reason: queued.scheduleReason,
      },
    ];
  });
  const ungated = items.filter((item) => item.scheduledFor === null);
  const timed = items
    .filter((item) => item.scheduledFor !== null)
    .sort((left, right) => Date.parse(left.scheduledFor!) - Date.parse(right.scheduledFor!));
  return [...ungated, ...timed];
}

/** A running thought's rows carry no text yet: give them what has streamed so far. */
function withLiveReasoning(activities: readonly ActivityEnvelope[], live: Record<string, string>): readonly ActivityEnvelope[] {
  if (Object.keys(live).length === 0) return activities;
  return activities.map((activity) => {
    const payload = asRecord(activity.payload);
    if (payload?.itemType !== "reasoning" || payload.status === "completed" || typeof payload.toolCallId !== "string") return activity;
    const text = live[payload.toolCallId];
    return text === undefined ? activity : { ...activity, payload: { ...payload, text } };
  });
}

/** The provider's own one-line "limit reached" reply: "You've hit your session limit · resets 4:40am (Europe/Madrid)". */
const PROVIDER_LIMIT_TEXT = /^you['’]ve (hit|reached) your [^\n]*limit[^\n]*$/iu;

/** Messages and activities interleaved into the single chronological list the chat pane renders. */
export function timeline(state: ThreadState): TimelineEntry[] {
  const checkpointsByTurn = new Map(state.checkpoints.map((checkpoint) => [checkpoint.turnId, checkpoint]));
  const retracted = retractedIds(state.activities);
  const waiting = new Map(
    (state.thread?.queuedTurns ?? []).map((queued) => [queued.messageId, { scheduledFor: queued.scheduledFor, reason: queued.scheduleReason }] as const),
  );
  // Taken back before running: gone from the transcript, prompt and all.
  const cancelled = cancelledBeforeStart(state.activities);
  const limitedTurns = new Set(
    state.activities.flatMap((activity) =>
      (activity.kind === "usage.limit" || activity.kind === "usage.wrap-up") && activity.turnId !== null ? [activity.turnId] : [],
    ),
  );
  const entries: TimelineEntry[] = [
    ...state.messages
      .filter((message) => !retracted.messages.has(message.id) && !cancelled.has(message.turnId ?? ""))
      // A message the agent has not been sent yet — queued behind the
      // running turn, scheduled, or held for a usage reset — is the Queued
      // panel's (and a waiting continue the usage-limit banner's). It joins
      // the transcript once it is sent, which is when the agent sees it.
      .filter((message) => !waiting.has(message.id))
      // Claude's own "You've hit your session limit · resets 4:40am" says
      // what the turn's usage-limit notice already shows, better.
      .filter((message) => !(message.role === "assistant" && limitedTurns.has(message.turnId ?? "") && PROVIDER_LIMIT_TEXT.test(message.text.trim())))
      .map((message) => ({
      ...(waiting.has(message.id) ? { queued: waiting.get(message.id) } : {}),
      id: message.id,
      at: message.createdAt,
      turnId: message.turnId,
      kind: message.role === "user" ? ("user" as const) : ("assistant" as const),
      text: message.text,
      streaming: message.streaming,
      tone: null,
      activityKind: null,
      message,
      activity: null,
      checkpoint: null,
      editStats: null,
      proposedPlan: null,
    })),
    ...collapseToolActivities(withLiveReasoning(state.activities, state.liveReasoning))
      .filter(
        (activity) =>
          !isPlanActivity(activity) &&
          !isBookkeepingActivity(activity) &&
          !cancelled.has(activity.turnId ?? "") &&
          !isQuestionToolActivity(activity) &&
          !isRetractedToolActivity(activity, retracted.toolCalls),
      )
      .map((activity) => ({
        id: activity.id,
        at: activity.createdAt,
        turnId: activity.turnId,
        kind: "activity" as const,
        text: activity.summary,
        streaming: false,
        tone: activity.tone,
        activityKind: activity.kind,
        message: null,
        activity,
        checkpoint: null,
        editStats: editStatsFor(activity, checkpointsByTurn.get(activity.turnId ?? "") ?? null),
        proposedPlan: null,
      })),
  ];

  // One row per turn for the turn's *net* diff, which is a different thing
  // from the per-call patches the tool rows now carry themselves: a file
  // edited three times shows three hunks inline and one combined result
  // here. (Before the tool rows carried their own input, this was the
  // only diff available at all.)
  for (const checkpoint of state.checkpoints) {
    if (checkpoint.files.length === 0) continue;
    const turnEntries = entries.filter((entry) => entry.turnId === checkpoint.turnId);
    const at = turnEntries.reduce((latest, entry) => (entry.at > latest ? entry.at : latest), "");
    if (at === "") continue;
    entries.push({
      id: `diff:${checkpoint.turnId}`,
      at,
      turnId: checkpoint.turnId,
      kind: "turn-diff",
      text: "",
      streaming: false,
      tone: null,
      activityKind: null,
      message: null,
      activity: null,
      checkpoint,
      editStats: null,
      proposedPlan: null,
    });
  }

  // A proposed plan stands in for the turn's reply (plan-approval mode skips
  // the normal assistant message), so it needs its own row rather than
  // riding along on an activity.
  for (const plan of state.proposedPlans) {
    const turnEntries = entries.filter((entry) => entry.turnId === plan.turnId);
    const at = turnEntries.reduce((latest, entry) => (entry.at > latest ? entry.at : latest), plan.updatedAt);
    entries.push({
      id: `plan:${plan.id}`,
      at,
      turnId: plan.turnId,
      kind: "proposed-plan",
      text: "",
      streaming: false,
      tone: null,
      activityKind: null,
      message: null,
      activity: null,
      checkpoint: null,
      editStats: null,
      proposedPlan: plan,
    });
  }
  return entries.sort((left, right) => {
    if (left.at !== right.at) return left.at.localeCompare(right.at);
    // A turn's diff summary closes the turn, so it sorts after its own rows.
    if (left.kind === "turn-diff" && right.kind !== "turn-diff") return 1;
    if (right.kind === "turn-diff" && left.kind !== "turn-diff") return -1;
    return left.id.localeCompare(right.id);
  });
}

export interface PlanSnapshot {
  items: { content: string; status: string }[];
  at: string;
}

/**
 * The latest `turn.plan.updated` checklist, for the bottom-anchored tasks
 * panel. The transcript keeps its own inline rendering; this is the live
 * summary Claude Code pins above the composer.
 */
export function latestPlan(state: ThreadState): PlanSnapshot | null {
  for (let index = state.activities.length - 1; index >= 0; index -= 1) {
    const activity = state.activities[index];
    if (activity === undefined || activity.kind !== "turn.plan.updated") continue;
    const payload = asRecord(activity.payload);
    const plan = payload === null ? null : payload.plan;
    if (!Array.isArray(plan)) continue;
    const items = plan.flatMap((row) => {
      const record = asRecord(row);
      const step = record === null || typeof record.step !== "string" || record.step.length === 0 ? null : record.step;
      if (step === null) return [];
      const status = record !== null && typeof record.status === "string" ? record.status : "pending";
      return [{ content: step, status }];
    });
    if (items.length === 0) continue;
    return { items, at: activity.createdAt };
  }
  return null;
}

export interface UsageLimitBlock {
  /** The window that ran out, as the provider names it ("Session", "Weekly"). */
  label: string | null;
  resetsAt: Date | null;
  rateLimitType: string | null;
  /** Met gracefully: the turn wraps up on a small allowance rather than stopping. */
  wrapUp: boolean;
}

/**
 * The thread's latest turn ran into a plan usage limit that has not reset
 * yet. The runner records the hit as a `usage.limit` row carrying the reset
 * instant, so no usage polling is needed to know when the thread can go on.
 */
export function detectUsageLimit(state: ThreadState, now: number = Date.now()): UsageLimitBlock | null {
  // A continue scheduled (or cancelled) after the hit hasn't run, so it
  // hasn't got through the limit: it must not count as the latest turn.
  const unstarted = unstartedTurnIds(state);
  const latestTurn =
    [...state.activities].reverse().find((activity) => activity.turnId !== null && !unstarted.has(activity.turnId))?.turnId ?? null;
  for (const activity of [...state.activities].reverse()) {
    if (activity.kind !== "usage.limit" && activity.kind !== "usage.wrap-up") continue;
    // Only the latest turn's hit counts: a later turn that ran got through.
    if (latestTurn !== null && activity.turnId !== latestTurn) return null;
    const payload = asRecord(activity.payload) ?? {};
    const resetsIso = typeof payload.resetsAt === "string" ? payload.resetsAt : null;
    const resetsAt = resetsIso === null || Number.isNaN(Date.parse(resetsIso)) ? null : new Date(resetsIso);
    if (resetsAt !== null && resetsAt.getTime() <= now) return null;
    return {
      label: typeof payload.label === "string" ? payload.label : null,
      resetsAt,
      rateLimitType: typeof payload.rateLimitType === "string" ? payload.rateLimitType : null,
      wrapUp: activity.kind === "usage.wrap-up",
    };
  }
  return null;
}

/**
 * The provider's guess at the user's next prompt, offered while the thread
 * is idle. It belongs to the turn it followed: once another turn exists (or
 * one is running) it is stale.
 */
export function promptSuggestion(state: ThreadState): string | null {
  const status = state.session?.status;
  if (status === "running" || status === "starting") return null;
  const latest = [...state.activities].reverse().find((activity) => activity.kind === "prompt.suggestion");
  if (latest === undefined) return null;
  const latestTurnId = state.thread?.latestTurn?.turnId ?? null;
  if (latestTurnId !== null && latest.turnId !== latestTurnId) return null;
  const suggestion = asRecord(latest.payload)?.suggestion;
  return typeof suggestion === "string" && suggestion.trim() ? suggestion.trim() : null;
}

/** "in 1h 12m" / "in 4m" / "now" until an instant. */
export function untilLabel(target: Date, now: number = Date.now()): string {
  const minutes = Math.ceil((target.getTime() - now) / 60_000);
  if (minutes <= 0) return "now";
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  return `in ${minutes}m`;
}

/**
 * Message and tool-call ids a provider took back (`message.retracted`
 * tombstones) — a refused attempt's output, re-run on a fallback model.
 */
export function retractedIds(activities: readonly ActivityEnvelope[]): { messages: Set<string>; toolCalls: Set<string> } {
  const messages = new Set<string>();
  const toolCalls = new Set<string>();
  for (const activity of activities) {
    if (activity.kind !== "message.retracted") continue;
    const payload = asRecord(activity.payload) ?? {};
    for (const id of Array.isArray(payload.messageIds) ? payload.messageIds : []) {
      if (typeof id === "string") messages.add(id);
    }
    for (const id of Array.isArray(payload.toolCallIds) ? payload.toolCallIds : []) {
      if (typeof id === "string") toolCalls.add(id);
    }
  }
  return { messages, toolCalls };
}

/**
 * Mirrors the desktop `shouldOfferResumeCompaction`
 * (`upstream/apps/web/src/components/chat/ContextWindowMeter.logic.ts`):
 * the "Resume with less context" banner is a plain staleness check, not a
 * wire event — idle Claude threads whose context snapshot holds >= 100k
 * tokens and hasn't refreshed in >= 70 minutes get the banner. 70 minutes
 * is a guess at the prompt cache having expired (its 1-hour TTL plus
 * margin): the API reports cache hits after the fact, never when the cache
 * goes cold. `now` is the same ticking clock the timeline already uses.
 */
export const RESUME_COMPACTION_MINUTES = 70;
export const RESUME_COMPACTION_TOKENS = 100_000;

export function shouldOfferResumeCompaction(
  state: ThreadState,
  providerInstanceId: string | null | undefined,
  now: number,
): boolean {
  if (providerInstanceId !== "claudeAgent") return false;
  // A running turn keeps the cache warm with every request: nothing to
  // resume, whatever the last reading's age. (Readings used to arrive only
  // when a turn ended, so an hour-long turn tripped this mid-flight.)
  const status = state.session?.status;
  if (status === "running" || status === "starting") return false;
  const usedTokens = state.contextUsage?.usedTokens ?? 0;
  if (usedTokens < RESUME_COMPACTION_TOKENS) return false;
  const updatedAt =
    state.contextWindowUpdatedAt === null ? NaN : Date.parse(state.contextWindowUpdatedAt);
  return Number.isFinite(updatedAt) && now - updatedAt >= RESUME_COMPACTION_MINUTES * 60_000;
}

/** Dismissal key for the resume banner — one slot per (thread, snapshot),
    so a new snapshot reopens it after an earlier dismissal on the thread. */
export function resumeCompactionKey(state: ThreadState): string | null {
  const threadId = state.thread?.id;
  if (threadId === undefined || state.contextWindowUpdatedAt === null) return null;
  return `${threadId}:${state.contextWindowUpdatedAt}`;
}

/** One settled delegated task, as a task-notification message carries it. */
export interface TaskNotificationView {
  taskId: string;
  title: string;
  status: string;
  durationMs: number | null;
  model: string | null;
  branch: string | null;
  headline: string | null;
  filesChanged: number | null;
  additions: number | null;
  deletions: number | null;
}

/**
 * The tasks a moxen-written "your delegated tasks settled" message reports,
 * or null for any other message (a user's own prompt included).
 */
export function taskNotifications(message: MessageEnvelope | null): TaskNotificationView[] | null {
  if (message === null || message.origin !== "task-notification") return null;
  const tasks = asRecord(message.notification)?.tasks;
  if (!Array.isArray(tasks)) return null;
  const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
  const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const views = tasks.flatMap((raw): TaskNotificationView[] => {
    const task = asRecord(raw);
    const taskId = text(task?.taskId);
    if (task === null || taskId === null) return [];
    return [
      {
        taskId,
        title: text(task.title) ?? "Delegated task",
        status: text(task.status) ?? "completed",
        durationMs: count(task.durationMs),
        model: text(task.model),
        branch: text(task.branch),
        headline: text(task.headline),
        filesChanged: count(task.filesChanged),
        additions: count(task.additions),
        deletions: count(task.deletions),
      },
    ];
  });
  return views.length > 0 ? views : null;
}
