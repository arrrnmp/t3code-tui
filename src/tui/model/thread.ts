import type { T3Message, T3Session, T3Thread, T3ThreadActivity } from "../../types.js";
import { describeActivity } from "./activity.js";

export interface TimelineEntry {
  id: string;
  at: string;
  turnId: string | null;
  kind: "user" | "assistant" | "activity" | "turn-diff" | "proposed-plan";
  text: string;
  streaming: boolean;
  tone: string | null;
  activityKind: string | null;
  message: T3Message | null;
  activity: T3ThreadActivity | null;
  checkpoint: TurnCheckpoint | null;
  /** Per-file +A/-D from the turn's checkpoint; the wire strips tool input. */
  editStats: { added: number; removed: number } | null;
  /** A plan proposed for this turn (plan-mode approval flow) — see `T3ProposedPlan`. */
  proposedPlan: TurnProposedPlan | null;
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
 * own context window, not something T3 computes. Lives on
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
}

export interface ContextResume {
  beforeTokens: number;
  afterTokens: number;
}

export interface ThreadState {
  snapshotSequence: number;
  thread: T3Thread | null;
  messages: T3Message[];
  activities: T3ThreadActivity[];
  checkpoints: TurnCheckpoint[];
  proposedPlans: TurnProposedPlan[];
  session: T3Session | null;
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

function decodeMessage(raw: Record<string, unknown>): T3Message | null {
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

function decodeActivity(raw: Record<string, unknown>): T3ThreadActivity | null {
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
  };
}

/**
 * The real live signal for context usage on this server build: a
 * `context-window.updated` *activity* (`{usedTokens, maxTokens,
 * totalProcessedTokens, inputTokens, outputTokens}`) appended after tool
 * calls, not the `provider-thread.updated`/`contextUsage` shape
 * `snapshotContextUsage` below expects and which no thread observed here has
 * ever actually sent. No cache or auto-compact fields exist in this shape,
 * so those stay null rather than guessed.
 */
function decodeContextWindowActivity(activity: T3ThreadActivity): ContextUsage | null {
  const payload = asRecord(activity.payload);
  if (payload === null || typeof payload.usedTokens !== "number") return null;
  return {
    usedTokens: payload.usedTokens,
    maxTokens: typeof payload.maxTokens === "number" ? payload.maxTokens : null,
    totalProcessedTokens: typeof payload.totalProcessedTokens === "number" ? payload.totalProcessedTokens : null,
    cachedInputTokens: null,
    compactsAutomatically: null,
    autoCompactThreshold: null,
  };
}

function latestContextWindowUsage(activities: readonly T3ThreadActivity[]): {
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

function applySnapshot(state: ThreadState, snapshot: Record<string, unknown>): ThreadState {
  const thread = asRecord(snapshot.thread);
  if (thread === null) return state;
  const activities = asArray(thread.activities).flatMap((row) => decodeActivity(row) ?? []);
  const windowUsage = latestContextWindowUsage(activities);
  return {
    ...state,
    snapshotSequence: typeof snapshot.snapshotSequence === "number" ? snapshot.snapshotSequence : state.snapshotSequence,
    thread: thread as unknown as T3Thread,
    messages: asArray(thread.messages).flatMap((row) => decodeMessage(row) ?? []),
    activities,
    checkpoints: asArray(thread.checkpoints).flatMap((row) => decodeCheckpoint(row) ?? []),
    proposedPlans: asArray(thread.proposedPlans).flatMap((row) => decodeProposedPlan(row) ?? []),
    session: (asRecord(thread.session) as T3Session | null) ?? null,
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
    const message = decodeMessage(payload);
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
    return session === null ? state : { ...state, session: session as unknown as T3Session };
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
 * A tool call emits started/updated/completed rows that all describe the same
 * work, so they collapse onto the first row's position carrying the newest
 * payload — otherwise the transcript is mostly duplicate headers. Plan
 * checklists re-emit on every step change, so they collapse per turn too.
 */
function collapseToolActivities(activities: readonly T3ThreadActivity[]): T3ThreadActivity[] {
  const positions = new Map<string, number>();
  const ordered: T3ThreadActivity[] = [];

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
      ordered[index] = { ...activity, id: first.id, createdAt: first.createdAt };
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
export function isPlanActivity(activity: T3ThreadActivity): boolean {
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
function isBookkeepingActivity(activity: T3ThreadActivity): boolean {
  return (
    activity.kind === "context-window.updated" ||
    activity.kind === "checkpoint.captured" ||
    // The answer itself is visible (answer panel + the user's next message);
    // a bare "User input submitted" row adds nothing.
    activity.kind === "user-input.resolved"
  );
}

/**
 * An `AskUserQuestion`/`question` *tool* row — started/updated/completed
 * echoes with stripped input ("Tool call started / AskUserQuestion: {}").
 * The same question already renders as the friendly `? question` row from
 * its `user-input.requested` activity (see `describeActivity`), so these
 * tool echoes never reach the transcript.
 */
export function isQuestionToolActivity(activity: T3ThreadActivity): boolean {
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
  activity: T3ThreadActivity,
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
function decodeUserInputRequest(activity: T3ThreadActivity): PendingUserInputRequest | null {
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

/** Messages and activities interleaved into the single chronological list the chat pane renders. */
export function timeline(state: ThreadState): TimelineEntry[] {
  const checkpointsByTurn = new Map(state.checkpoints.map((checkpoint) => [checkpoint.turnId, checkpoint]));
  const entries: TimelineEntry[] = [
    ...state.messages.map((message) => ({
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
    ...collapseToolActivities(state.activities)
      .filter(
        (activity) =>
          !isPlanActivity(activity) && !isBookkeepingActivity(activity) && !isQuestionToolActivity(activity),
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

  // A turn's real diff lives on its checkpoint, not on the tool rows: T3 only
  // ships a ~180 character preview of tool input, so per-call patches cannot be
  // reconstructed from the transcript.
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
  message: string;
  resetsAt: Date | null;
  rateLimitType: string | null;
}

/**
 * A turn stopped by provider quota. The reset instant rides along on the
 * `runtime.warning` activity, so no usage polling is needed to know when the
 * thread can continue.
 */
export function detectUsageLimit(state: ThreadState): UsageLimitBlock | null {
  const lastError = state.session?.lastError;
  const stopped = state.session?.status === "stopped" || state.session?.status === "error";
  if (!stopped || typeof lastError !== "string" || !/usage limit/i.test(lastError)) return null;

  for (const activity of [...state.activities].reverse()) {
    if (activity.kind !== "runtime.warning") continue;
    const detail = asRecord(asRecord(activity.payload)?.detail);
    const resetsAt = detail?.resetsAt;
    if (typeof resetsAt === "number") {
      return {
        message: lastError,
        resetsAt: new Date(resetsAt * 1000),
        rateLimitType: typeof detail?.rateLimitType === "string" ? detail.rateLimitType : null,
      };
    }
  }
  return { message: lastError, resetsAt: null, rateLimitType: null };
}

/**
 * Mirrors the desktop `shouldOfferResumeCompaction`
 * (`upstream/apps/web/src/components/chat/ContextWindowMeter.logic.ts`):
 * the "Resume with less context" banner is a plain staleness check, not a
 * wire event — Claude threads whose context snapshot holds >= 100k tokens
 * and hasn't refreshed in >= 70 minutes get the banner. `now` is the same
 * ticking clock the timeline already uses.
 */
export const RESUME_COMPACTION_MINUTES = 70;
export const RESUME_COMPACTION_TOKENS = 100_000;

export function shouldOfferResumeCompaction(
  state: ThreadState,
  providerInstanceId: string | null | undefined,
  now: number,
): boolean {
  if (providerInstanceId !== "claudeAgent") return false;
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
