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
import { defaultConfigPath, loadConfig, saveConfig, setConfigValue } from "../core/config.js";
import { describeSettings } from "../core/configschema.js";
import { buildHandoff, continuedTitle } from "../core/threads/handoff.js";
import { readCommitDiff, readOverview } from "../core/git/history.js";
import {
  commentOnRequest,
  createRequest,
  detectForge,
  listRequests,
  mergeRequest,
  viewRequest,
  type ForgeDetection,
} from "../core/forge/forge.js";
import { toWsConfigPayload } from "./config-payload.js";
import { MOXEN_MCP_SERVER_NAME, moxenMcpServerSpec } from "./mcp/main.js";
import { startMcpHttpServer, type McpHttpServer } from "./mcp/http.js";
import { MOXEN_MCP_INSTRUCTIONS } from "./mcp/stdio.js";
import { callMoxenTool, MOXEN_TOOLS } from "./mcp/tools.js";
import { noteMessageId } from "../core/threads/views.js";
import type { McpServerSpec } from "../core/mcp.js";
import { ensureStoredProject, listStoredProjects } from "../core/projects/projects.js";
import { diffCheckpointRange, diffCheckpointStat } from "../core/checkpoints/git.js";
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
  driverKey,
  subscribeDriverThread,
  type TurnDriver,
  type TurnDriverFactories,
} from "../core/threads/execute.js";
import { onScheduledTurnDue } from "../core/threads/schedule.js";
import {
  armPendingScheduledTurns,
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
  runDueScheduledTurn,
  startTurn,
  type OperationContext,
  type StartedTurn,
} from "../core/threads/operations.js";
import { toThreadEnvelope } from "../core/threads/project.js";
import { openThreadStore, resolveStoreRoot, type ThreadStore } from "../core/threads/store.js";
import type { ProviderRuntimeEvent } from "../core/providers/spi.js";
import type { CheckpointFileStat, StoredCheckpoint, TurnStatus } from "../core/threads/types.js";
import type { CliConfig, ForgeConfig, ProvidersConfig, ThreadEnvelope } from "../core/types.js";
import { persistUsageLimits, usageLimitsSnapshot } from "../core/usage/limits.js";
import type { ClientApi } from "./api.js";
import {
  decodeCommand,
  decodeQuery,
  type Command,
  type CommandOf,
  type CommandResult,
  type CommandType,
  type ConfigPayload,
  type SettingsSnapshot,
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
  /** Which file `settings.set` writes; defaults to the resolved config path. */
  readonly configPath?: string;
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
  private readonly readConfigFile: () => Promise<{ config: CliConfig; path: string; exists: boolean }>;
  /** The per-provider settings the last config read saw; see `driverFor`. */
  private lastProviders: ProvidersConfig | undefined;
  private readonly builtinMcpServers: ((threadId: string) => readonly McpServerSpec[]) | null;
  private storePromise: Promise<ThreadStore> | null = null;
  private readonly driversOwner = {};
  private readonly ownedDrivers = new Set<TurnDriver>();
  private closed = false;
  /** Backfilled per-file stats for checkpoints recorded without them, by ref pair (immutable). */
  private readonly checkpointFiles = new Map<string, ReadonlyArray<CheckpointFileStat>>();

  constructor(options: DirectConnectionOptions = {}) {
    this.storeRoot = options.storeRoot ?? resolveStoreRoot();
    persistUsageLimits(this.storeRoot);
    this.factories = options.drivers ?? {};
    this.shellPollMs = options.shellPollMs ?? 1500;
    this.threadPollMs = options.threadPollMs ?? 750;
    this.providers = options.providers ?? (() => buildDirectProviders());
    this.catalog = options.catalog ?? (async () => toWsConfigPayload(await this.providers()));
    // One reader, two shapes: operations want the config alone, while
    // `settings.set` also needs the path to write back to. A test that
    // overrides the config supplies values only, so its path falls back to
    // the resolved default and is never written unless it asks for one.
    const override = options.config;
    this.readConfigFile = override
      ? async () => ({ config: await override(), path: options.configPath ?? defaultConfigPath(), exists: true })
      : async () => await loadConfig(options.configPath);
    this.loadConfig = async () => {
      const { config } = await this.readConfigFile();
      this.lastProviders = config.providers;
      return config;
    };
    this.builtinMcpServers =
      options.builtinMcpServers === undefined ? (threadId) => [this.moxenToolsFor(threadId)] : options.builtinMcpServers;
  }

  /**
   * The moxen tools for one thread. Its environment names this store (and
   * config and server mode) outright: providers hand MCP servers a filtered
   * environment (Codex does), and the tools must reach the same threads.
   */
  private moxenToolsFor(threadId: string): McpServerSpec {
    // Hosted in this process: Claude calls the tools in-process, the other
    // providers over loopback HTTP served here — so a delegation always runs
    // in the process that owns its parent's session. Until the HTTP server
    // is up (or in a process that never starts it), the stdio child.
    const fallback = this.mcpHttp
      ? { name: MOXEN_MCP_SERVER_NAME, type: "http" as const, ...this.mcpHttp.specFor(threadId), alwaysLoad: true }
      : { ...this.moxenStdioFor(threadId), alwaysLoad: true };
    return {
      name: MOXEN_MCP_SERVER_NAME,
      type: "in-process",
      instructions: MOXEN_MCP_INSTRUCTIONS,
      tools: MOXEN_TOOLS,
      call: (tool, args) => callMoxenTool(this, threadId, tool, args),
      fallback,
      // Delegation is what these tools are for: never behind a tool search.
      alwaysLoad: true,
    };
  }

  private moxenStdioFor(threadId: string): Extract<McpServerSpec, { type: "stdio" }> {
    const spec = moxenMcpServerSpec(threadId);
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

  /**
   * A thread's checkout. Worktree threads have their own, so this is the
   * only correct place to resolve it: a client that guessed the project
   * root would read the wrong branch for half the threads open.
   */
  private async workspaceFor(threadId: string): Promise<string> {
    const store = await this.store();
    const thread = await store.readThreadRecord(threadId);
    if (!thread) throw new CliError("THREAD_NOT_FOUND", `No thread ${threadId}.`, { exitCode: 2 });
    return thread.env.path;
  }

  private async forgeFor(threadId: string, config: ForgeConfig | undefined): Promise<ForgeDetection> {
    return await detectForge(await this.workspaceFor(threadId), config);
  }

  /** Detection plus the checkout, for the three write commands. */
  private async forgeContext(threadId: string): Promise<{ cwd: string; detection: ForgeDetection }> {
    const config = await this.loadConfig();
    const cwd = await this.workspaceFor(threadId);
    return { cwd, detection: await detectForge(cwd, config.forge) };
  }

  private async settingsSnapshot(): Promise<SettingsSnapshot> {
    const { config, path, exists } = await this.readConfigFile();
    return { path, exists, settings: describeSettings(config) };
  }

  private async store(): Promise<ThreadStore> {
    if (!this.storePromise) this.storePromise = openThreadStore(this.storeRoot);
    return await this.storePromise;
  }

  private schedulingStarted = false;
  private mcpHttp: McpHttpServer | null = null;
  private readonly dueRunning = new Set<string>();
  private readonly onDue = (threadId: string): void => void this.runDue(threadId);

  /**
   * Become the process that runs scheduled turns: due timers call back here,
   * and every pending schedule on disk gets a timer. Only a process that
   * stays up does this — the shared server, or a client watching the shell —
   * never a one-shot CLI command.
   */
  startScheduling(): void {
    if (this.schedulingStarted || this.closed) return;
    this.schedulingStarted = true;
    onScheduledTurnDue(this.onDue);
    void this.context()
      .then((ctx) => armPendingScheduledTurns(ctx))
      .catch(() => undefined);
    // The same long-lived owner serves the moxen tools over loopback HTTP
    // for providers that cannot host them in-process.
    if (this.builtinMcpServers !== null) {
      void startMcpHttpServer(this)
        .then((server) => {
          if (this.closed) void server.close();
          else this.mcpHttp = server;
        })
        .catch(() => undefined);
    }
  }

  private async runDue(threadId: string): Promise<void> {
    if (this.closed || this.dueRunning.has(threadId)) return;
    this.dueRunning.add(threadId);
    try {
      await runDueScheduledTurn(await this.context(), threadId);
    } catch {
      // The turn stays queued; the next poll or timer tries again.
    } finally {
      this.dueRunning.delete(threadId);
    }
  }

  private driverFor(instanceId: string): TurnDriver {
    // `driverFor` is synchronous and config reads are not, so it uses the
    // copy the last operation loaded. Every path that reaches a driver
    // goes through `context()` first, so this is never staler than the
    // operation asking for it.
    const driver = driverForInstance(this.driversOwner, instanceId, this.factories, this.lastProviders);
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
    this.startScheduling();
    const poll = async (): Promise<void> => {
      if (stopped || this.closed) return;
      try {
        const store = await this.store();
        const [projects, threads] = await Promise.all([
          listStoredProjects(this.storeRoot),
          listThreads(store, { status: "all" }),
        ]);
        const now = Date.now();
        // Who delegated whom: the sidebar nests a task under its parent.
        const parents = new Map((await store.readDelegations().catch(() => [])).map((row) => [row.childThreadId, row.parentThreadId] as const));
        const rows = await Promise.all(
          threads.map(async (entry) => {
            const turns = await store.readTurns(entry.id);
            // This poll already reads every thread's turns: a scheduled turn
            // that came due — even one another process scheduled — starts here.
            if (turns.some((turn) => turn.status === "queued" && typeof turn.scheduledFor === "string" && Date.parse(turn.scheduledFor) <= now)) {
              void this.runDue(entry.id);
            }
            return toThreadEnvelope(entry, turns, { parentThreadId: parents.get(entry.id) });
          }),
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
    // When each streamed message first appeared: its place in the
    // timeline, between the tool calls around it.
    const firstSeen = new Map<string, string>();
    // The stored turn now running. Driver events carry the *driver's* turn
    // id, which no stored row shares; streamed text must group with the turn
    // the transcript shows.
    let runningTurnId: string | null = null;
    const poll = async (): Promise<void> => {
      if (stopped || this.closed) return;
      try {
        const detail = await this.threadDetail(threadId);
        if (!detail) return;
        const latest = detail.latestTurn;
        runningTurnId = latest && latest.state === "running" ? latest.turnId : null;
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
      if (event.type === "message.part.updated") {
        // Each event is a delta of one assistant message. It streams under
        // the id the message is stored with if it turns out to be a note
        // (`noteMessageId`), so the stored row replaces the stream in place.
        const turnId = runningTurnId ?? event.turnId;
        if (!turnId || event.text.length === 0) return;
        const id = noteMessageId(turnId, event.messageId ?? "message");
        const now = new Date().toISOString();
        const createdAt = firstSeen.get(id) ?? now;
        firstSeen.set(id, createdAt);
        onItem({
          kind: "event",
          event: {
            type: "thread.message-sent",
            payload: {
              message: { id, role: "assistant", text: event.text, turnId, streaming: true, createdAt, updatedAt: now },
            },
          },
        });
        return;
      }
      if (event.type === "reasoning.delta" && event.text.length > 0) {
        // Same `toolCallId` as the runner's reasoning rows, so the client
        // shows the text in the row it already has for this thought.
        onItem({
          kind: "event",
          event: {
            type: "thread.reasoning-delta",
            payload: { toolCallId: `reasoning:${event.reasoningId}`, turnId: runningTurnId ?? event.turnId, text: event.text },
          },
        });
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
      checkpoints: await this.withCheckpointFiles(read.thread.env.path, read.checkpoints),
    });
  }

  /**
   * Checkpoints written before turns recorded their changed files get them
   * from git here — once per ref pair, since a capture never changes — so
   * older turns still show their diff row. A ref already pruned reads as
   * no files.
   */
  private async withCheckpointFiles(cwd: string | null | undefined, checkpoints: StoredCheckpoint[]): Promise<StoredCheckpoint[]> {
    if (!cwd) return checkpoints;
    return await Promise.all(
      checkpoints.map(async (checkpoint) => {
        const { ref, baseRef } = checkpoint;
        if (checkpoint.files !== undefined || checkpoint.status !== "available" || !ref || !baseRef) return checkpoint;
        const key = `${baseRef}..${ref}`;
        let files = this.checkpointFiles.get(key);
        if (files === undefined) {
          files = await diffCheckpointStat(cwd, baseRef, ref);
          this.checkpointFiles.set(key, files);
        }
        return { ...checkpoint, files };
      }),
    );
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
      case "thread.background.stop": {
        const driver = await this.sessionDriver(command.threadId);
        if (!driver?.stopBackgroundTask) {
          throw new CliError(
            "REQUEST_NOT_OWNED",
            `Thread ${command.threadId} has no live session here to stop background work in. Its session runs in another process; start a shared server (moxen server start) so every client can reach it.`,
            { exitCode: 4, details: { threadId: command.threadId } },
          );
        }
        await Effect.runPromise(driver.stopBackgroundTask(command.threadId, command.taskId));
        return { stopped: true as const, taskId: command.taskId };
      }
      case "project.ensure": {
        const { type: _type, commandId: _id, ...request } = command;
        return await ensureProject(await this.context(), request);
      }
      case "model.visibility.set":
        return { hidden: await setModelHidden(this.storeRoot, command.instanceId, command.model, command.hidden) };
      case "forge.request.create": {
        const { cwd, detection } = await this.forgeContext(command.threadId);
        const created = await createRequest(cwd, detection, {
          title: command.title,
          ...(command.body !== undefined ? { body: command.body } : {}),
          ...(command.targetBranch !== undefined ? { targetBranch: command.targetBranch } : {}),
          ...(command.sourceBranch !== undefined ? { sourceBranch: command.sourceBranch } : {}),
          ...(command.draft !== undefined ? { draft: command.draft } : {}),
        });
        return { ...created, accepted: true };
      }
      case "forge.request.comment": {
        const { cwd, detection } = await this.forgeContext(command.threadId);
        await commentOnRequest(cwd, detection, command.number, command.body);
        return accepted;
      }
      case "forge.request.merge": {
        const { cwd, detection } = await this.forgeContext(command.threadId);
        await mergeRequest(cwd, detection, command.number, {
          ...(command.strategy !== undefined ? { strategy: command.strategy } : {}),
          ...(command.deleteBranch !== undefined ? { deleteBranch: command.deleteBranch } : {}),
        });
        return accepted;
      }
      case "thread.continue":
        return await this.continueThread(command);
      case "thread.side-question":
        return await this.sideQuestion(command);
      case "settings.set": {
        // Re-read rather than reusing a cached copy: another client may
        // have written since, and a settings page that silently reverts a
        // neighbour's edit is worse than one that is a beat behind.
        const { config, path } = await this.readConfigFile();
        await saveConfig(path, setConfigValue(config, command.key, command.value));
        return { ...(await this.settingsSnapshot()), accepted: true };
      }
      case "thread.conversation.revert":
        return {
          ...(await revertThread(await this.context(), command.threadId, command.turnCount, {
            ...(command.restoreFiles === true ? { restoreFiles: true } : {}),
          })),
          accepted: true,
        };
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

  /**
   * `/btw`. The thread's own provider answers, on a copy of its session so
   * the thread never sees the question. Providers that cannot copy a
   * session into a tool-less one-shot say so rather than falling back to
   * something that would touch the thread.
   */
  private async sideQuestion(command: CommandOf<"thread.side-question">): Promise<CommandResult<"thread.side-question">> {
    const { store } = await this.context();
    const thread = await store.readThreadRecord(command.threadId);
    if (!thread) throw new CliError("THREAD_NOT_FOUND", `No thread ${command.threadId}.`, { exitCode: 2 });
    const selection = thread.modelSelection;
    const provider = driverKey(selection.instanceId);
    const driver = this.driverFor(selection.instanceId);
    if (!driver.sideQuestion) {
      throw new CliError(
        "SIDE_QUESTION_UNSUPPORTED",
        `/btw needs a provider that can copy a session into a tool-less one-shot; ${provider} cannot. Ask in the thread instead.`,
        { exitCode: 2, details: { provider } },
      );
    }
    // The live session's handle if this process holds one, else the one
    // the thread last recorded — either way a copy, never the session itself.
    const cursor = driver.resumeCursor?.(thread.id) ?? thread.providerSessions?.[provider] ?? null;
    const answer = await driver.sideQuestion({
      cursor,
      workingDirectory: thread.env.path,
      question: command.question.trim(),
      model: selection.model,
    });
    return { ...answer, provider };
  }

  /**
   * A new thread that carries on from `threadId`: same project, model,
   * modes and checkout — the work so far is on that disk — opened with a
   * handoff document built from the old thread's ledger. The old thread is
   * left as it is, with a note pointing at its continuation.
   */
  private async continueThread(command: CommandOf<"thread.continue">): Promise<CommandResult<"thread.continue">> {
    const { store } = await this.context();
    const source = await store.readThreadRecord(command.threadId);
    if (!source) throw new CliError("THREAD_NOT_FOUND", `No thread ${command.threadId}.`, { exitCode: 2 });
    const project = (await listStoredProjects(this.storeRoot)).find((candidate) => candidate.id === source.projectId);
    const handoff = await buildHandoff(store, source.id, { projectTitle: project?.title ?? null });
    const title = continuedTitle(source.title);
    const created = await createThread(store, {
      projectId: source.projectId,
      title,
      modelSelection: source.modelSelection,
      runtimeMode: source.runtimeMode,
      interactionMode: source.interactionMode,
      env: source.env,
    });
    await this.turnStart({
      type: "thread.turn.start",
      threadId: created.id,
      message: { text: handoff },
      ...(command.scheduledFor !== undefined ? { scheduledFor: command.scheduledFor, scheduleReason: "user" as const } : {}),
    });
    await store.appendLedger(source.id, "activity", {
      id: store.newId(),
      threadId: source.id,
      turnId: null,
      kind: "thread.continued",
      summary: `Continued in "${title}"`,
      payload: { threadId: created.id, title, scheduledFor: command.scheduledFor ?? null },
      createdAt: store.nowIso(),
    });
    store.emit(source.id, "thread-continued");
    return { threadId: created.id, title, scheduledFor: command.scheduledFor ?? null, accepted: true };
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
      ...(command.scheduledFor !== undefined ? { scheduledFor: command.scheduledFor } : {}),
      ...(command.scheduleReason !== undefined ? { scheduleReason: command.scheduleReason } : {}),
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
  /** The driver holding this thread's live session in this process, or null. */
  private async sessionDriver(threadId: string): Promise<TurnDriver | null> {
    const store = await this.store();
    const thread = await inspectThread(store, threadId);
    const turns = await store.readTurns(threadId);
    const latest = [...turns].reverse().find((turn) => turn.modelSelection)?.modelSelection ?? thread.modelSelection;
    const driver = this.driverFor(latest.instanceId);
    return (await Effect.runPromise(driver.hasSession(threadId)).catch(() => false)) ? driver : null;
  }

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
        return { providers: withLiveUsage(await this.providers()) };
      case "doctor":
        return await diagnose(this.storeRoot);
      case "thread.background.list": {
        const driver = await this.sessionDriver(query.threadId);
        return driver ? { live: true, tasks: driver.backgroundTasks?.(query.threadId) ?? [] } : { live: false, tasks: [] };
      }
      case "thread.context": {
        const driver = await this.sessionDriver(query.threadId);
        if (!driver) return { live: false, breakdown: null };
        const breakdown = driver.contextBreakdown ? await driver.contextBreakdown(query.threadId).catch(() => null) : null;
        if (breakdown) return { live: true, breakdown };
        // Totals only (Codex, Grok): the reading without categories.
        const usage = driver.contextUsage ? await driver.contextUsage(query.threadId).catch(() => null) : null;
        return { live: true, breakdown: usage ? { ...usage, categories: [], estimated: false } : null };
      }
      case "usage.limits":
        return { providers: usageLimitsSnapshot() };
      case "settings.read":
        return await this.settingsSnapshot();
      case "git.overview": {
        const cwd = await this.workspaceFor(query.threadId);
        return await readOverview(cwd, {
          ...(query.branch !== undefined ? { branch: query.branch } : {}),
          limit: query.limit ?? ctx.config.git?.historyLimit ?? 50,
          ...(ctx.config.git?.autoFetch === true ? { autoFetch: true } : {}),
        });
      }
      case "git.commit.diff": {
        const cwd = await this.workspaceFor(query.threadId);
        return { sha: query.sha, diff: await readCommitDiff(cwd, query.sha) };
      }
      case "forge.detect":
        return await this.forgeFor(query.threadId, ctx.config.forge);
      case "forge.requests.list": {
        const cwd = await this.workspaceFor(query.threadId);
        const detection = await this.forgeFor(query.threadId, ctx.config.forge);
        // No forge is an ordinary state for a checkout, not a failure:
        // the panel shows why, rather than an error toast.
        if (detection.kind === null) return { requests: [] };
        return {
          requests: await listRequests(cwd, detection, {
            ...(query.state !== undefined ? { state: query.state } : {}),
            ...(query.limit !== undefined ? { limit: query.limit } : {}),
          }),
        };
      }
      case "forge.request.view": {
        const cwd = await this.workspaceFor(query.threadId);
        const detection = await this.forgeFor(query.threadId, ctx.config.forge);
        if (detection.kind === null) return { request: null };
        return { request: await viewRequest(cwd, detection, query.number) };
      }
      case "thread.background.output": {
        const driver = await this.sessionDriver(query.threadId);
        const output = driver?.backgroundTaskOutput ? await driver.backgroundTaskOutput(query.threadId, query.taskId).catch(() => null) : null;
        return output ? { available: true, lines: output.lines } : { available: false, lines: [] };
      }
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
    if (this.schedulingStarted) onScheduledTurnDue(null);
    await this.mcpHttp?.close().catch(() => undefined);
    this.mcpHttp = null;
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

/**
 * The catalog with each provider's recorded plan usage filled in where the
 * catalog itself has none (the direct catalog never does: usage arrives
 * live from sessions).
 */
function withLiveUsage(providers: readonly ProviderSummary[]): ProviderSummary[] {
  const live = usageLimitsSnapshot();
  return providers.map((provider) =>
    provider.usageLimits === null && live[provider.driver] !== undefined ? { ...provider, usageLimits: live[provider.driver]! } : provider,
  );
}
