/**
 * Claude driver: `ProviderAdapter` over the official Agent SDK.
 *
 * Thin by design (§4): no Effect Layers, no host services. One `query()`
 * per thread in streaming-input mode; a per-session pump translates SDK
 * messages into SPI events, transcripts, usage totals, and turn outcomes.
 * Permissions park in `canUseTool` until `respondToRequest` /
 * `respondToUserInput` resolve them. Rollback is fork-based (SDK
 * `getSessionMessages` + `forkSession` + resume); compaction is the
 * slash-command `/compact` with `compact_boundary` observed. Auth is
 * inherited from the CLI login — never our own OAuth.
 * See ARCHITECTURE.md §5.
 */
import { randomUUID } from "node:crypto";

import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type {
  CanUseTool,
  PermissionMode,
  PermissionResult,
  SDKMessage,
  SDKRateLimitInfo,
  SDKUserMessage,
  SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { CliError } from "../../errors.js";
import { plainSkill, type SkillInventory, type SkillSummary } from "../../catalog/summary.js";
import type { InteractionMode, RuntimeMode } from "../../types.js";
import type {
  ApprovalRequestId,
  ContextWindowUsage,
  ProviderImage,
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
  ThreadId,
  TurnId,
} from "../spi.js";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerSpec } from "../../mcp.js";
import {
  claudeSignedOutMessage,
  isClaudeAuthErrorText,
  makeClaudeEnv,
  normalizeClaudeSettings,
  parseClaudeLaunchArgs,
  resolveClaudeExecutable,
  resolveClaudeHomePath,
  type ClaudeSettings,
} from "./config.js";
import {
  classifyToolUse,
  needsAllowDangerouslySkipPermissions,
  permissionModeForRuntimeMode,
  sessionAllowKey,
} from "./permissions.js";
import { SdkSessionApi, SdkTransport, type ClaudeQuery, type ClaudeSessionApi, type ClaudeTransport } from "./transport.js";
import {
  addFrameUsage,
  describePauseUntil,
  emptyUsage,
  mapRateLimitEvent,
  mapUsageProbe,
  type UsageTotals,
} from "./usage.js";

export interface ClaudeDriverOptions {
  readonly settings?: Partial<ClaudeSettings>;
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: ClaudeTransport;
  readonly sessionApi?: ClaudeSessionApi;
  readonly usageProbeTimeoutMs?: number;
}

export type DriverTurnStatus = "completed" | "failed" | "interrupted";

export interface DriverTurnOutcome {
  readonly status: DriverTurnStatus;
  readonly text: string;
  readonly usage: UsageTotals;
  readonly error: string | null;
}

interface TranscriptItem {
  readonly kind: "user" | "assistant" | "tool";
  readonly text: string;
  readonly tool?: string;
}

interface TranscriptTurn {
  readonly id: TurnId;
  readonly prompt: string;
  readonly items: TranscriptItem[];
  status: "running" | DriverTurnStatus;
  text: string;
  costUsd: number;
  error: string | null;
}

interface ParkedRequest {
  readonly threadId: ThreadId;
  readonly toolName: string;
  readonly toolUseId: string | undefined;
  readonly resolve: (result: PermissionResult) => void;
}

interface ClaudeSession {
  readonly threadId: ThreadId;
  readonly workingDirectory: string;
  query: ClaudeQuery;
  input: PromptQueue;
  closed: boolean;
  resumeSessionId: string | null;
  account: { subscriptionType?: string; tokenSource?: string; apiProvider?: string } | null;
  model: string | null;
  basePermissionMode: PermissionMode;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  /**
   * Who put the session into plan mode, which decides whether the agent may
   * leave it. Null when it is not in plan mode.
   */
  planModeSource: "user" | "agent" | null;
  toolUseThreads: Map<string, ThreadId>;
  /**
   * Name and input per in-flight `tool_use` id. The matching `tool_result`
   * carries neither, and the transcript folds a call's rows onto the
   * *newest* payload — so without replaying them here a finished Read
   * collapses from "Read note.txt" to a nameless "Tool call".
   */
  toolUseCalls: Map<string, { name: string; input: Record<string, unknown> }>;
  lastActiveThreadId: ThreadId | null;
  parkedPermissions: Map<string, ParkedRequest>;
  parkedInputs: Map<string, ParkedRequest & { input: Record<string, unknown> }>;
  sessionAllows: Set<string>;
  transcript: TranscriptTurn[];
  waiters: Map<TurnId, Array<{ resolve: (outcome: DriverTurnOutcome) => void; reject: (cause: unknown) => void }>>;
  usage: UsageTotals;
  compacted: boolean;
  turnsSinceCompaction: number;
  announcedRateLimits: Map<TurnId, Set<string>>;
  startedAt: string;
}

/** A user message: the text, then each image as a base64 content block. */
function userMessage(text: string, images: readonly ProviderImage[] = []): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((image) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: image.mimeType, data: image.data },
        })),
      ],
    } as SDKUserMessage["message"],
    parent_tool_use_id: null,
  };
}

class PromptQueue {
  private pending: SDKUserMessage[] = [];
  private takers: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  closed = false;

  push(text: string, images: readonly ProviderImage[] = []): void {
    const message = userMessage(text, images);
    const taker = this.takers.shift();
    if (taker) taker({ value: message, done: false });
    else this.pending.push(message);
  }

  close(): void {
    this.closed = true;
    for (const taker of this.takers.splice(0)) taker({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: async (): Promise<IteratorResult<SDKUserMessage>> => {
        const message = this.pending.shift();
        if (message !== undefined) return { value: message, done: false };
        if (this.closed) return { value: undefined, done: true };
        return await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.takers.push(resolve);
        });
      },
    };
  }
}

