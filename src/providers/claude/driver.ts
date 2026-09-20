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
 * See DECOUPLE.md §5.
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
import type { InteractionMode, RuntimeMode } from "../../types.js";
import type {
  ApprovalRequestId,
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
  toolUseThreads: Map<string, ThreadId>;
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

class PromptQueue {
  private pending: string[] = [];
  private takers: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  closed = false;

  push(text: string): void {
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    };
    const taker = this.takers.shift();
    if (taker) taker({ value: message, done: false });
    else this.pending.push(text);
  }

  close(): void {
    this.closed = true;
    for (const taker of this.takers.splice(0)) taker({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: async (): Promise<IteratorResult<SDKUserMessage>> => {
        const text = this.pending.shift();
        if (text !== undefined) {
          return {
            value: {
              type: "user",
              message: { role: "user", content: [{ type: "text", text }] },
              parent_tool_use_id: null,
            },
            done: false,
          };
        }
        if (this.closed) return { value: undefined, done: true };
        return await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.takers.push(resolve);
        });
      },
    };
  }
}

function toCliError(code: string, message: string, cause: unknown): CliError {
  if (cause instanceof CliError) return cause;
  const text = cause instanceof Error ? cause.message : String(cause);
  if (isClaudeAuthErrorText(text)) {
    return new CliError("CLAUDE_AUTH_REQUIRED", claudeSignedOutMessage({ cwd: process.cwd() }), {
      cause,
    });
  }
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
        toolUseThreads: new Map(),
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
      session.query = this.transport.query(session.input, {
        cwd: input.workingDirectory,
        ...(session.model ? { model: session.model } : {}),
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
      } else if (input.interactionMode === "default") {
        await session.query.setPermissionMode(session.basePermissionMode);
        session.interactionMode = "default";
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
      session.input.push(input.prompt);
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
    // ExitPlanMode is captured as a proposed plan, then denied so the CLI
    // does not actually exit plan mode on our behalf.
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
        raw: { toolName, input },
      });
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
      parked.resolve({ behavior: "allow", updatedInput: { answers } });
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
    }
  }

  private handleMessage(session: ClaudeSession, message: SDKMessage): void {
    switch (message.type) {
      case "system":
        this.handleSystem(session, message);
        return;
      case "assistant":
        this.handleAssistant(session, message);
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
        if (open) open.items.push({ kind: "tool", tool: name, text: summarizeToolInput(block["input"]) });
        this.publish({
          type: "tool.execute.started",
          provider: "claude",
          threadId: session.threadId,
          turnId: open?.id ?? null,
          tool: name,
          raw: { toolUseId: block["id"], input: block["input"] },
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
      if (open && !open.text && typeof message.result === "string") open.text = message.result;
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
      const target = boundaries[boundaries.length - numTurns]!;
      const forked = await this.sessionApi.forkSession(sessionId, target.uuid);
      await this.closeSession(session, "session-forked");
      const next: ClaudeSession = {
        ...session,
        query: undefined as unknown as ClaudeQuery,
        input: new PromptQueue(),
        closed: false,
        resumeSessionId: forked.sessionId,
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
