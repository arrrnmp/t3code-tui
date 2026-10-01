/**
 * Turn runner: the ledger-local replacement for dispatch-then-poll.
 *
 * One active turn per thread is enforced by the store mutex; this module
 * runs an accepted store turn against a provider driver and converges the
 * outcome (completion / failure / interruption) back into the ledger.
 * Around the run it captures git worktree checkpoints (pre/post) and
 * records usage from the driver outcome. Driver `streamEvents` are drained
 * by one shared pump per driver instance (a single consumer — queues
 * would otherwise grow unbounded) and fanned out to per-thread
 * subscribers, which is how the TUI streams live text without polling.
 *
 * Used by the CLI `send` path and the TUI `thread.turn.start` dispatch
 * alike; `src/backend/direct.ts` used to own this before cutover.
 */
import * as Effect from "effect/Effect";
import { readFile } from "node:fs/promises";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import type { SkillInventory } from "../catalog/summary.js";
import type { BackgroundTaskSummary } from "../providers/spi.js";
import { noteMessageId, USAGE_CONTINUE_GRACE_MS } from "./views.js";
import { armScheduledTurn } from "./schedule.js";
import { recordUsageWindows, standingLimit } from "../usage/limits.js";
import type { McpServerSpec } from "../mcp.js";

import { ClaudeDriver } from "../providers/claude/driver.js";
import { CodexDriver } from "../providers/codex/driver.js";
import { GrokDriver } from "../providers/grok/driver.js";
import { OpenCodeDriver } from "../providers/opencode/driver.js";
import type {
  ContextBreakdown,
  ContextWindowUsage,
  ProviderApprovalDecision,
  ProviderImage,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderSessionTitles,
  ProviderUserInputAnswers,
  SideAnswer,
  SideQuestionInput,
  SubagentHistoryItem,
} from "../providers/spi.js";
import { CliError } from "../errors.js";
import type { InteractionMode, ModelSelection, ProvidersConfig, RuntimeMode } from "../types.js";
import {
  captureWorktree,
  diffCheckpointStat,
  pinCheckpointRef,
  pruneCheckpointRefs,
} from "../checkpoints/git.js";
import { adoptProviderTitle, completeTurn, failTurn, holdPromotedTurn, interruptTurn, openTurn, startBackgroundTurn, turnPrompt, updateThreadMeta } from "./threads.js";
import { recordNativeSubagent } from "./subagents.js";
import { ThreadStore } from "./store.js";
import { toolActivityRow, type ToolRuntimeEvent } from "./toolactivity.js";
import { userInputActivityRow, type UserInputRuntimeEvent } from "./requestactivity.js";
import type { StoredAttachment, StoredThread, TurnUsage } from "./types.js";

/** Structural driver surface the runner needs. All four drivers satisfy it. */
export interface TurnDriver extends ProviderSessionTitles {
  hasSession(threadId: string): Effect.Effect<boolean, CliError>;
  startSession(input: ProviderSessionStartInput): Effect.Effect<unknown, CliError>;
  sendTurn(input: ProviderSendTurnInput): Effect.Effect<{ threadId: string; turnId: string }, CliError>;
  interruptTurn(threadId: string, turnId?: string): Effect.Effect<void, CliError>;
  /**
   * Answering a parked request. Optional only so a test double need not
   * implement them; all four drivers do.
   */
  respondToUserInput?(
    threadId: string,
    requestId: string,
    answers: ProviderUserInputAnswers,
  ): Effect.Effect<void, CliError>;
  respondToRequest?(
    threadId: string,
    requestId: string,
    decision: ProviderApprovalDecision,
  ): Effect.Effect<void, CliError>;
  awaitTurn(
    threadId: string,
    turnId: string,
    signal?: AbortSignal,
  ): Promise<TurnOutcome>;
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
  readonly stopAll?: () => Effect.Effect<void, CliError>;
  /** Optional only so a test double need not implement it; all four drivers do. */
  resumeCursor?(threadId: string): string | null;
  contextUsage?(threadId: string): Promise<ContextWindowUsage | null>;
  /** What fills the window, by category; absent where the provider reports only totals. */
  contextBreakdown?(threadId: string): Promise<ContextBreakdown | null>;
  steerTurn?(threadId: string, text: string): Effect.Effect<void, CliError>;
  /** Skills and slash commands the provider resolves for `workingDirectory`. */
  skillInventory?(workingDirectory: string): Promise<SkillInventory>;
  /**
   * A native subagent's conversation, for providers that keep it in their
   * own session store (OpenCode's child sessions). Null when it cannot be
   * read right now.
   */
  subagentHistory?(threadId: string, agentId: string): Promise<readonly SubagentHistoryItem[] | null>;
  /** Background work running in the thread's live session (Claude: commands, Monitor watches, subagents). */
  backgroundTasks?(threadId: string): readonly BackgroundTaskSummary[];
  stopBackgroundTask?(threadId: string, taskId: string): Effect.Effect<void, CliError>;
  /**
   * A background task's output so far, best-effort — null when the driver
   * cannot read it right now (unsupported, task gone, nothing written yet).
   * Not a live stream: callers re-fetch to refresh.
   */
  backgroundTaskOutput?(threadId: string, taskId: string): Promise<{ readonly lines: readonly string[] } | null>;
  /**
   * Copy a native session whole (its handle, as `resumeCursor` gives it) into
   * a new one, for a delegated task that starts from its parent's
   * conversation. Resolves to the copy's handle. Absent where the provider
   * cannot fork (Codex, Grok).
   */
  forkSession?(cursor: string, workingDirectory: string): Promise<string>;
  /** Drop the provider's last `numTurns` prompts. All four drivers have it; Grok's always refuses. */
  rollbackThread?(threadId: string, numTurns: number): Effect.Effect<unknown, CliError>;
  /**
   * A side question (`/btw`): answered on a throwaway copy of the thread's
   * provider context, with no tools, and never recorded in the thread or
   * its provider session. Runs alongside a turn in flight. Absent where the
   * provider cannot copy a session into a tool-less one-shot (Claude has
   * it; Codex and Grok cannot fork, and OpenCode's fork keeps its tools).
   */
  sideQuestion?(input: SideQuestionInput): Promise<SideAnswer>;
}