function toCliError(code: string, message: string, cause: unknown): CliError {
  // Auth patterns win even over SDK wrappers carrying the message.
  const text = cause instanceof Error ? cause.message : String(cause);
  if (isClaudeAuthErrorText(text)) {
    return new CliError("CLAUDE_AUTH_REQUIRED", claudeSignedOutMessage({ cwd: process.cwd() }), {
      cause,
    });
  }
  if (cause instanceof CliError) return cause;
  return new CliError(code, `${message}: ${text.slice(0, 200)}`, { cause });
}

function contentBlocks(message: unknown): Array<Record<string, unknown>> {
  if (message === null || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) {
    return content.filter((block): block is Record<string, unknown> => block !== null && typeof block === "object");
  }
  return [];
}

/**
 * A `tool_result` block's content is either a plain string or the same
 * content-block array shape as everywhere else; keep only its text.
 */
function toolResultText(content: unknown): string | null {
  if (typeof content === "string") return content.length > 0 ? content : null;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((block): block is Record<string, unknown> => block !== null && typeof block === "object")
    .map((block) => (typeof block["text"] === "string" ? (block["text"] as string) : ""))
    .filter((part) => part.length > 0)
    .join("\n");
  return text.length > 0 ? text : null;
}

function isPromptSessionMessage(message: SessionMessage): boolean {
  if (message.type !== "user" || message.parent_tool_use_id !== null) return false;
  const blocks = contentBlocks(message.message);
  return blocks.some((block) => block["type"] === "text" && typeof block["text"] === "string");
}

export class ClaudeDriver implements ProviderAdapter<CliError> {
  readonly provider = "claude" as const;
  readonly capabilities: ProviderAdapterCapabilities = { sessionModelSwitch: "in-session" };
  readonly compaction = { type: "slash-command" as const, command: "/compact" as const };

  private readonly settings: ClaudeSettings;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly transport: ClaudeTransport;
  private readonly sessionApi: ClaudeSessionApi;
  private readonly usageProbeTimeoutMs: number;
  private readonly sessions = new Map<ThreadId, ClaudeSession>();
  /**
   * Last resumable CLI session id per thread, kept past session teardown.
   * `interrupt()` ends the query for good, so the next turn builds a new
   * session — without this it would start with no history.
   */
  private readonly resumable = new Map<ThreadId, string>();
  private readonly queue = Effect.runSync(Queue.unbounded<ProviderRuntimeEvent>());

  /** The exact callback handed to the SDK as `canUseTool`; tests drive it directly. */
  readonly handlePermissionRequest: CanUseTool;

  constructor(options: ClaudeDriverOptions = {}) {
    this.settings = normalizeClaudeSettings(options.settings);
    this.baseEnv = options.env ?? process.env;
    this.transport = options.transport ?? new SdkTransport();
    this.sessionApi = options.sessionApi ?? new SdkSessionApi();
    this.usageProbeTimeoutMs = options.usageProbeTimeoutMs ?? 15_000;
    this.handlePermissionRequest = (toolName, input, callbackOptions) =>
      this.onPermissionRequest(toolName, input, callbackOptions);
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

  private requireSession(threadId: ThreadId): ClaudeSession {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new CliError("CLAUDE_NOT_STARTED", `No Claude session exists for thread ${threadId}.`, {
        details: { threadId },
      });
    }
    return session;
  }

  // -- session lifecycle -------------------------------------------------

