/**
 * OpenCode driver: `ProviderAdapter` over `opencode serve` + the generated
 * SDK (serve-first, DECOUPLE.md §8 option (a)).
 *
 * One server per working directory (shared across that cwd's threads),
 * one native session per thread, one SSE `event.subscribe` pump per
 * server demuxed by `sessionID`. Turns run through `session.promptAsync`
 * and settle on `session.idle` / `session.error`; permission and question
 * requests park until `respondToRequest` / `respondToUserInput` resolve
 * them (`permission.reply` once/always/reject, `question.reply`/`reject`).
 * Rollback forks the native session; compaction is native
 * (`session.summarize`). Token usage is read best-effort off the latest
 * assistant message at turn end — OpenCode streams no usage channel, so
 * mid-turn usage stays silent (the §13 "per-message only" row).
 * Auth is never ours: the CLI's own login plus the vendored plugins.
 */
import { randomUUID } from "node:crypto";

import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { CliError } from "../../errors.js";
import type { InteractionMode, ModelSelection, RuntimeMode } from "../../types.js";
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
  isOpencodeAuthErrorText,
  normalizeOpencodeSettings,
  opencodeSignedOutMessage,
  type OpencodeSettings,
} from "./config.js";
import {
  SpawnOpencodeTransport,
  type OpencodeServerConnection,
  type OpencodeSubscribedEvent,
  type OpencodeTransport,
} from "./transport.js";

