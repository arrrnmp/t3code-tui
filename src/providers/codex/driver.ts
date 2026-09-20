/**
 * Codex driver: `ProviderAdapter` over a per-session `codex app-server`
 * stdio JSON-RPC peer. Thin by design: no Effect Layers, no host services.
 *
 * Handshake is initialize → initialized → account/read; each thread maps to
 * one app-server thread started with the static approval/sandbox policy for
 * its runtime mode. Server-driven approvals park until `respondToRequest` /
 * `respondToUserInput` resolve them (interrupt settles parked first, or the
 * stdin loop deadlocks). Token usage is a baseline delta over thread-wide
 * cumulative totals; compaction is native; rollback prefers
 * `thread/revert` with a `thread/rollback` fallback. Auth is the CLI's own
 * `auth.json` under `CODEX_HOME` — never ours. See DECOUPLE.md §6.
 */
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
  codexAccountTypeOf,
  codexSignedOutMessage,
  isCodexAuthErrorText,
  normalizeCodexSettings,
  resolveCodexHome,
  type CodexAccountType,
  type CodexSettings,
} from "./config.js";
import { approvalKindForMethod, staticPolicyForRuntimeMode, type CodexApprovalKind } from "./permissions.js";
import {
  asRecord,
  asString,
  CODEX_METHODS,
  codexTokenBreakdownOf,
  codexTurnStateOf,
} from "./protocol.js";
import { SpawnCodexTransport, type CodexTransport } from "./transport.js";
import {
  CodexUsageAccumulator,
  codexWindowsOf,
  rewriteLimitError,
} from "./usage.js";

export interface CodexDriverOptions {
  readonly settings?: Partial<CodexSettings>;
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: CodexTransport;
  readonly rateLimitsTimeoutMs?: number;
}

export type CodexTurnStatus = "completed" | "failed" | "interrupted";

export interface CodexListedModel {
  readonly id: string;
  readonly name?: string | undefined;
  readonly reasoningEfforts?: ReadonlyArray<string> | undefined;
}

export interface CodexTurnOutcome {
  readonly status: CodexTurnStatus;
  readonly text: string;
  readonly usage: TokenUsageDelta;
  readonly error: string | null;
}

interface TranscriptItem {
  readonly kind: "user" | "assistant" | "tool";
  readonly text: string;
  readonly tool?: string;
}

interface TranscriptTurn {
  readonly id: TurnId;
  serverTurnId: string | null;
  readonly prompt: string;
  readonly items: TranscriptItem[];
  status: "running" | CodexTurnStatus;
  text: string;
  error: string | null;
}

interface ParkedCodex {
  readonly threadId: ThreadId;
  readonly kind: CodexApprovalKind;
  readonly method: string;
  readonly resolve: (result: unknown) => void;
}

interface CodexSession {
  readonly threadId: ThreadId;
  codexThreadId: string | null;
  readonly peer: JsonRpcPeer;
  readonly workingDirectory: string;
  closed: boolean;
  accountType: CodexAccountType;
  model: string | null;
  runtimeMode: RuntimeMode;
  transcript: TranscriptTurn[];
  waiters: Map<TurnId, Array<{ resolve: (outcome: CodexTurnOutcome) => void; reject: (cause: unknown) => void }>>;
  parked: Map<string, ParkedCodex>;
  sessionAllows: Set<string>;
  usage: CodexUsageAccumulator;
  lastWindows: ReturnType<typeof codexWindowsOf>;
  lastResetsAt: string | null;
  lastActiveAt: number;
  lastActiveThreadId: ThreadId | null;
  startedAt: string;
}

const CLIENT_INFO = { name: "t3code-tui", title: "t3code-tui", version: "0.0.0" };

// Serialized per CODEX_HOME so concurrent reset-credit consumes never race.
const resetCreditLocks = new Map<string, Promise<void>>();