export type { SideAnswer, SideQuestionInput } from "../providers/spi.js";

export interface TurnOutcome {
  readonly status: "completed" | "failed" | "interrupted";
  readonly text: string;
  readonly usage: TurnUsage | null;
  readonly error: string | null;
}

export interface TurnDriverFactories {
  readonly claude?: () => TurnDriver;
  readonly codex?: () => TurnDriver;
  readonly grok?: () => TurnDriver;
  readonly opencode?: () => TurnDriver;
}

const driverCache = new WeakMap<object, WeakMap<object, Map<string, TurnDriver>>>();

const defaultFactories: TurnDriverFactories = {};

/**
 * The driver an instance id routes to. `opencode/<provider>` entries share
 * one driver (the provider address travels in the model slug), and
 * `claudeAgent` is the historical id for the Claude surface that existing
 * threads and configs still carry.
 */
export function driverKey(instanceId: string): string {
  const rawKey = instanceId.trim().toLowerCase();
  return rawKey === "opencode" || rawKey.startsWith("opencode/")
    ? "opencode"
    : rawKey === "claudeagent"
      ? "claude"
      : rawKey;
}

/**
 * Route a model-selection instance id to its driver, shared per
 * (owner, factories) pair.
 */
export function driverForInstance(
  owner: object,
  instanceId: string,
  factories: TurnDriverFactories = defaultFactories,
  providers?: ProvidersConfig,
): TurnDriver {
  const key = driverKey(instanceId);
  let byFactories = driverCache.get(owner);
  if (!byFactories) {
    byFactories = new WeakMap();
    driverCache.set(owner, byFactories);
  }
  let cache = byFactories.get(factories);
  if (!cache) {
    cache = new Map();
    byFactories.set(factories, cache);
  }
  const existing = cache.get(key);
  if (existing) return existing;
  let driver: TurnDriver | undefined;
  if (key === "codex") driver = factories.codex?.() ?? new CodexDriver();
  else if (key === "grok") driver = factories.grok?.() ?? new GrokDriver();
  // Provider settings are read here, once, because the driver owns the
  // spawned process: an already-running session cannot be moved to a
  // different binary or config directory. The schema says as much
  // (`restartRequired`), so a change applies to the next server start.
  else if (key === "claude") driver = factories.claude?.() ?? new ClaudeDriver(providers?.claude ? { settings: providers.claude } : {});
  else if (key === "opencode") driver = factories.opencode?.() ?? new OpenCodeDriver();
  if (!driver) {
    throw new CliError("PROVIDER_UNKNOWN", `No direct driver for provider "${instanceId}".`, {
      details: { instanceId },
    });
  }
  cache.set(key, driver);
  return driver;
}

// -- event pump (one consumer per driver) -----------------------------------

type EventSubscriber = (event: ProviderRuntimeEvent) => void;

const pumps = new WeakMap<TurnDriver, Map<string, Set<EventSubscriber>>>();

function ensureDriverPump(driver: TurnDriver): Map<string, Set<EventSubscriber>> {
  const existing = pumps.get(driver);
  if (existing) return existing;
  const subscribers = new Map<string, Set<EventSubscriber>>();
  pumps.set(driver, subscribers);
  const fiber = Effect.runFork(
    Stream.runForEach(driver.streamEvents, (event) =>
      Effect.sync(() => {
        // Plan usage belongs to the account, not the thread: recorded here,
        // once per event, whoever (if anyone) watches the thread.
        if (event.type === "rate-limits.updated") recordUsageWindows(event.provider, event.windows);
        for (const subscriber of subscribers.get(event.threadId) ?? []) subscriber(event);
      }),
    ),
  );
  // The pump drains for the process lifetime: without a consumer the
  // driver's unbounded queue would grow forever. If the stream ever ends
  // (driver shutdown), release the fiber.
  void Effect.runPromise(Fiber.join(fiber))
    .catch(() => undefined)
    .finally(() => {
      if (pumps.get(driver) === subscribers) pumps.delete(driver);
    });
  return subscribers;
}

/**
 * Subscribe to one thread's provider events. Several subscribers per
 * thread are supported (turn runner + open TUI subscriptions). Returns an
 * unsubscribe fn.
 */
export function subscribeDriverThread(
  driver: TurnDriver,
  threadId: string,
  onEvent: EventSubscriber,
): () => void {
  const subscribers = ensureDriverPump(driver);
  let set = subscribers.get(threadId);
  if (!set) {
    set = new Set();
    subscribers.set(threadId, set);
  }
  set.add(onEvent);
  return () => {
    set.delete(onEvent);
    if (set.size === 0 && subscribers.get(threadId) === set) subscribers.delete(threadId);
  };
}

