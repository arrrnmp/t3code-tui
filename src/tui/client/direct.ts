/**
 * Direct TUI client: implements the `TuiClient` surface over the own
 * store, drivers, and git checkpoints — no server, no websocket.
 *
 * - Subscriptions are poll-based snapshots in the exact frame shapes the
 *   existing projectors consume (`{kind:"snapshot",…}`,
 *   `{kind:"synchronized"}`, `{kind:"event",…}`), plus live
 *   `thread.message-sent` deltas bridged from provider events while a
 *   turn runs. Tool calls are appended to the activity ledger as they
 *   land, so they survive resubscription; message text streams live and
 *   converges from the ledger at settle.
 * - `dispatch` maps the command types the TUI sends onto store ops and
 *   the shared turn runner. Image attachments degrade to file-name
 *   mentions in the driver prompt (per-driver image plumbing is a
 *   Stage 6 item); validation limits still apply client-side.
 * - `getConfig` serves the direct catalog translated into the
 *   `server.getConfig` payload shape, so `extractProviders` (and the
 *   effort picker) works unmodified.
 */
import * as Effect from "effect/Effect";

import { buildDirectProviders, toWsConfigPayload } from "../../cli/catalog/direct.js";
import { ensureStoredProject, listStoredProjects } from "../../projects/projects.js";
import { diffCheckpointRange } from "../../checkpoints/git.js";
import { CliError } from "../../errors.js";
import {
  archiveThread,
  createThread,
  deleteThread,
  inspectThread,
  interruptTurn,
  listThreads,
  readThread,
  sendTurn,
  settleThread,
  snoozeThread,
  unsettleThread,
  unsnoozeThread,
  updateThreadMeta,
} from "../../threads/threads.js";
import {
  driverForInstance,
  executeTurn,
  subscribeDriverThread,
  type TurnDriver,
  type TurnDriverFactories,
} from "../../threads/execute.js";
import { toT3Thread } from "../../threads/project.js";
import { openThreadStore, resolveStoreRoot, type ThreadStore } from "../../threads/store.js";
import type { ProviderRuntimeEvent } from "../../providers/spi.js";
import type {
  InteractionMode,
  ModelSelection,
  RuntimeMode,
  T3Thread,
} from "../../types.js";
import type { ImageAttachmentUpload } from "../model/attachments.js";
import type { TuiClient } from "../app/app.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const RUNTIME_MODES: ReadonlyArray<RuntimeMode> = ["approval-required", "auto", "auto-accept-edits", "full-access"];

function asRuntimeMode(value: unknown): RuntimeMode {
  return typeof value === "string" && (RUNTIME_MODES as readonly string[]).includes(value)
    ? (value as RuntimeMode)
    : "full-access";
}

function asInteractionMode(value: unknown): InteractionMode {
  return value === "plan" ? "plan" : "default";
}

function asModelSelection(value: unknown): ModelSelection | null {
  const record = asRecord(value);
  const instanceId = record ? asString(record.instanceId) : null;
  const model = record ? asString(record.model) : null;
  if (!instanceId || !model) return null;
  const options = record?.options;
  const normalized = Array.isArray(options)
    ? options.flatMap((entry) => {
      const row = asRecord(entry);
      const id = row ? asString(row.id) : null;
      const optionValue = row?.value;
      if (!id || (typeof optionValue !== "string" && typeof optionValue !== "boolean")) return [];
      return [{ id, value: optionValue }];
    })
    : [];
  return { instanceId, model, ...(normalized.length > 0 ? { options: normalized } : {}) };
}

function unknownCommand(type: string): CliError {
  return new CliError("UNKNOWN_COMMAND", `Unsupported command type: ${type}.`, {
    details: { type },
  });
}

export interface DirectConnectionOptions {
  readonly storeRoot?: string;
  readonly drivers?: TurnDriverFactories;
  readonly shellPollMs?: number;
  readonly threadPollMs?: number;
  /** Catalog source override (tests); defaults to the live direct catalog. */
  readonly catalog?: () => Promise<unknown>;
}

