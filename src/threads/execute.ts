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
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { ClaudeDriver } from "../providers/claude/driver.js";
import { CodexDriver } from "../providers/codex/driver.js";
import { GrokDriver } from "../providers/grok/driver.js";
import { OpenCodeDriver } from "../providers/opencode/driver.js";
import type {
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
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
import type { TurnUsage } from "./types.js";

/** Structural driver surface the runner needs. All four drivers satisfy it. */
export interface TurnDriver {
  hasSession(threadId: string): Effect.Effect<boolean, CliError>;
  startSession(input: ProviderSessionStartInput): Effect.Effect<unknown, CliError>;
  sendTurn(input: ProviderSendTurnInput): Effect.Effect<{ threadId: string; turnId: string }, CliError>;
  interruptTurn(threadId: string, turnId?: string): Effect.Effect<void, CliError>;
  awaitTurn(
    threadId: string,
    turnId: string,
    signal?: AbortSignal,
  ): Promise<TurnOutcome>;
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
  readonly stopAll?: () => Effect.Effect<void, CliError>;
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
 * Route a model-selection instance id to its driver, shared per
 * (owner, factories) pair. `opencode/<provider>` entries share one
 * driver; the provider address travels in the model slug.
 */
export function driverForInstance(
  owner: object,
  instanceId: string,
  factories: TurnDriverFactories = defaultFactories,
): TurnDriver {
  const rawKey = instanceId.trim().toLowerCase();
  // Legacy T3 instance id for the Claude surface; migrated threads and
  // configs still carry it.
  const key = rawKey === "opencode" || rawKey.startsWith("opencode/")
    ? "opencode"
    : rawKey === "claudeagent"
      ? "claude"
      : rawKey;
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

function sleepLocal(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Block one-shot CLI commands until a turn leaves `running`/`queued`
 * (or vanishes). Ctrl-C interrupts the ledger turn first so the run
 * converges instead of stranding, then exits 130. Without this a
 * one-shot CLI would exit and take the in-process runner with it,
 * leaving the turn `running` forever — there is no server to inherit it.
 */
export async function waitForTurnTerminal(
  store: ThreadStore,
  threadId: string,
  turnId: string,
  onInterrupt: () => Promise<unknown>,
): Promise<void> {
  const onSigint = (): void => {
    void (async () => {
      try {
        await onInterrupt();
      } finally {
        process.exit(130);
      }
    })();
  };
  process.once("SIGINT", onSigint);
  try {
    for (;;) {
      const turns = await store.readTurns(threadId).catch(() => null);
      const turn = turns?.find((candidate) => candidate.id === turnId) ?? null;
      if (!turn || (turn.status !== "running" && turn.status !== "queued")) return;
      await sleepLocal(200);
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

export interface ExecuteTurnArgs {
  readonly store: ThreadStore;
  readonly driver: TurnDriver;
  readonly threadId: string;
  readonly storeTurnId: string;
  readonly prompt: string;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: InteractionMode;
  /** Worktree root for checkpoint capture; checkpoints skipped when empty. */
  readonly workingDirectory?: string;
  /** Provider events for this thread while the turn runs (TUI streaming). */
  readonly onEvent?: (event: ProviderRuntimeEvent) => void;
}

export function executeTurn(args: ExecuteTurnArgs): Promise<void> {
  return trackRun(runExecuteTurn(args));
}

async function runExecuteTurn(args: ExecuteTurnArgs): Promise<void> {
  const { store, driver, threadId, storeTurnId } = args;
  const cwd = args.workingDirectory?.trim() ? args.workingDirectory.trim() : null;
  const unsubscribe = args.onEvent ? subscribeDriverThread(driver, threadId, args.onEvent) : undefined;
  // Pre-turn capture first: the diff base must predate any provider write.
  const pre = cwd ? await captureWorktree(cwd, `t3code ${threadId}/${storeTurnId} pre`) : null;
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
        ...(args.modelSelection ? { modelSelection: args.modelSelection } : {}),
      }),
    );
    const outcome = await driver.awaitTurn(threadId, sent.turnId, controller.signal);
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
    unsubscribe?.();
  }
}

async function settleTurn(
  store: ThreadStore,
  args: ExecuteTurnArgs,
  outcome: TurnOutcome,
  cwd: string | null,
  pre: string | null,
): Promise<void> {
  const { storeTurnId, threadId } = args;
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
  await settleCheckpoints(store, args, cwd, pre);
}

async function settleCheckpoints(
  store: ThreadStore,
  args: ExecuteTurnArgs,
  cwd: string | null,
  pre: string | null,
): Promise<void> {
  const post = cwd ? await captureWorktree(cwd, `t3code ${args.threadId}/${args.storeTurnId} post`) : null;
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
