/**
 * In-process implementation of `ClientApi` (`./api.ts`) over the own
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

import { buildDirectProviders } from "../core/catalog/direct.js";
import { diagnose } from "../core/diagnostics/doctor.js";
import { EMPTY_SKILL_INVENTORY, type ProviderSummary } from "../core/catalog/summary.js";
import { loadModelPrefs, providerModelPreferences, setModelHidden } from "../core/catalog/prefs.js";
import { defaultModelSelection, resolveModelSelection } from "../core/catalog/selection.js";
import { loadConfig } from "../core/config.js";
import { toWsConfigPayload } from "./config-payload.js";
import { moxenMcpServerSpec } from "./mcp/main.js";
import type { McpServerSpec } from "../core/mcp.js";
import { ensureStoredProject, listStoredProjects } from "../core/projects/projects.js";
import { diffCheckpointRange } from "../core/checkpoints/git.js";
import { CliError } from "../core/errors.js";
import {
  archiveThread,
  createThread,
  deleteThread,
  inspectThread,
  interruptTurn,
  listThreads,
  readThread,
  settleThread,
  snoozeThread,
  unsettleThread,
  unsnoozeThread,
  updateThreadMeta,
} from "../core/threads/threads.js";
import {
  driverForInstance,
  subscribeDriverThread,
  type TurnDriver,
  type TurnDriverFactories,
} from "../core/threads/execute.js";
import {
  cancelTask,
  delegate,
  describeTask,
  ensureProject,
  handover,
  inspectThreadView,
  recoverOrphanedTurn,
  listThreadsView,
  readThreadView,
  resolveProjectView,
  revertThread,
  startTurn,
  type OperationContext,
  type StartedTurn,
} from "../core/threads/operations.js";
import { toThreadEnvelope } from "../core/threads/project.js";
import { openThreadStore, resolveStoreRoot, type ThreadStore } from "../core/threads/store.js";
import type { ProviderRuntimeEvent } from "../core/providers/spi.js";
import type { TurnStatus } from "../core/threads/types.js";
import type { CliConfig, ThreadEnvelope } from "../core/types.js";
import type { ClientApi } from "./api.js";
import {
  decodeCommand,
  decodeQuery,
  type Command,
  type CommandOf,
  type CommandResult,
  type CommandType,
  type ConfigPayload,
  type Query,
  type QueryOf,
  type QueryResult,
  type QueryType,
  type ShellFrame,
  type StartedTurnSummary,
  type ThreadFrame,
  type UserInputAnswers,
} from "./protocol.js";

export type { TurnDriverFactories } from "../core/threads/execute.js";

export interface DirectConnectionOptions {
  readonly storeRoot?: string;
  readonly drivers?: TurnDriverFactories;
  readonly shellPollMs?: number;
  readonly threadPollMs?: number;
  /** Provider source override (tests); defaults to probing the live providers. */
  readonly providers?: () => Promise<ProviderSummary[]>;
  /** Catalog source override (tests); defaults to the providers above, reshaped. */
  readonly catalog?: () => Promise<ConfigPayload>;
  /** Config source override (tests); defaults to the user's config file. */
  readonly config?: () => Promise<CliConfig>;
  /** The `moxen` tools' MCP server per thread; defaults to `mcp/main.ts`. Null turns them off. */
  readonly builtinMcpServers?: ((threadId: string) => readonly McpServerSpec[]) | null;
}

export class DirectConnection implements ClientApi {
  private readonly storeRoot: string;
  private readonly factories: TurnDriverFactories;
  private readonly shellPollMs: number;
  private readonly threadPollMs: number;
  private readonly catalog: () => Promise<ConfigPayload>;
  private readonly providers: () => Promise<ProviderSummary[]>;
  private readonly loadConfig: () => Promise<CliConfig>;
  private readonly builtinMcpServers: ((threadId: string) => readonly McpServerSpec[]) | null;
  private storePromise: Promise<ThreadStore> | null = null;
  private readonly driversOwner = {};
  private readonly ownedDrivers = new Set<TurnDriver>();
  private closed = false;

