/**
 * OpenCode driver: `ProviderAdapter` over `opencode serve` + the generated
 * v2 client (serve-first; see the providers table in ARCHITECTURE.md).
 *
 * One server per working directory (shared across that cwd's threads),
 * one native session per thread, one SSE `event.subscribe` pump per
 * server demuxed by `sessionID`. The transport translates v2's events into
 * the vocabulary read here (`translate.ts`). Turns run through
 * `session.prompt` and settle on `session.idle` / `session.error` (v2's
 * `session.execution.*`, once no steered input is still queued); permission
 * and question requests park until `respondToRequest` / `respondToUserInput`
 * resolve them (`permission.reply` once/always/reject, a question form is
 * replied to or cancelled). v2 prompts carry only text and files, so the
 * model, agent (plan mode) and runtime instructions are session state,
 * applied before a prompt only when they changed. Rollback forks the native
 * session; compaction is native (`session.compact`). Token usage is read
 * best-effort off the latest assistant message at turn end, so mid-turn
 * usage stays silent (the §13 "per-message only" row).
 * Auth is never ours: the CLI's own login.
 */
import { randomUUID } from "node:crypto";

import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { CliError } from "../../errors.js";
import { plainSkill, type SkillInventory, type SkillSummary } from "../../catalog/summary.js";
import type { InteractionMode, ModelSelection, ProviderOptionSelection, RuntimeMode } from "../../types.js";
import type {
  ApprovalRequestId,
  ContextBreakdown,
  ContextWindowUsage,
  ProviderAdapter,
  ProviderAdapterCapabilities,
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderThreadSnapshot,
  ProviderTurnStartResult,
  ProviderUserInputAnswers,
  SubagentHistoryItem,
  ThreadId,
  TokenUsageDelta,
  TurnId,
} from "../spi.js";
import { outOfProcessWithChecklist, type McpServerSpec } from "../../mcp.js";
import { opencodeContextBreakdown } from "./context.js";
import {
  isOpencodeAuthErrorText,
  normalizeOpencodeSettings,
  opencodeSignedOutMessage,
  type OpencodeSettings,
} from "./config.js";
import { isFreeOpencodeModel, providerEnvNames, readStoredAuthTypes, storedAuthTypeFor } from "./catalog.js";
import {
  newOpencodeMessageId,
  SpawnOpencodeTransport,
  type OpencodeContextSettings,
  type OpencodeMcpConfig,
  type OpencodeModelInfo,
  type OpencodeModelRef,
  type OpencodeServerConnection,
  type OpencodeSessionState,
  type OpencodeSubscribedEvent,
  type OpencodeTransport,
} from "./transport.js";
import type { OpencodeMessage } from "./translate.js";

export interface OpenCodeDriverOptions {
  readonly settings?: Partial<OpencodeSettings>;
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: OpencodeTransport;
  /** Silence budget per turn before it fails loudly (default 10 minutes, mirroring the Grok watchdog). */
  readonly stallTimeoutMs?: number;
  /** How long an interrupt waits for the server to confirm before settling the turn itself (default 3 s). */
  readonly interruptAckTimeoutMs?: number;
}

/** Default `stallTimeoutMs`: a turn with zero provider events for this long is failed, never left running. */
export const OPENCODE_STALL_TIMEOUT_MS = 10 * 60 * 1000;

export type OpenCodeTurnStatus = "completed" | "failed" | "interrupted";

export interface OpenCodeTurnOutcome {
  readonly status: OpenCodeTurnStatus;
  readonly text: string;
  readonly usage: TokenUsageDelta;
  readonly error: string | null;
}

interface OpenCodeTurn {
  readonly id: TurnId;
  readonly prompt: string;
  status: "running" | OpenCodeTurnStatus;
  text: string;
  error: string | null;
  /**
   * Id of the user message this turn sent. Parts of it stream back on the
   * same `message.part.updated` channel as the answer, so the accumulator
   * skips them — otherwise the prompt is echoed into the reply text.
   * Assigned before the send so no part can arrive unattributed.
   */
  readonly userMessageId: string;
  /** User messages steered into this turn: skipped like the prompt's own. */
  readonly steerMessageIds: Set<string>;
  /** Text parts by part id, in arrival order, with the message each belongs to. */
  partTexts: Map<string, { messageId: string | null; text: string }>;
  /** The assistant message (one per model step) that last streamed text. */
  lastTextMessageId: string | null;
  /** Setup step to append if the server rejects this turn (see `missingCredentialHint`). */
  credentialHint: string | null;
  usage: TokenUsageDelta;
  /** When the server last said anything about this turn; the stall watchdog measures silence from here. */
  lastActivityAt: number;
  /** Set once an interrupt is on its way: the server's idle then acknowledges it rather than completes the turn. */
  interrupting: boolean;
  /** The server has confirmed the interrupt (recorded even when it beats the HTTP reply, before anyone waits). */
  interruptAcked: boolean;
  interruptAck: (() => void) | null;
}

type ParkedKind = "permission" | "question";

interface ParkedOpenCode {
  readonly threadId: ThreadId;
  readonly kind: ParkedKind;
  /** Native `permission.asked` / `question.asked` id (doubles as requestId). */
  readonly nativeId: string;
  readonly detail: string;
}

interface OpenCodeSession {
  readonly threadId: ThreadId;
  nativeSessionId: string;
  readonly workingDirectory: string;
  closed: boolean;
  /** Catalog instance id (`opencode` or `opencode/<provider>`); supplies the provider for bare model slugs. */
  instanceId: string;
  /** Raw model slug; parsed per send so instance-id context applies. */
  modelSlug: string | null;
  /** The thread's model options (reasoning effort); read as a v2 variant when the model has one. */
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  /** Runtime instructions, kept as the session's `moxen` instruction entry (v2 prompts carry no `system`). */
  instructions: string | null;
  /** moxen's MCP servers, re-registered on a replacement server (see `dropConnection`). */
  mcpServers: readonly McpServerSpec[];
  /** What the native session is already set to; a prompt only changes what differs. */
  applied: AppliedSessionState;
  turns: Map<TurnId, OpenCodeTurn>;
  waiters: Map<TurnId, Array<{ resolve: (outcome: OpenCodeTurnOutcome) => void; reject: (cause: unknown) => void }>>;
  parked: Map<string, ParkedOpenCode>;
  /** Latest context-window reading, taken when a turn goes idle. */
  context: ContextWindowUsage | null;
  startedAt: string;
}

/** The native session's model, agent and `moxen` instruction entry, as last known. `undefined` = not known. */
interface AppliedSessionState {
  model: OpencodeModelRef | undefined;
  agent: string | undefined;
  instructions: string | null | undefined;
}

/** A child session OpenCode's `subagent` tool started for a thread's session. */
interface OpenCodeChild {
  readonly parent: OpenCodeSession;
  readonly agentType: string;
  readonly description: string | null;
  readonly background: boolean;
  stopped: boolean;
}

/** A `subagent` call's result without its `<subagent …>` wrapper: the child's report. */
function subagentReport(output: string | null): string | null {
  if (!output) return null;
  const report = output.replace(/^\s*<subagent\b[^>]*>/u, "").replace(/<\/subagent>\s*$/u, "").trim();
  return report.length > 0 ? report : null;
}

/** The text of the newest assistant message that said anything. */
function lastAssistantText(messages: ReadonlyArray<OpencodeMessage>): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.info.role !== "assistant") continue;
    const text = message.parts
      .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
      .join("")
      .trim();
    if (text.length > 0) return text;
  }
  return null;
}

function isoAt(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

/** A child session's timeline as subagent history: its prompt, thoughts, tool calls and words. */
function subagentHistoryItems(messages: ReadonlyArray<OpencodeMessage>): SubagentHistoryItem[] {
  const items: SubagentHistoryItem[] = [];
  for (const message of messages) {
    const at = isoAt(asRecord(message.info.time)?.created);
    const user = message.info.role === "user";
    for (const part of message.parts) {
      const id = asString(part.id) ?? `${asString(message.info.id) ?? "message"}:${items.length}`;
      if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string" && part.text.trim()) {
        items.push({ kind: user ? "prompt" : part.type === "reasoning" ? "reasoning" : "text", id, at, text: part.text });
      } else if (part.type === "tool" && !user) {
        const started = isoAt(asRecord(asRecord(part.state)?.time)?.start);
        items.push({ kind: "tool", id, at: started ?? at, tool: asString(part.tool) ?? "tool", raw: part });
      }
    }
  }
  return items;
}

/** The instruction entry key runtime instructions live under. */
const INSTRUCTIONS_KEY = "moxen";

