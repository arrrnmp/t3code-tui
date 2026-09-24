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
import type { McpServerSpec } from "../mcp.js";

import { ClaudeDriver } from "../providers/claude/driver.js";
import { CodexDriver } from "../providers/codex/driver.js";
import { GrokDriver } from "../providers/grok/driver.js";
import { OpenCodeDriver } from "../providers/opencode/driver.js";
import type {
  ContextWindowUsage,
  ProviderApprovalDecision,
  ProviderImage,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderUserInputAnswers,
} from "../providers/spi.js";
import { CliError } from "../errors.js";
import type { InteractionMode, ModelSelection, RuntimeMode } from "../types.js";
import {
  captureWorktree,
  pinCheckpointRef,
  pruneCheckpointRefs,
} from "../checkpoints/git.js";
import { completeTurn, failTurn, interruptTurn } from "./threads.js";
import { ThreadStore } from "./store.js";
import { toolActivityRow, type ToolRuntimeEvent } from "./toolactivity.js";
import { userInputActivityRow, type UserInputRuntimeEvent } from "./requestactivity.js";
import type { StoredAttachment, StoredThread, TurnUsage } from "./types.js";

/** Structural driver surface the runner needs. All four drivers satisfy it. */
export interface TurnDriver {
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
  steerTurn?(threadId: string, text: string): Effect.Effect<void, CliError>;
  /** Skills and slash commands the provider resolves for `workingDirectory`. */
  skillInventory?(workingDirectory: string): Promise<SkillInventory>;
  /** Drop the provider's last `numTurns` prompts. All four drivers have it; Grok's always refuses. */
  rollbackThread?(threadId: string, numTurns: number): Effect.Effect<unknown, CliError>;
}

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
  else if (key === "claude") driver = factories.claude?.() ?? new ClaudeDriver();
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
    const message = (await store.readMessages(threadId)).find((candidate) => candidate.id === next.messageId);
    if (!message?.text) return;
    // Its images were saved when it was queued; the bytes come off disk.
    const images = await imagesOf(message.attachments ?? []);
    void executeTurn({
      store,
      driver,
      threadId,
      storeTurnId: next.id,
      prompt: message.text,
      ...(images.length > 0 ? { images } : {}),
      modelSelection: selection,
      workingDirectory: thread.env.path,
      ...(args.onEvent ? { onEvent: args.onEvent } : {}),
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
): { onEvent: (event: ProviderRuntimeEvent) => void; flush: () => Promise<void> } {
  const written = new Map<string, string>();
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
  const onEvent = (event: ProviderRuntimeEvent): void => {
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
  return { onEvent, flush: () => chain };
}

async function runExecuteTurn(args: ExecuteTurnArgs): Promise<void> {
  const { store, driver, threadId, storeTurnId } = args;
  const cwd = args.workingDirectory?.trim() ? args.workingDirectory.trim() : null;
  const recordTools = recordTurnActivity(store, threadId, storeTurnId);
  const onEvent = args.onEvent;
  const unsubscribe = subscribeDriverThread(driver, threadId, (event) => {
    recordTools.onEvent(event);
    onEvent?.(event);
  });
  // Pre-turn capture first: the diff base must predate any provider write.
  const pre = cwd ? await captureWorktree(cwd, `moxen ${threadId}/${storeTurnId} pre`) : null;
  const controller = new AbortController();
  store.trackRunning(storeTurnId, () => controller.abort());
  const onAbort = (): void => {
    Effect.runFork(driver.interruptTurn(threadId));
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const sent = await Effect.runPromise(
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
    await settleTurn(store, args, outcome, cwd, pre);
  } catch (cause) {
    if (cause instanceof CliError && cause.code === "TURN_ABORTED") {
      await interruptTurn(store, threadId).catch(() => undefined);
      await settleCheckpoints(store, args, cwd, pre);
      return;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    try {
      await failTurn(store, threadId, storeTurnId, { error: message.slice(0, 500) });
    } catch {
      // Already terminal (e.g. a concurrent interrupt won the race).
    }
    await settleCheckpoints(store, args, cwd, pre);
  } finally {
    controller.signal.removeEventListener("abort", onAbort);
    store.untrackRunning(storeTurnId);
    unsubscribe();
    // Drain queued tool rows before the run is considered over.
    await recordTools.flush();
    // Again at the end: some providers only report the handle once the
    // first reply lands (Claude's `init` arrives with it).
    await persistResumeCursor(store, driver, threadId);
  }
}

const CONTEXT_USAGE_TIMEOUT_MS = 10_000;

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
): Promise<void> {
  if (!driver.contextUsage) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const usage = await Promise.race([
    driver.contextUsage(threadId).catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CONTEXT_USAGE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  if (usage === null) return;
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
  try {
    await store.appendLedger(args.threadId, "checkpoints", {
      id: store.newId(),
      threadId: args.threadId,
      turnId: args.storeTurnId,
      status: available ? "available" : "unavailable",
      ref: post,
      baseRef: pre,
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