  constructor(options: DirectConnectionOptions = {}) {
    this.storeRoot = options.storeRoot ?? resolveStoreRoot();
    this.factories = options.drivers ?? {};
    this.shellPollMs = options.shellPollMs ?? 1500;
    this.threadPollMs = options.threadPollMs ?? 750;
    this.providers = options.providers ?? (() => buildDirectProviders());
    this.catalog = options.catalog ?? (async () => toWsConfigPayload(await this.providers()));
    this.loadConfig = options.config ?? (async () => (await loadConfig()).config);
    this.builtinMcpServers =
      options.builtinMcpServers === undefined ? (threadId) => [this.moxenToolsFor(threadId)] : options.builtinMcpServers;
  }

  /**
   * The moxen tools for one thread. Its environment names this store (and
   * config and server mode) outright: providers hand MCP servers a filtered
   * environment (Codex does), and the tools must reach the same threads.
   */
  private moxenToolsFor(threadId: string): McpServerSpec {
    const spec = moxenMcpServerSpec(threadId);
    if (spec.type !== "stdio") return spec;
    const env: Record<string, string> = { ...spec.env, MOXEN_STORE_ROOT: this.storeRoot };
    for (const name of ["MOXEN_CONFIG", "MOXEN_SERVER", "MOXEN_SERVER_ENDPOINT"]) {
      const value = process.env[name];
      if (value) env[name] = value;
    }
    return { ...spec, env };
  }