  readonly startSession = (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, CliError> =>
    this.attempt("CLAUDE_SPAWN_FAILED", `Could not start a Claude session for thread ${input.threadId}`, async () => {
      const existing = this.sessions.get(input.threadId);
      if (existing && !existing.closed) return this.describeSession(existing);
      const launch = parseClaudeLaunchArgs(this.settings.launchArgs);
      const basePermissionMode = permissionModeForRuntimeMode(
        input.runtimeMode ?? "full-access",
        { permissionMode: launch.permissionMode, skipPermissions: launch.skipPermissions },
      );
      const executable = resolveClaudeExecutable(this.settings.binaryPath, this.baseEnv);
      const env = makeClaudeEnv({ homePath: this.settings.homePath }, this.baseEnv);
      const session: ClaudeSession = {
        threadId: input.threadId,
        workingDirectory: input.workingDirectory,
        query: undefined as unknown as ClaudeQuery,
        input: new PromptQueue(),
        closed: false,
        resumeSessionId: null,
        account: null,
        model: input.modelSelection?.model ?? null,
        basePermissionMode,
        runtimeMode: input.runtimeMode ?? "full-access",
        interactionMode: input.interactionMode ?? "default",
        planModeSource: input.interactionMode === "plan" ? "user" : null,
        toolUseThreads: new Map(),
        toolUseCalls: new Map(),
        lastActiveThreadId: null,
        parkedPermissions: new Map(),
        parkedInputs: new Map(),
        sessionAllows: new Set(),
        transcript: [],
        waiters: new Map(),
        usage: emptyUsage(),
        compacted: false,
        turnsSinceCompaction: 0,
        announcedRateLimits: new Map(),
        startedAt: new Date().toISOString(),
      };
      const stringEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") stringEnv[key] = value;
      }
      const resume = this.resumable.get(input.threadId) ?? (await this.liveCursor(input.resumeCursor));
      session.resumeSessionId = resume ?? null;
      if (resume) this.resumable.set(input.threadId, resume);
      session.query = this.transport.query(session.input, {
        cwd: input.workingDirectory,
        ...(session.model ? { model: session.model } : {}),
        ...(resume ? { resume } : {}),
        ...(input.mcpServers && input.mcpServers.length > 0 ? { mcpServers: claudeMcpServers(input.mcpServers) } : {}),
        // Always Claude Code's own prompt: the SDK's default when this is
        // omitted is an *empty* custom prompt (`systemPrompt = ""`), which
        // left sessions without Claude Code's tool and environment guidance.
        // moxen's runtime instructions are appended to it, never in place of it.
        systemPrompt: {
          type: "preset" as const,
          preset: "claude_code" as const,
          ...(input.instructions ? { append: input.instructions } : {}),
        },
        permissionMode: basePermissionMode,
        ...(needsAllowDangerouslySkipPermissions(basePermissionMode)
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        env: stringEnv,
        pathToClaudeCodeExecutable: executable,
        canUseTool: this.handlePermissionRequest,
      });
      this.sessions.set(input.threadId, session);
      void this.pump(session);
      return this.describeSession(session);
    });

  readonly resumeCursor = (threadId: ThreadId): string | null => this.resumable.get(threadId) ?? null;

  /**
   * Streaming input is how the CLI takes more text mid-turn: a user
   * message pushed while it works is folded into the running turn between
   * tool rounds (or, if the run is already finishing, runs next and is
   * announced by the result's `queued_turn_count`).
   */
  readonly steerTurn = (threadId: ThreadId, text: string): Effect.Effect<void, CliError> =>
    this.attempt("CLAUDE_STEER_FAILED", `Could not steer the turn on thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      const open = session.transcript.find((turn) => turn.status === "running");
      if (session.closed || !open) {
        throw new CliError("TURN_NOT_RUNNING", `Thread ${threadId} has no running turn to steer.`, {
          details: { threadId },
        });
      }
      open.items.push({ kind: "user", text });
      session.input.push(text);
    });

  /**
   * The CLI's own `/context` reading, in its cheap `summary` form (from the
   * last response's usage, no token-count calls): tokens in the window,
   * the window, the auto-compact threshold, and the last request's cache
   * reads. Null once the session is gone.
   */
  readonly contextUsage = async (threadId: ThreadId): Promise<ContextWindowUsage | null> => {
    const session = this.sessions.get(threadId);
    if (!session || session.closed || !session.query.getContextUsage) return null;
    return claudeContextUsageOf(await session.query.getContextUsage({ detail: "summary" }));
  };

  /**
   * Skills and slash commands as Claude Code resolves them for `cwd` — user,
   * project, plugin and MCP ones included — from a query that is never sent
   * a prompt: the CLI answers `supportedCommands` on initialize, and writes
   * no session for it (checked against claude 2.1.281).
   */
  readonly skillInventory = async (cwd: string): Promise<SkillInventory> => {
    const never: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<SDKUserMessage>>(() => undefined) }),
    };
    const stringEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.baseEnv)) if (typeof value === "string") stringEnv[key] = value;
    const query = this.transport.query(never, {
      cwd,
      permissionMode: "default",
      env: stringEnv,
      pathToClaudeCodeExecutable: resolveClaudeExecutable(this.settings.binaryPath, this.baseEnv),
    });
    try {
      const entries = (await query.supportedCommands?.()) ?? [];
      // "(user)" / "(project)" is the CLI's own scope suffix on custom entries.
      const describe = (text: string): string | null => text.replace(/\s*\((user|project|local)\)$/, "").trim() || null;
      return {
        trigger: "/",
        skills: entries.filter((entry) => entry.builtin !== true).map((entry) => plainSkill(entry.name, describe(entry.description))),
        commands: entries
          .filter((entry) => entry.builtin === true)
          .map((entry) => ({
            name: entry.name,
            description: describe(entry.description),
            argumentHint: entry.argumentHint.trim() || null,
            builtin: true,
          })),
      };
    } finally {
      query.close?.();
    }
  };

  /**
   * A cursor from a previous process, if the CLI still has that session.
   * A lost one (cleared `~/.claude`, another machine) starts fresh instead
   * of failing the turn; so does a lookup that itself fails.
   */
  private async liveCursor(cursor: string | undefined): Promise<string | undefined> {
    if (!cursor) return undefined;
    const exists = await this.sessionApi.sessionExists(cursor).catch(() => false);
    return exists ? cursor : undefined;
  }

  private describeSession(session: ClaudeSession): ProviderSession {
    return {
      threadId: session.threadId,
      provider: "claude",
      workingDirectory: session.workingDirectory,
      startedAt: session.startedAt,
    };
  }

  readonly stopSession = (threadId: ThreadId): Effect.Effect<void, CliError> =>
    this.attempt("CLAUDE_SPAWN_FAILED", `Could not stop the Claude session for thread ${threadId}`, async () => {
      const session = this.sessions.get(threadId);
      if (!session) return;
      await this.closeSession(session, "session-stopped");
    });

  readonly stopAll = (): Effect.Effect<void, CliError> =>
    this.attempt("CLAUDE_SPAWN_FAILED", "Could not stop Claude sessions", async () => {
      for (const session of [...this.sessions.values()]) {
        await this.closeSession(session, "session-stopped");
      }
    });

  private async closeSession(session: ClaudeSession, reason: string): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    this.denyParked(session, "Session ended.");
    try {
      await session.query.interrupt();
    } catch {
      // Best effort: the process may already be gone.
    }
    session.input.close();
    this.sessions.delete(session.threadId);
    this.publish({
      type: "thread.state.changed",
      provider: "claude",
      threadId: session.threadId,
      state: reason,
    });
  }

  readonly listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
    Effect.succeed([...this.sessions.values()].map((session) => this.describeSession(session)));

  readonly hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
    Effect.succeed(this.sessions.has(threadId));

  // -- turns -------------------------------------------------------------

  readonly sendTurn = (input: ProviderSendTurnInput): Effect.Effect<ProviderTurnStartResult, CliError> =>
    this.attempt("CLAUDE_TURN_FAILED", `Could not send a turn on thread ${input.threadId}`, async () => {
      const session = this.requireSession(input.threadId);
      if (session.closed) {
        throw new CliError("CLAUDE_NOT_STARTED", `The Claude session for thread ${input.threadId} is closed.`, {
          details: { threadId: input.threadId },
        });
      }
      const open = session.transcript.find((turn) => turn.status === "running");
      if (open) {
        throw new CliError("TURN_BUSY", `Thread ${input.threadId} already has a running turn.`, {
          details: { threadId: input.threadId, turnId: open.id },
        });
      }
      const model = input.modelSelection?.model ?? session.model;
      if (model && model !== session.model) {
        await session.query.setModel(model);
        session.model = model;
      }
      if (input.runtimeMode && input.runtimeMode !== session.runtimeMode) {
        session.runtimeMode = input.runtimeMode;
        session.basePermissionMode = permissionModeForRuntimeMode(
          input.runtimeMode,
          parseClaudeLaunchArgs(this.settings.launchArgs),
        );
        await session.query.setPermissionMode(session.basePermissionMode);
      }
      // "plan" maps to the SDK plan mode; "default" restores the base mode.
      if (input.interactionMode === "plan") {
        await session.query.setPermissionMode("plan");
        session.interactionMode = "plan";
        session.planModeSource = "user";
      } else if (input.interactionMode === "default") {
        await session.query.setPermissionMode(session.basePermissionMode);
        session.interactionMode = "default";
        session.planModeSource = null;
      }
      const turn: TranscriptTurn = {
        id: randomUUID(),
        prompt: input.prompt,
        items: [{ kind: "user", text: input.prompt }],
        status: "running",
        text: "",
        costUsd: 0,
        error: null,
      };
      session.transcript.push(turn);
      session.turnsSinceCompaction += 1;
      session.lastActiveThreadId = session.threadId;
      session.input.push(input.prompt, input.images ?? []);
      return { threadId: session.threadId, turnId: turn.id };
    });

  readonly interruptTurn = (threadId: ThreadId, _turnId?: TurnId): Effect.Effect<void, CliError> =>
    this.attempt("CLAUDE_TURN_FAILED", `Could not interrupt the turn on thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      this.denyParked(session, "Interrupted.");
      try {
        await session.query.interrupt();
      } catch (cause) {
        if (!session.closed) throw cause;
      }
      this.settleOpenTurn(session, "interrupted", "Interrupted.");
    });