// -- turn execution ----------------------------------------------------------

export const CHECKPOINT_GC_KEEP_TURNS = 20;

/** In-flight turn runs, tracked so tests can flush background work before tearing down stores. */
const activeRuns = new Set<Promise<void>>();

function trackRun(run: Promise<void>): Promise<void> {
  activeRuns.add(run);
  run
    .catch(() => undefined)
    .finally(() => {
      activeRuns.delete(run);
    })
    .catch(() => undefined);
  return run;
}

/** Wait for in-flight runs to settle (abandoned after `timeoutMs`). */
export async function flushTurnRunners(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (activeRuns.size > 0 && Date.now() < deadline) {
    const remaining = Math.max(deadline - Date.now(), 0);
    await Promise.race([
      Promise.allSettled([...activeRuns]),
      new Promise((resolve) => setTimeout(resolve, remaining)),
    ]);
  }
}

export interface ExecuteTurnArgs {
  readonly store: ThreadStore;
  readonly driver: TurnDriver;
  readonly threadId: string;
  readonly storeTurnId: string;
  readonly prompt: string;
  /** Images sent with the prompt. */
  readonly images?: readonly ProviderImage[];
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: InteractionMode;
  /** Worktree root for checkpoint capture; checkpoints skipped when empty. */
  readonly workingDirectory?: string;
  /** Provider events for this thread while the turn runs (TUI streaming). */
  readonly onEvent?: (event: ProviderRuntimeEvent) => void;
  /** The provider already started this turn itself (a background turn): await it, send nothing. */
  readonly driverTurnId?: string;
  /** A usage limit stopped this turn (`resetsAt` when the provider said): the automatic continue hooks in here. */
  readonly onUsageLimit?: (storeTurnId: string, resetsAt: string | null) => void;
}

export function executeTurn(args: ExecuteTurnArgs): Promise<void> {
  return trackRun(runExecuteTurn(args).then(() => runPromotedTurn(args)));
}

/** Saved attachments as provider images; a file gone from disk is skipped. */
export async function imagesOf(attachments: readonly StoredAttachment[]): Promise<ProviderImage[]> {
  const images = await Promise.all(
    attachments.map(async (attachment) => {
      const bytes = await readFile(attachment.path).catch(() => null);
      return bytes === null ? null : { name: attachment.name, mimeType: attachment.mimeType, data: bytes.toString("base64") };
    }),
  );
  return images.filter((image): image is ProviderImage => image !== null);
}

/**
 * Run the queued turn that settling this one promoted.
 *
 * Settling promotes the oldest queued turn to `running` in the ledger, but
 * nothing used to run it: a `--delivery queue` send was recorded and then
 * sat `running` forever. The runner that just finished is the one process
 * guaranteed to be alive at the moment of promotion, so it takes the next
 * turn — on the same driver, which is the one holding the session.
 */
async function runPromotedTurn(args: ExecuteTurnArgs): Promise<void> {
  const { store, threadId, driver } = args;
  try {
    const turns = await store.readTurns(threadId);
    const next = turns.find(
      (turn) => turn.status === "running" && turn.delivery === "queued" && !store.isTracked(turn.id),
    );
    if (!next) return;
    const thread = await store.readThreadRecord(threadId);
    if (!thread) return;
    const selection = next.modelSelection ?? thread.modelSelection;
    // A queued turn addressed to another provider needs that provider's
    // driver, which this runner does not hold; leave it for a client.
    const current = args.modelSelection ?? thread.modelSelection;
    if (driverKey(selection.instanceId) !== driverKey(current.instanceId)) return;
    // The turn that just settled may have ended on a usage limit. Running
    // the next queued message now would only fail it against the same wall
    // (and then the next, until the whole queue is failed turns), so hold
    // it for just after the reset instead — it runs then like a scheduled one.
    const standing = standingLimit(driverKey(selection.instanceId));
    if (standing !== null) {
      const until = new Date(Date.parse(standing.resetsAt) + USAGE_CONTINUE_GRACE_MS).toISOString();
      if (await holdPromotedTurn(store, threadId, next.id, until)) armScheduledTurn(threadId, next.id, until);
      return;
    }
    // One message, or several queued ones batched into this turn at promotion.
    const prompt = turnPrompt(await store.readMessages(threadId), next);
    if (prompt === null) return;
    // Its images were saved when it was queued; the bytes come off disk.
    const images = await imagesOf(prompt.attachments);
    void executeTurn({
      store,
      driver,
      threadId,
      storeTurnId: next.id,
      prompt: prompt.text,
      ...(images.length > 0 ? { images } : {}),
      modelSelection: selection,
      workingDirectory: thread.env.path,
      ...(args.onEvent ? { onEvent: args.onEvent } : {}),
      ...(args.onUsageLimit ? { onUsageLimit: args.onUsageLimit } : {}),
    });
  } catch {
    // Best effort: the turn stays promoted and a later send can see it.
  }
}

