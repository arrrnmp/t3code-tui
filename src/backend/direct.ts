/**
 * DirectBackend — the `Backend` over our own store + provider drivers.
 *
 * `catalog`/`inspectThread` project store records into the T3-shaped
 * envelope types (shape unchanged; values come from the ledger). `send`
 * records the turn under the store mutex, ensures a Claude session, and
 * kicks `executeDirectTurn` off in the background — acceptance returns
 * immediately, completion lands in the ledger via events. The projects
 * registry arrives at cutover, so `projects` is empty until then.
 * Selected with `T3CODE_BACKEND=direct` (default stays `t3`).
 * See DECOUPLE.md §9 + §15.2.
 */
import os from "node:os";
import path from "node:path";

import * as Effect from "effect/Effect";

import { CliError } from "../errors.js";
import type { ModelSelection, T3Thread } from "../types.js";
import { ClaudeDriver } from "../providers/claude/driver.js";
import { CodexDriver } from "../providers/codex/driver.js";
import { GrokDriver } from "../providers/grok/driver.js";
import { OpenCodeDriver } from "../providers/opencode/driver.js";
import type {
  ProviderSendTurnInput,
  ProviderSessionStartInput,
} from "../providers/spi.js";
import {
  completeTurn,
  failTurn,
  inspectThread,
  interruptTurn,
  listThreads,
  sendTurn,
} from "../threads/threads.js";
import { openThreadStore, ThreadStore } from "../threads/store.js";
import type { StoredThread, StoredTurn } from "../threads/types.js";
import type {
  Backend,
  BackendCatalog,
  BackendSendInput,
  BackendSendResult,
  BackendThreadDetail,
} from "./backend.js";

export interface DirectBackendOptions {
  readonly storeRoot?: string;
  readonly drivers?: {
    readonly claude?: () => ClaudeDriver;
    readonly codex?: () => CodexDriver;
    readonly grok?: () => GrokDriver;
    readonly opencode?: () => OpenCodeDriver;
  };
}

/** Structural driver surface the direct backend needs. All three drivers satisfy it. */
export interface DirectDriver {
  hasSession(threadId: string): Effect.Effect<boolean, CliError>;
  startSession(input: ProviderSessionStartInput): Effect.Effect<unknown, CliError>;
  sendTurn(input: ProviderSendTurnInput): Effect.Effect<{ threadId: string; turnId: string }, CliError>;
  interruptTurn(threadId: string, turnId?: string): Effect.Effect<void, CliError>;
  awaitTurn(
    threadId: string,
    turnId: string,
    signal?: AbortSignal,
  ): Promise<DirectTurnOutcome>;
}

export interface DirectTurnOutcome {
  readonly status: "completed" | "failed" | "interrupted";
  readonly text: string;
  readonly error: string | null;
}

export function resolveStoreRoot(): string {
  const raw = process.env.T3CODE_STORE_ROOT?.trim();
  if (raw) return path.resolve(raw);
  return path.join(os.homedir(), ".t3code", "threads");
}

function latestMeaningfulTurn(turns: StoredTurn[]): StoredTurn | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]!.status !== "queued") return turns[index]!;
  }
  return null;
}

/** Ledger-local projection into the envelope thread shape. */
export function toCatalogThread(thread: StoredThread, turns: StoredTurn[]): T3Thread {
  const running = turns.find((turn) => turn.status === "running") ?? null;
  const latest = latestMeaningfulTurn(turns);
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    latestTurn: latest
      ? {
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
        }
      : null,
    session: {
      threadId: thread.id,
      status: running ? "running" : "idle",
      providerName: thread.modelSelection.instanceId,
      runtimeMode: thread.runtimeMode,
      activeTurnId: running?.id ?? null,
      lastError: null,
      updatedAt: thread.updatedAt,
    },
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    settledOverride: thread.settledOverride,
    settledAt: thread.settledAt,
    unsettledAt: thread.unsettledAt,
    snoozedUntil: thread.snoozedUntil,
    snoozedAt: thread.snoozedAt,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
  };
}

export interface ExecuteDirectTurnArgs {
  readonly store: ThreadStore;
  readonly driver: DirectDriver;
  readonly threadId: string;
  readonly storeTurnId: string;
  readonly prompt: string;
  readonly modelSelection?: ModelSelection;
}

/**
 * Run one accepted store turn against the Claude driver. Completion,
 * failure, and interruption converge back into the ledger; a store turn
 * that already reached a terminal state is left alone.
 */