/**
 * The turn's answer: the text of its last assistant message. OpenCode opens
 * one assistant message per model step, so a turn that calls tools leaves
 * interim notes in the earlier steps; joining every step's text put that
 * working narration into the final output.
 */
function answerText(parts: ReadonlyMap<string, { messageId: string | null; text: string }>): string {
  const all = [...parts.values()];
  const last = all.findLast((part) => part.text.length > 0);
  if (!last) return "";
  return all.filter((part) => part.messageId === last.messageId).map((part) => part.text).join("");
}

/**
 * OpenCode v2's auto-compaction trigger for a model: the usable window (the
 * input limit when the model has one, else the context limit) less a buffer —
 * `compaction.buffer` when configured, else 10% of the window, never under
 * 16k on windows of 32k and up. 200k → 180k, 128k → 112k, 20k → 18k. Null
 * when there is no usable window (v2 never auto-compacts then).
 */
export function opencodeCompactionThreshold(
  limit: { readonly context: number; readonly input?: number },
  buffer: number | null,
): number | null {
  const usable = limit.input || limit.context;
  if (!(usable > 0)) return null;
  const reserved = buffer !== null ? buffer : Math.max(Math.floor(usable * 0.1), usable >= 32_000 ? 16_000 : 0);
  return Math.max(0, usable - reserved);
}

/**
 * The context window after a turn, the way OpenCode v2 itself counts it: the
 * latest assistant message's `input + cache.read + cache.write + output +
 * reasoning`, against the model's `limit.context`, with the auto-compact
 * threshold from `opencodeCompactionThreshold`.
 */
export function opencodeContextOf(
  messages: ReadonlyArray<{ info: Record<string, unknown> }>,
  settings: OpencodeContextSettings | null,
): ContextWindowUsage | null {
  const info = [...messages].reverse().find((message) => message.info.role === "assistant" && asRecord(message.info.tokens))?.info;
  const tokens = asRecord(info?.tokens);
  if (!info || !tokens) return null;
  const cache = asRecord(tokens.cache);
  const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const cacheRead = number(cache?.read);
  const used = number(tokens.input) + cacheRead + number(cache?.write) + number(tokens.output) + number(tokens.reasoning);
  if (used <= 0) return null;
  const providerId = asString(info.providerID);
  const modelId = asString(info.modelID);
  const limit = providerId && modelId ? settings?.limits.get(`${providerId}/${modelId}`) : undefined;
  return {
    usedTokens: used,
    maxTokens: limit && limit.context > 0 ? limit.context : null,
    cachedInputTokens: cacheRead,
    autoCompactThreshold: limit ? opencodeCompactionThreshold(limit, settings?.buffer ?? null) : null,
    compactsAutomatically: settings ? settings.autoCompact : null,
  };
}

/** Whether the session's latest user message has a finished assistant reply. */
function lastUserAnswered(messages: ReadonlyArray<{ info: Record<string, unknown> }>): boolean {
  const lastUser = [...messages].reverse().find((message) => message.info.role === "user");
  const userId = lastUser ? asString(lastUser.info.id) : null;
  if (!userId) return true;
  // The timeline's own `idle` marker after the prompt: answered, even when the run left no reply.
  if (lastUser?.info.settled === true) return true;
  return messages.some((message) =>
    message.info.role === "assistant" &&
    message.info.parentID === userId &&
    asRecord(message.info.time)?.completed !== undefined,
  );
}

function emptyUsage(): TokenUsageDelta {
  return { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0 };
}

function toCliError(code: string, message: string, cause: unknown, cwd?: string): CliError {
  // Auth patterns win even over SDK wrappers carrying the message.
  const text = cause instanceof Error ? cause.message : String(cause);
  if (isOpencodeAuthErrorText(text)) {
    return new CliError("OPENCODE_AUTH_REQUIRED", opencodeSignedOutMessage({ cwd: cwd ?? process.cwd() }), {
      cause,
    });
  }
  if (cause instanceof CliError) return cause;
  return new CliError(code, `${message}: ${text.slice(0, 200)}`, { cause });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Resolve the native `providerID/modelID` address. `modelSelection.model`
 * is either already `providerID/modelID` or a bare models.dev id, in
 * which case the `opencode/<providerId>` instance id supplies the
 * provider. Anything else means "server default".
 */
export function parseOpencodeModel(
  modelSelection?: ModelSelection,
  instanceId?: string,
): { providerID: string; modelID: string } | null {
  const raw = modelSelection?.model?.trim() ?? "";
  if (raw.length === 0) return null;
  const slash = raw.indexOf("/");
  if (slash > 0 && slash < raw.length - 1) return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) };
  const instance = (instanceId ?? modelSelection?.instanceId ?? "").trim().toLowerCase();
  const match = instance.match(/^opencode\/(.+)$/);
  if (match?.[1]) return { providerID: match[1], modelID: raw };
  return null;
}

/** Timeline items read when a turn goes idle (see `onSessionIdle`). */
const IDLE_READ_ITEMS = 60;

/** Option ids a thread's reasoning effort may be stored under. */
const EFFORT_OPTION_IDS: ReadonlySet<string> = new Set(["reasoningEffort", "effort", "reasoning", "variant"]);

/**
 * The v2 variant for a thread's reasoning effort: the option's value, when
 * this model lists a variant with that id (a variant the model lacks is a
 * model-resolution error on the server, so it is never sent).
 */
function variantFor(
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
  model: OpencodeModelInfo,
): string | null {
  const value = options?.find((option) => EFFORT_OPTION_IDS.has(option.id) && typeof option.value === "string")?.value;
  return typeof value === "string" && model.variants.includes(value) ? value : null;
}

/** Same model and variant; "no variant" and the server's `default` are one. */
function sameModel(applied: OpencodeModelRef | undefined, target: OpencodeModelRef): boolean {
  return (
    applied !== undefined &&
    applied.providerID === target.providerID &&
    applied.modelID === target.modelID &&
    (applied.variant ?? "default") === (target.variant ?? "default")
  );
}

export class OpenCodeDriver implements ProviderAdapter<CliError> {
  readonly provider = "opencode" as const;
  readonly capabilities: ProviderAdapterCapabilities = {
    sessionModelSwitch: "in-session",
    supportsConversationRollback: true,
  };
  readonly compaction = {
    start: (threadId: ThreadId, modelSelection?: ModelSelection): Effect.Effect<void, CliError> =>
      this.attempt("OPENCODE_COMPACT_FAILED", `Could not compact the session for thread ${threadId}`, async () => {
        const session = this.requireSession(threadId);
        const connection = await this.connectionFor(session);
        if (modelSelection) {
          // v2's compact runs on the session's own model, so switch first —
          // through the applied-state cache, which a direct switch would leave stale.
          session.instanceId = modelSelection.instanceId;
          session.modelSlug = modelSelection.model;
          session.modelOptions = modelSelection.options;
          const wanted = parseOpencodeModel(modelSelection, session.instanceId);
          await this.applySessionState(session, connection, wanted, undefined, null);
        }
        await connection.summarizeSession(session.nativeSessionId);
      }),
    type: "native" as const,
  };

  private readonly settings: OpencodeSettings;
  private readonly baseEnv: NodeJS.ProcessEnv;
  /**
   * Child sessions OpenCode's `subagent` tool started, by session id. Kept
   * after they stop so the call's later updates (which still name the
   * child) do not start it again.
   */
  private readonly children = new Map<string, OpenCodeChild>();
  private readonly transport: OpencodeTransport;
  private readonly stallTimeoutMs: number;
  private readonly interruptAckTimeoutMs: number;
  private readonly stallTimers = new Map<TurnId, ReturnType<typeof setTimeout>>();
  private readonly sessions = new Map<ThreadId, OpenCodeSession>();
  private readonly connections = new Map<string, Promise<OpencodeServerConnection>>();
  /** The connection behind each `connections` entry once it resolved, for identity checks. */
  private readonly liveConnections = new Map<string, OpencodeServerConnection>();
  /** `name:config` already registered per server connection (see `registerMcpServers`). */
  private readonly mcpRegistered = new WeakMap<OpencodeServerConnection, Set<string>>();
  private readonly pumps = new Map<string, { controller: AbortController; ready: Promise<void>; done: Promise<void> }>();
  private readonly queue = Effect.runSync(Queue.unbounded<ProviderRuntimeEvent>());

  constructor(options: OpenCodeDriverOptions = {}) {
    this.settings = normalizeOpencodeSettings(options.settings);
    this.baseEnv = options.env ?? process.env;
    this.transport = options.transport ?? new SpawnOpencodeTransport();
    this.stallTimeoutMs = options.stallTimeoutMs ?? OPENCODE_STALL_TIMEOUT_MS;
    this.interruptAckTimeoutMs = options.interruptAckTimeoutMs ?? 3000;
  }