/**
 * Make sure `driver` holds a live session for `thread`, starting one when
 * it does not — resumed from the provider session this thread last ran,
 * if one was recorded.
 *
 * This was copied into every entry point (the server's turn start, CLI
 * `send`, CLI delegate, CLI handover) and none of the copies passed a
 * resume handle, so a thread only kept its provider-side history for as
 * long as the one process that started the session stayed up: closing
 * the TUI, or a CLI `send` from a fresh process, silently began an empty
 * conversation under the old transcript.
 *
 * Throws what `startSession` throws; callers that tolerate a failed start
 * (the CLI, which surfaces it through the turn instead) catch it.
 */
export async function ensureDriverSession(
  driver: TurnDriver,
  thread: StoredThread,
  options: {
    readonly modelSelection?: ModelSelection;
    readonly workingDirectory?: string;
    readonly mcpServers?: readonly McpServerSpec[];
    readonly instructions?: string | null;
    /** Watch the session for what happens between turns (`watchDriverSession`). */
    readonly store?: ThreadStore;
  } = {},
): Promise<void> {
  const hasSession = await Effect.runPromise(driver.hasSession(thread.id)).catch(() => false);
  if (hasSession) return;
  const selection = options.modelSelection ?? thread.modelSelection;
  const cursor = thread.providerSessions?.[driverKey(selection.instanceId)];
  const cwd = options.workingDirectory?.trim() || thread.env.path.trim() || process.cwd();
  await Effect.runPromise(
    driver.startSession({
      threadId: thread.id,
      workingDirectory: cwd,
      modelSelection: selection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      ...(cursor ? { resumeCursor: cursor } : {}),
      ...(options.mcpServers && options.mcpServers.length > 0 ? { mcpServers: options.mcpServers } : {}),
      ...(options.instructions ? { instructions: options.instructions } : {}),
    }),
  );
  if (options.store) watchDriverSession(options.store, driver, thread.id, cwd);
}

const watching = new WeakMap<TurnDriver, Map<string, () => void>>();

/**
 * Threads whose events a turn run is recording right now, counted per
 * thread. Checked synchronously by the session watcher, so an event is
 * recorded by exactly one of the two listeners that both see it.
 */
const recordingTurns = new Map<string, number>();

function subagentPayload(event: Extract<ProviderRuntimeEvent, { type: "subagent.updated" }>): Record<string, unknown> {
  // Folds per agent (`toolCallId`) into one row that goes started → stopped.
  return {
    toolCallId: `subagent:${event.agentId}`,
    agentId: event.agentId,
    agentType: event.agentType,
    status: event.status,
    lastMessage: event.lastMessage,
    ...(event.description ? { description: event.description } : {}),
  };
}

/**
 * What a provider session does between our turns, recorded for as long as
 * the session lives in this process:
 *
 * - a turn the provider starts itself (`turn.started`, origin background —
 *   Claude Code woken by a finished background task or a Monitor event) is
 *   stored and run like any turn, so its output is not lost;
 * - background tasks starting and ending, and the live set of them, become
 *   activity rows the transcript and the tasks panel read.
 */
export function watchDriverSession(store: ThreadStore, driver: TurnDriver, threadId: string, cwd: string): void {
  let byThread = watching.get(driver);
  if (!byThread) {
    byThread = new Map();
    watching.set(driver, byThread);
  }
  if (byThread.has(threadId)) return;
  let lastTasks = "";
  let chain: Promise<void> = Promise.resolve();
  const latestTurnId = async (): Promise<string | null> => {
    const turns = await store.readTurns(threadId);
    return (openTurn(turns) ?? turns.at(-1))?.id ?? null;
  };
  const record = (kind: string, summary: string, payload: Record<string, unknown>): void => {
    chain = chain.then(async () => {
      const createdAt = store.nowIso();
      await store
        .appendLedger(threadId, "activity", {
          id: store.newId(),
          threadId,
          turnId: await latestTurnId(),
          kind,
          summary,
          payload,
          createdAt,
        })
        .catch(() => undefined);
      // Subagent and background-task rows also keep the thread record's
      // subagent list current, for the sidebar.
      await recordNativeSubagent(store, threadId, { kind, payload, createdAt });
      store.emit(threadId, "activity");
    });
  };
  const unsubscribe = subscribeDriverThread(driver, threadId, (event) => {
    if (event.type === "turn.started" && event.origin === "background") {
      void runBackgroundTurn(store, driver, threadId, event.turnId, cwd);
      return;
    }
    if (event.type === "background.task") {
      const verb = event.status === "started" ? "Started" : event.status === "completed" ? "Finished" : event.status === "failed" ? "Failed" : "Stopped";
      record(`background.${event.status}`, `${verb} in the background: ${event.description || event.taskId}`, {
        title: event.description || event.taskId,
        taskId: event.taskId,
        status: event.status,
        description: event.description,
        taskType: event.taskType,
        toolUseId: event.toolUseId,
        summary: event.summary,
      });
      return;
    }
    if (event.type === "background.tasks.changed") {
      const signature = JSON.stringify(event.tasks);
      if (signature === lastTasks) return;
      lastTasks = signature;
      record("background.tasks", `${event.tasks.length} background task${event.tasks.length === 1 ? "" : "s"} running`, {
        tasks: event.tasks,
      });
      return;
    }
    if (event.type === "subagent.updated") {
      // Mid-turn the turn runner records it. A background subagent can
      // finish after its turn closed, when only this watcher is listening
      // — without this its row stayed "running" for good.
      if ((recordingTurns.get(threadId) ?? 0) > 0) return;
      record("subagent", `${event.agentType} ${event.status}`, subagentPayload(event));
      return;
    }
    if (event.type === "prompt.suggested") {
      // It lands after the turn settled, so only this watcher is still
      // listening; the composer offers the latest one until a turn follows.
      record("prompt.suggestion", "Suggested next prompt", { suggestion: event.suggestion });
      return;
    }
    if (event.type === "thread.state.changed" && event.state === "session-ended") stop();
  });
  const stop = (): void => {
    unsubscribe();
    byThread!.delete(threadId);
  };
  byThread.set(threadId, stop);
}

