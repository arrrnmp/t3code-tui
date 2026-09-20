/**
 * Grok driver: `ProviderAdapter` over `grok agent stdio` via ACP. Thin by
 * design: one ACP session per thread, prompts per turn, parked permission
 * round-trips with allow_always→allow_once fallback, fork-less operation
 * (rollback explicitly unsupported), delegated `/compact`, a stall
 * watchdog, and a billing-probe usage window. Auth is the CLI login or
 * `XAI_API_KEY` — never our own OAuth. See DECOUPLE.md §7.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { CliError } from "../../errors.js";
import type { InteractionMode, ModelSelection, RuntimeMode } from "../../types.js";
import { JsonRpcPeer } from "../stdio.js";
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
  TokenUsageDelta,
  TurnId,
} from "../spi.js";
import {
  AcpClient,
  compactCommandFromMeta,
  readModelState,
  type AcpModelState,
  type AcpPermissionRequest,
} from "./acp.js";
import {
  GROK_DEFAULT_MODEL_SLUG,
  grokSignedOutMessage,
  isGrokAuthErrorText,
  normalizeGrokReasoningEffort,
  normalizeGrokSettings,
  resolveGrokModelId,
  type GrokSettings,
} from "./config.js";
import {
  readPermissionOptions,
  selectGrokPermissionOptionId,
  selectGrokRejectOptionId,
} from "./permissions.js";
import { SpawnGrokTransport, type GrokTransport } from "./transport.js";
import { probeGrokBilling } from "./usage.js";

export interface GrokDriverOptions {
  readonly settings?: Partial<GrokSettings>;
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: GrokTransport;
  readonly initializeTimeoutMs?: number;
  readonly billingProbe?: () => Promise<{ id: "subscription"; label: string; usedPercent: number; resetsAt: string | null; exhausted: boolean } | null>;
}

export type GrokTurnStatus = "completed" | "failed" | "interrupted";

export interface GrokTurnOutcome {
  readonly status: GrokTurnStatus;
  readonly text: string;
  readonly usage: TokenUsageDelta;
  readonly error: string | null;
}

interface TranscriptItem {
  readonly kind: "user" | "assistant" | "thought" | "tool";
  readonly text: string;
  readonly tool?: string;
}

interface TranscriptTurn {
  readonly id: TurnId;
  readonly prompt: string;
  readonly items: TranscriptItem[];
  status: "running" | GrokTurnStatus;
  text: string;
  error: string | null;
}

interface ParkedPermission {
  readonly threadId: ThreadId;
  readonly toolKey: string;
  readonly options: Array<{ optionId: string; kind: string }>;
  readonly resolve: (answer: { outcome: "selected"; optionId: string } | { outcome: "cancelled" }) => void;
}

interface ParkedInput {
  readonly threadId: ThreadId;
  readonly resolve: (answers: ProviderUserInputAnswers) => void;
  readonly reject: (cause: unknown) => void;
}

interface GrokSession {
  readonly threadId: ThreadId;
  acpSessionId: string | null;
  readonly peer: JsonRpcPeer;
  readonly acp: AcpClient;
  readonly workingDirectory: string;
  closed: boolean;
  runtimeMode: RuntimeMode;
  model: string | null;
  reasoningEffort?: string | undefined;
  models: AcpModelState | null;
  transcript: TranscriptTurn[];
  waiters: Map<TurnId, Array<{ resolve: (outcome: GrokTurnOutcome) => void; reject: (cause: unknown) => void }>>;
  parkedPermissions: Map<string, ParkedPermission>;
  parkedInputs: Map<string, ParkedInput>;
  sessionAllows: Set<string>;
  promptsInFlight: number;
  lastActivityAt: number;
  lastToolAt: number | null;
  toolInFlight: boolean;
  compactCommand: string;
  usage: TokenUsageDelta;
  startedAt: string;
}

const SILENT_STALL_MS = 10 * 60_000;
const ACTIVE_TOOL_STALL_MS = 30 * 60_000;
const STALL_CHECK_INTERVAL_MS = 60_000;

function toCliError(code: string, message: string, cause: unknown): CliError {
  const text = cause instanceof Error ? cause.message : String(cause);
  if (isGrokAuthErrorText(text)) {
    return new CliError("GROK_AUTH_REQUIRED", grokSignedOutMessage(), { cause });
  }
  if (cause instanceof CliError) return cause;
  return new CliError(code, `${message}: ${text.slice(0, 200)}`, { cause });
}

function toolKeyOf(toolCall: { title?: string; kind?: string; toolCallId: string }): string {
  return toolCall.title || toolCall.kind || toolCall.toolCallId || "unknown-tool";
}

function usageOfResponse(value: unknown): TokenUsageDelta {
  const record =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const num = (keys: string[]): number => {
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    }
    return 0;
  };
  return {
    input: num(["inputTokens", "input_tokens"]),
    cacheRead: num(["cacheReadInputTokens", "cache_read_input_tokens"]),
    cacheCreate: num(["cacheCreationInputTokens", "cache_creation_input_tokens"]),
    output: num(["outputTokens", "output_tokens"]),
    thinking: num(["thinkingTokens", "thinking_tokens"]),
  };
}

export class GrokDriver implements ProviderAdapter<CliError> {
  readonly provider = "grok" as const;
  readonly capabilities: ProviderAdapterCapabilities = {
    sessionModelSwitch: "in-session",
    supportsConversationRollback: false,
  };
  readonly compaction = { type: "slash-command" as const, command: "/compact" as const };

  private readonly settings: GrokSettings;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly transport: GrokTransport;
  private readonly initializeTimeoutMs: number;
  private readonly sessions = new Map<ThreadId, GrokSession>();
  private readonly queue = Effect.runSync(Queue.unbounded<ProviderRuntimeEvent>());
  private stallTimer: ReturnType<typeof setInterval> | null = null;
  private readonly billingProbe: () => Promise<{ id: "subscription"; label: string; usedPercent: number; resetsAt: string | null; exhausted: boolean } | null>;

  constructor(options: GrokDriverOptions = {}) {
    this.settings = normalizeGrokSettings(options.settings);
    this.baseEnv = options.env ?? process.env;
    this.transport = options.transport ?? new SpawnGrokTransport();
    this.initializeTimeoutMs = options.initializeTimeoutMs ?? 8000;
    this.billingProbe = options.billingProbe ?? (() => probeGrokBilling({ env: this.baseEnv }));
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

  private requireSession(threadId: ThreadId): GrokSession {
    const session = this.sessions.get(threadId);
    if (!session || session.closed) {
      throw new CliError("GROK_NOT_STARTED", `No Grok session exists for thread ${threadId}.`, {
        details: { threadId },
      });
    }
    return session;
  }

  // -- session lifecycle ---------------------------------------------------

  readonly startSession = (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, CliError> =>
    this.attempt("GROK_SPAWN_FAILED", `Could not start a Grok session for thread ${input.threadId}`, async () => {
      const existing = this.sessions.get(input.threadId);
      if (existing && !existing.closed) return this.describeSession(existing);
      if (existing) this.sessions.delete(input.threadId);

      const peer = this.transport.startPeer({
        settings: this.settings,
        env: this.baseEnv,
        cwd: input.workingDirectory,
        runtimeMode: input.runtimeMode ?? "full-access",
      });
      const acp = new AcpClient(peer);
      const session: GrokSession = {
        threadId: input.threadId,
        acpSessionId: null,
        peer,
        acp,
        workingDirectory: input.workingDirectory,
        closed: false,
        runtimeMode: input.runtimeMode ?? "full-access",
        model: input.modelSelection?.model ?? GROK_DEFAULT_MODEL_SLUG,
        reasoningEffort: undefined,
        models: null,
        transcript: [],
        waiters: new Map(),
        parkedPermissions: new Map(),
        parkedInputs: new Map(),
        sessionAllows: new Set(),
        promptsInFlight: 0,
        lastActivityAt: Date.now(),
        lastToolAt: null,
        toolInFlight: false,
        compactCommand: "/compact",
        usage: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0 },
        startedAt: new Date().toISOString(),
      };
      acp.onPermissionRequest((request) => this.onPermissionRequest(session, request));
      acp.onUpdate((update) => {
        if (update.sessionId === session.acpSessionId) this.onSessionUpdate(session, update.update);
      });
      acp.onCustomRequest("_x.ai/ask_user_question", (params) => this.onAskUserQuestion(session, params));
      peer.onExit(() => {
        if (!session.closed) {
          session.closed = true;
          this.settleOpenTurn(session, "failed", "The Grok process exited.");
          this.sessions.delete(session.threadId);
        }
      });
      this.sessions.set(input.threadId, session);
      try {
        // initialize() is warning-only per the reference: a timeout still
        // yields a usable session; a hard failure does not.
        let meta: unknown = null;
        try {
          const init = await Promise.race([
            acp.initialize(),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("initialize timed out")), this.initializeTimeoutMs);
            }),
          ]);
          meta = init._meta;
        } catch (cause) {
          const text = cause instanceof Error ? cause.message : String(cause);
          if (!/timed out/i.test(text)) throw cause;
        }
        session.compactCommand = compactCommandFromMeta(meta) ?? "/compact";
        const created = await acp.newSession(input.workingDirectory);
        session.acpSessionId = created.sessionId;
        session.models = created.models;
        const current = created.models?.currentModelId;
        if (current) session.model = current;
        void this.probeBilling(session);
        this.ensureStallWatchdog();
        return this.describeSession(session);
      } catch (cause) {
        session.closed = true;
        this.sessions.delete(session.threadId);
        try {
          peer.close();
        } catch {
          // Best effort.
        }
        throw cause;
      }
    });

  private describeSession(session: GrokSession): ProviderSession {
    return {
      threadId: session.threadId,
      provider: "grok",
      workingDirectory: session.workingDirectory,
      startedAt: session.startedAt,
    };
  }

  private async probeBilling(session: GrokSession): Promise<void> {
    try {
      const window = await this.billingProbe();
      if (!window || session.closed) return;
      this.publish({
        type: "rate-limits.updated",
        provider: "grok",
        threadId: session.threadId,
        windows: [
          { id: window.id, label: window.label, resetsAt: window.resetsAt, exhausted: window.exhausted },
        ],
        raw: { usedPercent: window.usedPercent },
      });
    } catch {
      // Best effort: unavailable on API-key/custom deployments by design.
    }
  }

  readonly stopSession = (threadId: ThreadId): Effect.Effect<void, CliError> =>
    this.attempt("GROK_SPAWN_FAILED", `Could not stop the Grok session for thread ${threadId}`, async () => {
      const session = this.sessions.get(threadId);
      if (!session) return;
      await this.closeSession(session, "session-stopped");
    });

  readonly stopAll = (): Effect.Effect<void, CliError> =>
    this.attempt("GROK_SPAWN_FAILED", "Could not stop Grok sessions", async () => {
      for (const session of [...this.sessions.values()]) {
        await this.closeSession(session, "session-stopped");
      }
      this.stopStallWatchdog();
    });

  private async closeSession(session: GrokSession, reason: string): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    this.denyParked(session, "Session ended.");
    if (session.acpSessionId) {
      try {
        session.peer.notify("session/close", { sessionId: session.acpSessionId });
      } catch {
        // Best effort.
      }
    }
    try {
      session.peer.close();
    } catch {
      // Best effort.
    }
    this.sessions.delete(session.threadId);
    if (this.sessions.size === 0) this.stopStallWatchdog();
    this.publish({
      type: "thread.state.changed",
      provider: "grok",
      threadId: session.threadId,
      state: reason,
    });
  }

  readonly listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
    Effect.succeed([...this.sessions.values()].map((session) => this.describeSession(session)));

  readonly hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
    Effect.succeed(this.sessions.has(threadId));

  // -- turns -----------------------------------------------------------------

  readonly sendTurn = (input: ProviderSendTurnInput): Effect.Effect<ProviderTurnStartResult, CliError> =>
    this.attempt("GROK_TURN_FAILED", `Could not send a turn on thread ${input.threadId}`, async () => {
      const session = this.requireSession(input.threadId);
      if (!session.acpSessionId) {
        throw new CliError("GROK_NOT_STARTED", `The Grok session for thread ${input.threadId} is not ready.`, {
          details: { threadId: input.threadId },
        });
      }
      const open = session.transcript.find((turn) => turn.status === "running");
      if (open) {
        throw new CliError("TURN_BUSY", `Thread ${input.threadId} already has a running turn.`, {
          details: { threadId: input.threadId, turnId: open.id },
        });
      }
      const requestedModel = resolveGrokModelId(input.modelSelection?.model ?? session.model);
      if (requestedModel && requestedModel !== session.model) {
        const applied = await session.acp.setModel(session.acpSessionId, requestedModel);
        if (applied) session.model = requestedModel;
      }
      const options = input.modelSelection?.options ?? [];
      const effortRaw = options.find(
        (option) => (option.id === "reasoningEffort" || option.id === "effort") && typeof option.value === "string",
      )?.value as string | undefined;
      const effort = normalizeGrokReasoningEffort(effortRaw);
      if (effort && effort !== session.reasoningEffort && session.model) {
        const applied = await session.acp.setModel(session.acpSessionId, session.model, {
          reasoningEffort: effort,
        });
        if (applied) session.reasoningEffort = effort;
      }
      const turn: TranscriptTurn = {
        id: randomUUID(),
        prompt: input.prompt,
        items: [{ kind: "user", text: input.prompt }],
        status: "running",
        text: "",
        error: null,
      };
      session.transcript.push(turn);
      session.promptsInFlight += 1;
      session.lastActivityAt = Date.now();
      try {
        // Attachments beyond text are a follow-up; other files travel as
        // prompt path text in this version.
        const response = await session.acp.prompt(session.acpSessionId, [
          { type: "text", text: input.prompt },
        ]);
        session.lastActivityAt = Date.now();
        const usage = usageOfResponse(response.usage);
        session.usage = {
          input: session.usage.input + usage.input,
          cacheRead: session.usage.cacheRead + usage.cacheRead,
          cacheCreate: session.usage.cacheCreate + usage.cacheCreate,
          output: session.usage.output + usage.output,
          thinking: session.usage.thinking + usage.thinking,
        };
        this.publish({
          type: "token-usage.updated",
          provider: "grok",
          threadId: session.threadId,
          usage: { ...session.usage },
        });
        if (response.stopReason === "end_turn") this.settleOpenTurn(session, "completed", "");
        else if (response.stopReason === "cancelled") this.settleOpenTurn(session, "interrupted", "Cancelled.");
        else this.settleOpenTurn(session, "failed", `Grok stopped the turn (${response.stopReason}).`);
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : String(cause);
        this.settleOpenTurn(session, "failed", text.slice(0, 500));
        throw cause;
      } finally {
        session.promptsInFlight = Math.max(0, session.promptsInFlight - 1);
      }
      return { threadId: session.threadId, turnId: turn.id };
    });

  readonly interruptTurn = (threadId: ThreadId, _turnId?: TurnId): Effect.Effect<void, CliError> =>
    this.attempt("GROK_TURN_FAILED", `Could not interrupt the turn on thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      // ACP requires pending permission requests to settle as cancelled
      // when the turn is cancelled; the CLI enforces this ordering.
      this.denyParked(session, "Interrupted.");
      if (session.acpSessionId) session.acp.cancel(session.acpSessionId);
      this.settleOpenTurn(session, "interrupted", "Interrupted.");
    });

  async awaitTurn(threadId: ThreadId, turnId: TurnId, signal?: AbortSignal): Promise<GrokTurnOutcome> {
    const session = this.requireSession(threadId);
    const turn = session.transcript.find((candidate) => candidate.id === turnId);
    if (!turn) {
      throw new CliError("TURN_NOT_FOUND", `No turn exists with id ${turnId}.`, {
        details: { threadId, turnId },
      });
    }
    if (turn.status !== "running") {
      return { status: turn.status, text: turn.text, usage: { ...session.usage }, error: turn.error };
    }
    if (signal?.aborted === true) {
      throw new CliError("TURN_ABORTED", `Turn ${turnId} was aborted before settling.`, {
        details: { threadId, turnId },
      });
    }
    return await new Promise<GrokTurnOutcome>((resolve, reject) => {
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

  private settleOpenTurn(session: GrokSession, status: GrokTurnStatus, detail: string): void {
    const open = session.transcript.find((turn) => turn.status === "running");
    if (open) {
      open.status = status;
      open.error = status === "completed" ? null : detail;
      if (status !== "completed") open.text = open.text || detail;
    }
    const waiters = open ? (session.waiters.get(open.id) ?? []) : [];
    if (open) session.waiters.delete(open.id);
    const outcome: GrokTurnOutcome = {
      status,
      text: open?.text ?? "",
      usage: { ...session.usage },
      error: open?.error ?? detail,
    };
    for (const waiter of waiters) waiter.resolve(outcome);
    if (open) {
      this.publish({
        type: status === "completed" ? "turn.completed" : status === "failed" ? "turn.failed" : "turn.interrupted",
        provider: "grok",
        threadId: session.threadId,
        turnId: open.id,
        ...(status === "failed" ? { raw: { error: open.error } } : {}),
      });
    }
  }

  // -- permissions ---------------------------------------------------------------

  private onPermissionRequest(
    session: GrokSession,
    request: { sessionId: string; toolCall: { toolCallId: string; title?: string; kind?: string; rawInput?: unknown }; options: Array<{ optionId: string; kind: string; name?: string }> },
  ): Promise<{ outcome: "selected"; optionId: string } | { outcome: "cancelled" }> {
    if (request.sessionId !== session.acpSessionId) {
      return Promise.resolve({ outcome: "cancelled" });
    }
    const toolKey = toolKeyOf(request.toolCall);
    // full-access and session-approved tools auto-approve.
    if (session.runtimeMode === "full-access" || session.sessionAllows.has(toolKey)) {
      const optionId = selectGrokPermissionOptionId(readPermissionOptions(request.options), "accept");
      if (optionId) return Promise.resolve({ outcome: "selected", optionId });
    }
    const requestId = randomUUID();
    this.publish({
      type: "permission.request.opened",
      provider: "grok",
      threadId: session.threadId,
      requestId,
      raw: { toolCall: request.toolCall, options: request.options },
    });
    return new Promise((resolve) => {
      session.parkedPermissions.set(requestId, {
        threadId: session.threadId,
        toolKey,
        options: readPermissionOptions(request.options),
        resolve,
      });
    });
  }

  private denyParked(session: GrokSession, _message: string): void {
    for (const [requestId, parked] of [...session.parkedPermissions]) {
      session.parkedPermissions.delete(requestId);
      parked.resolve({ outcome: "cancelled" });
    }
    for (const [requestId, parked] of [...session.parkedInputs]) {
      session.parkedInputs.delete(requestId);
      parked.reject(new CliError("TURN_ABORTED", "Interrupted."));
    }
  }

  readonly respondToRequest = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ): Effect.Effect<void, CliError> =>
    this.attempt("GROK_TURN_FAILED", `Could not answer permission request ${requestId}`, async () => {
      const session = this.requireSession(threadId);
      const parked = session.parkedPermissions.get(requestId);
      if (!parked || parked.threadId !== threadId) {
        throw new CliError("REQUEST_UNKNOWN", `No pending permission request ${requestId}.`, {
          details: { threadId, requestId },
        });
      }
      session.parkedPermissions.delete(requestId);
      const options = parked.options;
      this.publish({
        type: "permission.request.resolved",
        provider: "grok",
        threadId,
        requestId,
        raw: { decision: decision.kind },
      });
      if (decision.kind === "cancel") {
        parked.resolve({ outcome: "cancelled" });
        return;
      }
      if (decision.kind === "decline") {
        const rejectId = selectGrokRejectOptionId(options);
        parked.resolve(rejectId ? { outcome: "selected", optionId: rejectId } : { outcome: "cancelled" });
        return;
      }
      if (decision.kind === "acceptForSession") session.sessionAllows.add(parked.toolKey);
      const optionId = selectGrokPermissionOptionId(
        options,
        decision.kind === "acceptForSession" ? "acceptForSession" : "accept",
      );
      parked.resolve(optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" });
    });

  private onAskUserQuestion(session: GrokSession, params: unknown): Promise<unknown> {
    const requestId = randomUUID();
    this.publish({
      type: "user-input.request.opened",
      provider: "grok",
      threadId: session.threadId,
      requestId,
      raw: { method: "_x.ai/ask_user_question", params },
    });
    return new Promise<unknown>((resolve, reject) => {
      session.parkedInputs.set(requestId, {
        threadId: session.threadId,
        resolve: (answers) => {
          session.parkedInputs.delete(requestId);
          this.publish({
            type: "user-input.request.resolved",
            provider: "grok",
            threadId: session.threadId,
            requestId,
            raw: { method: "_x.ai/ask_user_question" },
          });
          resolve({ answers });
        },
        reject: (cause) => {
          session.parkedInputs.delete(requestId);
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        },
      });
    });
  }

  readonly respondToUserInput = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ): Effect.Effect<void, CliError> =>
    this.attempt("GROK_TURN_FAILED", `Could not answer user input request ${requestId}`, async () => {
      const session = this.requireSession(threadId);
      const parked = session.parkedInputs.get(requestId);
      if (!parked || parked.threadId !== threadId) {
        throw new CliError("REQUEST_UNKNOWN", `No pending user input request ${requestId}.`, {
          details: { threadId, requestId },
        });
      }
      parked.resolve(answers);
    });

  // -- updates ---------------------------------------------------------------------

  private onSessionUpdate(session: GrokSession, update: { sessionUpdate: string; [key: string]: unknown }): void {
    session.lastActivityAt = Date.now();
    const open = session.transcript.find((turn) => turn.status === "running") ?? null;
    const content = update["content"] as Record<string, unknown> | undefined;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = content && typeof content["text"] === "string" ? (content["text"] as string) : null;
        if (text && open) {
          open.text += text;
          open.items.push({ kind: "assistant", text });
        }
        if (text) {
          this.publish({
            type: "message.part.updated",
            provider: "grok",
            threadId: session.threadId,
            turnId: open?.id ?? null,
            text,
          });
        }
        return;
      }
      case "agent_thought_chunk": {
        const text = content && typeof content["text"] === "string" ? (content["text"] as string) : null;
        if (text && open) open.items.push({ kind: "thought", text });
        return;
      }
      case "tool_call": {
        const title =
          (typeof update["title"] === "string" && (update["title"] as string)) ||
          (typeof update["kind"] === "string" && (update["kind"] as string)) ||
          "tool";
        session.toolInFlight = true;
        session.lastToolAt = Date.now();
        if (open) open.items.push({ kind: "tool", tool: title, text: title });
        this.publish({
          type: "tool.execute.started",
          provider: "grok",
          threadId: session.threadId,
          turnId: open?.id ?? null,
          tool: title,
          raw: update,
        });
        return;
      }
      case "tool_call_update": {
        const status = update["status"];
        session.lastToolAt = Date.now();
        if (status === "completed" || status === "failed") session.toolInFlight = false;
        this.publish({
          type: status === "failed" ? "tool.execute.completed" : "tool.execute.updated",
          provider: "grok",
          threadId: session.threadId,
          turnId: open?.id ?? null,
          tool: "tool",
          raw: update,
        });
        return;
      }
      case "plan": {
        this.publish({
          type: "turn.plan.updated",
          provider: "grok",
          threadId: session.threadId,
          turnId: open?.id ?? null,
          raw: update,
        });
        return;
      }
      case "current_mode_update": {
        return;
      }
      default:
        return;
    }
  }

  // -- stall watchdog ------------------------------------------------------------------

  /**
   * Fail turns stalled past budget: 10 minutes of silence, or 30 minutes
   * without tool progress while a tool runs (tool output extends the
   * silence budget). Called on an interval in production, directly in tests.
   */
  checkStalls(nowMs: number): void {
    for (const session of this.sessions.values()) {
      if (session.closed) continue;
      const open = session.transcript.find((turn) => turn.status === "running");
      if (!open) continue;
      const deadline =
        session.toolInFlight && session.lastToolAt !== null
          ? session.lastToolAt + ACTIVE_TOOL_STALL_MS
          : session.lastActivityAt + SILENT_STALL_MS;
      if (nowMs <= deadline) continue;
      this.settleOpenTurn(
        session,
        "failed",
        session.toolInFlight
          ? "Stalled: tool ran 30 minutes without progress."
          : "Stalled: no agent output for 10 minutes.",
      );
    }
  }

  private ensureStallWatchdog(): void {
    if (this.stallTimer) return;
    this.stallTimer = setInterval(() => this.checkStalls(Date.now()), STALL_CHECK_INTERVAL_MS);
    const timer = this.stallTimer as unknown as { unref?: unknown };
    if (typeof timer.unref === "function") (timer as unknown as { unref(): void }).unref();
  }

  private stopStallWatchdog(): void {
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
  }

  // -- state -------------------------------------------------------------------------------

  readonly readThread = (threadId: ThreadId): Effect.Effect<ProviderThreadSnapshot, CliError> =>
    this.attempt("GROK_TURN_FAILED", `Could not read thread ${threadId}`, async () => {
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
      this.requireSession(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        throw new CliError("INVALID_ROLLBACK", "numTurns must be an integer >= 1.", {
          details: { threadId, numTurns },
        });
      }
      throw new CliError(
        "ROLLBACK_UNAVAILABLE",
        "Grok ACP sessions do not support provider-side rollback yet.",
        { details: { threadId, numTurns } },
      );
    });

  /** Models from the last session setup, else a `grok models` probe parse. */
  async listModels(threadId: ThreadId): Promise<ReadonlyArray<{ id: string; reasoningEffort?: string }>> {
    const session = this.requireSession(threadId);
    const models = session.models?.availableModels ?? [];
    if (models.length > 0) {
      return models.map((model) => ({
        id: model.modelId,
        ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
      }));
    }
    return await probeGrokModels(this.settings.binaryPath);
  }

  currentModelId(threadId: ThreadId): string | null {
    return this.requireSession(threadId).model;
  }
}

/** Parse `grok models` stdout heuristically (format is CLI-owned). */
export async function probeGrokModels(binaryPath: string, timeoutMs = 8000): Promise<ReadonlyArray<{ id: string }>> {
  const output = await new Promise<string>((resolve) => {
    execFile(binaryPath, ["models"], { timeout: timeoutMs }, (error, stdout) => {
      resolve(error ? "" : String(stdout ?? ""));
    });
  });
  return output
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().includes("model"))
    .map((id) => ({ id }));
}

/** Test hook: read a session's model state without touching the wire. */
export function grokModelStateForTests(
  driver: GrokDriver,
  threadId: ThreadId,
): { model: string | null; models: AcpModelState | null } {
  const session = (driver as unknown as { sessions: Map<ThreadId, GrokSession> }).sessions.get(threadId);
  if (!session) throw new Error(`no session for ${threadId}`);
  return { model: session.model, models: session.models };
}