function toCliError(code: string, message: string, cause: unknown): CliError {
  // Auth patterns win even over transport wrappers: a failed account/read
  // surfaces as PEER_REQUEST_FAILED whose message still names the cause.
  const text = cause instanceof Error ? cause.message : String(cause);
  if (isCodexAuthErrorText(text)) {
    return new CliError("CODEX_AUTH_REQUIRED", codexSignedOutMessage({ home: "~/.codex" }), {
      cause,
    });
  }
  if (cause instanceof CliError) return cause;
  return new CliError(code, `${message}: ${text.slice(0, 200)}`, { cause });
}

function textOfDelta(params: unknown): string | null {
  const record = asRecord(params);
  if (!record) return typeof params === "string" ? params : null;
  for (const key of ["text", "delta", "content"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  const content = asRecord(record["content"]);
  if (content && typeof content["text"] === "string") return content["text"] as string;
  return null;
}

function userInputBlocks(prompt: string): Array<Record<string, unknown>> {
  return [{ type: "text", text: prompt }];
}

export class CodexDriver implements ProviderAdapter<CliError> {
  readonly provider = "codex" as const;
  readonly capabilities: ProviderAdapterCapabilities = {
    sessionModelSwitch: "in-session",
    supportsConversationRollback: true,
  };

  private readonly settings: CodexSettings;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly transport: CodexTransport;
  private readonly rateLimitsTimeoutMs: number;
  private readonly sessions = new Map<ThreadId, CodexSession>();
  private readonly queue = Effect.runSync(Queue.unbounded<ProviderRuntimeEvent>());

  constructor(options: CodexDriverOptions = {}) {
    this.settings = normalizeCodexSettings(options.settings);
    this.baseEnv = options.env ?? process.env;
    this.transport = options.transport ?? new SpawnCodexTransport();
    this.rateLimitsTimeoutMs = options.rateLimitsTimeoutMs ?? 3000;
  }

  get streamEvents(): Stream.Stream<ProviderRuntimeEvent> {
    return Stream.fromQueue(this.queue);
  }

  readonly compaction = {
    type: "native" as const,
    start: (threadId: ThreadId, _modelSelection?: ModelSelection): Effect.Effect<void, CliError> =>
      this.attempt("CODEX_TURN_FAILED", `Could not compact thread ${threadId}`, async () => {
        const session = this.requireSession(threadId);
        const codexThreadId = this.requireCodexThread(session);
        await session.peer.request(CODEX_METHODS.threadCompactStart, { threadId: codexThreadId });
      }),
  };

  private publish(event: ProviderRuntimeEvent): void {
    Effect.runSync(Queue.offer(this.queue, event));
  }

  private attempt<T>(code: string, message: string, run: () => Promise<T>): Effect.Effect<T, CliError> {
    return Effect.tryPromise({
      try: run,
      catch: (cause) => toCliError(code, message, cause),
    });
  }

  private requireSession(threadId: ThreadId): CodexSession {
    const session = this.sessions.get(threadId);
    if (!session || session.closed) {
      throw new CliError("CODEX_NOT_STARTED", `No Codex session exists for thread ${threadId}.`, {
        details: { threadId },
      });
    }
    return session;
  }

  private requireCodexThread(session: CodexSession): string {
    if (!session.codexThreadId) {
      throw new CliError("CODEX_NOT_STARTED", `The Codex thread for ${session.threadId} is not started.`, {
        details: { threadId: session.threadId },
      });
    }
    return session.codexThreadId;
  }

  // -- session lifecycle -------------------------------------------------

  readonly startSession = (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, CliError> =>
    this.attempt("CODEX_SPAWN_FAILED", `Could not start a Codex session for thread ${input.threadId}`, async () => {
      const existing = this.sessions.get(input.threadId);
      if (existing && !existing.closed) return this.describeSession(existing);
      if (existing) this.sessions.delete(input.threadId);

      const peer = this.transport.startPeer({
        settings: this.settings,
        env: this.baseEnv,
        cwd: input.workingDirectory,
      });
      const session: CodexSession = {
        threadId: input.threadId,
        codexThreadId: null,
        peer,
        workingDirectory: input.workingDirectory,
        closed: false,
        accountType: "unknown",
        model: input.modelSelection?.model ?? null,
        runtimeMode: input.runtimeMode ?? "full-access",
        transcript: [],
        waiters: new Map(),
        parked: new Map(),
        sessionAllows: new Set(),
        usage: new CodexUsageAccumulator(),
        lastWindows: [],
        lastResetsAt: null,
        lastActiveAt: Date.now(),
        lastActiveThreadId: null,
        startedAt: new Date().toISOString(),
      };
      peer.onRequest((method, params) => this.onServerRequest(session, method, params));
      peer.onNotification((method, params) => this.onNotification(session, method, params));
      peer.onExit(() => {
        if (!session.closed) {
          session.closed = true;
          this.settleOpenTurn(session, "failed", "The Codex process exited.");
          this.sessions.delete(session.threadId);
        }
      });
      this.sessions.set(input.threadId, session);
      try {
        await peer.request("initialize", {
          clientInfo: CLIENT_INFO,
          capabilities: { experimentalApi: true, optOutNotificationMethods: null },
        });
        peer.notify(CODEX_METHODS.initialized, undefined);
        const account = await peer.request(CODEX_METHODS.accountRead, {});
        session.accountType = codexAccountTypeOf(account);
        await this.probeRateLimits(session);
        const policy = staticPolicyForRuntimeMode(session.runtimeMode);
        const started = await peer.request(CODEX_METHODS.threadStart, {
          cwd: input.workingDirectory,
          ...(session.model ? { model: session.model } : {}),
          approvalPolicy: policy.approvalPolicy,
          sandbox: policy.sandbox,
        });
        const startedRecord = asRecord(started);
        const codexThreadId =
          asString(startedRecord?.["threadId"]) ??
          asString(asRecord(startedRecord?.["thread"])?.["id"]) ??
          asString(startedRecord?.["id"]);
        if (!codexThreadId) {
          throw new CliError("CODEX_START_FAILED", "The app-server did not return a thread id.", {
            details: { threadId: input.threadId },
          });
        }
        session.codexThreadId = codexThreadId;
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

  private describeSession(session: CodexSession): ProviderSession {
    return {
      threadId: session.threadId,
      provider: "codex",
      workingDirectory: session.workingDirectory,
      startedAt: session.startedAt,
    };
  }

  private async probeRateLimits(session: CodexSession): Promise<void> {
    try {
      const snapshot = await session.peer.request(
        CODEX_METHODS.rateLimitsRead,
        {},
        this.rateLimitsTimeoutMs,
      );
      this.applyRateSnapshot(session, snapshot);
    } catch {
      // Degrade to a message: live updates still arrive mid-turn.
    }
  }

  private applyRateSnapshot(session: CodexSession, snapshot: unknown): void {
    const record = asRecord(snapshot) ?? {};
    const inner = asRecord(record["rateLimits"]) ?? record;
    const windows = codexWindowsOf({
      limitId: asString(inner["limitId"]) ?? undefined,
      planType: asString(inner["planType"]) ?? undefined,
      primary: inner["primary"],
      secondary: inner["secondary"],
    });
    session.lastWindows = windows;
    const resets = windows.map((window) => window.resetsAt).filter((value): value is string => value !== null);
    session.lastResetsAt = resets.length > 0 ? resets.sort()[0]! : session.lastResetsAt;
    this.publish({
      type: "rate-limits.updated",
      provider: "codex",
      threadId: session.threadId,
      windows,
      raw: { planType: inner["planType"] ?? null },
    });
  }

  readonly stopSession = (threadId: ThreadId): Effect.Effect<void, CliError> =>
    this.attempt("CODEX_SPAWN_FAILED", `Could not stop the Codex session for thread ${threadId}`, async () => {
      const session = this.sessions.get(threadId);
      if (!session) return;
      await this.closeSession(session, "session-stopped");
    });

  readonly stopAll = (): Effect.Effect<void, CliError> =>
    this.attempt("CODEX_SPAWN_FAILED", "Could not stop Codex sessions", async () => {
      for (const session of [...this.sessions.values()]) {
        await this.closeSession(session, "session-stopped");
      }
    });

  private async closeSession(session: CodexSession, reason: string): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    this.denyParked(session, "Session ended.");
    try {
      session.peer.close();
    } catch {
      // Best effort.
    }
    this.sessions.delete(session.threadId);
    this.publish({
      type: "thread.state.changed",
      provider: "codex",
      threadId: session.threadId,
      state: reason,
    });
  }

  readonly listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
    Effect.succeed([...this.sessions.values()].map((session) => this.describeSession(session)));

  readonly hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
    Effect.succeed(this.sessions.has(threadId));

  // -- turns ---------------------------------------------------------------

  readonly sendTurn = (input: ProviderSendTurnInput): Effect.Effect<ProviderTurnStartResult, CliError> =>
    this.attempt("CODEX_TURN_FAILED", `Could not send a turn on thread ${input.threadId}`, async () => {
      const session = this.requireSession(input.threadId);
      const codexThreadId = this.requireCodexThread(session);
      const open = session.transcript.find((turn) => turn.status === "running");
      if (open) {
        throw new CliError("TURN_BUSY", `Thread ${input.threadId} already has a running turn.`, {
          details: { threadId: input.threadId, turnId: open.id },
        });
      }
      const model = input.modelSelection?.model ?? session.model;
      if (model) session.model = model;
      if (input.runtimeMode) session.runtimeMode = input.runtimeMode;
      const policy = staticPolicyForRuntimeMode(session.runtimeMode);
      // Plan mode constrains the turn to untrusted approvals. A per-turn
      // sandbox switch would need the unverified SandboxPolicy shape, so
      // the session policy (set at thread/start) stays authoritative.
      const turnApprovalPolicy =
        input.interactionMode === "plan" ? "untrusted" : policy.approvalPolicy;
      const options = input.modelSelection?.options ?? [];
      const optionValue = (ids: string[]): string | null => {
        for (const id of ids) {
          const found = options.find((option) => option.id === id);
          if (found && typeof found.value === "string" && found.value.trim()) return found.value.trim();
        }
        return null;
      };
      const effort = optionValue(["reasoningEffort", "effort"]);
      const serviceTier = optionValue(["serviceTier", "tier"]);
      const turn: TranscriptTurn = {
        id: randomUUID(),
        serverTurnId: null,
        prompt: input.prompt,
        items: [{ kind: "user", text: input.prompt }],
        status: "running",
        text: "",
        error: null,
      };
      session.transcript.push(turn);
      session.lastActiveAt = Date.now();
      session.lastActiveThreadId = session.threadId;
      await session.peer.request(CODEX_METHODS.turnStart, {
        threadId: codexThreadId,
        input: userInputBlocks(input.prompt),
        ...(effort ? { effort } : {}),
        ...(model ? { model } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        approvalPolicy: turnApprovalPolicy,
      });
      return { threadId: session.threadId, turnId: turn.id };
    });

  readonly interruptTurn = (threadId: ThreadId, _turnId?: TurnId): Effect.Effect<void, CliError> =>
    this.attempt("CODEX_TURN_FAILED", `Could not interrupt the turn on thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      // Settle parked approvals/inputs first: interrupting while they park
      // deadlocks the server's stdin loop.
      this.denyParked(session, "Interrupted.");
      try {
        await session.peer.request(CODEX_METHODS.turnInterrupt, {
          threadId: this.requireCodexThread(session),
        });
      } catch (cause) {
        if (!session.closed) throw cause;
      }
      this.settleOpenTurn(session, "interrupted", "Interrupted.");
    });

  async awaitTurn(threadId: ThreadId, turnId: TurnId, signal?: AbortSignal): Promise<CodexTurnOutcome> {
    const session = this.requireSession(threadId);
    const turn = session.transcript.find((candidate) => candidate.id === turnId);
    if (!turn) {
      throw new CliError("TURN_NOT_FOUND", `No turn exists with id ${turnId}.`, {
        details: { threadId, turnId },
      });
    }
    if (turn.status !== "running") {
      return {
        status: turn.status,
        text: turn.text,
        usage: this.usageOf(session, turnId),
        error: turn.error,
      };
    }
    if (signal?.aborted === true) {
      throw new CliError("TURN_ABORTED", `Turn ${turnId} was aborted before settling.`, {
        details: { threadId, turnId },
      });
    }
    return await new Promise<CodexTurnOutcome>((resolve, reject) => {
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

  private usageOf(session: CodexSession, turnId: TurnId): TokenUsageDelta {
    const totals = session.usage.peek(turnId);
    return {
      input: totals.input,
      cacheRead: totals.cacheRead,
      cacheCreate: totals.cacheCreate,
      output: totals.output,
      thinking: totals.reasoning,
    };
  }

  private settleOpenTurn(session: CodexSession, status: CodexTurnStatus, detail: string): void {
    const open = session.transcript.find((turn) => turn.status === "running");
    const usage = open ? this.usageOf(session, open.id) : null;
    if (open) {
      open.status = status;
      open.error = status === "completed" ? null : detail;
      if (status !== "completed") open.text = open.text || detail;
      session.usage.take(open.id);
    }
    const waiters = open ? (session.waiters.get(open.id) ?? []) : [];
    if (open) session.waiters.delete(open.id);
    const outcome: CodexTurnOutcome = {
      status,
      text: open?.text ?? "",
      usage: usage ?? { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0 },
      error: open?.error ?? detail,
    };
    for (const waiter of waiters) waiter.resolve(outcome);
    if (open) {
      this.publish({
        type: status === "completed" ? "turn.completed" : status === "failed" ? "turn.failed" : "turn.interrupted",
        provider: "codex",
        threadId: session.threadId,
        turnId: open.id,
        ...(status === "failed" ? { raw: { error: open.error } } : {}),
      });
    }
  }

  // -- server requests (approvals) --------------------------------------------

  private sessionForPayload(params: unknown): CodexSession | null {
    const record = asRecord(params);
    const threadId =
      asString(record?.["threadId"]) ?? asString(record?.["conversationId"]) ?? null;
    if (threadId) {
      for (const session of this.sessions.values()) {
        if (session.codexThreadId === threadId) return session;
      }
    }
    if (this.sessions.size === 1) return [...this.sessions.values()][0]!;
    for (const session of this.sessions.values()) {
      if (session.lastActiveThreadId === session.threadId) return session;
    }
    return null;
  }

  private onServerRequest(
    session: CodexSession,
    method: string,
    params: unknown,
  ): Promise<unknown> | unknown {
    const kind = approvalKindForMethod(method);
    if (!kind) throw new Error(`Method not found: ${method}`);
    const target = this.sessionForPayload(params) ?? session;
    if (target.sessionAllows.has(method) && (kind === "command_execution" || kind === "file_change" || kind === "permissions" || kind === "dynamic_tool_call")) {
      return this.autoApprovalResponse(kind);
    }
    // user_input + elicitation always park (like AskUserQuestion).
    const requestId = randomUUID();
    const opened = kind === "user_input" || kind === "elicitation" ? "user-input.request.opened" : "permission.request.opened";
    this.publish({
      type: opened,
      provider: "codex",
      threadId: target.threadId,
      requestId,
      raw: { method, kind, params },
    } as ProviderRuntimeEvent);
    return new Promise<unknown>((resolve) => {
      target.parked.set(requestId, {
        threadId: target.threadId,
        kind,
        method,
        resolve: (result) => {
          target.parked.delete(requestId);
          const resolved = kind === "user_input" || kind === "elicitation" ? "user-input.request.resolved" : "permission.request.resolved";
          this.publish({
            type: resolved,
            provider: "codex",
            threadId: target.threadId,
            requestId,
            raw: { method, kind },
          } as ProviderRuntimeEvent);
          resolve(result);
        },
      });
    });
  }

  private autoApprovalResponse(kind: CodexApprovalKind): unknown {
    if (kind === "dynamic_tool_call") return { success: true, contentItems: [] };
    if (kind === "elicitation") return { action: "accept" };
    return { decision: "accept" };
  }

  private denyParked(session: CodexSession, message: string): void {
    for (const [requestId, parked] of [...session.parked]) {
      session.parked.delete(requestId);
      try {
        parked.resolve(this.cancelResponse(parked.kind, message));
      } catch {
        // Handler already gone.
      }
    }
  }

  private cancelResponse(kind: CodexApprovalKind, message: string): unknown {
    void message;
    if (kind === "user_input") return { answers: {} };
    if (kind === "elicitation") return { action: "cancel" };
    if (kind === "dynamic_tool_call") {
      return { success: false, contentItems: [{ type: "text", text: "Cancelled." }] };
    }
    return { decision: "cancel" };
  }

  readonly respondToRequest = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ): Effect.Effect<void, CliError> =>
    this.attempt("CODEX_TURN_FAILED", `Could not answer permission request ${requestId}`, async () => {
      const session = this.requireSession(threadId);
      const parked = session.parked.get(requestId);
      if (!parked || parked.threadId !== threadId) {
        throw new CliError("REQUEST_UNKNOWN", `No pending permission request ${requestId}.`, {
          details: { threadId, requestId },
        });
      }
      if (parked.kind === "user_input" || parked.kind === "elicitation") {
        throw new CliError("REQUEST_MISMATCH", `Request ${requestId} needs user input, not a permission decision.`, {
          details: { threadId, requestId, kind: parked.kind },
        });
      }
      if (decision.kind === "accept") parked.resolve(this.acceptResponse(parked.kind, false));
      else if (decision.kind === "acceptForSession") {
        session.sessionAllows.add(parked.method);
        parked.resolve(this.acceptResponse(parked.kind, true));
      } else if (decision.kind === "decline") parked.resolve(this.declineResponse(parked.kind));
      else parked.resolve(this.cancelResponse(parked.kind, "Cancelled."));
    });

  private acceptResponse(kind: CodexApprovalKind, _forSession: boolean): unknown {
    if (kind === "dynamic_tool_call") return { success: true, contentItems: [] };
    return { decision: "accept" };
  }

  private declineResponse(kind: CodexApprovalKind): unknown {
    if (kind === "dynamic_tool_call") {
      return { success: false, contentItems: [{ type: "text", text: "Declined." }] };
    }
    return { decision: "decline" };
  }

  readonly respondToUserInput = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ): Effect.Effect<void, CliError> =>
    this.attempt("CODEX_TURN_FAILED", `Could not answer user input request ${requestId}`, async () => {
      const session = this.requireSession(threadId);
      const parked = session.parked.get(requestId);
      if (!parked || parked.threadId !== threadId) {
        throw new CliError("REQUEST_UNKNOWN", `No pending user input request ${requestId}.`, {
          details: { threadId, requestId },
        });
      }
      if (parked.kind === "user_input") {
        const mapped: Record<string, { answers: string[] }> = {};
        for (const [key, value] of Object.entries(answers)) mapped[key] = { answers: [value] };
        parked.resolve({ answers: mapped });
        return;
      }
      if (parked.kind === "elicitation") {
        parked.resolve({ action: "accept", content: { ...answers } });
        return;
      }
      throw new CliError("REQUEST_MISMATCH", `Request ${requestId} needs a permission decision, not user input.`, {
        details: { threadId, requestId, kind: parked.kind },
      });
    });

  // -- notifications ------------------------------------------------------------

  private onNotification(session: CodexSession, method: string, params: unknown): void {
    session.lastActiveAt = Date.now();
    switch (method) {
      case CODEX_METHODS.turnStarted: {
        const record = asRecord(params);
        const turn = asRecord(record?.["turn"]);
        const serverId = asString(turn?.["id"]) ?? asString(record?.["turnId"]);
        const open = session.transcript.find((candidate) => candidate.status === "running");
        if (open && serverId) open.serverTurnId = serverId;
        return;
      }
      case CODEX_METHODS.turnCompleted: {
        const record = asRecord(params);
        const turn = asRecord(record?.["turn"]);
        const state = codexTurnStateOf(turn);
        const open = session.transcript.find((candidate) => candidate.status === "running");
        const usage = open ? this.usageOf(session, open.id) : null;
        if (usage && open) {
          this.publish({
            type: "token-usage.updated",
            provider: "codex",
            threadId: session.threadId,
            usage,
          });
        }
        if (state === "completed") this.settleOpenTurn(session, "completed", "");
        else if (state === "interrupted") this.settleOpenTurn(session, "interrupted", "Interrupted.");
        else this.settleOpenTurn(session, "failed", this.turnErrorOf(session, turn));
        return;
      }
      case CODEX_METHODS.turnFailed:
      case CODEX_METHODS.turnInterrupted: {
        const failed = method === CODEX_METHODS.turnFailed;
        this.settleOpenTurn(
          session,
          failed ? "failed" : "interrupted",
          failed ? rewriteLimitError(textOfDelta(params) ?? "Turn failed.", session.lastResetsAt) : "Interrupted.",
        );
        return;
      }
      case CODEX_METHODS.agentMessageDelta: {
        const text = textOfDelta(params);
        const open = session.transcript.find((candidate) => candidate.status === "running");
        if (text && open) {
          open.text += text;
          open.items.push({ kind: "assistant", text });
        }
        if (text) {
          this.publish({
            type: "message.part.updated",
            provider: "codex",
            threadId: session.threadId,
            turnId: open?.id ?? null,
            text,
          });
        }
        return;
      }
      case CODEX_METHODS.commandOutputDelta:
      case CODEX_METHODS.itemStarted:
      case CODEX_METHODS.itemCompleted: {
        const record = asRecord(params);
        const tool =
          asString(record?.["tool"]) ??
          asString(record?.["kind"]) ??
          asString(record?.["type"]) ??
          "tool";
        const open = session.transcript.find((candidate) => candidate.status === "running");
        if (open && method === CODEX_METHODS.itemCompleted) {
          open.items.push({ kind: "tool", tool, text: textOfDelta(params) ?? tool });
        }
        this.publish({
          type:
            method === CODEX_METHODS.itemStarted
              ? "tool.execute.started"
              : method === CODEX_METHODS.itemCompleted
                ? "tool.execute.completed"
                : "tool.execute.updated",
          provider: "codex",
          threadId: session.threadId,
          turnId: open?.id ?? null,
          tool,
          raw: params,
        });
        return;
      }
      case CODEX_METHODS.threadCompacted: {
        this.publish({
          type: "thread.state.changed",
          provider: "codex",
          threadId: session.threadId,
          state: "compacted",
          raw: params,
        });
        return;
      }
      case CODEX_METHODS.tokenUsageUpdated: {
        const record = asRecord(params);
        const usage = asRecord(record?.["tokenUsage"]) ?? record;
        const open = session.transcript.find((candidate) => candidate.status === "running");
        const total = codexTokenBreakdownOf(usage?.["total"] ?? usage);
        const last = codexTokenBreakdownOf(usage?.["last"] ?? {});
        const totals = session.usage.observe(open?.id ?? "unknown", total, last);
        this.publish({
          type: "token-usage.updated",
          provider: "codex",
          threadId: session.threadId,
          usage: {
            input: totals.input,
            cacheRead: totals.cacheRead,
            cacheCreate: totals.cacheCreate,
            output: totals.output,
            thinking: totals.reasoning,
          },
        });
        return;
      }
      case CODEX_METHODS.rateLimitsUpdated: {
        const record = asRecord(params);
        this.applyRateSnapshot(session, record?.["rateLimits"] ?? params);
        return;
      }
      default:
        return;
    }
  }

  private turnErrorOf(session: CodexSession, turn: Record<string, unknown> | null): string {
    const message =
      asString(turn?.["error"]) ??
      asString(asRecord(turn?.["error"])?.["message"]) ??
      "Turn failed.";
    return rewriteLimitError(message, session.lastResetsAt);
  }

  // -- state ----------------------------------------------------------------------

  readonly readThread = (threadId: ThreadId): Effect.Effect<ProviderThreadSnapshot, CliError> =>
    this.attempt("CODEX_TURN_FAILED", `Could not read thread ${threadId}`, async () => {
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
      const codexThreadId = this.requireCodexThread(session);
      if (numTurns >= session.transcript.length) {
        throw new CliError("ROLLBACK_UNAVAILABLE", "Cannot roll back past the first turn.", {
          details: { threadId, numTurns },
        });
      }
      const removed = session.transcript.slice(session.transcript.length - numTurns);
      const withServerIds = removed.filter((turn) => turn.serverTurnId !== null);
      try {
        if (withServerIds.length === removed.length && withServerIds.length > 0) {
          await session.peer.request(CODEX_METHODS.threadRevert, {
            threadId: codexThreadId,
            beforeTurnId: withServerIds[0]!.serverTurnId,
          });
        } else {
          await session.peer.request(CODEX_METHODS.threadRollback, {
            threadId: codexThreadId,
            numTurns,
          });
        }
      } catch (cause) {
        throw toCliError("ROLLBACK_FAILED", `Rollback failed on thread ${threadId}`, cause);
      }
      session.transcript = session.transcript.slice(0, session.transcript.length - numTurns);
      return {
        threadId,
        turns: session.transcript.map((turn) => ({
          id: turn.id,
          items: turn.items.map((item) => ({ ...item })),
        })),
      };
    });

  readonly uploadFeedback = (
    input: { threadId: ThreadId },
  ): Effect.Effect<{ threadId: ThreadId; url: string | null }, CliError> =>
    this.attempt("CODEX_TURN_FAILED", `Could not upload feedback for thread ${input.threadId}`, async () => {
      const session = this.requireSession(input.threadId);
      const result = await session.peer.request(CODEX_METHODS.feedbackUpload, {
        threadId: this.requireCodexThread(session),
      });
      return { threadId: input.threadId, url: asString(asRecord(result)?.["url"]) };
    });

  /** Live model list; no allowlist — the server is the source of truth. */
  async listModels(threadId: ThreadId): Promise<ReadonlyArray<CodexListedModel>> {
    const session = this.requireSession(threadId);
    const result = await session.peer.request(CODEX_METHODS.modelList, {});
    const record = asRecord(result);
    // Local CLIs disagree on the envelope key: observed `models` and
    // `items` during development, `data` on codex-cli 0.153.4 (paginated).
    const rawList = Array.isArray(result)
      ? result
      : (record?.["models"] ?? record?.["items"] ?? record?.["data"] ?? []);
    const list = Array.isArray(rawList) ? rawList : [];
    const models: Array<CodexListedModel> = [];
    for (const entry of list) {
      const item = asRecord(entry);
      const id = asString(item?.["id"]) ?? asString(item?.["model"]) ?? asString(item?.["slug"]);
      if (!id) continue;
      const name = asString(item?.["displayName"]) ?? asString(item?.["name"]) ?? id;
      const efforts = asRecord(item)?.["supportedReasoningEfforts"];
      const reasoningEfforts = Array.isArray(efforts)
        ? efforts.flatMap((effort) => {
          const value = asString(asRecord(effort)?.["reasoningEffort"]);
          return value ? [value] : [];
        })
        : [];
      models.push({
        id,
        ...(name !== id ? { name } : {}),
        ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
      });
    }
    return models;
  }

  /** Serialized per CODEX_HOME: consume one reset credit, then re-probe. */
  async consumeResetCredit(threadId: ThreadId): Promise<unknown> {
    const session = this.requireSession(threadId);
    const home = resolveCodexHome(this.settings.homePath, this.baseEnv);
    const previous = resetCreditLocks.get(home) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => gate);
    resetCreditLocks.set(home, current);
    await previous;
    try {
      const outcome = await session.peer.request(CODEX_METHODS.rateLimitResetCreditConsume, {});
      await this.probeRateLimits(session);
      return outcome;
    } finally {
      release();
      if (resetCreditLocks.get(home) === current) {
        resetCreditLocks.delete(home);
      }
    }
  }

  /** Test hook: account type observed at session start. */
  accountTypeOf(threadId: ThreadId): CodexAccountType {
    return this.requireSession(threadId).accountType;
  }
}