async function runBackgroundTurn(
  store: ThreadStore,
  driver: TurnDriver,
  threadId: string,
  driverTurnId: string,
  cwd: string,
): Promise<void> {
  try {
    const thread = await store.readThreadRecord(threadId);
    if (!thread) return;
    const turn = await startBackgroundTurn(store, threadId, { modelSelection: null });
    await executeTurn({
      store,
      driver,
      threadId,
      storeTurnId: turn.id,
      prompt: "",
      driverTurnId,
      ...(turn.modelSelection ? { modelSelection: turn.modelSelection } : {}),
      workingDirectory: cwd,
    });
  } catch {
    // Best effort: a background turn that cannot be recorded still runs in
    // the provider; only its transcript rows are missing.
  }
}

/**
 * Record the driver's current resume handle on the thread, keyed by driver
 * so a thread that moves between providers resumes each one. Best effort:
 * losing the write costs the next process its history, never this turn.
 */
async function persistResumeCursor(store: ThreadStore, driver: TurnDriver, threadId: string): Promise<void> {
  const cursor = driver.resumeCursor?.(threadId) ?? null;
  if (cursor === null) return;
  await store
    .withThreadLock(threadId, async () => {
      const thread = await store.readThreadRecord(threadId);
      if (thread === null) return;
      const turns = await store.readTurns(threadId);
      const selection = [...turns].reverse().find((turn) => turn.modelSelection)?.modelSelection ?? thread.modelSelection;
      const key = driverKey(selection.instanceId);
      if (thread.providerSessions?.[key] === cursor) return;
      await store.writeThreadRecord({ ...thread, providerSessions: { ...thread.providerSessions, [key]: cursor } });
    })
    .catch(() => undefined);
}

/**
 * Adopt the provider's own session title for the thread, once per settled
 * run (no polling). Only drivers whose provider keeps a title have
 * `sessionTitle`; a thread the user named is left alone. Best effort.
 */
const TITLE_SYNC_TIMEOUT_MS = 5_000;

async function syncProviderTitle(store: ThreadStore, driver: TurnDriver, threadId: string, cwd: string | null): Promise<void> {
  if (!driver.sessionTitle) return;
  try {
    const thread = await store.readThreadRecord(threadId);
    const cursor = driver.resumeCursor?.(threadId) ?? null;
    if (thread === null || thread.titleSource === "user" || cursor === null) return;
    // Bounded like the context reading: a slow provider costs the title, never the caller awaiting the run.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const title = await Promise.race([
      driver.sessionTitle(cursor, cwd ?? (thread.env.path.trim() || process.cwd())),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TITLE_SYNC_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (title) await adoptProviderTitle(store, threadId, title);
  } catch {
    // The title is a nicety; the turn's outcome is already recorded.
  }
}

/**
 * Persist the turn's tool calls and parked questions as activity rows
 * while it runs.
 *
 * Without this the ledger records only lifecycle bookkeeping and the
 * transcript has nothing to show for a turn's work (ARCHITECTURE.md §9). Rows
 * are append-only — the TUI collapses started/completed onto one card by
 * `toolCallId` — but a provider that streams output deltas would append
 * hundreds per call, so a row is written only when its signature changes.
 *
 * Parked `user-input.request.*` events are written here too, and for the
 * same reason: the answer panel reads open questions off the ledger, so a
 * question that never lands as a row can never be answered and the turn
 * blocks until it is interrupted. These rows must reach disk *during* the
 * turn rather than at flush — the turn is blocked on the answer.
 *
 * Every failure here is swallowed: a transcript row must never rewrite a
 * turn's outcome, and a payload shape we cannot read is a missing card,
 * not a failed run.
 */