  get streamEvents(): Stream.Stream<ProviderRuntimeEvent> {
    return Stream.fromQueue(this.queue);
  }

  private publish(event: ProviderRuntimeEvent): void {
    Effect.runSync(Queue.offer(this.queue, event));
  }

  private attempt<T>(code: string, message: string, run: () => Promise<T>): Effect.Effect<T, CliError> {
    return Effect.tryPromise({
      try: run,
      catch: (cause) => toCliError(code, message, cause),
    });
  }

  private requireSession(threadId: ThreadId): OpenCodeSession {
    const session = this.sessions.get(threadId);
    if (!session || session.closed) {
      throw new CliError("OPENCODE_NOT_STARTED", `No OpenCode session exists for thread ${threadId}.`, {
        details: { threadId },
      });
    }
    return session;
  }

  private openTurn(session: OpenCodeSession): OpenCodeTurn | null {
    for (const turn of session.turns.values()) {
      if (turn.status === "running") return turn;
    }
    return null;
  }

  private async connectionForSession(threadId: ThreadId, workingDirectory: string): Promise<OpencodeServerConnection> {
    const key = workingDirectory;
    const existing = this.connections.get(key);
    if (existing) {
      const connection = await existing;
      // A pump that died (dropped stream) is restarted before anything is sent:
      // v2 replays nothing, so an event stream that is not live loses answers.
      await this.ensurePump(key, connection);
      return connection;
    }
    const pending = this.transport.ensureServer({
      settings: this.settings,
      workingDirectory,
      env: this.baseEnv,
    });
    this.connections.set(key, pending);
    try {
      const connection = await pending;
      this.liveConnections.set(key, connection);
      // A spawned server that exits is forgotten, so the next call respawns it.
      void connection.closed.then(() => this.dropConnection(key, connection, "the server exited"));
      await this.ensurePump(key, connection);
      return connection;
    } catch (cause) {
      if (this.connections.get(key) === pending) this.connections.delete(key);
      throw cause;
    }
  }