export class DirectConnection implements TuiClient {
  private readonly storeRoot: string;
  private readonly factories: TurnDriverFactories;
  private readonly shellPollMs: number;
  private readonly threadPollMs: number;
  private readonly catalog: () => Promise<unknown>;
  private storePromise: Promise<ThreadStore> | null = null;
  private readonly driversOwner = {};
  private readonly ownedDrivers = new Set<TurnDriver>();
  private closed = false;

  constructor(options: DirectConnectionOptions = {}) {
    this.storeRoot = options.storeRoot ?? resolveStoreRoot();
    this.factories = options.drivers ?? {};
    this.shellPollMs = options.shellPollMs ?? 1500;
    this.threadPollMs = options.threadPollMs ?? 750;
    this.catalog = options.catalog ?? (async () => toWsConfigPayload(await buildDirectProviders()));
  }

  private async store(): Promise<ThreadStore> {
    if (!this.storePromise) this.storePromise = openThreadStore(this.storeRoot);
    return await this.storePromise;
  }

  private driverFor(instanceId: string): TurnDriver {
    const driver = driverForInstance(this.driversOwner, instanceId, this.factories);
    this.ownedDrivers.add(driver);
    return driver;
  }

  // -- subscriptions -------------------------------------------------------

  subscribeShell(
    _options: { afterSequence?: number },
    onItem: (item: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void {
    let lastHash: string | null = null;
    let stopped = false;
    const poll = async (): Promise<void> => {
      if (stopped || this.closed) return;
      try {
        const store = await this.store();
        const [projects, threads] = await Promise.all([
          listStoredProjects(this.storeRoot),
          listThreads(store, { status: "all" }),
        ]);
        const rows = await Promise.all(
          threads.map(async (entry) => toT3Thread(entry, await store.readTurns(entry.id))),
        );
        const visible = rows.filter((row) => row.archivedAt == null && row.deletedAt == null);
        const hash = JSON.stringify({ projects, threads: visible });
        if (hash !== lastHash) {
          lastHash = hash;
          onItem({
            kind: "snapshot",
            snapshot: { snapshotSequence: 0, projects, threads: visible },
          });
        }
      } catch (cause) {
        onError(cause);
      }
    };
    void poll().then(() => {
      if (!stopped && !this.closed) onItem({ kind: "synchronized" });
    });
    const timer = setInterval(() => void poll(), this.shellPollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  subscribeThread(
    threadId: string,
    _options: { afterSequence?: number },
    onItem: (item: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void {
    let lastHash: string | null = null;
    let stopped = false;
    const emittedLengths = new Map<string, number>();
    const poll = async (): Promise<void> => {
      if (stopped || this.closed) return;
      try {
        const detail = await this.threadDetail(threadId);
        if (!detail) return;
        const hash = JSON.stringify(detail);
        if (hash !== lastHash) {
          lastHash = hash;
          onItem({ kind: "snapshot", snapshot: { snapshotSequence: 0, thread: detail } });
        }
      } catch (cause) {
        onError(cause);
      }
    };
    const onEvent = (event: ProviderRuntimeEvent): void => {
      if (stopped || this.closed) return;
      if (event.type === "message.part.updated" && event.turnId) {
        const key = event.turnId;
        const seen = emittedLengths.get(key) ?? 0;
        const delta = event.text.slice(seen);
        emittedLengths.set(key, event.text.length);
        if (delta.length === 0) return;
        onItem({
          kind: "event",
          event: {
            type: "thread.message-sent",
            payload: {
              message: {
                id: `stream-${key}`,
                role: "assistant",
                text: delta,
                turnId: key,
                streaming: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            },
          },
        });
        return;
      }
      if (
        (event.type === "tool.execute.started" ||
          event.type === "tool.execute.updated" ||
          event.type === "tool.execute.completed") &&
        event.turnId
      ) {
        void this.recordToolActivity(threadId, event.turnId, event.tool).catch(() => undefined);
      }
    };
    // The bridge attaches lazily per active driver session: poll for a
    // session and subscribe once it exists, so events flow even when the
    // turn was started elsewhere (CLI) while the TUI watches.
    let unsubscribeBridge: (() => void) | null = null;
    const ensureBridge = async (): Promise<void> => {
      if (stopped || this.closed || unsubscribeBridge) return;
      try {
        const store = await this.store();
        const thread = await store.readThreadRecord(threadId).catch(() => null);
        if (!thread) return;
        const driver = this.driverFor(thread.modelSelection.instanceId);
        const hasSession = await Effect.runPromise(driver.hasSession(threadId)).catch(() => false);
        if (!hasSession) return;
        unsubscribeBridge = subscribeDriverThread(driver, threadId, onEvent);
      } catch {
        // Retry on the next poll.
      }
    };
    void poll().then(() => {
      if (!stopped && !this.closed) {
        onItem({ kind: "synchronized" });
        void ensureBridge();
      }
    });
    const timer = setInterval(() => {
      void poll();
      void ensureBridge();
    }, this.threadPollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
      unsubscribeBridge?.();
    };
  }

  private async threadDetail(threadId: string): Promise<T3Thread | null> {
    const store = await this.store();
    const read = await readThread(store, threadId, { view: "messages" }).catch(() => null);
    if (!read) return null;
    return toT3Thread(read.thread, read.turns, {
      messages: read.messages,
      activities: read.activities,
      checkpoints: read.checkpoints,
    });
  }

  private async recordToolActivity(threadId: string, turnId: string, tool: string): Promise<void> {
    const store = await this.store();
    await store.appendLedger(threadId, "activity", {
      id: store.newId(),
      threadId,
      turnId,
      kind: "tool_execution",
      summary: tool.slice(0, 200),
      createdAt: store.nowIso(),
    });
  }

  // -- dispatch --------------------------------------------------------------

  async dispatch(command: unknown): Promise<unknown> {
    if (this.closed) throw new CliError("CONNECTION_CLOSED", "The direct connection is closed.");
    const record = asRecord(command);
    const type = record ? asString(record.type) : null;
    if (!type || !record) {
      throw unknownCommand(String(asRecord(command)?.type ?? "missing"));
    }
    switch (type) {
      case "project.create":
        return await this.dispatchProjectCreate(record);
      case "thread.create":
        return await this.dispatchThreadCreate(record);
      case "thread.turn.start":
        return await this.dispatchTurnStart(record);
      case "thread.turn.interrupt":
        return await this.dispatchTurnInterrupt(record);
      case "thread.settle":
        return await this.dispatchSettle(record, true);
      case "thread.unsettle":
        return await this.dispatchSettle(record, false);
      case "thread.snooze":
        return await this.dispatchSnooze(record);
      case "thread.unsnooze": {
        const store = await this.store();
        await unsnoozeThread(store, requireThreadId(record.threadId));
        return { accepted: true };
      }
      case "thread.archive": {
        const store = await this.store();
        await archiveThread(store, requireThreadId(record.threadId));
        return { accepted: true };
      }
      case "thread.delete": {
        const store = await this.store();
        await deleteThread(store, requireThreadId(record.threadId));
        return { accepted: true };
      }
      case "thread.meta.update":
        return await this.dispatchMetaUpdate(record);
      case "thread.model-selection.set":
        return await this.dispatchModelSelectionSet(record);
      case "thread.runtime-mode.set":
        return await this.dispatchRuntimeModeSet(record);
      default:
        throw unknownCommand(type);
    }
  }

  private async dispatchProjectCreate(record: Record<string, unknown>): Promise<unknown> {
    const workspaceRoot = asString(record.workspaceRoot);
    if (!workspaceRoot) throw new CliError("INVALID_THREAD_OPTION", "project.create requires workspaceRoot.");
    const existing = await listStoredProjects(this.storeRoot).then(
      (projects) => projects.find((candidate) => candidate.workspaceRoot === workspaceRoot) ?? null,
    );
    if (existing) return { projectId: existing.id, created: false };
    const ensured = await ensureStoredProject(this.storeRoot, {
      ...(typeof record.projectId === "string" && record.projectId ? { id: record.projectId } : {}),
      workspaceRoot,
      ...(typeof record.title === "string" && record.title ? { title: record.title } : {}),
    });
    return { projectId: ensured.project.id, created: true };
  }

  private async projectWorkspaceRoot(projectId: string): Promise<string> {
    const projects = await listStoredProjects(this.storeRoot);
    return projects.find((candidate) => candidate.id === projectId)?.workspaceRoot ?? "";
  }

  private async dispatchThreadCreate(record: Record<string, unknown>): Promise<unknown> {
    const store = await this.store();
    const projectId = asString(record.projectId);
    if (!projectId) throw new CliError("PROJECT_ID_REQUIRED", "thread.create requires projectId.", { exitCode: 2 });
    const projects = await listStoredProjects(this.storeRoot);
    if (!projects.some((candidate) => candidate.id === projectId)) {
      throw new CliError("PROJECT_NOT_FOUND", `No project exists with id ${projectId}.`, {
        exitCode: 3,
        details: { projectId },
      });
    }
    const selection = asRecord(record.modelSelection) ? asModelSelection(record.modelSelection) : null;
    const created = await createThread(store, {
      ...(typeof record.threadId === "string" && record.threadId ? { id: record.threadId } : {}),
      projectId,
      title: asString(record.title) ?? "New thread",
      modelSelection: selection ?? { instanceId: "codex", model: "gpt-5.4" },
      runtimeMode: asRuntimeMode(record.runtimeMode),
      interactionMode: asInteractionMode(record.interactionMode),
      env: {
        mode: "local",
        path: await this.projectWorkspaceRoot(projectId),
        branch: typeof record.branch === "string" ? record.branch : null,
      },
    });
    return { threadId: created.id, accepted: true };
  }

  private async dispatchTurnStart(record: Record<string, unknown>): Promise<unknown> {
    const store = await this.store();
    const threadId = requireThreadId(record.threadId);
    const message = asRecord(record.message);
    const text = message ? asString(message.text) ?? "" : "";
    if (!text.trim()) throw new CliError("PROMPT_REQUIRED", "A non-empty thread message is required.", { exitCode: 2 });
    const attachments = message && Array.isArray(message.attachments)
      ? (message.attachments as ImageAttachmentUpload[])
      : [];
    const names = attachments.map((attachment) => attachment?.name).filter((name): name is string => !!name);
    const prompt = names.length > 0 ? `${text}\n\n[attached images: ${names.join(", ")}]` : text;
    const selection = asModelSelection(record.modelSelection);
    const thread = await inspectThread(store, threadId);
    const sent = await sendTurn(store, threadId, {
      prompt: text,
      ...(selection ? { modelSelection: selection } : {}),
    });
    const instanceId = selection?.instanceId ?? thread.modelSelection.instanceId;
    const driver = this.driverFor(instanceId);
    const hasSession = await Effect.runPromise(driver.hasSession(threadId)).catch(() => false);
    if (!hasSession) {
      const cwd = thread.env.path.trim().length > 0 ? thread.env.path : process.cwd();
      await Effect.runPromise(
        driver.startSession({
          threadId,
          workingDirectory: cwd,
          modelSelection: selection ?? thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
        }),
      );
    }
    void executeTurn({
      store,
      driver,
      threadId,
      storeTurnId: sent.turn.id,
      prompt,
      ...(selection ? { modelSelection: selection } : {}),
      workingDirectory: thread.env.path,
      // Noop subscriber: guarantees the driver's shared pump exists (drain
      // discipline) even before any thread subscription opens. Open
      // subscriptions register their own callbacks alongside this one.
      onEvent: () => undefined,
    }).catch(() => undefined);
    return { messageId: sent.messageId, accepted: true };
  }

  private async dispatchTurnInterrupt(record: Record<string, unknown>): Promise<unknown> {
    const store = await this.store();
    const turnId = typeof record.turnId === "string" && record.turnId ? record.turnId : undefined;
    await interruptTurn(store, requireThreadId(record.threadId), turnId);
    return { accepted: true };
  }

  private async dispatchSettle(record: Record<string, unknown>, settled: boolean): Promise<unknown> {
    const store = await this.store();
    const threadId = requireThreadId(record.threadId);
    if (settled) await settleThread(store, threadId);
    else await unsettleThread(store, threadId);
    return { accepted: true };
  }

  private async dispatchSnooze(record: Record<string, unknown>): Promise<unknown> {
    const store = await this.store();
    const until = asString(record.snoozedUntil);
    if (!until) throw new CliError("SNOOZE_UNTIL_INVALID", "Use --until with a valid ISO-8601 datetime.", { exitCode: 2 });
    await snoozeThread(store, requireThreadId(record.threadId), until);
    return { accepted: true };
  }

  private async dispatchMetaUpdate(record: Record<string, unknown>): Promise<unknown> {
    const store = await this.store();
    const threadId = requireThreadId(record.threadId);
    await updateThreadMeta(store, threadId, {
      ...(typeof record.title === "string" ? { title: record.title } : {}),
      ...(record.regenerateTitle === true ? { regenerateTitle: true } : {}),
    });
    return { accepted: true };
  }

  private async dispatchModelSelectionSet(record: Record<string, unknown>): Promise<unknown> {
    const store = await this.store();
    const selection = asModelSelection(record.modelSelection);
    if (!selection) throw new CliError("INVALID_THREAD_OPTION", "model-selection.set requires a model selection.");
    await updateThreadMeta(store, requireThreadId(record.threadId), { modelSelection: selection });
    return { accepted: true };
  }

  private async dispatchRuntimeModeSet(record: Record<string, unknown>): Promise<unknown> {
    const store = await this.store();
    const mode = record.runtimeMode;
    if (typeof mode !== "string" || !(RUNTIME_MODES as readonly string[]).includes(mode)) {
      throw new CliError("INVALID_THREAD_OPTION", "runtime-mode.set requires a known runtime mode.", { exitCode: 2 });
    }
    await updateThreadMeta(store, requireThreadId(record.threadId), { runtimeMode: mode as RuntimeMode });
    return { accepted: true };
  }

  // -- reads -----------------------------------------------------------------

  async turnDiff(threadId: string, toTurnCount: number): Promise<string | null> {
    const store = await this.store();
    const [turns, checkpoints] = await Promise.all([
      store.readTurns(threadId).catch(() => []),
      store.readCheckpoints(threadId).catch(() => []),
    ]);
    const turn = turns[toTurnCount - 1];
    if (!turn) return null;
    const checkpoint = checkpoints.find((row) => row.turnId === turn.id);
    if (!checkpoint || checkpoint.status !== "available" || !checkpoint.ref || !checkpoint.baseRef) return null;
    const thread = await store.readThreadRecord(threadId).catch(() => null);
    const cwd = thread?.env.path?.trim() ? thread.env.path : null;
    if (!cwd) return null;
    return await diffCheckpointRange(cwd, checkpoint.baseRef, checkpoint.ref);
  }

  async getConfig(): Promise<unknown> {
    return await this.catalog();
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const driver of this.ownedDrivers) {
      try {
        await Effect.runPromise(driver.stopAll?.() ?? Effect.void);
      } catch {
        // Best effort: servers may already be gone.
      }
    }
    this.ownedDrivers.clear();
  }
}

function requireThreadId(value: unknown): string {
  const threadId = typeof value === "string" ? value.trim() : "";
  if (!threadId) throw new CliError("THREAD_ID_REQUIRED", "A non-empty thread id is required.", { exitCode: 2 });
  return threadId;
}