export async function executeDirectTurn(args: ExecuteDirectTurnArgs): Promise<void> {
  const { store, driver, threadId, storeTurnId } = args;
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
    if (outcome.status === "completed") {
      await completeTurn(store, threadId, storeTurnId, { text: outcome.text });
    } else if (outcome.status === "interrupted") {
      await interruptTurn(store, threadId).catch(() => undefined);
    } else {
      await failTurn(store, threadId, storeTurnId, {
        error: outcome.error ?? "Claude turn failed.",
      });
    }
  } catch (cause) {
    if (cause instanceof CliError && cause.code === "TURN_ABORTED") {
      await interruptTurn(store, threadId).catch(() => undefined);
      return;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    try {
      await failTurn(store, threadId, storeTurnId, { error: message.slice(0, 500) });
    } catch {
      // Already terminal (e.g. a concurrent interrupt won the race).
    }
  } finally {
    controller.signal.removeEventListener("abort", onAbort);
    store.untrackRunning(storeTurnId);
  }
}

export class DirectBackend implements Backend {
  readonly kind = "direct" as const;
  private storePromise: Promise<ThreadStore> | null = null;
  private readonly drivers = new Map<string, DirectDriver>();

  constructor(private readonly options: DirectBackendOptions = {}) {}

  private async store(): Promise<ThreadStore> {
    if (!this.storePromise) {
      const root = this.options.storeRoot ?? resolveStoreRoot();
      this.storePromise = openThreadStore(root);
    }
    return await this.storePromise;
  }

  /** Route a model-selection instance id to its driver (shared per backend). */
  private driverFor(instanceId: string): DirectDriver {
    // `opencode/<provider>` catalog entries share one driver (and its
    // per-cwd servers); the provider address travels in the model slug.
    const rawKey = instanceId.trim().toLowerCase();
    const key = rawKey === "opencode" || rawKey.startsWith("opencode/") ? "opencode" : rawKey;
    const existing = this.drivers.get(key);
    if (existing) return existing;
    const factories = this.options.drivers ?? {};
    let driver: DirectDriver | undefined;
    if (key === "codex") driver = factories.codex?.() ?? new CodexDriver();
    else if (key === "grok") driver = factories.grok?.() ?? new GrokDriver();
    else if (key === "claude") driver = factories.claude?.() ?? new ClaudeDriver();
    else if (key === "opencode") driver = factories.opencode?.() ?? new OpenCodeDriver();
    if (!driver) {
      throw new CliError("PROVIDER_UNKNOWN", `No direct driver for provider "${instanceId}".`, {
        details: { instanceId },
      });
    }
    this.drivers.set(key, driver);
    return driver;
  }

  async catalog(): Promise<BackendCatalog> {
    const store = await this.store();
    const threads = await listThreads(store, { status: "all" });
    return {
      snapshotSequence: 0,
      projects: [],
      threads: await Promise.all(
        threads.map(async (thread) => toCatalogThread(thread, await store.readTurns(thread.id))),
      ),
      updatedAt: new Date().toISOString(),
    };
  }

  async inspectThread(threadId: string): Promise<BackendThreadDetail> {
    const store = await this.store();
    const thread = await inspectThread(store, threadId);
    return {
      snapshotSequence: 0,
      thread: toCatalogThread(thread, await store.readTurns(thread.id)),
    };
  }

  async send(threadId: string, input: BackendSendInput): Promise<BackendSendResult> {
    const store = await this.store();
    // Resolve the driver before touching the ledger: unknown providers and
    // missing threads fail without recording a turn.
    const preview = await inspectThread(store, threadId);
    const instanceId =
      input.modelSelection?.instanceId ?? preview.modelSelection.instanceId;
    const driver = this.driverFor(instanceId);
    const sent = await sendTurn(store, threadId, {
      prompt: input.prompt,
      ...(input.ifBusy ? { ifBusy: input.ifBusy } : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
      ...(input.wakeSettled !== undefined ? { wakeSettled: input.wakeSettled } : {}),
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
    });
    const hasSession = await Effect.runPromise(driver.hasSession(threadId));
    if (!hasSession) {
      await Effect.runPromise(
        driver.startSession({
          threadId,
          workingDirectory:
            sent.thread.env.path.trim().length > 0 ? sent.thread.env.path : process.cwd(),
          modelSelection: sent.thread.modelSelection,
          runtimeMode: sent.thread.runtimeMode,
          interactionMode: sent.thread.interactionMode,
        }),
      );
    }
    void executeDirectTurn({
      store,
      driver,
      threadId,
      storeTurnId: sent.turn.id,
      prompt: input.prompt,
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
    }).catch(() => undefined);
    return {
      threadId,
      messageId: sent.messageId,
      turnId: sent.turn.id,
      delivery: sent.delivery,
    };
  }
}