  /**
   * What the core operations run against. The store is opened once; the
   * config is read per operation, because a server outlives any one
   * command and a config edit must not need a restart to apply.
   */
  private async context(): Promise<OperationContext> {
    const [store, config] = await Promise.all([this.store(), this.loadConfig()]);
    return {
      store,
      storeRoot: this.storeRoot,
      config,
      driverFor: (instanceId: string) => this.driverFor(instanceId),
      ...(this.builtinMcpServers ? { builtinMcpServers: this.builtinMcpServers } : {}),
    };
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
    onItem: (item: ShellFrame) => void,
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
          threads.map(async (entry) => toThreadEnvelope(entry, await store.readTurns(entry.id))),
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
    onItem: (item: ThreadFrame) => void,
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
    // Live assistant text only. Tool calls are *not* recorded here: the
    // turn runner already writes them to the activity ledger with their
    // full payload (`threads/toolactivity.ts`), and the poll above picks
    // them up. A second recorder on this path wrote a payload-less row per
    // event — undeduped, and with no `toolCallId` for the transcript to
    // fold — so any turn run with the TUI attached got bare rows beside
    // the real tool cards.
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

  private async threadDetail(threadId: string): Promise<ThreadEnvelope | null> {
    // The TUI polls here: a turn orphaned by a dead process must not spin forever.
    await recoverOrphanedTurn(await this.context(), threadId);
    const store = await this.store();
    const read = await readThread(store, threadId, { view: "messages" }).catch(() => null);
    if (!read) return null;
    return toThreadEnvelope(read.thread, read.turns, {
      messages: read.messages,
      activities: read.activities,
      checkpoints: read.checkpoints,
    });
  }

  // -- dispatch --------------------------------------------------------------

  /**
   * Typed callers are checked at compile time; the argument is decoded
   * anyway, because not every caller is typed — a transport hands this
   * whatever arrived on the wire — and decoding is also where defaults
   * (runtime mode, interaction mode) are applied.
   */
  async dispatch<T extends CommandType>(command: CommandOf<T>): Promise<CommandResult<T>> {
    if (this.closed) throw new CliError("CONNECTION_CLOSED", "The direct connection is closed.");
    return (await this.run(decodeCommand(command))) as CommandResult<T>;
  }

  private async run(command: Command): Promise<CommandResult> {
    const accepted = { accepted: true } as const;
    switch (command.type) {
      case "project.create":
        return await this.projectCreate(command);
      case "thread.create":
        return await this.threadCreate(command);
      case "thread.turn.start":
        return await this.turnStart(command);
      case "thread.turn.interrupt":
        await interruptTurn(await this.store(), command.threadId, command.turnId);
        return accepted;
      case "thread.settle":
        await settleThread(await this.store(), command.threadId);
        return accepted;
      case "thread.unsettle":
        await unsettleThread(await this.store(), command.threadId);
        return accepted;
      case "thread.snooze":
        await snoozeThread(await this.store(), command.threadId, command.snoozedUntil);
        return accepted;
      case "thread.unsnooze":
        await unsnoozeThread(await this.store(), command.threadId);
        return accepted;
      case "thread.archive":
        await archiveThread(await this.store(), command.threadId);
        return accepted;
      case "thread.delete":
        await deleteThread(await this.store(), command.threadId);
        return accepted;
      case "thread.meta.update":
        await updateThreadMeta(await this.store(), command.threadId, {
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.regenerateTitle === true ? { regenerateTitle: true } : {}),
        });
        return accepted;
      case "thread.model-selection.set":
        await updateThreadMeta(await this.store(), command.threadId, { modelSelection: command.modelSelection });
        return accepted;
      case "thread.runtime-mode.set":
        await updateThreadMeta(await this.store(), command.threadId, { runtimeMode: command.runtimeMode });
        return accepted;
      case "thread.user-input.respond":
        await this.userInputRespond(command.threadId, command.requestId, command.answers);
        return accepted;
      case "thread.user-input.dismiss":
        await this.userInputDismiss(command.threadId, command.requestId);
        return accepted;
      case "thread.handover": {
        const { type: _type, commandId: _id, wait, ...request } = command;
        const result = await handover(await this.context(), request);
        return { ...result, started: result.started ? await this.settle(result.started, wait === true) : null };
      }
      case "thread.delegate": {
        const { type: _type, commandId: _id, ...request } = command;
        return await delegate(await this.context(), request);
      }
      case "thread.task.cancel":
        return await cancelTask(await this.context(), command.parentThreadId, command.taskId);
      case "project.ensure": {
        const { type: _type, commandId: _id, ...request } = command;
        return await ensureProject(await this.context(), request);
      }
      case "model.visibility.set":
        return { hidden: await setModelHidden(this.storeRoot, command.instanceId, command.model, command.hidden) };
      case "thread.conversation.revert":
        return { ...(await revertThread(await this.context(), command.threadId, command.turnCount)), accepted: true };
    }
  }

  private async projectCreate(command: CommandOf<"project.create">): Promise<CommandResult<"project.create">> {
    const { workspaceRoot } = command;
    const existing = await listStoredProjects(this.storeRoot).then(
      (projects) => projects.find((candidate) => candidate.workspaceRoot === workspaceRoot) ?? null,
    );
    if (existing) return { projectId: existing.id, created: false };
    const ensured = await ensureStoredProject(this.storeRoot, {
      ...(command.projectId ? { id: command.projectId } : {}),
      workspaceRoot,
      ...(command.title ? { title: command.title } : {}),
    });
    return { projectId: ensured.project.id, created: true };
  }