function recordTurnActivity(
  store: ThreadStore,
  threadId: string,
  storeTurnId: string,
  modelSelection: ModelSelection | null,
  onUsageLimit?: (storeTurnId: string, resetsAt: string | null) => void,
): { onEvent: (event: ProviderRuntimeEvent) => void; flush: () => Promise<void>; noteFailure: () => void } {
  const written = new Map<string, string>();
  let limitRecorded = false;
  // Appends are chained rather than fired in parallel: the ledger is an
  // append-only file and the rows must land in the order they happened.
  // The runner awaits this chain before returning, so a one-shot CLI
  // cannot exit between a tool completing and its row being written.
  let chain: Promise<void> = Promise.resolve();
  const append = (kind: string, summary: string, payload: Record<string, unknown>): void => {
    const row = {
      id: store.newId(),
      threadId,
      turnId: storeTurnId,
      kind,
      summary,
      payload,
      createdAt: store.nowIso(),
    };
    chain = chain.then(() => store.appendLedger(threadId, "activity", row).catch(() => undefined));
  };
  const notes = new Set<string>();
  const switches = new Map<string, "refusal-fallback" | "auto">();
  const onEvent = (event: ProviderRuntimeEvent): void => {
    if (event.type === "reasoning.updated") {
      // One row as it starts and one as it ends; both carry the same
      // `toolCallId`, so the transcript folds them into one card that goes
      // "Thinking…" → "Thought for 12s".
      const signature = `reasoning:${event.reasoningId}:${event.status}`;
      if (written.has(signature)) return;
      written.set(signature, signature);
      const took =
        event.durationMs === null
          ? null
          : event.durationMs < 1000
            ? `${Math.max(1, Math.floor(event.durationMs))}ms`
            : `${Math.round(event.durationMs / 1000)}s`;
      append("reasoning", event.status === "running" ? "Thinking" : took === null ? "Thought" : `Thought for ${took}`, {
        itemType: "reasoning",
        toolCallId: `reasoning:${event.reasoningId}`,
        status: event.status === "running" ? "inProgress" : "completed",
        text: event.text,
        startedAt: event.startedAt,
        durationMs: event.durationMs,
      });
      return;
    }
    if (event.type === "message.retracted") {
      // The provider took back a refused attempt's output. Ledgers are
      // append-only, so this is a tombstone the transcript filters by.
      append("message.retracted", "Output retracted", {
        messageIds: event.messageIds.map((messageId) => noteMessageId(storeTurnId, messageId)),
        toolCallIds: [...event.toolUseIds],
      });
      return;
    }
    if (event.type === "session.notice") {
      append("notice", event.title, { notice: event.notice, provider: event.provider, detail: event.detail });
      return;
    }
    if (event.type === "subagent.updated") {
      append("subagent", `${event.agentType} ${event.status}`, subagentPayload(event));
      void recordNativeSubagent(store, threadId, { kind: "subagent", payload: subagentPayload(event), createdAt: store.nowIso() });
      return;
    }
    if (event.type === "model.changed") {
      // A refusal fallback can also surface as the provider's own "auto"
      // switch to the same model. One row per model per turn: the refusal
      // wins (it says why), and a later "auto" for the same move adds nothing.
      const switchKey = `model:${storeTurnId}:${event.to}`;
      const seen = switches.get(switchKey);
      if (seen === "refusal-fallback" || (seen === "auto" && event.reason === "auto")) return;
      switches.set(switchKey, event.reason);
      append("model.changed", `Switched to ${event.toLabel ?? event.to}`, {
        toolCallId: switchKey,
        provider: event.provider,
        from: event.from,
        to: event.to,
        fromLabel: event.fromLabel ?? null,
        toLabel: event.toLabel ?? null,
        reason: event.reason,
        scope: event.scope,
        category: event.category,
      });
      // A session-wide switch sticks: the turn ran on the new model, and the
      // thread's own choice follows it — otherwise the next turn would ask
      // for the old model and walk straight back into the same refusal.
      if (event.scope === "session" && modelSelection) {
        const next: ModelSelection = { ...modelSelection, model: event.to };
        chain = chain.then(async () => {
          await store
            .withThreadLock(threadId, () => store.updateTurn(threadId, storeTurnId, { modelSelection: next }))
            .catch(() => undefined);
          await updateThreadMeta(store, threadId, { modelSelection: next }).catch(() => undefined);
        });
      }
      return;
    }
    if (event.type === "thread.state.changed" && (event.state === "rate-limited" || event.state === "usage-wrap-up")) {
      // A wrap-up is the same limit, met gracefully: the turn goes on, on a
      // small allowance, to a stopping point — so the continue after the
      // reset is just as due.
      const wrapUp = event.state === "usage-wrap-up";
      const raw = event.raw !== null && typeof event.raw === "object" ? (event.raw as Record<string, unknown>) : {};
      const resetsAt = typeof raw.resetsAt === "string" ? raw.resetsAt : null;
      limitRecorded = true;
      append(wrapUp ? "usage.wrap-up" : "usage.limit", wrapUp ? "Usage limit reached, wrapping up" : "Usage limit reached", {
        provider: event.provider,
        rateLimitType: typeof raw.rateLimitType === "string" ? raw.rateLimitType : null,
        label: typeof raw.label === "string" ? raw.label : null,
        resetsAt,
      });
      onUsageLimit?.(storeTurnId, resetsAt);
      return;
    }
    if (event.type === "assistant.note") {
      // An interim message, kept as its own assistant row so the transcript
      // can show it between the tool calls it narrates.
      if (notes.has(event.messageId) || !event.text.trim()) return;
      notes.add(event.messageId);
      const createdAt = store.nowIso();
      const row = {
        id: noteMessageId(storeTurnId, event.messageId),
        threadId,
        turnId: storeTurnId,
        role: "assistant",
        text: event.text,
        createdAt,
      };
      chain = chain.then(() => store.appendLedger(threadId, "messages", row).catch(() => undefined));
      return;
    }
    if (event.type === "turn.plan.updated") {
      // A live checklist re-emits on every step change; each version is its
      // own row so `latestPlan` (the pinned tasks panel) always reads the
      // newest, and `collapseToolActivities` folds them onto one card in
      // the transcript (which hides it anyway — the panel is where this
      // renders). A markdown plan-mode proposal is not this shape (no
      // `plan` array) — recorded the same way, just never read as a checklist.
      const raw = event.raw;
      const payload = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      append("turn.plan.updated", "Plan updated", payload);
      return;
    }
    if (event.type === "permission.request.opened" || event.type === "permission.request.resolved") {
      // Bracket rows for a tool approval, so a reader can tell how long the
      // turn stood waiting on the user (the transcript's "Worked for" and
      // live clock leave that time out). Tool name only: the input can be
      // a whole file, and the prompt itself is rendered live elsewhere.
      const opened = event.type === "permission.request.opened";
      const key = `permission:${event.requestId}:${opened ? "requested" : "resolved"}`;
      if (written.has(key)) return;
      written.set(key, key);
      const raw = event.raw !== null && typeof event.raw === "object" ? (event.raw as Record<string, unknown>) : {};
      const toolName = typeof raw.toolName === "string" ? raw.toolName : null;
      append(opened ? "permission.requested" : "permission.resolved", opened ? `Asked to use ${toolName ?? "a tool"}` : "Permission answered", {
        requestId: event.requestId,
        provider: event.provider,
        toolName,
        ...(!opened && typeof raw.behavior === "string" ? { behavior: raw.behavior } : {}),
      });
      return;
    }
    if (
      event.type === "user-input.request.opened" ||
      event.type === "user-input.request.resolved"
    ) {
      let request: ReturnType<typeof userInputActivityRow>;
      try {
        request = userInputActivityRow(event as UserInputRuntimeEvent);
      } catch {
        return;
      }
      if (request === null) return;
      if (written.has(request.key)) return;
      written.set(request.key, request.key);
      append(request.kind, request.summary, request.payload);
      return;
    }
    if (
      event.type !== "tool.execute.started" &&
      event.type !== "tool.execute.updated" &&
      event.type !== "tool.execute.completed"
    ) {
      return;
    }
    let row: ReturnType<typeof toolActivityRow>;
    try {
      row = toolActivityRow(event as ToolRuntimeEvent);
    } catch {
      return;
    }
    if (row === null) return;
    if (written.get(row.callId) === row.signature) return;
    written.set(row.callId, row.signature);
    append(row.kind, row.summary, row.payload);
  };
  /**
   * Called when the turn fails. A turn that ran into a limit already in
   * force gets no fresh rate-limit event — the provider only reports one
   * when the limit changes — so without this it fails with a bare error,
   * reads to the transcript as "a later turn got through", and hides the
   * limit card (and never schedules the continue). A queued message sent
   * after a hit is exactly that turn.
   */
  const noteFailure = (): void => {
    if (limitRecorded || modelSelection === null) return;
    const provider = driverKey(modelSelection.instanceId);
    const standing = standingLimit(provider);
    if (standing === null) return;
    limitRecorded = true;
    append("usage.limit", "Usage limit reached", {
      provider,
      rateLimitType: null,
      label: standing.label,
      resetsAt: standing.resetsAt,
      // Inferred from the recorded windows, not announced for this turn.
      standing: true,
    });
    onUsageLimit?.(storeTurnId, standing.resetsAt);
  };
  return { onEvent, flush: () => chain, noteFailure };
}