export interface OpenCodeDriverOptions {
  readonly settings?: Partial<OpencodeSettings>;
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: OpencodeTransport;
}

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
  /** Latest text per message part (part updates are cumulative snapshots). */
  partTexts: Map<string, string>;
  usage: TokenUsageDelta;
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
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  turns: Map<TurnId, OpenCodeTurn>;
  waiters: Map<TurnId, Array<{ resolve: (outcome: OpenCodeTurnOutcome) => void; reject: (cause: unknown) => void }>>;
  parked: Map<string, ParkedOpenCode>;
  startedAt: string;
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
        await connection.summarizeSession(
          session.nativeSessionId,
          parseOpencodeModel(modelSelection ?? undefined, session.instanceId) ?? undefined,
        );
      }),
    type: "native" as const,
  };

  private readonly settings: OpencodeSettings;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly transport: OpencodeTransport;
  private readonly sessions = new Map<ThreadId, OpenCodeSession>();
  private readonly connections = new Map<string, Promise<OpencodeServerConnection>>();
  private readonly pumps = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private readonly queue = Effect.runSync(Queue.unbounded<ProviderRuntimeEvent>());

  constructor(options: OpenCodeDriverOptions = {}) {
    this.settings = normalizeOpencodeSettings(options.settings);
    this.baseEnv = options.env ?? process.env;
    this.transport = options.transport ?? new SpawnOpencodeTransport();
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
    if (existing) return await existing;
    const pending = this.transport.ensureServer({
      settings: this.settings,
      workingDirectory,
      env: this.baseEnv,
    });
    this.connections.set(key, pending);
    try {
      const connection = await pending;
      this.startPump(key, connection).catch(() => undefined);
      return connection;
    } catch (cause) {
      if (this.connections.get(key) === pending) this.connections.delete(key);
      throw cause;
    }
  }

  private async connectionFor(session: OpenCodeSession): Promise<OpencodeServerConnection> {
    return await this.connectionForSession(session.threadId, session.workingDirectory);
  }

  // -- session lifecycle -------------------------------------------------

  readonly startSession = (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, CliError> =>
    this.attempt("OPENCODE_SPAWN_FAILED", `Could not start an OpenCode session for thread ${input.threadId}`, async () => {
      const existing = this.sessions.get(input.threadId);
      if (existing && !existing.closed) return this.describeSession(existing);
      const connection = await this.connectionForSession(input.threadId, input.workingDirectory);
      const created = await connection.createSession({ title: `t3code ${input.threadId}` });
      const session: OpenCodeSession = {
        threadId: input.threadId,
        nativeSessionId: created.sessionID,
        workingDirectory: input.workingDirectory,
        closed: false,
        instanceId: input.modelSelection?.instanceId ?? "opencode",
        modelSlug: input.modelSelection?.model ?? null,
        runtimeMode: input.runtimeMode ?? "full-access",
        interactionMode: input.interactionMode ?? "default",
        turns: new Map(),
        waiters: new Map(),
        parked: new Map(),
        startedAt: new Date().toISOString(),
      };
      this.sessions.set(input.threadId, session);
      return this.describeSession(session);
    });

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
      }
      const model = session.modelSlug
        ? parseOpencodeModel(
          { instanceId: session.instanceId, model: session.modelSlug },
          session.instanceId,
        )
        : null;
      const turn: OpenCodeTurn = {
        id: `turn-${randomUUID()}`,
        prompt: input.prompt,
        status: "running",
        text: "",
        error: null,
        partTexts: new Map(),
        usage: emptyUsage(),
      };
      session.turns.set(turn.id, turn);
      const connection = await this.connectionFor(session);
      await connection.promptAsync({
        sessionID: session.nativeSessionId,
        ...(model ? { model } : {}),
        parts: [{ type: "text", text: input.prompt }],
      });
      return { threadId: input.threadId, turnId: turn.id };
    });

  readonly interruptTurn = (threadId: ThreadId, _turnId?: TurnId): Effect.Effect<void, CliError> =>
    this.attempt("OPENCODE_TURN_FAILED", `Could not interrupt the turn on thread ${threadId}`, async () => {
      const session = this.requireSession(threadId);
      // Parked permission/question prompts hold the turn open server-side;
      // reject them first so abort settles instead of hanging.
      await this.rejectParked(session, "Interrupted.");
      try {
        const connection = await this.connectionFor(session);
        await connection.abortSession(session.nativeSessionId);
      } catch (cause) {
        if (!session.closed) throw cause;
      }
      this.settleOpenTurn(session, "interrupted", "Interrupted.");
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
      await connection.replyToPermission(parked.nativeId, reply);
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
      await connection.replyToQuestion(parked.nativeId, answersFor(answers, parked.detail));
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
      const messages = await connection.sessionMessages(session.nativeSessionId);
      const ids = messages.flatMap((message) => {
        const id = asString(message.info.id);
        return id ? [id] : [];
      });
      if (ids.length <= numTurns) {
        throw new CliError("ROLLBACK_UNAVAILABLE", "Cannot roll back past the first turn.", {
          details: { threadId, numTurns },
        });
      }
      const forkPoint = ids[ids.length - 1 - numTurns];
      const forked = await connection.forkSession(session.nativeSessionId, forkPoint);
      session.nativeSessionId = forked.sessionID;
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
        for (const pending of connections) {
          await pending.then((connection) => connection.dispose()).catch(() => undefined);
        }
      },
      catch: (cause) => toCliError("OPENCODE_STOP_FAILED", "Could not stop the OpenCode driver", cause),
    });

  // -- event pump ----------------------------------------------------------

  private async startPump(key: string, connection: OpencodeServerConnection): Promise<void> {
    if (this.pumps.has(key)) return;
    const controller = new AbortController();
    const done = (async () => {
      try {
        const subscription = await connection.subscribeEvents({ signal: controller.signal });
        for await (const event of subscription.stream) {
          if (controller.signal.aborted) break;
          this.onServerEvent(event);
        }
      } catch {
        // Abort or a dropped SSE stream ends the pump; turns already
        // running stay running until idle/error or an explicit interrupt.
      }
    })();
    this.pumps.set(key, { controller, done });
    await done.catch(() => undefined);
    if (this.pumps.get(key)?.controller === controller) this.pumps.delete(key);
  }

  private sessionForNative(nativeSessionId: string): OpenCodeSession | null {
    for (const session of this.sessions.values()) {
      if (!session.closed && session.nativeSessionId === nativeSessionId) return session;
    }
    return null;
  }

  private onServerEvent(event: OpencodeSubscribedEvent): void {
    const nativeSessionId = asString(event.properties.sessionID);
    if (!nativeSessionId) return;
    const session = this.sessionForNative(nativeSessionId);
    if (!session) return;
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
    const partId = asString(part.id) ?? `part-${turn.partTexts.size}`;
    const kind = asString(part.type) ?? "unknown";
    if (kind === "text") {
      const text = typeof part.text === "string" ? part.text : "";
      turn.partTexts.set(partId, text);
      turn.text = [...turn.partTexts.values()].join("");
      this.publish({
        type: "message.part.updated",
        provider: this.provider,
        threadId: session.threadId,
        turnId: turn.id,
        text,
        raw: part,
      });
      return;
    }
    if (kind === "tool") {
      const tool = asString(part.tool ?? part.name) ?? "tool";
      this.publish({
        type: "tool.execute.updated",
        provider: this.provider,
        threadId: session.threadId,
        turnId: turn.id,
        tool,
        raw: part,
      });
    }
  }

  private onPermissionAsked(session: OpenCodeSession, event: OpencodeSubscribedEvent): void {
    const nativeId = asString(event.properties.id);
    if (!nativeId || session.parked.has(nativeId)) return;
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
      raw: event.properties,
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

  private onSessionIdle(session: OpenCodeSession): void {
    const turn = this.openTurn(session);
    if (!turn) return;
    // Best-effort usage: read the latest assistant message tokens off the
    // server. Failures stay silent — usage is advisory, never load-bearing.
    void this.connectionFor(session)
      .then((connection) => connection.sessionMessages(session.nativeSessionId))
      .then((messages) => {
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
        this.settleOpenTurn(session, "completed", "");
      });
  }

  private onSessionError(session: OpenCodeSession, event: OpencodeSubscribedEvent): void {
    const error = asRecord(event.properties.error);
    const message = (error ? asString(error.message ?? error.data ?? error.name) : null) ?? "OpenCode turn failed.";
    if (isOpencodeAuthErrorText(message)) {
      this.settleOpenTurn(session, "failed", opencodeSignedOutMessage({ cwd: session.workingDirectory }));
      return;
    }
    this.settleOpenTurn(session, "failed", message.slice(0, 500));
  }

  private settleOpenTurn(session: OpenCodeSession, status: OpenCodeTurnStatus, detail: string): void {
    const open = this.openTurn(session);
    if (open) {
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

  private async rejectParked(session: OpenCodeSession, detail: string): Promise<void> {
    void detail;
    const parked = [...session.parked.values()];
    session.parked.clear();
    let connection: OpencodeServerConnection | null = null;
    for (const request of parked) {
      try {
        connection = connection ?? (await this.connectionFor(session));
        if (request.kind === "permission") await connection.replyToPermission(request.nativeId, "reject");
        else await connection.rejectQuestion(request.nativeId);
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
 * Map our flat `Record<question, answer>` onto the server's per-question
 * `string[][]`: match by question header, else by `q<index>`, else leave
 * that question unanswered (empty selection).
 */
export function answersFor(
  answers: ProviderUserInputAnswers,
  questionsJson: string,
): ReadonlyArray<ReadonlyArray<string>> {
  let questions: ReadonlyArray<{ header?: unknown }>;
  try {
    const parsed = JSON.parse(questionsJson) as unknown;
    questions = Array.isArray(parsed) ? parsed : [];
  } catch {
    questions = [];
  }
  if (questions.length === 0) return Object.values(answers).map((value) => [value]);
  return questions.map((question, index) => {
    const header = typeof question?.header === "string" ? question.header : `q${index}`;
    const direct = answers[header] ?? answers[`q${index}`];
    return direct === undefined ? [] : [direct];
  });
}

function latestAssistantUsage(
  messages: ReadonlyArray<{ info: Record<string, unknown>; parts: ReadonlyArray<Record<string, unknown>> }>,
): TokenUsageDelta | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info;
    if (!info || info.role !== "assistant") continue;
    const tokens = asRecord(info.tokens);
    if (!tokens) return null;
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