  /** Await a turn's terminal outcome. Rejects on abort. */
  async awaitTurn(threadId: ThreadId, turnId: TurnId, signal?: AbortSignal): Promise<DriverTurnOutcome> {
    const session = this.requireSession(threadId);
    const turn = session.transcript.find((candidate) => candidate.id === turnId);
    if (!turn) {
      throw new CliError("TURN_NOT_FOUND", `No turn exists with id ${turnId}.`, {
        details: { threadId, turnId },
      });
    }
    if (turn.status !== "running") {
      return { status: turn.status, text: turn.text, usage: session.usage, error: turn.error };
    }
    if (signal?.aborted === true) {
      throw new CliError("TURN_ABORTED", `Turn ${turnId} was aborted before settling.`, {
        details: { threadId, turnId },
      });
    }
    return await new Promise<DriverTurnOutcome>((resolve, reject) => {
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

  private settleOpenTurn(session: ClaudeSession, status: DriverTurnStatus, detail: string): void {
    const open = session.transcript.find((turn) => turn.status === "running");
    if (open) {
      open.status = status;
      open.error = status === "completed" ? null : detail;
      if (status !== "completed") open.text = open.text || detail;
    }
    const waiters = open ? (session.waiters.get(open.id) ?? []) : [];
    if (open) session.waiters.delete(open.id);
    const outcome: DriverTurnOutcome = {
      status,
      text: open?.text ?? "",
      usage: session.usage,
      error: open?.error ?? detail,
    };
    for (const waiter of waiters) waiter.resolve(outcome);
  }

  // -- permissions --------------------------------------------------------

  private sessionForToolUse(toolUseId: string | undefined): ClaudeSession | null {
    if (toolUseId) {
      for (const session of this.sessions.values()) {
        const threadId = session.toolUseThreads.get(toolUseId);
        if (threadId === session.threadId) return session;
      }
    }
    // Unambiguous single session (e.g. a parked prompt answered before any
    // tool_use block was observed).
    if (this.sessions.size === 1) {
      return [...this.sessions.values()][0]!;
    }
    for (const session of this.sessions.values()) {
      if (session.lastActiveThreadId === session.threadId) return session;
    }
    return null;
  }

  private onPermissionRequest(
    toolName: string,
    input: Record<string, unknown>,
    callbackOptions: { toolUseID?: string; signal: AbortSignal },
  ): Promise<PermissionResult> {
    const session = this.sessionForToolUse(callbackOptions.toolUseID);
    if (!session || session.closed) {
      return Promise.resolve({ behavior: "deny", message: "Claude session is unavailable." });
    }
    // AskUserQuestion always surfaces, regardless of runtime mode.
    if (toolName === "AskUserQuestion") {
      return this.parkInput(session, toolName, input, callbackOptions);
    }
    // The agent may put itself into plan mode. We have to know that it did:
    // ExitPlanMode below is denied to keep a *user's* plan from executing
    // itself, and applying that to a self-entered plan mode leaves the
    // agent in a mode whose only exit we refuse — it goes quiet mid-turn.
    if (toolName === "EnterPlanMode") {
      session.interactionMode = "plan";
      session.planModeSource = "agent";
      return Promise.resolve({ behavior: "allow" });
    }
    // ExitPlanMode is captured as a proposed plan. A plan the user asked
    // for is then denied, so the CLI does not act on it before they have
    // seen it; a plan mode the agent entered on its own is released, since
    // nobody is waiting to approve it.
    if (toolName === "ExitPlanMode") {
      const plan = extractPlan(input);
      session.transcript
        .filter((turn) => turn.status === "running")
        .forEach((turn) => {
          turn.items.push({ kind: "assistant", text: plan ?? "(empty plan)" });
        });
      this.publish({
        type: "turn.plan.updated",
        provider: "claude",
        threadId: session.threadId,
        turnId: session.transcript.find((turn) => turn.status === "running")?.id ?? null,
        raw: { toolName, input, plan },
      });
      if (session.planModeSource === "agent") {
        session.interactionMode = "default";
        session.planModeSource = null;
        return Promise.resolve({ behavior: "allow" });
      }
      return Promise.resolve({ behavior: "deny", message: "Recorded as a proposed plan." });
    }
    if (session.sessionAllows.has(sessionAllowKey(toolName))) {
      return Promise.resolve({ behavior: "allow" });
    }
    if (session.basePermissionMode === "bypassPermissions") {
      return Promise.resolve({ behavior: "allow" });
    }
    return this.parkPermission(session, toolName, input, callbackOptions);
  }

  private parkPermission(
    session: ClaudeSession,
    toolName: string,
    input: Record<string, unknown>,
    callbackOptions: { toolUseID?: string; signal: AbortSignal },
  ): Promise<PermissionResult> {
    const requestId = randomUUID();
    const classification = classifyToolUse(toolName);
    this.publish({
      type: "permission.request.opened",
      provider: "claude",
      threadId: session.threadId,
      requestId,
      raw: { toolName, classification, input },
    });
    return new Promise<PermissionResult>((resolve) => {
      const cleanup = (): void => {
        session.parkedPermissions.delete(requestId);
      };
      session.parkedPermissions.set(requestId, {
        threadId: session.threadId,
        toolName,
        toolUseId: callbackOptions.toolUseID,
        resolve: (result) => {
          cleanup();
          this.publish({
            type: "permission.request.resolved",
            provider: "claude",
            threadId: session.threadId,
            requestId,
            raw: { toolName, behavior: result.behavior },
          });
          resolve(result);
        },
      });
      callbackOptions.signal.addEventListener(
        "abort",
        () => {
          if (session.parkedPermissions.has(requestId)) {
            cleanup();
            resolve({ behavior: "deny", message: "Interrupted." });
          }
        },
        { once: true },
      );
    });
  }

  private parkInput(
    session: ClaudeSession,
    toolName: string,
    input: Record<string, unknown>,
    callbackOptions: { toolUseID?: string; signal: AbortSignal },
  ): Promise<PermissionResult> {
    const requestId = randomUUID();
    this.publish({
      type: "user-input.request.opened",
      provider: "claude",
      threadId: session.threadId,
      requestId,
      raw: { toolName, input },
    });
    return new Promise<PermissionResult>((resolve) => {
      const cleanup = (): void => {
        session.parkedInputs.delete(requestId);
      };
      session.parkedInputs.set(requestId, {
        threadId: session.threadId,
        toolName,
        toolUseId: callbackOptions.toolUseID,
        input,
        resolve: (result) => {
          cleanup();
          this.publish({
            type: "user-input.request.resolved",
            provider: "claude",
            threadId: session.threadId,
            requestId,
            raw: { toolName, behavior: result.behavior },
          });
          resolve(result);
        },
      });
      callbackOptions.signal.addEventListener(
        "abort",
        () => {
          if (session.parkedInputs.has(requestId)) {
            cleanup();
            resolve({ behavior: "deny", message: "Interrupted." });
          }
        },
        { once: true },
      );
    });
  }

  private denyParked(session: ClaudeSession, message: string): void {
    for (const [, parked] of [...session.parkedPermissions]) {
      parked.resolve({ behavior: "deny", message });
    }
    for (const [, parked] of [...session.parkedInputs]) {
      parked.resolve({ behavior: "deny", message });
    }
  }

  readonly respondToRequest = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ): Effect.Effect<void, CliError> =>
    this.attempt("CLAUDE_TURN_FAILED", `Could not answer permission request ${requestId}`, async () => {
      const session = this.requireSession(threadId);
      const parked = session.parkedPermissions.get(requestId);
      if (!parked || parked.threadId !== threadId) {
        // A dismissed *question* lands here too: the panel closes a
        // question the same way it declines a permission, and the request
        // is still blocking `canUseTool`. Denying it releases the turn —
        // closing only the panel would park it until the next interrupt.
        const parkedInput = session.parkedInputs.get(requestId);
        if (parkedInput && parkedInput.threadId === threadId) {
          if (decision.kind !== "decline" && decision.kind !== "cancel") {
            // Accepting is a miscall: there is no answer to accept.
            throw new CliError("REQUEST_MISMATCH", `Request ${requestId} needs user input, not a permission decision.`, {
              details: { threadId, requestId },
            });
          }
          parkedInput.resolve({
            behavior: "deny",
            message: decision.kind === "cancel" ? "Cancelled." : "Declined.",
            ...(decision.kind === "cancel" ? { interrupt: true } : {}),
          });
          return;
        }
        throw new CliError("REQUEST_UNKNOWN", `No pending permission request ${requestId}.`, {
          details: { threadId, requestId },
        });
      }
      if (decision.kind === "accept") parked.resolve({ behavior: "allow" });
      else if (decision.kind === "acceptForSession") {
        session.sessionAllows.add(sessionAllowKey(parked.toolName));
        parked.resolve({ behavior: "allow" });
      } else if (decision.kind === "decline") parked.resolve({ behavior: "deny", message: "Declined." });
      else parked.resolve({ behavior: "deny", message: "Cancelled.", interrupt: true });
    });

  readonly respondToUserInput = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ): Effect.Effect<void, CliError> =>
    this.attempt("CLAUDE_TURN_FAILED", `Could not answer user input request ${requestId}`, async () => {
      const session = this.requireSession(threadId);
      const parked = session.parkedInputs.get(requestId);
      if (!parked || parked.threadId !== threadId) {
        throw new CliError("REQUEST_UNKNOWN", `No pending user input request ${requestId}.`, {
          details: { threadId, requestId },
        });
      }
      // `updatedInput` replaces the tool input wholesale, so the original
      // `questions` have to ride along — an input of just `{ answers }`
      // fails the tool's own schema and the turn dies on a valid answer.
      parked.resolve({ behavior: "allow", updatedInput: { ...parked.input, answers } });
    });

  // -- message pump -------------------------------------------------------

  private async pump(session: ClaudeSession): Promise<void> {
    try {
      for await (const message of session.query) {
        if (session.closed) return;
        this.handleMessage(session, message);
      }
      if (!session.closed) this.settleOpenTurn(session, "interrupted", "Session ended.");
    } catch (cause) {
      if (!session.closed) {
        const text = cause instanceof Error ? cause.message : String(cause);
        this.settleOpenTurn(session, "failed", text.slice(0, 500));
      }
    } finally {
      this.retireSession(session);
    }
  }

  /**
   * The query is an async iterator: once it finishes — normally, by error,
   * or because `interrupt()` ended it — no further prompt will ever be read
   * from `session.input`. The session used to stay in the map with
   * `closed === false`, so `hasSession` reported it live, `sendTurn` pushed
   * into a queue nobody drained, and *every* later turn on that thread hung
   * silently until it was interrupted. Retiring it here makes the next turn
   * start a fresh session, resumed from `resumable` so history survives.
   */
  private retireSession(session: ClaudeSession): void {
    if (this.sessions.get(session.threadId) !== session) return;
    session.closed = true;
    this.denyParked(session, "Session ended.");
    session.input.close();
    this.sessions.delete(session.threadId);
    this.publish({
      type: "thread.state.changed",
      provider: "claude",
      threadId: session.threadId,
      state: "session-ended",
    });
  }

  private handleMessage(session: ClaudeSession, message: SDKMessage): void {
    switch (message.type) {
      case "system":
        this.handleSystem(session, message);
        return;
      case "assistant":
        this.handleAssistant(session, message);
        return;
      case "user":
        this.handleToolResults(session, message);
        return;
      case "result":
        this.handleResult(session, message);
        return;
      case "rate_limit_event":
        this.handleRateLimit(session, message.rate_limit_info);
        return;
      default:
        return;
    }
  }

  private handleSystem(session: ClaudeSession, message: Extract<SDKMessage, { type: "system" }>): void {
    if (message.subtype === "init") {
      session.resumeSessionId = message.session_id;
      if (message.session_id) this.resumable.set(session.threadId, message.session_id);
      session.model = message.model ?? session.model;
      const account = (message as unknown as { account?: ClaudeSession["account"] }).account;
      if (account) session.account = account;
      this.publish({
        type: "thread.state.changed",
        provider: "claude",
        threadId: session.threadId,
        state: "session-started",
        raw: { sessionId: message.session_id, account: session.account, model: session.model },
      });
      void this.probeUsage(session);
      return;
    }
    if (message.subtype === "compact_boundary") {
      session.compacted = true;
      session.turnsSinceCompaction = 0;
      session.usage = emptyUsage();
      const metadata = message.compact_metadata as unknown as {
        pre_tokens?: number;
        post_tokens?: number;
      };
      this.publish({
        type: "thread.state.changed",
        provider: "claude",
        threadId: session.threadId,
        state: "compacted",
        raw: { pre_tokens: metadata.pre_tokens, post_tokens: metadata.post_tokens },
      });
    }
  }

  /**
   * The SDK reports a tool's *result* as a `user` message carrying
   * `tool_result` blocks — the only signal a call finished. Without it
   * every tool row stayed `inProgress` forever in the transcript, since
   * `tool_use` above is the only other tool event Claude produces.
   * Prompt-shaped `user` messages (plain text) are not results and pass
   * through untouched.
   */
  private handleToolResults(session: ClaudeSession, message: Extract<SDKMessage, { type: "user" }>): void {
    const open = session.transcript.find((turn) => turn.status === "running") ?? null;
    for (const block of contentBlocks(message.message as unknown)) {
      if (block["type"] !== "tool_result") continue;
      const toolUseId = block["tool_use_id"];
      if (typeof toolUseId !== "string") continue;
      // Replay the call's own name and input: the result block has neither.
      const call = session.toolUseCalls.get(toolUseId);
      session.toolUseCalls.delete(toolUseId);
      this.publish({
        type: "tool.execute.completed",
        provider: "claude",
        threadId: session.threadId,
        turnId: open?.id ?? null,
        tool: call?.name ?? "tool",
        raw: {
          toolUseId,
          input: call?.input ?? {},
          output: toolResultText(block["content"]),
          isError: block["is_error"] === true,
        },
      });
    }
  }

  private handleAssistant(session: ClaudeSession, message: Extract<SDKMessage, { type: "assistant" }>): void {
    const open = session.transcript.find((turn) => turn.status === "running") ?? null;
    const blocks = contentBlocks(message.message as unknown);
    const subagent = message.parent_tool_use_id !== null;
    for (const block of blocks) {
      if (block["type"] === "text" && typeof block["text"] === "string" && !subagent) {
        const text = block["text"] as string;
        if (open) {
          open.text += text;
          open.items.push({ kind: "assistant", text });
        }
        this.publish({
          type: "message.part.updated",
          provider: "claude",
          threadId: session.threadId,
          turnId: open?.id ?? null,
          text,
        });
      }
      if (block["type"] === "tool_use" && typeof block["id"] === "string") {
        session.toolUseThreads.set(block["id"] as string, session.threadId);
        session.lastActiveThreadId = session.threadId;
        const name = typeof block["name"] === "string" ? (block["name"] as string) : "unknown";
        const input = block["input"] !== null && typeof block["input"] === "object" && !Array.isArray(block["input"])
          ? (block["input"] as Record<string, unknown>)
          : {};
        session.toolUseCalls.set(block["id"] as string, { name, input });
        if (open) open.items.push({ kind: "tool", tool: name, text: summarizeToolInput(block["input"]) });
        this.publish({
          type: "tool.execute.started",
          provider: "claude",
          threadId: session.threadId,
          turnId: open?.id ?? null,
          tool: name,
          raw: { toolUseId: block["id"], input },
        });
      }
    }
    if (!subagent) {
      const usage = (message.message as unknown as { usage?: Parameters<typeof addFrameUsage>[1] }).usage;
      session.usage = addFrameUsage(session.usage, usage);
    }
  }

  private handleResult(session: ClaudeSession, message: Extract<SDKMessage, { type: "result" }>): void {
    if (message.subtype === "success") {
      const cost = typeof message.total_cost_usd === "number" ? message.total_cost_usd : 0;
      session.usage = { ...session.usage, costUsd: cost };
      const open = session.transcript.find((turn) => turn.status === "running");
      // A steer that arrived too late to fold into this run is queued as the
      // CLI's next run, announced here; our turn is not over until it is.
      const queued = (message as { queued_turn_count?: unknown }).queued_turn_count;
      if (open && typeof queued === "number" && queued > 0) {
        if (typeof message.result === "string" && message.result) open.text = message.result;
        return;
      }
      // `result` is the run's final answer. The streamed text blocks also
      // hold every interim note written between tool calls, so they only
      // stand in when the CLI reports no result.
      if (open && typeof message.result === "string" && message.result) {
        open.text = message.result;
      }
      this.publish({
        type: "token-usage.updated",
        provider: "claude",
        threadId: session.threadId,
        usage: {
          input: session.usage.input,
          cacheRead: session.usage.cacheRead,
          cacheCreate: session.usage.cacheCreate,
          output: session.usage.output,
          thinking: session.usage.thinking,
        },
        raw: { costUsd: cost },
      });
      this.publish({
        type: "turn.completed",
        provider: "claude",
        threadId: session.threadId,
        turnId: open?.id ?? "unknown",
      });
      this.settleOpenTurn(session, "completed", "");
      return;
    }
    const errorText = extractResultError(message);
    this.publish({
      type: "turn.failed",
      provider: "claude",
      threadId: session.threadId,
      turnId: session.transcript.find((turn) => turn.status === "running")?.id ?? "unknown",
      raw: { subtype: message.subtype, error: errorText },
    });
    this.settleOpenTurn(session, "failed", errorText);
  }

  private handleRateLimit(session: ClaudeSession, info: SDKRateLimitInfo | undefined): void {
    if (!info) return;
    const { windows, blocked, rateLimitType } = mapRateLimitEvent(info);
    this.publish({
      type: "rate-limits.updated",
      provider: "claude",
      threadId: session.threadId,
      windows,
      raw: { rateLimitType, status: info.status },
    });
    if (!blocked) return;
    const open = session.transcript.find((turn) => turn.status === "running");
    if (!open) return;
    const resetsAt = windows[0]?.resetsAt ?? null;
    const key = `${rateLimitType}:${resetsAt ?? "unknown"}`;
    const announced = session.announcedRateLimits.get(open.id) ?? new Set<string>();
    if (announced.has(key)) return;
    announced.add(key);
    session.announcedRateLimits.set(open.id, announced);
    this.publish({
      type: "thread.state.changed",
      provider: "claude",
      threadId: session.threadId,
      state: "rate-limited",
      raw: {
        rateLimitType,
        resetsAt,
        notice: describePauseUntil(resetsAt, Date.now()) ?? "paused",
      },
    });
  }

  private async probeUsage(session: ClaudeSession): Promise<void> {
    try {
      // Method call (not detached): control methods may rely on `this`.
      const query = session.query;
      if (typeof query.usageExperimental !== "function") return;
      const response = (await Promise.race([
        query.usageExperimental({ skipBehaviors: true }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("usage probe timed out")), this.usageProbeTimeoutMs);
        }),
      ])) as Parameters<typeof mapUsageProbe>[0];
      if (session.closed) return;
      const mapped = mapUsageProbe(response);
      if (!mapped.available) return;
      this.publish({
        type: "rate-limits.updated",
        provider: "claude",
        threadId: session.threadId,
        windows: mapped.windows.map((window) => ({
          id: window.id,
          label: window.label,
          resetsAt: window.resetsAt,
          exhausted: window.usedPercent >= 100,
        })),
        raw: { subscriptionType: mapped.subscriptionType, costUsd: mapped.costUsd },
      });
    } catch {
      // Best effort: stream events still carry live windows.
    }
  }

  // -- state ---------------------------------------------------------------

  readonly readThread = (threadId: ThreadId): Effect.Effect<ProviderThreadSnapshot, CliError> =>
    this.attempt("CLAUDE_TURN_FAILED", `Could not read thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      return {
        threadId,
        turns: session.transcript.map((turn) => ({
          id: turn.id,
          items: turn.items.map((item) => ({ ...item })),
        })),
      };
    });

  readonly rollbackThread = (
    threadId: ThreadId,
    numTurns: number,
  ): Effect.Effect<ProviderThreadSnapshot, CliError> =>
    this.attempt("ROLLBACK_FAILED", `Could not roll back thread ${threadId}`, async () => {
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        throw new CliError("INVALID_ROLLBACK", "numTurns must be an integer >= 1.", {
          details: { threadId, numTurns },
        });
      }
      const session = this.requireSession(threadId);
      const sessionId = session.resumeSessionId;
      if (!sessionId) {
        throw new CliError("ROLLBACK_UNAVAILABLE", "The Claude session id is unavailable.", {
          details: { threadId },
        });
      }
      if (session.compacted && numTurns > session.turnsSinceCompaction) {
        throw new CliError(
          "ROLLBACK_UNAVAILABLE",
          "Turn boundaries before the last compaction are gone; cannot roll back that far.",
          { details: { threadId, numTurns } },
        );
      }
      const history = await this.sessionApi.getSessionMessages(sessionId);
      const boundaries = history.filter(isPromptSessionMessage);
      if (boundaries.length < numTurns) {
        throw new CliError("ROLLBACK_UNAVAILABLE", "Not enough turn boundaries in history.", {
          details: { threadId, numTurns, boundaries: boundaries.length },
        });
      }
      // The first prompt to drop, and the fork point just before it:
      // `upToMessageId` is inclusive, so forking *at* the prompt kept it.
      const target = boundaries[boundaries.length - numTurns]!;
      const keepThrough = history[history.indexOf(target) - 1];
      // Nothing before it: the rolled-back conversation is empty, which is
      // a fresh session rather than a fork.
      const forked = keepThrough ? await this.sessionApi.forkSession(sessionId, keepThrough.uuid) : null;
      await this.closeSession(session, "session-forked");
      if (forked) this.resumable.set(threadId, forked.sessionId);
      else this.resumable.delete(threadId);
      const next: ClaudeSession = {
        ...session,
        query: undefined as unknown as ClaudeQuery,
        input: new PromptQueue(),
        closed: false,
        resumeSessionId: forked?.sessionId ?? null,
        transcript: session.transcript.slice(0, Math.max(0, session.transcript.length - numTurns)),
        waiters: new Map(),
        parkedPermissions: new Map(),
        parkedInputs: new Map(),
        turnsSinceCompaction: Math.max(0, session.turnsSinceCompaction - numTurns),
        announcedRateLimits: new Map(),
      };
      next.query = this.resumeQuery(next);
      this.sessions.set(threadId, next);
      void this.pump(next);
      return {
        threadId,
        turns: next.transcript.map((turn) => ({
          id: turn.id,
          items: turn.items.map((item) => ({ ...item })),
        })),
      };
    });

  private resumeQuery(session: ClaudeSession): ClaudeQuery {
    const stringEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      makeClaudeEnv({ homePath: this.settings.homePath }, this.baseEnv),
    )) {
      if (typeof value === "string") stringEnv[key] = value;
    }
    return this.transport.query(session.input, {
      cwd: session.workingDirectory,
      ...(session.model ? { model: session.model } : {}),
      permissionMode: session.basePermissionMode,
      ...(needsAllowDangerouslySkipPermissions(session.basePermissionMode)
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      env: stringEnv,
      pathToClaudeCodeExecutable: resolveClaudeExecutable(this.settings.binaryPath, this.baseEnv),
      ...(session.resumeSessionId ? { resume: session.resumeSessionId } : {}),
      canUseTool: this.handlePermissionRequest,
    });
  }

  // -- plan mode helper ------------------------------------------------------

  /** Live permission-mode switch (plan mode); outside the SPI, used by the TUI. */
  readonly setInteractionMode = (
    threadId: ThreadId,
    interactionMode: InteractionMode,
  ): Effect.Effect<void, CliError> =>
    this.attempt("CLAUDE_TURN_FAILED", `Could not switch interaction mode on thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      if (interactionMode === "plan") {
        await session.query.setPermissionMode("plan");
      } else {
        await session.query.setPermissionMode(session.basePermissionMode);
      }
      session.interactionMode = interactionMode;
    });

  /** Test hook: resolved home dir for the current settings (never touches HOME). */
  resolvedHomeForTests(): string {
    return resolveClaudeHomePath(this.settings.homePath, this.baseEnv);
  }
}