async function runExecuteTurn(args: ExecuteTurnArgs): Promise<void> {
  const { store, driver, threadId, storeTurnId } = args;
  const cwd = args.workingDirectory?.trim() ? args.workingDirectory.trim() : null;
  const recordTools = recordTurnActivity(store, threadId, storeTurnId, args.modelSelection ?? null, args.onUsageLimit);
  const onEvent = args.onEvent;
  const unsubscribe = subscribeDriverThread(driver, threadId, (event) => {
    recordTools.onEvent(event);
    onEvent?.(event);
  });
  recordingTurns.set(threadId, (recordingTurns.get(threadId) ?? 0) + 1);
  // Pre-turn capture first: the diff base must predate any provider write.
  const pre = cwd ? await captureWorktree(cwd, `moxen ${threadId}/${storeTurnId} pre`) : null;
  const controller = new AbortController();
  store.trackRunning(storeTurnId, () => controller.abort());
  // Live context readings while the turn runs: a long turn otherwise showed
  // the reading from before it started until it ended. Only a moved number
  // is written, and a slow provider never stacks readings up.
  let lastLiveReading: string | null = null;
  let liveReading = false;
  const liveContext = setInterval(() => {
    if (liveReading) return;
    liveReading = true;
    void recordContextUsage(store, driver, threadId, storeTurnId, (usage) => {
      // Cost moves on its own (a long tool run between requests does not
      // grow the context, but the requests before it cost something).
      const reading = `${usage.usedTokens}:${usage.costUsd ?? ""}`;
      if (reading === lastLiveReading) return false;
      lastLiveReading = reading;
      return true;
    }).finally(() => {
      liveReading = false;
    });
  }, LIVE_CONTEXT_MS);
  liveContext.unref?.();
  const onAbort = (): void => {
    Effect.runFork(driver.interruptTurn(threadId));
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const sent = args.driverTurnId
      ? { turnId: args.driverTurnId }
      : await Effect.runPromise(
          driver.sendTurn({
            threadId,
            prompt: args.prompt,
            ...(args.images?.length ? { images: args.images } : {}),
            ...(args.modelSelection ? { modelSelection: args.modelSelection } : {}),
          }),
        );
    // Persisted as soon as the turn is under way, not only at settle: a
    // process that dies mid-turn is exactly the one whose successor needs it.
    await persistResumeCursor(store, driver, threadId);
    const outcome = await driver.awaitTurn(threadId, sent.turnId, controller.signal);
    await recordContextUsage(store, driver, threadId, storeTurnId);
    if (outcome.status === "failed") recordTools.noteFailure();
    await settleTurn(store, args, outcome, cwd, pre);
  } catch (cause) {
    if (cause instanceof CliError && cause.code === "TURN_ABORTED") {
      await interruptTurn(store, threadId).catch(() => undefined);
      await settleCheckpoints(store, args, cwd, pre);
      return;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    recordTools.noteFailure();
    try {
      await failTurn(store, threadId, storeTurnId, { error: message.slice(0, 500) });
    } catch {
      // Already terminal (e.g. a concurrent interrupt won the race).
    }
    await settleCheckpoints(store, args, cwd, pre);
  } finally {
    clearInterval(liveContext);
    controller.signal.removeEventListener("abort", onAbort);
    store.untrackRunning(storeTurnId);
    unsubscribe();
    const recording = (recordingTurns.get(threadId) ?? 1) - 1;
    if (recording > 0) recordingTurns.set(threadId, recording);
    else recordingTurns.delete(threadId);
    // Drain queued tool rows before the run is considered over.
    await recordTools.flush();
    // Again at the end: some providers only report the handle once the
    // first reply lands (Claude's `init` arrives with it).
    await persistResumeCursor(store, driver, threadId);
    await syncProviderTitle(store, driver, threadId, cwd);
  }
}

const CONTEXT_USAGE_TIMEOUT_MS = 10_000;

/** How often a running turn's context reading refreshes. */
const LIVE_CONTEXT_MS = 30_000;

/**
 * Record how full the context window is as the turn ends — before its
 * outcome, so whoever sees the turn settle also sees the reading. The
 * TUI's context indicator reads the latest of these rows. Best effort and
 * bounded: a provider slow to answer costs the reading, never the turn.
 */
async function recordContextUsage(
  store: ThreadStore,
  driver: TurnDriver,
  threadId: string,
  turnId: string,
  /** Live readings pass this to skip writing a row when nothing moved. */
  shouldRecord: (usage: ContextWindowUsage) => boolean = () => true,
): Promise<void> {
  if (!driver.contextUsage) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const usage = await Promise.race([
    driver.contextUsage(threadId).catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CONTEXT_USAGE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  if (usage === null || !shouldRecord(usage)) return;
  const summary =
    usage.maxTokens === null
      ? `${usage.usedTokens} tokens in context`
      : `${usage.usedTokens} / ${usage.maxTokens} tokens in context`;
  await store
    .appendLedger(threadId, "activity", {
      id: store.newId(),
      threadId,
      turnId,
      kind: "context-window.updated",
      summary,
      payload: { ...usage },
      createdAt: store.nowIso(),
    })
    .catch(() => undefined);
}

async function settleTurn(
  store: ThreadStore,
  args: ExecuteTurnArgs,
  outcome: TurnOutcome,
  cwd: string | null,
  pre: string | null,
): Promise<void> {
  const { storeTurnId, threadId } = args;
  // Checkpoint first, outcome second: anyone who sees the turn settle —
  // a CLI `send` returning, then `read --view checkpoints` — must also see
  // its checkpoint. Recording the outcome first left a window in which a
  // completed turn had none.
  await settleCheckpoints(store, args, cwd, pre);
  if (outcome.status === "completed") {
    await completeTurn(store, threadId, storeTurnId, {
      ...(outcome.text ? { text: outcome.text } : {}),
      ...(outcome.usage ? { usage: outcome.usage } : {}),
    });
  } else if (outcome.status === "interrupted") {
    await interruptTurn(store, threadId).catch(() => undefined);
  } else {
    await failTurn(store, threadId, storeTurnId, {
      error: outcome.error ?? "Turn failed.",
      ...(outcome.usage ? { usage: outcome.usage } : {}),
    });
  }
}

async function settleCheckpoints(
  store: ThreadStore,
  args: ExecuteTurnArgs,
  cwd: string | null,
  pre: string | null,
): Promise<void> {
  const post = cwd ? await captureWorktree(cwd, `moxen ${args.threadId}/${args.storeTurnId} post`) : null;
  const available = pre !== null && post !== null;
  if (cwd && pre) await pinCheckpointRef(args.threadId, args.storeTurnId, pre, cwd, "pre").catch(() => undefined);
  if (cwd && post) await pinCheckpointRef(args.threadId, args.storeTurnId, post, cwd, "post").catch(() => undefined);
  // The per-file summary clients draw a turn's diff row from.
  const files = cwd && pre && post ? await diffCheckpointStat(cwd, pre, post) : [];
  try {
    await store.appendLedger(args.threadId, "checkpoints", {
      id: store.newId(),
      threadId: args.threadId,
      turnId: args.storeTurnId,
      status: available ? "available" : "unavailable",
      ref: post,
      baseRef: pre,
      ...(available ? { files } : {}),
      createdAt: store.nowIso(),
    });
  } catch {
    // Ledger append failure must not rewrite the turn outcome.
  }
  if (cwd) {
    const turns = await store.readTurns(args.threadId).catch(() => []);
    const keep = turns.slice(-CHECKPOINT_GC_KEEP_TURNS).map((turn) => turn.id);
    await pruneCheckpointRefs(cwd, args.threadId, keep).catch(() => undefined);
  }
}