  private async threadCreate(command: CommandOf<"thread.create">): Promise<CommandResult<"thread.create">> {
    const { store, config } = await this.context();
    const { projectId } = command;
    const project = (await listStoredProjects(this.storeRoot)).find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new CliError("PROJECT_NOT_FOUND", `No project exists with id ${projectId}.`, {
        exitCode: 3,
        details: { projectId },
      });
    }
    const created = await createThread(store, {
      ...(command.threadId ? { id: command.threadId } : {}),
      projectId,
      title: command.title ?? "New thread",
      // No explicit selection: the project's default, then the config's
      // provider/model, the same resolution a CLI handover applies.
      modelSelection:
        command.modelSelection ??
        resolveModelSelection(project.defaultModelSelection ?? defaultModelSelection(), config, { prompt: "" }),
      runtimeMode: command.runtimeMode ?? config.runtimeMode,
      interactionMode: command.interactionMode ?? config.interactionMode,
      env: { mode: "local", path: project.workspaceRoot, branch: command.branch ?? null },
    });
    return { threadId: created.id, accepted: true };
  }

  private async turnStart(command: CommandOf<"thread.turn.start">): Promise<CommandResult<"thread.turn.start">> {
    const { threadId, message } = command;
    const started = await startTurn(await this.context(), {
      threadId,
      prompt: message.text,
      // Saved with the message and sent to the provider as images.
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      ...(command.modelSelection ? { modelSelection: command.modelSelection } : {}),
      ...(command.ifBusy ? { ifBusy: command.ifBusy } : {}),
      ...(command.delivery ? { delivery: command.delivery } : {}),
      ...(command.wakeSettled !== undefined ? { wakeSettled: command.wakeSettled } : {}),
      ...(command.handoffNote !== undefined ? { handoffNote: command.handoffNote } : {}),
      // Noop subscriber: guarantees the driver's shared pump exists (drain
      // discipline) even before any thread subscription opens. Open
      // subscriptions register their own callbacks alongside this one.
      onEvent: () => undefined,
    });
    return { ...(await this.settle(started, command.wait === true)), accepted: true };
  }

  /**
   * A started turn as a client sees it, after optionally waiting for it
   * to settle. Waiting follows the ledger rather than the run handle: a
   * queued turn has no run yet, and is started by whichever runner
   * settles the turn ahead of it.
   */
  private async settle(started: StartedTurn, wait: boolean): Promise<StartedTurnSummary> {
    if (wait) await started.run;
    return {
      turnId: started.turn.id,
      messageId: started.messageId,
      delivery: started.delivery,
      status: wait ? await this.turnSettled(started.turn.threadId, started.turn.id) : await this.turnStatus(started.turn.threadId, started.turn.id),
      ...(started.steerDelivered === undefined ? {} : { steerDelivered: started.steerDelivered }),
    };
  }

  private async turnStatus(threadId: string, turnId: string): Promise<TurnStatus> {
    const turn = (await (await this.store()).readTurns(threadId)).find((candidate) => candidate.id === turnId);
    if (!turn) {
      throw new CliError("TURN_NOT_FOUND", `No turn exists with id ${turnId}.`, { exitCode: 3, details: { threadId, turnId } });
    }
    return turn.status;
  }

  /**
   * Follows the ledger rather than a run handle: a queued turn has no run
   * yet, and a turn started by another process has none here at all.
   */
  private async turnSettled(threadId: string, turnId: string): Promise<TurnStatus> {
    for (let poll = 0; ; poll += 1) {
      const status = await this.turnStatus(threadId, turnId);
      if ((status !== "running" && status !== "queued") || this.closed) return status;
      // Every couple of seconds: a turn whose process died never settles.
      if (poll % 20 === 19) await recoverOrphanedTurn(await this.context(), threadId);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }


  /**
   * The driver that owns the live session for a thread. Answering a parked
   * request has to reach the *same* driver instance that parked it, so this
   * resolves through the thread's own instance id rather than guessing.
   */
  private async driverForThread(threadId: string): Promise<TurnDriver> {
    const store = await this.store();
    const thread = await inspectThread(store, threadId);
    // The running turn's own model: the thread's may have been switched
    // since the turn started, and the parked question is on this driver.
    const running = (await store.readTurns(threadId)).find((turn) => turn.status === "running");
    const driver = this.driverFor((running?.modelSelection ?? thread.modelSelection).instanceId);
    if (!(await Effect.runPromise(driver.hasSession(threadId)).catch(() => false))) {
      throw new CliError(
        "REQUEST_NOT_OWNED",
        `The question on thread ${threadId} belongs to a turn running in another process. Start a shared server (moxen server start) so every client can reach it.`,
        { exitCode: 4, details: { threadId } },
      );
    }
    return driver;
  }

  /**
   * Answers arrive from the panel as `string | string[]` (multi-select),
   * while the SPI carries one string per question; a multi-select answer
   * joins on the same separator the options are listed with.
   */
  private async userInputRespond(threadId: string, requestId: string, answers: UserInputAnswers): Promise<void> {
    const driver = await this.driverForThread(threadId);
    if (!driver.respondToUserInput) {
      throw new CliError("REQUEST_UNSUPPORTED", "This provider cannot be answered.");
    }
    const joined = Object.fromEntries(
      Object.entries(answers).map(([key, value]) => [key, typeof value === "string" ? value : value.join(", ")]),
    );
    await Effect.runPromise(driver.respondToUserInput(threadId, requestId, joined));
  }

  /**
   * Dismissal denies the parked request rather than answering it: the
   * provider is still blocked on `canUseTool` and would hang forever if we
   * only closed the panel. The model sees a declined tool call and carries
   * on, which is what "the agent is not messaged" means in practice.
   */
  private async userInputDismiss(threadId: string, requestId: string): Promise<void> {
    const driver = await this.driverForThread(threadId);
    if (!driver.respondToRequest) {
      throw new CliError("REQUEST_UNSUPPORTED", "This provider cannot be answered.");
    }
    await Effect.runPromise(driver.respondToRequest(threadId, requestId, { kind: "decline" }));
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

  // -- queries ---------------------------------------------------------------

  /** Reads; decoded like commands, for the same reason. */
  async query<T extends QueryType>(query: QueryOf<T>): Promise<QueryResult<T>> {
    if (this.closed) throw new CliError("CONNECTION_CLOSED", "The direct connection is closed.");
    return (await this.answer(decodeQuery(query))) as QueryResult<T>;
  }

  private async answer(query: Query): Promise<QueryResult> {
    const ctx = await this.context();
    switch (query.type) {
      case "projects.list":
        return { projects: await listStoredProjects(this.storeRoot) };
      case "project.resolve":
        return await resolveProjectView(ctx, query);
      case "threads.list": {
        const { type: _type, ...filter } = query;
        return await listThreadsView(ctx, filter);
      }
      case "thread.inspect":
        await recoverOrphanedTurn(ctx, query.threadId);
        return await inspectThreadView(ctx, query.threadId);
      case "thread.read":
        await recoverOrphanedTurn(ctx, query.threadId);
        return await readThreadView(ctx, query.threadId, {
          ...(query.view !== undefined ? { view: query.view } : {}),
          ...(query.lastTurn !== undefined ? { lastTurn: query.lastTurn } : {}),
        });
      case "thread.task.status":
        return await describeTask(ctx, query.parentThreadId, query.taskId);
      case "thread.turn.await":
        return { status: await this.turnSettled(query.threadId, query.turnId) };
      case "providers.list":
        return { providers: await this.providers() };
      case "doctor":
        return await diagnose(this.storeRoot);
      case "skills.list": {
        const driver = this.driverFor(query.instanceId);
        return driver.skillInventory ? await driver.skillInventory(query.cwd) : EMPTY_SKILL_INVENTORY;
      }
    }
  }

  /**
   * The catalog plus the user's model preferences, in the settings shape
   * the catalog decoder reads hidden models from — so hiding a model (from
   * any client) takes it out of every picker.
   */
  async getConfig(): Promise<ConfigPayload> {
    const [payload, prefs] = await Promise.all([this.catalog(), loadModelPrefs(this.storeRoot)]);
    const preferences = providerModelPreferences(prefs);
    if (Object.keys(preferences).length === 0) return payload;
    return { ...payload, settings: { ...payload.settings, providerModelPreferences: preferences } };
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