function summarizeToolInput(input: unknown): string {
  if (typeof input === "string") return input.slice(0, 200);
  try {
    return JSON.stringify(input)?.slice(0, 200) ?? "";
  } catch {
    return "";
  }
}

function extractPlan(input: Record<string, unknown>): string | null {
  const plan = input["plan"];
  return typeof plan === "string" ? plan : null;
}

function extractResultError(message: Extract<SDKMessage, { type: "result" }>): string {
  if (message.subtype === "success") return "";
  const record = message as unknown as Record<string, unknown>;
  for (const key of ["error", "message", "detail"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 500);
  }
  return `Claude run failed (${message.subtype}).`;
}

/** `SDKControlGetContextUsageResponse` → `ContextWindowUsage`; null when it names no token count. */
export function claudeContextUsageOf(raw: unknown): ContextWindowUsage | null {
  const record = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (record === null || typeof record["totalTokens"] !== "number") return null;
  const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const apiUsage = record["apiUsage"] !== null && typeof record["apiUsage"] === "object"
    ? (record["apiUsage"] as Record<string, unknown>)
    : null;
  return {
    usedTokens: record["totalTokens"],
    maxTokens: number(record["maxTokens"]),
    cachedInputTokens: apiUsage ? number(apiUsage["cache_read_input_tokens"]) : null,
    autoCompactThreshold: number(record["autoCompactThreshold"]),
    compactsAutomatically: typeof record["isAutoCompactEnabled"] === "boolean" ? record["isAutoCompactEnabled"] : null,
  };
}

/**
 * moxen's MCP servers as the SDK's `mcpServers` record. The CLI loads
 * them alongside the user's own (`dynamic` scope), so nothing the user
 * configured in Claude Code is displaced.
 */
function claudeMcpServers(servers: readonly McpServerSpec[]): Record<string, McpServerConfig> {
  return Object.fromEntries(
    servers.map((server): [string, McpServerConfig] =>
      server.type === "http"
        ? [server.name, { type: "http", url: server.url, headers: { ...server.headers } }]
        : [server.name, { type: "stdio", command: server.command, args: [...server.args], env: { ...server.env } }],
    ),
  );
}