  /**
   * MCP in OpenCode belongs to the directory's instance, not to a session,
   * so moxen's servers are added once per connection and again only when
   * their config changes — `mcp.add` restarts the server on every call.
   * Same rule as OpenCode's own ACP server (`acp/service.ts`,
   * `mcpRegistrationKey`), including that a failed add does not fail the
   * session: it is retried on the next start.
   */
  private async registerMcpServers(
    connection: OpencodeServerConnection,
    servers: readonly McpServerSpec[],
  ): Promise<void> {
    if (servers.length === 0) return;
    let done = this.mcpRegistered.get(connection);
    if (!done) {
      done = new Set();
      this.mcpRegistered.set(connection, done);
    }
    // v2 has no `todowrite`: moxen's server lends its checklist tool.
    for (const server of servers.map(outOfProcessWithChecklist)) {
      const config: OpencodeMcpConfig =
        server.type === "http"
          ? { type: "remote", url: server.url, ...(Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}) }
          : {
              type: "local",
              command: [server.command, ...server.args],
              ...(Object.keys(server.env).length > 0 ? { environment: server.env } : {}),
            };
      const key = `${server.name}:${JSON.stringify(config)}`;
      if (done.has(key)) continue;
      try {
        await connection.addMcpServer(server.name, config);
        done.add(key);
      } catch {
        // Retried on the next session start.
      }
    }
  }

  /**
   * Forget a server that is gone (its process exited, or its event stream
   * died) so the next call starts a fresh one instead of failing against the
   * dead one forever. Turns open on it fail; the connection's caches (MCP
   * registered, context settings, model list) are keyed by the connection and
   * go with it. A no-op when the key already holds a different connection.
   */
  private dropConnection(key: string, connection: OpencodeServerConnection, reason: string): void {
    if (this.liveConnections.get(key) !== connection) return;
    this.liveConnections.delete(key);
    this.connections.delete(key);
    const pump = this.pumps.get(key);
    this.pumps.delete(key);
    pump?.controller.abort();
    this.failServerTurns(key, `Lost the OpenCode server (${reason.slice(0, 200)}).`);
    void connection.dispose().catch(() => undefined);
  }

  private async connectionFor(session: OpenCodeSession): Promise<OpencodeServerConnection> {
    return await this.connectionForSession(session.threadId, session.workingDirectory);
  }

  /** Model limits + compaction config, fetched once per server connection. */
  private readonly contextSettings = new WeakMap<OpencodeServerConnection, Promise<OpencodeContextSettings>>();

  private async contextSettingsFor(session: OpenCodeSession): Promise<OpencodeContextSettings> {
    const connection = await this.connectionFor(session);
    let pending = this.contextSettings.get(connection);
    if (!pending) {
      pending = connection.contextSettings();
      // A failed fetch is retried on the next turn rather than cached.
      pending.catch(() => this.contextSettings.delete(connection));
      this.contextSettings.set(connection, pending);
    }
    return await pending;
  }

  /** `model.list`, fetched once per connection and again when a model is not in it (a provider connected since). */
  private readonly modelLists = new WeakMap<OpencodeServerConnection, Promise<ReadonlyArray<OpencodeModelInfo>>>();

  private async modelListFor(connection: OpencodeServerConnection, refresh: boolean): Promise<ReadonlyArray<OpencodeModelInfo>> {
    let pending = this.modelLists.get(connection);
    if (!pending || refresh) {
      pending = connection.listModels();
      pending.catch(() => this.modelLists.delete(connection));
      this.modelLists.set(connection, pending);
    }
    return await pending;
  }

  /**
   * The server does not validate `session.switchModel`: a bogus model is
   * accepted and only fails the next run. So the model is checked against
   * `model.list` here and the send fails clearly. A list that cannot be read
   * skips the check (the server then answers `Model unavailable`).
   */
  private async resolveModel(
    connection: OpencodeServerConnection,
    model: { providerID: string; modelID: string },
    options: ReadonlyArray<ProviderOptionSelection> | undefined,
    credentialHint: string | null,
  ): Promise<OpencodeModelRef> {
    const find = (list: ReadonlyArray<OpencodeModelInfo>) =>
      list.find((entry) => entry.providerID === model.providerID && entry.modelID === model.modelID);
    let info: OpencodeModelInfo | undefined;
    try {
      info = find(await this.modelListFor(connection, false));
      if (!info) info = find(await this.modelListFor(connection, true));
    } catch {
      return model;
    }
    if (!info) {
      throw new CliError(
        "OPENCODE_MODEL_UNAVAILABLE",
        `OpenCode has no model "${model.providerID}/${model.modelID}".${credentialHint ? ` ${credentialHint}` : " Check the model id, or connect its provider with `opencode auth login`."}`,
        { details: { providerID: model.providerID, modelID: model.modelID } },
      );
    }
    const variant = variantFor(options, info);
    return { ...model, ...(variant ? { variant } : {}) };
  }

  /**
   * Bring the native session to this send's model, agent and instructions.
   * v2 prompts carry none of them, so they are session state; each call is
   * made only when the state it sets differs from what is already applied.
   * Plan mode runs OpenCode's built-in read-only `plan` agent and leaving it
   * returns to `build`; a session on any other agent (the user's
   * `default_agent`) is left alone.
   */
  private async applySessionState(
    session: OpenCodeSession,
    connection: OpencodeServerConnection,
    wantedModel: { providerID: string; modelID: string } | null,
    interactionMode: InteractionMode | undefined,
    credentialHint: string | null,
  ): Promise<void> {
    if (interactionMode) session.interactionMode = interactionMode;
    const nativeId = session.nativeSessionId;
    const applied = session.applied;
    if (wantedModel) {
      const target = await this.resolveModel(connection, wantedModel, session.modelOptions, credentialHint);
      if (!sameModel(applied.model, target)) {
        await connection.switchModel(nativeId, target);
        applied.model = target;
      }
    }
    const planning = session.interactionMode === "plan";
    if (planning && applied.agent !== "plan") {
      await connection.switchAgent(nativeId, "plan");
      applied.agent = "plan";
    } else if (!planning && applied.agent === "plan") {
      await connection.switchAgent(nativeId, "build");
      applied.agent = "build";
    }
    if (applied.instructions !== session.instructions) {
      try {
        await connection.setInstructions(nativeId, INSTRUCTIONS_KEY, session.instructions);
      } catch (cause) {
        // Clearing an entry the session never had is not a failure.
        if (session.instructions !== null) throw cause;
      }
      applied.instructions = session.instructions;
    }
  }

  /**
   * Skills and slash commands from the directory's own server
   * (`command.list`, the SDK route upstream serves — never `opencode debug
   * skill`, whose piped output truncates at 64KB). Everything there runs as
   * `/name`; `source: "skill"` marks skills, the rest are commands.
   */
  readonly skillInventory = async (cwd: string): Promise<SkillInventory> => {
    const connection = await this.connectionForSession(`moxen-skills-${cwd}` as ThreadId, cwd);
    const entries = await connection.listCommands();
    return {
      trigger: "/",
      skills: entries.filter((entry) => entry.source === "skill").map((entry) => plainSkill(entry.name, entry.description)),
      commands: entries
        .filter((entry) => entry.source !== "skill")
        .map((entry) => ({
          name: entry.name,
          description: entry.description,
          argumentHint: entry.hints.length > 0 ? entry.hints.join(" ") : null,
          builtin: false,
        })),
    };
  };

  /** The reading taken when the last turn went idle. */
  readonly contextUsage = async (threadId: ThreadId): Promise<ContextWindowUsage | null> =>
    this.sessions.get(threadId)?.context ?? null;

  /** The reading above, broken down by estimate from the session's messages. */
  readonly contextBreakdown = async (threadId: ThreadId): Promise<ContextBreakdown | null> => {
    const session = this.sessions.get(threadId);
    if (!session?.context) return null;
    const connection = await this.connectionFor(session);
    // Only what the model still sees: nothing before the last compaction.
    const messages = await connection.sessionContext(session.nativeSessionId).catch(() => []);
    return opencodeContextBreakdown(session.context, messages);
  };

  // -- session lifecycle -------------------------------------------------

  readonly startSession = (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, CliError> =>
    this.attempt("OPENCODE_SPAWN_FAILED", `Could not start an OpenCode session for thread ${input.threadId}`, async () => {
      const existing = this.sessions.get(input.threadId);
      if (existing && !existing.closed) return this.describeSession(existing);
      const connection = await this.connectionForSession(input.threadId, input.workingDirectory);
      await this.registerMcpServers(connection, input.mcpServers ?? []);
      // OpenCode keeps sessions on disk, so the previous one — from this
      // process or an earlier one — is reattached with its history rather
      // than replaced by an empty session.
      const cursor = existing?.nativeSessionId ?? input.resumeCursor;
      const resumed = cursor ? await connection.getSession(cursor).catch(() => null) : null;
      const native: OpencodeSessionState =
        resumed ?? (await connection.createSession({}));
      const nativeSessionId = native.sessionID;
      const session: OpenCodeSession = {
        threadId: input.threadId,
        nativeSessionId,
        workingDirectory: input.workingDirectory,
        closed: false,
        instanceId: input.modelSelection?.instanceId ?? "opencode",
        modelSlug: input.modelSelection?.model ?? null,
        modelOptions: input.modelSelection?.options,
        runtimeMode: input.runtimeMode ?? "full-access",
        interactionMode: input.interactionMode ?? "default",
        instructions: input.instructions ?? null,
        mcpServers: input.mcpServers ?? [],
        // A session we just made has no instruction entry; a resumed one may
        // still hold the previous process's, which the first send reconciles.
        applied: { model: native.model, agent: native.agent, instructions: resumed ? undefined : null },
        turns: new Map(),
        waiters: new Map(),
        parked: new Map(),
        context: null,
        startedAt: new Date().toISOString(),
      };
      this.sessions.set(input.threadId, session);
      return this.describeSession(session);
    });

  readonly resumeCursor = (threadId: ThreadId): string | null =>
    this.sessions.get(threadId)?.nativeSessionId ?? null;

  readonly sessionTitle = async (cursor: string, workingDirectory: string): Promise<string | null> =>
    await (await this.connectionForSession(`title:${cursor}` as ThreadId, workingDirectory)).sessionTitle(cursor);

  readonly renameSession = async (cursor: string, workingDirectory: string, title: string): Promise<void> => {
    await (await this.connectionForSession(`title:${cursor}` as ThreadId, workingDirectory)).renameSession(cursor, title);
  };

  readonly regenerateSessionTitle = async (cursor: string, workingDirectory: string): Promise<string | null> =>
    await (await this.connectionForSession(`title:${cursor}` as ThreadId, workingDirectory)).regenerateSessionTitle(cursor);

  /** A whole copy of a native session, on the server for `workingDirectory` (where it lives). */
  readonly forkSession = async (cursor: string, workingDirectory: string): Promise<string> => {
    const connection = await this.connectionForSession(`fork:${cursor}` as ThreadId, workingDirectory);
    return (await connection.forkSession(cursor)).sessionID;
  };

  readonly sendTurn = (input: ProviderSendTurnInput): Effect.Effect<ProviderTurnStartResult, CliError> =>
    this.attempt("OPENCODE_TURN_FAILED", `Could not send a turn on thread ${input.threadId}`, async () => {
      const session = this.requireSession(input.threadId);
      if (this.openTurn(session)) {
        throw new CliError("TURN_BUSY", `Thread ${input.threadId} already has a running turn.`, {
          details: { threadId: input.threadId },
        });
      }
      if (input.modelSelection) {
        session.instanceId = input.modelSelection.instanceId;
        session.modelSlug = input.modelSelection.model;
        session.modelOptions = input.modelSelection.options;
      }
      const model = session.modelSlug
        ? parseOpencodeModel(
          { instanceId: session.instanceId, model: session.modelSlug },
          session.instanceId,
        )
        : null;
      const userMessageId = newOpencodeMessageId();
      const turn: OpenCodeTurn = {
        id: `turn-${randomUUID()}`,
        prompt: input.prompt,
        userMessageId,
        steerMessageIds: new Set(),
        status: "running",
        text: "",
        error: null,
        partTexts: new Map(),
        lastTextMessageId: null,
        credentialHint: null,
        usage: emptyUsage(),
        lastActivityAt: Date.now(),
        interrupting: false,
        interruptAcked: false,
        interruptAck: null,
      };
      session.turns.set(turn.id, turn);
      try {
        const connection = await this.connectionFor(session);
        // A replacement server (see `dropConnection`) has lost the runtime MCP registrations.
        await this.registerMcpServers(connection, session.mcpServers);
        turn.credentialHint = await this.missingCredentialHint(model, connection);
        await this.applySessionState(session, connection, model, input.interactionMode, turn.credentialHint);
        await connection.prompt({
          sessionID: session.nativeSessionId,
          messageID: userMessageId,
          text: input.prompt,
          files: (input.images ?? []).map((image) => ({
            uri: `data:${image.mimeType};base64,${image.data}`,
            name: image.name,
          })),
        });
      } catch (cause) {
        this.clearStallTimer(turn.id);
        session.turns.delete(turn.id);
        throw cause;
      }
      this.armStallTimer(session, turn);
      return { threadId: input.threadId, turnId: turn.id };
    });

  /**
   * Setup hint for a model whose provider looks uncredentialed here —
   * advisory only, never a gate.
   *
   * An earlier version blocked the send outright, on the theory that the
   * server accepts credential-less prompts and then goes silent. It does
   * not: it answers `session.error` within seconds ("Model not found:
   * <provider>/<model>" when the provider never loaded, or a 401 for a
   * rejected key). The silence that motivated the gate came from our own
   * vendored plugin modules, which no longer exist (v2 has the ChatGPT and
   * SuperGrok logins built in).
   *
   * Blocking on this guess is strictly worse than letting the server
   * answer, because the guess only models two of the credential
   * arrangements upstream honors — `env[]` names and stored logins — and
   * misses `opencode.json`'s `provider.<id>.options.apiKey`, OAuth stored
   * under another id, and anything a newer catalog adds.
   * Each miss blocks a model the server would have served: exactly the
   * `opencode/muse-spark-1.3-contributor-free` report this replaced.
   *
   * So we keep only the useful half — the actionable setup step — and
   * attach it to the server's own failure. Computed at send time, where
   * the model is known; null whenever the provider is unknown to the
   * pinned snapshot (the server decides those) or credentialed, and for
   * free `opencode` models, which upstream serves with `apiKey: "public"`
   * and no credential at all (see `isFreeOpencodeModel`).
   */
  private async missingCredentialHint(
    model: { providerID: string; modelID: string } | null,
    connection: OpencodeServerConnection,
  ): Promise<string | null> {
    if (!model) return null;
    if (await isFreeOpencodeModel(model.providerID, model.modelID)) return null;
    const envNames = await providerEnvNames(model.providerID);
    if (envNames === null) return null;
    // Renamed provider ids (`azure-cognitive-services` → `azure`, …) count as the same credential.
    const stored = await this.storedAuthTypes(connection);
    if (storedAuthTypeFor(stored, model.providerID) !== undefined) return null;
    if (envNames.some((name) => (this.baseEnv[name] ?? "").trim().length > 0)) return null;
    const how = envNames.length > 0
      ? `set ${envNames.join(" or ")}`
      : "add an API key";
    return `No credential found for provider "${model.providerID}" — ${how}, or run \`opencode auth login\`.`;
  }

  /**
   * Credential types as the server we already talk to knows them (connection
   * types only). Only when that cannot answer do we run the CLI, which is
   * async, `--standalone` and cached (see `readStoredAuthTypes`).
   */
  private async storedAuthTypes(connection: OpencodeServerConnection): Promise<Record<string, string>> {
    try {
      return await connection.storedAuthTypes();
    } catch {
      return await readStoredAuthTypes(this.baseEnv, { binaryPath: this.settings.binaryPath });
    }
  }

  /**
   * Cancel what this turn still has queued on the server: its own prompt and
   * any steer that was not yet delivered. An interrupt discards the turn, so
   * a leftover steer must not reach the model with the next turn. Delivered
   * items cannot be cancelled; those requests fail and are ignored.
   */
  private async cancelQueuedInput(session: OpenCodeSession, connection: OpencodeServerConnection, turn: OpenCodeTurn): Promise<void> {
    const ids = [turn.userMessageId, ...turn.steerMessageIds];
    await Promise.all(ids.map((id) => connection.cancelInbox(session.nativeSessionId, id).catch(() => undefined)));
  }

  readonly interruptTurn = (threadId: ThreadId, _turnId?: TurnId): Effect.Effect<void, CliError> =>
    this.attempt("OPENCODE_TURN_FAILED", `Could not interrupt the turn on thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      const turn = this.openTurn(session);
      if (turn) turn.interrupting = true;
      // Parked permission/question prompts hold the turn open server-side;
      // reject them first so abort settles instead of hanging.
      await this.rejectParked(session, "Interrupted.");
      try {
        const connection = await this.connectionFor(session);
        if (turn) await this.cancelQueuedInput(session, connection, turn);
        await connection.abortSession(session.nativeSessionId);
      } catch (cause) {
        if (!session.closed) throw cause;
      }
      // The server confirms an interrupt with its own event, which arrives
      // after this call returns. Settling before it would let a prompt sent
      // right away be completed by the old run's confirmation.
      // (It may already have: the event can beat the HTTP reply.)
      if (turn && turn.status === "running" && !turn.interruptAcked) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.interruptAckTimeoutMs);
          (timer as { unref?: () => void }).unref?.();
          turn.interruptAck = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      if (!turn || this.openTurn(session) === turn) this.settleOpenTurn(session, "interrupted", "Interrupted.");
    });

  async awaitTurn(threadId: ThreadId, turnId: TurnId, signal?: AbortSignal): Promise<OpenCodeTurnOutcome> {
    const session = this.requireSession(threadId);
    const turn = session.turns.get(turnId);
    if (!turn) {
      throw new CliError("TURN_NOT_FOUND", `No turn exists with id ${turnId}.`, {
        details: { threadId, turnId },
      });
    }
    if (turn.status !== "running") {
      return { status: turn.status, text: turn.text, usage: turn.usage, error: turn.error };
    }
    if (signal?.aborted === true) {
      throw new CliError("TURN_ABORTED", `Turn ${turnId} was aborted before settling.`, {
        details: { threadId, turnId },
      });
    }
    return await new Promise<OpenCodeTurnOutcome>((resolve, reject) => {
      const list = session.waiters.get(turnId) ?? [];
      list.push({ resolve, reject });
      session.waiters.set(turnId, list);
      signal?.addEventListener(
        "abort",
        () => {
          const pending = session.waiters.get(turnId) ?? [];
          session.waiters.delete(turnId);
          for (const waiter of pending) {
            waiter.reject(
              new CliError("TURN_ABORTED", `Turn ${turnId} was aborted before settling.`, {
                details: { threadId, turnId },
              }),
            );
          }
        },
        { once: true },
      );
    });
  }

  readonly respondToRequest = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ): Effect.Effect<void, CliError> =>
    this.attempt("OPENCODE_REQUEST_FAILED", `Could not answer permission request ${requestId}`, async () => {
      const session = this.requireSession(threadId);
      const parked = session.parked.get(requestId);
      if (!parked) {
        throw new CliError("REQUEST_UNKNOWN", `No pending permission request ${requestId}.`, {
          details: { threadId, requestId },
        });
      }
      // A *dismissed question* arrives here, not only a miscalled
      // permission: the panel closes a question the same way it declines a
      // permission, and the request is still blocking the server. Replying
      // with no answers releases the turn — throwing left it parked until
      // the next interrupt.
      if (parked.kind === "question") {
        if (decision.kind !== "decline" && decision.kind !== "cancel") {
          // Accepting is a miscall: there is no answer to accept.
          throw new CliError("REQUEST_MISMATCH", `Request ${requestId} needs user input, not a permission decision.`, {
            details: { threadId, requestId },
          });
        }
        const connection = await this.connectionFor(session);
        // Cancelling the form is how v2 says "no answer"; a reply with none is invalid.
        await connection.rejectQuestion(session.nativeSessionId, parked.nativeId);
        session.parked.delete(requestId);
        this.publish({ type: "user-input.request.resolved", provider: this.provider, threadId, requestId });
        return;
      }
      if (parked.kind !== "permission") {
        throw new CliError("REQUEST_MISMATCH", `Request ${requestId} needs user input, not a permission decision.`, {
          details: { threadId, requestId },
        });
      }
      const connection = await this.connectionFor(session);
      const reply = decision.kind === "accept"
        ? ("once" as const)
        : decision.kind === "acceptForSession"
          ? ("always" as const)
          : ("reject" as const);
      await connection.replyToPermission(session.nativeSessionId, parked.nativeId, reply);
      session.parked.delete(requestId);
      this.publish({ type: "permission.request.resolved", provider: this.provider, threadId, requestId });
    });

  readonly respondToUserInput = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ): Effect.Effect<void, CliError> =>
    this.attempt("OPENCODE_REQUEST_FAILED", `Could not answer user input request ${requestId}`, async () => {
      const session = this.requireSession(threadId);
      const parked = session.parked.get(requestId);
      if (!parked) {
        throw new CliError("REQUEST_UNKNOWN", `No pending user input request ${requestId}.`, {
          details: { threadId, requestId },
        });
      }
      if (parked.kind !== "question") {
        throw new CliError("REQUEST_MISMATCH", `Request ${requestId} needs a permission decision, not user input.`, {
          details: { threadId, requestId },
        });
      }
      const connection = await this.connectionFor(session);
      await connection.replyToQuestion(session.nativeSessionId, parked.nativeId, answersFor(answers, parked.detail));
      session.parked.delete(requestId);
      this.publish({ type: "user-input.request.resolved", provider: this.provider, threadId, requestId });
    });

  readonly stopSession = (threadId: ThreadId): Effect.Effect<void, CliError> =>
    this.attempt("OPENCODE_STOP_FAILED", `Could not stop the OpenCode session for thread ${threadId}`, async () => {
      const session = this.sessions.get(threadId);
      if (!session || session.closed) return;
      session.closed = true;
      this.settleOpenTurn(session, "interrupted", "Session stopped.");
      try {
        const connection = await this.connectionFor(session);
        await connection.abortSession(session.nativeSessionId);
      } catch {
        // Best effort: the server may already be gone.
      }
      this.sessions.delete(threadId);
    });

  readonly listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
    Effect.succeed([...this.sessions.values()].filter((session) => !session.closed).map((session) => this.describeSession(session)));

  readonly hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
    Effect.succeed(this.sessions.get(threadId)?.closed === false);

  readonly readThread = (threadId: ThreadId): Effect.Effect<ProviderThreadSnapshot, CliError> =>
    this.attempt("OPENCODE_READ_FAILED", `Could not read the OpenCode thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      const connection = await this.connectionFor(session);
      const messages = await connection.sessionMessages(session.nativeSessionId);
      return {
        threadId,
        turns: messages.flatMap((message) => {
          const id = asString(message.info.id);
          if (!id) return [];
          return [{ id, items: [...message.parts] }];
        }),
      };
    });

  readonly rollbackThread = (threadId: ThreadId, numTurns: number): Effect.Effect<ProviderThreadSnapshot, CliError> =>
    this.attempt("OPENCODE_ROLLBACK_FAILED", `Could not roll back the OpenCode thread ${threadId}`, async () => {
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        throw new CliError("INVALID_ROLLBACK", "numTurns must be an integer >= 1.", {
          details: { threadId, numTurns },
        });
      }
      const session = this.requireSession(threadId);
      if (this.openTurn(session)) {
        throw new CliError("TURN_BUSY", `Thread ${threadId} already has a running turn.`, {
          details: { threadId },
        });
      }
      const connection = await this.connectionFor(session);
      // A turn is one user message plus its replies; `session.fork` copies
      // every message *before* the one named, so the fork point is the
      // first user message to drop.
      const messages = await connection.sessionMessages(session.nativeSessionId);
      const prompts = messages.flatMap((message) => {
        const id = asString(message.info.id);
        return id && message.info.role === "user" ? [id] : [];
      });
      if (prompts.length < numTurns) {
        throw new CliError("ROLLBACK_UNAVAILABLE", "Cannot roll back more turns than the session holds.", {
          details: { threadId, numTurns, turns: prompts.length },
        });
      }
      const forkPoint = prompts[prompts.length - numTurns];
      const previous = session.applied;
      const forked = await connection.forkSession(session.nativeSessionId, forkPoint);
      session.nativeSessionId = forked.sessionID;
      // The fork copies the session's state (instructions included); what the
      // server does not report about it is what it was.
      session.applied = {
        model: forked.model ?? previous.model,
        agent: forked.agent ?? previous.agent,
        instructions: previous.instructions,
      };
      return await Effect.runPromise(this.readThread(threadId));
    });

  readonly stopAll = (): Effect.Effect<void, CliError> =>
    Effect.tryPromise({
      try: async () => {
        for (const session of this.sessions.values()) {
          session.closed = true;
          this.settleOpenTurn(session, "interrupted", "Driver stopped.");
        }
        this.sessions.clear();
        for (const pump of this.pumps.values()) pump.controller.abort();
        this.pumps.clear();
        const connections = [...this.connections.values()];
        this.connections.clear();
        this.liveConnections.clear();
        for (const pending of connections) {
          await pending.then((connection) => connection.dispose()).catch(() => undefined);
        }
      },
      catch: (cause) => toCliError("OPENCODE_STOP_FAILED", "Could not stop the OpenCode driver", cause),
    });

  // -- event pump ----------------------------------------------------------

  /**
   * The one event pump per server, demuxed by session. Resolves once the
   * subscription is live (v2 replays nothing, so nothing may be sent before
   * that), never rejects. A pump that ends without being stopped fails the
   * turns open on its server — their answers can no longer arrive — and the
   * next call to the server starts a fresh one.
   */
  private ensurePump(key: string, connection: OpencodeServerConnection): Promise<void> {
    const existing = this.pumps.get(key);
    if (existing) return existing.ready;
    const controller = new AbortController();
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const entry = { controller, ready, done: Promise.resolve() };
    this.pumps.set(key, entry);
    entry.done = (async () => {
      try {
        const subscription = await connection.subscribeEvents({ signal: controller.signal });
        markReady();
        // Enqueue only: the shared iterator waits for this loop, and a
        // subscriber that falls behind is cut off, so handlers never await.
        for await (const event of subscription.stream) {
          if (controller.signal.aborted) break;
          this.onServerEvent(event, key);
        }
        if (!controller.signal.aborted) this.onPumpLost(key, "the stream ended");
      } catch (cause) {
        if (!controller.signal.aborted) this.onPumpLost(key, cause instanceof Error ? cause.message : String(cause));
      } finally {
        markReady();
        if (this.pumps.get(key) === entry) this.pumps.delete(key);
      }
    })();
    return ready;
  }

  private onPumpLost(key: string, reason: string): void {
    this.failServerTurns(key, `Lost the OpenCode event stream (${reason.slice(0, 200)}).`);
    // A server whose stream died is not trusted again: the next call starts a fresh one.
    const connection = this.liveConnections.get(key);
    if (connection) this.dropConnection(key, connection, `event stream lost: ${reason}`);
  }

  private failServerTurns(key: string, message: string): void {
    this.onServerError(key, { type: "session.error", properties: { error: { message } } });
  }

  private sessionForNative(nativeSessionId: string): OpenCodeSession | null {
    for (const session of this.sessions.values()) {
      if (!session.closed && session.nativeSessionId === nativeSessionId) return session;
    }
    return null;
  }

  private onServerEvent(event: OpencodeSubscribedEvent, serverKey: string): void {
    const nativeSessionId = asString(event.properties.sessionID);
    if (!nativeSessionId) {
      // A fault with no session attached: v2's `location.shutdown`, or a
      // lost event stream (both arrive as `session.error`, see `translate.ts`
      // and `ensurePump`). Dropping those strands every turn on that server
      // until the stall watchdog fires, ten minutes later, with nothing to
      // show for it.
      if (event.type === "session.error") this.onServerError(serverKey, event);
      return;
    }
    const session = this.sessionForNative(nativeSessionId);
    if (!session) {
      this.onChildEvent(nativeSessionId, event, serverKey);
      return;
    }
    const active = this.openTurn(session);
    if (active) active.lastActivityAt = Date.now();
    switch (event.type) {
      case "message.part.updated":
        this.onPartUpdated(session, event);
        break;
      case "permission.asked":
        this.onPermissionAsked(session, event);
        break;
      case "question.asked":
        this.onQuestionAsked(session, event);
        break;
      case "permission.replied":
        this.onRequestSettled(session, asString(event.properties.requestID), "permission");
        break;
      case "question.replied":
      case "question.rejected":
        this.onRequestSettled(session, asString(event.properties.requestID), "question");
        break;
      case "session.idle":
        this.onSessionIdle(session);
        break;
      case "session.interrupted":
        this.onSessionInterrupted(session, event);
        break;
      case "session.error":
        this.onSessionError(session, event);
        break;
      default:
        break;
    }
  }

  private onPartUpdated(session: OpenCodeSession, event: OpencodeSubscribedEvent): void {
    const part = asRecord(event.properties.part);
    if (!part) return;
    const turn = this.openTurn(session);
    if (!turn) return;
    // Our own prompt streams back as parts of the user message; never
    // accumulate those into the assistant text.
    const messageId = asString(part.messageID);
    if (messageId === turn.userMessageId || (messageId && turn.steerMessageIds.has(messageId))) return;
    const partId = asString(part.id) ?? `part-${turn.partTexts.size}`;
    const kind = asString(part.type) ?? "unknown";
    if (kind === "text") {
      const text = typeof part.text === "string" ? part.text : "";
      const messageId = asString(part.messageID) ?? "opencode-message";
      // Parts stream as cumulative snapshots; subscribers want the delta.
      const previous = turn.partTexts.get(partId)?.text ?? "";
      const delta = text.startsWith(previous) ? text.slice(previous.length) : text;
      if (part.ignored !== true) {
        // A new step speaking means the previous step's text was a note.
        if (text && turn.lastTextMessageId !== null && turn.lastTextMessageId !== messageId) {
          const note = [...turn.partTexts.values()]
            .filter((entry) => entry.messageId === turn.lastTextMessageId)
            .map((entry) => entry.text)
            .join("");
          if (note.trim()) {
            this.publish({
              type: "assistant.note",
              provider: this.provider,
              threadId: session.threadId,
              turnId: turn.id,
              messageId: turn.lastTextMessageId,
              text: note,
            });
          }
        }
        if (text) turn.lastTextMessageId = messageId;
        turn.partTexts.set(partId, { messageId: asString(part.messageID), text });
        turn.text = answerText(turn.partTexts);
      }
      if (delta) {
        this.publish({
          type: "message.part.updated",
          provider: this.provider,
          threadId: session.threadId,
          turnId: turn.id,
          messageId,
          text: delta,
          raw: part,
        });
      }
      return;
    }
    if (kind === "tool") {
      const tool = asString(part.tool ?? part.name) ?? "tool";
      // The part's own `state.status` is the lifecycle, not the channel it
      // arrives on: every tool part streams as `message.part.updated`, so
      // publishing a flat `updated` left subscribers unable to tell a
      // started call from a finished one.
      const status = asString(asRecord(part.state)?.status);
      this.publish({
        type: status === "completed" || status === "error"
          ? "tool.execute.completed"
          : status === "pending"
            ? "tool.execute.started"
            : "tool.execute.updated",
        provider: this.provider,
        threadId: session.threadId,
        turnId: turn.id,
        tool,
        raw: part,
      });
      if (tool === "subagent") this.onSubagentCall(session, turn.id, part);
    }
  }

  /**
   * OpenCode's `subagent` tool runs a child session: a native subagent. Its
   * first progress update names the child (`metadata.sessionID`). A
   * foreground call ends with the child's report as its result; a
   * background call returns at launch, so its child's own idle ends it.
   */
  private onSubagentCall(session: OpenCodeSession, turnId: TurnId, part: Record<string, unknown>): void {
    const state = asRecord(part.state) ?? {};
    const childId = asString(asRecord(state.metadata)?.sessionID);
    const input = asRecord(state.input) ?? {};
    const status = asString(state.status);
    const finished = status === "completed" || status === "error";
    if (!childId) return;
    let child = this.children.get(childId);
    if (!child) {
      child = {
        parent: session,
        agentType: asString(input.agent) ?? "subagent",
        description: asString(input.description),
        background: input.background === true,
        stopped: false,
      };
      this.children.set(childId, child);
      this.publishSubagent(child, childId, turnId, "started", null);
    }
    if (finished && !child.background && !child.stopped) {
      child.stopped = true;
      this.publishSubagent(child, childId, turnId, "stopped", status === "completed" ? subagentReport(asString(state.output)) : null);
    }
  }

  /**
   * An event from a session no thread owns. A subagent's own prompts are
   * answered here — nobody sees them, so left alone they would hang the
   * child and the call waiting on it. Its ending is news.
   */
  private onChildEvent(childId: string, event: OpencodeSubscribedEvent, serverKey: string): void {
    if (event.type === "permission.asked" || event.type === "question.asked") {
      void this.answerChildRequest(childId, event, serverKey);
      return;
    }
    const child = this.children.get(childId);
    if (!child || child.stopped || !child.background) return;
    const ended =
      event.type === "session.idle" ||
      event.type === "session.error" ||
      (event.type === "session.interrupted" && event.properties.pendingInbox !== true);
    if (!ended) return;
    child.stopped = true;
    const turnId = this.openTurn(child.parent)?.id ?? null;
    if (event.type !== "session.idle") {
      this.publishSubagent(child, childId, turnId, "stopped", null);
      return;
    }
    // Its report is its last word; best effort, the stop is news either way.
    void this.connectionFor(child.parent)
      .then((connection) => connection.sessionMessages(childId, { tail: IDLE_READ_ITEMS }))
      .then((messages) => lastAssistantText(messages))
      .catch(() => null)
      .then((report) => this.publishSubagent(child, childId, turnId, "stopped", report));
  }

  /**
   * Subagents run with full access, always: a permission is allowed (once —
   * never saved as a project rule), and a question, which no one could
   * see, is dismissed so the child carries on without it. Only a child of
   * one of this driver's sessions: a shared server runs other clients'
   * sessions too. A child seen before its call named it is looked up.
   */
  private async answerChildRequest(childId: string, event: OpencodeSubscribedEvent, serverKey: string): Promise<void> {
    const requestId = asString(event.properties.id);
    if (!requestId) return;
    const connection = this.liveConnections.get(serverKey);
    if (!connection) return;
    try {
      if (!this.children.has(childId)) {
        const parentId = (await connection.getSession(childId))?.parentID;
        if (!parentId || !this.sessionForNative(parentId)) return;
      }
      if (event.type === "permission.asked") await connection.replyToPermission(childId, requestId, "once");
      else await connection.rejectQuestion(childId, requestId);
    } catch {
      // Best effort: the child's own call fails or times out as it would have.
    }
  }

  private publishSubagent(child: OpenCodeChild, agentId: string, turnId: TurnId | null, status: "started" | "stopped", lastMessage: string | null): void {
    this.publish({
      type: "subagent.updated",
      provider: this.provider,
      threadId: child.parent.threadId,
      turnId,
      agentId,
      agentType: child.agentType,
      status,
      lastMessage,
      ...(status === "started" ? { description: child.description } : {}),
    });
  }

  /** A child session's conversation, for the subagent view. */
  readonly subagentHistory = async (threadId: ThreadId, agentId: string): Promise<readonly SubagentHistoryItem[] | null> => {
    const session = this.sessions.get(threadId);
    if (!session || session.closed) return null;
    const connection = await this.connectionFor(session);
    const child = await connection.getSession(agentId).catch(() => null);
    // Only this thread's own subagents: a child of its session.
    if (!child || child.parentID !== session.nativeSessionId) return null;
    return subagentHistoryItems(await connection.sessionMessages(agentId));
  };

  private onPermissionAsked(session: OpenCodeSession, event: OpencodeSubscribedEvent): void {
    const nativeId = asString(event.properties.id);
    if (!nativeId || session.parked.has(nativeId)) return;
    if (session.runtimeMode === "full-access") {
      // Full access means no prompts. v2 still asks by default for paths
      // outside the project and for `.env` reads; allow them once, never
      // saving a project rule. A configured `deny` never reaches here.
      void this.connectionFor(session)
        .then((connection) => connection.replyToPermission(session.nativeSessionId, nativeId, "once"))
        .catch(() => undefined);
      return;
    }
    const permission = asString(event.properties.permission) ?? "tool";
    session.parked.set(nativeId, {
      threadId: session.threadId,
      kind: "permission",
      nativeId,
      detail: permission,
    });
    this.publish({
      type: "permission.request.opened",
      provider: this.provider,
      threadId: session.threadId,
      requestId: nativeId,
      raw: { ...event.properties, toolName: permission },
    });
  }

  private onQuestionAsked(session: OpenCodeSession, event: OpencodeSubscribedEvent): void {
    const nativeId = asString(event.properties.id);
    if (!nativeId || session.parked.has(nativeId)) return;
    session.parked.set(nativeId, {
      threadId: session.threadId,
      kind: "question",
      nativeId,
      detail: JSON.stringify(event.properties.questions ?? []),
    });
    this.publish({
      type: "user-input.request.opened",
      provider: this.provider,
      threadId: session.threadId,
      requestId: nativeId,
      raw: event.properties,
    });
  }

  private onRequestSettled(session: OpenCodeSession, nativeId: string | null, kind: ParkedKind): void {
    if (!nativeId) return;
    const parked = session.parked.get(nativeId);
    if (!parked || parked.kind !== kind) return;
    session.parked.delete(nativeId);
    this.publish({
      type: kind === "permission" ? "permission.request.resolved" : "user-input.request.resolved",
      provider: this.provider,
      threadId: session.threadId,
      requestId: nativeId,
    });
  }

  /**
   * `session.execution.interrupted`. Our own interrupt is acknowledged, always.
   * Otherwise the server stopped the run itself: for `inactivity` and
   * `superseded` that is a failure, never a completed turn; any other reason
   * (a dismissed form's cancel, a shutdown) ends the turn like a finished run
   * — unless a steer is still queued, whose run will settle it.
   */
  private onSessionInterrupted(session: OpenCodeSession, event: OpencodeSubscribedEvent): void {
    const turn = this.openTurn(session);
    if (!turn) return;
    if (turn.interrupting) {
      turn.interruptAcked = true;
      turn.interruptAck?.();
      return;
    }
    const reason = asString(event.properties.reason);
    if (reason === "inactivity" || reason === "superseded") {
      this.settleOpenTurn(
        session,
        "failed",
        reason === "inactivity"
          ? "OpenCode stopped the run after a period of inactivity."
          : "OpenCode replaced this run with another prompt on the same session.",
      );
      return;
    }
    if (event.properties.pendingInbox === true) return;
    this.onSessionIdle(session);
  }

  private onSessionIdle(session: OpenCodeSession): void {
    const turn = this.openTurn(session);
    if (!turn) return;
    if (turn.interrupting) {
      turn.interruptAcked = true;
      turn.interruptAck?.();
      return;
    }
    let settle = true;
    // Best-effort usage: read the latest assistant message tokens off the
    // server. Failures stay silent — usage is advisory, never load-bearing.
    void this.connectionFor(session)
      // The newest items are all this reads: the last reply's usage and whether the last prompt is answered.
      .then((connection) => connection.sessionMessages(session.nativeSessionId, { tail: IDLE_READ_ITEMS }))
      .then(async (messages) => {
        // A steer that landed as the loop was finishing starts a second run
        // (and a second idle). The turn is over only once its latest user
        // message has a finished reply.
        if (turn.steerMessageIds.size > 0 && !lastUserAnswered(messages)) {
          settle = false;
          return;
        }
        const settings = await this.contextSettingsFor(session).catch(() => null);
        session.context = opencodeContextOf(messages, settings) ?? session.context;
        const usage = latestAssistantUsage(messages);
        if (usage) {
          turn.usage = usage;
          this.publish({
            type: "token-usage.updated",
            provider: this.provider,
            threadId: session.threadId,
            usage,
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (settle) this.settleOpenTurn(session, "completed", "");
      });
  }

  /**
   * Mid-turn steering. A prompt sent to a busy v2 session is delivered as
   * `steer` (the default) and taken up at the next step boundary of the same
   * run — no restart. If it lands as the run finishes, the run ends and a
   * second one delivers it; the translator holds the idle until nothing is
   * queued, so the turn still settles once.
   */
  readonly steerTurn = (threadId: ThreadId, text: string): Effect.Effect<void, CliError> =>
    this.attempt("OPENCODE_STEER_FAILED", `Could not steer the turn on thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      const turn = this.openTurn(session);
      if (!turn) {
        throw new CliError("TURN_NOT_RUNNING", `Thread ${threadId} has no running turn to steer.`, {
          details: { threadId },
        });
      }
      const messageID = newOpencodeMessageId();
      // Registered before the send so no echoed part is read as answer text.
      turn.steerMessageIds.add(messageID);
      const connection = await this.connectionFor(session);
      try {
        // The session's model, agent and instructions are already those of the running turn.
        await connection.prompt({ sessionID: session.nativeSessionId, messageID, text });
      } catch (cause) {
        turn.steerMessageIds.delete(messageID);
        throw cause;
      }
    });

  /** Fail every open turn on one server: a fault with no session to blame. */
  private onServerError(serverKey: string, event: OpencodeSubscribedEvent): void {
    for (const session of this.sessions.values()) {
      if (session.closed || session.workingDirectory !== serverKey) continue;
      if (!this.openTurn(session)) continue;
      this.onSessionError(session, event);
    }
  }

  private onSessionError(session: OpenCodeSession, event: OpencodeSubscribedEvent): void {
    const error = asRecord(event.properties.error);
    const message = (error ? asString(error.message ?? error.data ?? error.name) : null) ?? "OpenCode turn failed.";
    if (isOpencodeAuthErrorText(message)) {
      this.settleOpenTurn(session, "failed", opencodeSignedOutMessage({ cwd: session.workingDirectory }));
      return;
    }
    // A provider that never loaded reads as a missing model, which tells
    // the user nothing about the key they actually need.
    const hint = this.openTurn(session)?.credentialHint;
    const detail = hint && /model not found/i.test(message) ? `${message} ${hint}` : message;
    this.settleOpenTurn(session, "failed", detail.slice(0, 500));
  }

  private settleOpenTurn(session: OpenCodeSession, status: OpenCodeTurnStatus, detail: string): void {
    const open = this.openTurn(session);
    if (open) {
      this.clearStallTimer(open.id);
      open.interruptAck?.();
      open.status = status;
      open.error = status === "completed" ? null : detail;
      if (status !== "completed") open.text = open.text || detail;
    }
    const waiters = open ? (session.waiters.get(open.id) ?? []) : [];
    if (open) session.waiters.delete(open.id);
    for (const waiter of waiters) {
      waiter.resolve({
        status,
        text: open?.text ?? "",
        usage: open?.usage ?? emptyUsage(),
        error: open?.error ?? null,
      });
    }
  }

  private clearStallTimer(turnId: TurnId): void {
    const timer = this.stallTimers.get(turnId);
    if (timer) {
      clearTimeout(timer);
      this.stallTimers.delete(turnId);
    }
  }

  /**
   * Silence watchdog: the server can accept a prompt and then emit
   * nothing at all (observed with unauthenticated async prompts — 204
   * followed by zero events, where the sync endpoint 500s). Without
   * this the turn reads `running` forever.
   */
  private armStallTimer(session: OpenCodeSession, turn: OpenCodeTurn, delayMs = this.stallTimeoutMs): void {
    this.clearStallTimer(turn.id);
    const timer = setTimeout(() => {
      this.stallTimers.delete(turn.id);
      const current = this.sessions.get(session.threadId);
      if (!current || current.closed) return;
      const open = current.turns.get(turn.id);
      if (!open || open.status !== "running") return;
      // Any event since the timer was armed is proof of life: wait out the rest of the silence budget.
      const silentFor = Date.now() - open.lastActivityAt;
      if (silentFor < this.stallTimeoutMs) {
        this.armStallTimer(current, open, this.stallTimeoutMs - silentFor);
        return;
      }
      this.settleOpenTurn(
        current,
        "failed",
        `No response from the provider for ${Math.round(this.stallTimeoutMs / 60000)} minutes — ` +
          "the turn was failed. Check authentication and network, then retry.",
      );
    }, delayMs);
    (timer as { unref?: () => void }).unref?.();
    this.stallTimers.set(turn.id, timer);
  }

  private async rejectParked(session: OpenCodeSession, detail: string): Promise<void> {
    void detail;
    const parked = [...session.parked.values()];
    session.parked.clear();
    let connection: OpencodeServerConnection | null = null;
    for (const request of parked) {
      try {
        connection = connection ?? (await this.connectionFor(session));
        if (request.kind === "permission") await connection.replyToPermission(session.nativeSessionId, request.nativeId, "reject");
        else await connection.rejectQuestion(session.nativeSessionId, request.nativeId);
      } catch {
        // Best effort: abort still proceeds below.
      }
      this.publish({
        type: request.kind === "permission" ? "permission.request.resolved" : "user-input.request.resolved",
        provider: this.provider,
        threadId: session.threadId,
        requestId: request.nativeId,
      });
    }
  }

  private describeSession(session: OpenCodeSession): ProviderSession {
    return {
      threadId: session.threadId,
      provider: this.provider,
      workingDirectory: session.workingDirectory,
      startedAt: session.startedAt,
    };
  }
}

/**
 * Split a multiselect answer back into its values. The panel joins them with
 * `", "`; a value that itself contains `", "` survives when it is one of the
 * field's option labels (longest match first), else each piece stands alone.
 */
function splitMultiselect(joined: string, labels: readonly string[]): string[] {
  const tokens = joined.split(", ");
  const known = new Set(labels);
  const values: string[] = [];
  let at = 0;
  while (at < tokens.length) {
    let taken = 1;
    for (let end = tokens.length; end > at + 1; end -= 1) {
      if (known.has(tokens.slice(at, end).join(", "))) {
        taken = end - at;
        break;
      }
    }
    values.push(tokens.slice(at, at + taken).join(", "));
    at += taken;
  }
  return values.filter((value) => value.length > 0);
}

/**
 * Map the panel's flat `Record<question id, answer>` onto the server's
 * per-question `string[][]`. The panel keys each answer by the question's
 * own text (`requestactivity.ts`: `id` is the text, `"<text> (n)"` for a
 * repeat), so that comes first; then the header, then `q<index>`. A question
 * with no answer gets an empty selection. A multiselect answer arrives joined
 * with `", "` and is split back into its values.
 */
export function answersFor(
  answers: ProviderUserInputAnswers,
  questionsJson: string,
): ReadonlyArray<ReadonlyArray<string>> {
  let questions: readonly unknown[];
  try {
    const parsed = JSON.parse(questionsJson) as unknown;
    questions = Array.isArray(parsed) ? parsed : [];
  } catch {
    questions = [];
  }
  if (questions.length === 0) return Object.values(answers).map((value) => [value]);
  const seen = new Set<string>();
  return questions.map((entry, index) => {
    const question = asRecord(entry);
    // Mirrors `normalizeQuestions` in requestactivity.ts, id for id.
    const text = question ? (asString(question.question) ?? asString(question.prompt) ?? asString(question.text)) : null;
    const id = text === null ? null : seen.has(text) ? `${text} (${index + 1})` : text;
    if (text !== null) seen.add(text);
    const key = [id, question ? asString(question.header) : null, `q${index}`].find(
      (candidate) => candidate !== null && answers[candidate] !== undefined,
    );
    const answer = key === undefined || key === null ? undefined : answers[key];
    if (answer === undefined || answer === "") return [];
    if (question?.multiple !== true && question?.multiSelect !== true) return [answer];
    const labels = (Array.isArray(question.options) ? question.options : []).flatMap((option) => {
      const record = asRecord(option);
      return [asString(record?.label), asString(record?.value)].filter((label): label is string => label !== null);
    });
    return splitMultiselect(answer, labels);
  });
}

function latestAssistantUsage(
  messages: ReadonlyArray<{ info: Record<string, unknown>; parts: ReadonlyArray<Record<string, unknown>> }>,
): TokenUsageDelta | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info;
    if (!info || info.role !== "assistant") continue;
    const tokens = asRecord(info.tokens);
    // A step cut short reports no tokens; the reply before it still does.
    if (!tokens) continue;
    const cache = asRecord(tokens.cache);
    const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
    return {
      input: number(tokens.input),
      cacheRead: number(cache?.read),
      cacheCreate: number(cache?.write),
      output: number(tokens.output),
      thinking: number(tokens.reasoning),
    };
  }
  return null;
}
