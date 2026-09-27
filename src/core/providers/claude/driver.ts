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
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type {
  CanUseTool,
  HookCallbackMatcher,
  HookEvent,
  OnUserDialog,
  PermissionMode,
  PermissionResult,
  SDKMessage,
  SDKRateLimitInfo,
  SDKUserMessage,
  SessionMessage,
  UserDialogRequest,
  UserDialogResult,
} from "@anthropic-ai/claude-agent-sdk";

import { CliError } from "../../errors.js";
import { plainSkill, type SkillInventory, type SkillSummary } from "../../catalog/summary.js";
import type { InteractionMode, RuntimeMode } from "../../types.js";
import type {
  ApprovalRequestId,
  BackgroundTaskSummary,
  ContextBreakdown,
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
  SideAnswer,
  SideQuestionInput,
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
import { claudeModelName } from "./catalog.js";
import {
  effectiveEffortChoice,
  effortFlagSettings,
  promptForEffort,
  sessionEffortKey,
  sessionWideEffort,
  spawnEffortOptions,
  type ClaudeEffortChoice,
} from "./effort.js";
import {
  sdkMcpServer,
  SdkSessionApi,
  SdkTransport,
  type ClaudeQuery,
  type ClaudeQueryOptions,
  type ClaudeSessionApi,
  type ClaudeTransport,
} from "./transport.js";
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
  /** Set on a turn Claude Code started itself (a background task or Monitor woke it). */
  readonly origin?: "background";
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
  /**
   * The assistant message streaming now, not yet known to be interim or
   * final. The next tool call or message makes it a note; `result` makes it
   * the answer. Claude Code sends one SDK message per content block, all
   * sharing the API message id.
   */
  pendingText: { messageId: string; text: string } | null;
  /** After an interrupt: drop the cut-off run's stragglers until its `result`. */
  drainUntilResult: boolean;
  /** The live background tasks (`background_tasks_changed`), ambient ones excluded. */
  backgroundTasks: BackgroundTaskSummary[];
  /**
   * Each task's description from its `task_started`: the completion notice
   * carries none, and the live set has usually dropped the task by then.
   */
  taskDescriptions: Map<string, string>;
  /**
   * Tasks started in the foreground (`task_started.is_backgrounded: false`,
   * the spawning tool call blocking on them): not background work until a
   * `task_updated` patch backgrounds them, when they join the live set with
   * everything their `task_started` carried.
   */
  foregroundTasks: Map<string, BackgroundTaskSummary>;
  /**
   * The session's task list as the Task tools build it, in creation order:
   * `TaskCreate` adds an entry once its result names the assigned id,
   * `TaskUpdate` patches or deletes one, a `TaskList` result resyncs all.
   */
  checklist: Array<{ id: string; subject: string; status: ChecklistStatus }>;
  query: ClaudeQuery;
  input: PromptQueue;
  closed: boolean;
  resumeSessionId: string | null;
  account: { subscriptionType?: string; tokenSource?: string; apiProvider?: string } | null;
  model: string | null;
  /** The session-wide effort last applied (never `ultrathink`, which is per turn); null = the model's default. */
  effort: ClaudeEffortChoice | null;
  /** MCP servers and runtime instructions the session was started with, kept so a rebuilt query has them too. */
  readonly mcpServers: readonly McpServerSpec[] | null;
  readonly instructions: string | null;
  /**
   * SDK message uuid → the API message id and tool calls it carried. A
   * refusal fallback names what it retracts by uuid; the transcript knows
   * those messages by API message id and tool call id.
   */
  sdkMessages: Map<string, { readonly messageId: string | null; readonly toolUseIds: readonly string[] }>;
  /** The API message streaming now (`message_start`), and its open content blocks by index. */
  stream: { messageId: string | null; blocks: Map<number, { type: string; startedAt: number; text: string }> };
  /**
   * Per API message: text characters already published (streamed deltas or
   * complete blocks) and characters the complete blocks account for. A
   * complete block only publishes what its deltas did not, so streamed text
   * is never sent twice — and nothing is lost if a delta never came.
   */
  textPublished: Map<string, number>;
  textAccounted: Map<string, number>;
  /** API messages whose thinking the stream reported, so their complete blocks are not reported again. */
  streamedThinking: Set<string>;
  /** Why the run is ending on an API error (`StopFailure` hook), for a result that only says "failed". */
  lastStopFailure: string | null;
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
  /** When the `get_usage` probe last ran: it is also the live source of the session's cost. */
  usageProbedAt: number;
  startedAt: string;
}

/** The CLI dialog asking whether to re-run a flagged request on the fallback model. */
const REFUSAL_FALLBACK_DIALOG = "refusal_fallback_prompt";

/**
 * Appended to a side question's system prompt. It has no tools, and a
 * model asked to "check" something will otherwise write tool calls as
 * text — Claude Code's own `/btw` fixed exactly that — so it is told to
 * answer from what the conversation already holds, and to say so when it
 * cannot.
 */
const SIDE_QUESTION_INSTRUCTIONS = [
  "This is a side question asked while the main conversation continues elsewhere.",
  "You have no tools here: do not write tool calls or pretend to run commands or read files.",
  "Answer from what the conversation above already contains, briefly. If answering needs a file read or a command, say so plainly instead.",
].join(" ");

/** SDK messages remembered for retraction; far more than one turn's worth. */
const SDK_MESSAGE_INDEX_LIMIT = 2_000;

/** A live context reading re-probes usage (the session's running cost) when the last probe is older than this. */
const COST_REFRESH_MS = 25_000;
/** How long a context reading waits on that probe before going on without it. */
const COST_REFRESH_WAIT_MS = 4_000;

/** "bio" → "biology": the refusal categories the classifiers report, in words. */
function refusalCategoryLabel(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const category = raw.trim().toLowerCase();
  if (category === "bio") return "biology";
  if (category === "cyber") return "cybersecurity";
  return category;
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

  /** `priority: "next"` folds the message into the running turn at its next step (a steer). */
  push(text: string, images: readonly ProviderImage[] = [], priority?: "next"): void {
    const message: SDKUserMessage = priority ? { ...userMessage(text, images), priority } : userMessage(text, images);
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
  /** The exact callback handed to the SDK as `onUserDialog`; tests drive it directly. */
  readonly handleUserDialog: OnUserDialog;

  constructor(options: ClaudeDriverOptions = {}) {
    this.settings = normalizeClaudeSettings(options.settings);
    this.baseEnv = options.env ?? process.env;
    this.transport = options.transport ?? new SdkTransport();
    this.sessionApi = options.sessionApi ?? new SdkSessionApi();
    this.usageProbeTimeoutMs = options.usageProbeTimeoutMs ?? 15_000;
    this.handlePermissionRequest = (toolName, input, callbackOptions) =>
      this.onPermissionRequest(toolName, input, callbackOptions);
    this.handleUserDialog = (request, dialogOptions) => this.onUserDialog(request, dialogOptions);
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
      const session: ClaudeSession = {
        threadId: input.threadId,
        workingDirectory: input.workingDirectory,
        query: undefined as unknown as ClaudeQuery,
        input: new PromptQueue(),
        closed: false,
        resumeSessionId: null,
        account: null,
        model: input.modelSelection?.model ?? null,
        effort: sessionWideEffort(effectiveEffortChoice(input.modelSelection)),
        mcpServers: input.mcpServers && input.mcpServers.length > 0 ? input.mcpServers : null,
        instructions: input.instructions ?? null,
        sdkMessages: new Map(),
        stream: { messageId: null, blocks: new Map() },
        textPublished: new Map(),
        textAccounted: new Map(),
        streamedThinking: new Set(),
        lastStopFailure: null,
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
        usageProbedAt: 0,
        pendingText: null,
        drainUntilResult: false,
        backgroundTasks: [],
        taskDescriptions: new Map(),
        foregroundTasks: new Map(),
        checklist: [],
        startedAt: new Date().toISOString(),
      };
      const resume = this.resumable.get(input.threadId) ?? (await this.liveCursor(input.resumeCursor));
      session.resumeSessionId = resume ?? null;
      if (resume) this.resumable.set(input.threadId, resume);
      session.query = this.transport.query(session.input, this.queryOptions(session));
      this.sessions.set(input.threadId, session);
      void this.pump(session);
      return this.describeSession(session);
    });

  readonly resumeCursor = (threadId: ThreadId): string | null => this.resumable.get(threadId) ?? null;

  /** A whole copy of a Claude session (the SDK's `forkSession`), resumable on its own. */
  readonly forkSession = async (cursor: string, _workingDirectory: string): Promise<string> =>
    (await this.sessionApi.forkSession(cursor)).sessionId;

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
      // Said outright rather than left to the default: a steer is read at
      // the running turn's next step, never held until it ends.
      session.input.push(text, [], "next");
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
    await this.refreshCost(session);
    const mapped = claudeContextUsageOf(await session.query.getContextUsage({ detail: "summary" }));
    return mapped === null ? null : { ...mapped, costUsd: session.usage.costUsd };
  };

  /**
   * Claude Code's own `/context` breakdown: system prompt, tools, memory
   * files, skills, messages, free space and the autocompact buffer, plus the
   * conversation's heaviest tools. `summary` detail — from the last
   * response and local estimates, no extra API calls.
   */
  readonly contextBreakdown = async (threadId: ThreadId): Promise<ContextBreakdown | null> => {
    const session = this.sessions.get(threadId);
    if (!session || session.closed || !session.query.getContextUsage) return null;
    const raw = await session.query.getContextUsage({ detail: "summary" });
    const usage = claudeContextUsageOf(raw);
    if (usage === null) return null;
    return { ...usage, costUsd: session.usage.costUsd, ...claudeContextCategoriesOf(raw) };
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
   * `/btw`: one answer on a copy of the thread's session. `forkSession`
   * copies the conversation under a new id so the real session is never
   * written to; `persistSession: false` keeps the copy off disk; `tools: []`
   * and `maxTurns: 1` make it a single tool-less reply. Its own process,
   * so it runs while the thread's turn does.
   */
  readonly sideQuestion = async (input: SideQuestionInput): Promise<SideAnswer> => {
    const stringEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.baseEnv)) if (typeof value === "string") stringEnv[key] = value;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    const prompt: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => {
        let sent = false;
        return {
          next: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: userMessage(input.question) };
          },
        };
      },
    };
    const query = this.transport.query(prompt, {
      cwd: input.workingDirectory,
      permissionMode: "default",
      env: stringEnv,
      pathToClaudeCodeExecutable: resolveClaudeExecutable(this.settings.binaryPath, this.baseEnv),
      ...(input.cursor !== null ? { resume: input.cursor, forkSession: true } : {}),
      persistSession: false,
      tools: [],
      maxTurns: 1,
      ...(input.model ? { model: input.model } : {}),
      systemPrompt: { type: "preset", preset: "claude_code", append: SIDE_QUESTION_INSTRUCTIONS },
      abortController: controller,
    });
    const parts: string[] = [];
    let result: string | null = null;
    try {
      for await (const message of query) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "text" && block.text.trim()) parts.push(block.text);
          }
        } else if (message.type === "result") {
          if (message.subtype === "success" && typeof message.result === "string") result = message.result;
          else if (message.subtype !== "success") {
            throw new CliError("SIDE_QUESTION_FAILED", `The side question did not get an answer (${message.subtype}).`);
          }
          break;
        }
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
      query.close?.();
    }
    const text = (parts.join("\n\n").trim() || result?.trim()) ?? "";
    if (!text) throw new CliError("SIDE_QUESTION_FAILED", "The side question came back empty.");
    return { text, withContext: input.cursor !== null };
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
      // A selection that names no effort runs at its model's catalog default.
      const effort = effectiveEffortChoice(input.modelSelection);
      const sessionEffort = sessionWideEffort(effort);
      if (sessionEffort !== null && sessionEffortKey(sessionEffort) !== sessionEffortKey(session.effort)) {
        await session.query.applyFlagSettings?.(effortFlagSettings(sessionEffort, sessionEffortKey(session.effort)));
        session.effort = sessionEffort;
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
      session.input.push(promptForEffort(input.prompt, effort), input.images ?? []);
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
      session.pendingText = null;
      // The interrupted run still ends with its own `result`; anything it
      // sends before that must not open a background turn.
      session.drainUntilResult = true;
    });

  /** The live background tasks on a thread's session (none when it has no session). */
  readonly backgroundTasks = (threadId: ThreadId): readonly BackgroundTaskSummary[] =>
    this.sessions.get(threadId)?.backgroundTasks ?? [];

  /** Stop one background task; the SDK reports the stop as a `task_notification`. */
  readonly stopBackgroundTask = (threadId: ThreadId, taskId: string): Effect.Effect<void, CliError> =>
    this.attempt("CLAUDE_TASK_STOP_FAILED", `Could not stop background task ${taskId}`, async () => {
      const session = this.requireSession(threadId);
      if (!session.backgroundTasks.some((task) => task.taskId === taskId)) {
        throw new CliError("BACKGROUND_TASK_NOT_FOUND", `No background task ${taskId} is running on thread ${threadId}.`, {
          exitCode: 3,
          details: { threadId, taskId },
        });
      }
      if (!session.query.stopTask) throw new CliError("BACKGROUND_TASK_STOP_UNSUPPORTED", "This Claude transport cannot stop tasks.");
      await session.query.stopTask(taskId);
    });

  /**
   * A background task's output file, read directly off disk: the SDK only
   * names it once, on the task's own completion notification (there is no
   * live-output control request — "Read a background task's output file
   * with the Read tool instead," per the SDK's own docs). Its path is
   * reverse-engineered from the CLI's own writes (claude 2.1.281):
   * `{tmpdir}/claude/{cwd, `:`/`\`/`/` -> `-`}/{session id}/tasks/{taskId}.output`
   * — undocumented and best-effort, so any failure here (missing session
   * id, wrong path convention on a future CLI build, file not written yet)
   * degrades to null rather than an error.
   */
  readonly backgroundTaskOutput = async (
    threadId: ThreadId,
    taskId: string,
  ): Promise<{ readonly lines: readonly string[] } | null> => {
    const session = this.sessions.get(threadId);
    if (!session || !session.resumeSessionId) return null;
    const scope = session.workingDirectory.replace(/[:\\/]/g, "-");
    const file = path.join(os.tmpdir(), "claude", scope, session.resumeSessionId, "tasks", `${taskId}.output`);
    try {
      const text = await readFile(file, "utf8");
      const lines = text.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      return { lines };
    } catch {
      return null;
    }
  };

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
      case "stream_event":
        this.handleStreamEvent(session, message);
        return;
      case "prompt_suggestion":
        if (message.suggestion.trim()) {
          this.publish({ type: "prompt.suggested", provider: "claude", threadId: session.threadId, suggestion: message.suggestion.trim() });
        }
        return;
      default:
        return;
    }
  }

  /**
   * Token-level events for the main session (subagents never stream).
   * Text deltas publish as they arrive; a thinking block is reported when
   * it opens and again, with its summary and duration, when it closes.
   */
  private handleStreamEvent(session: ClaudeSession, message: Extract<SDKMessage, { type: "stream_event" }>): void {
    if (message.parent_tool_use_id !== null) return;
    const event = message.event as unknown as Record<string, unknown>;
    const index = typeof event["index"] === "number" ? (event["index"] as number) : -1;
    switch (event["type"]) {
      case "message_start": {
        const started = event["message"] as { id?: unknown } | undefined;
        session.stream = { messageId: typeof started?.id === "string" ? started.id : null, blocks: new Map() };
        return;
      }
      case "content_block_start": {
        const block = event["content_block"] as { type?: unknown } | undefined;
        const type = typeof block?.type === "string" ? block.type : "unknown";
        session.stream.blocks.set(index, { type, startedAt: Date.now(), text: "" });
        if (type === "thinking" && session.stream.messageId) {
          const open = this.turnForOutput(session);
          if (!open && session.drainUntilResult) return;
          session.streamedThinking.add(session.stream.messageId);
          this.publishReasoning(session, open, `${session.stream.messageId}:${index}`, "running", "", Date.now(), null);
        }
        return;
      }
      case "content_block_delta": {
        const delta = event["delta"] as { type?: unknown; text?: unknown; thinking?: unknown } | undefined;
        const messageId = session.stream.messageId;
        if (!messageId) return;
        if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
          const open = this.turnForOutput(session);
          if (!open && session.drainUntilResult) return;
          session.textPublished.set(messageId, (session.textPublished.get(messageId) ?? 0) + delta.text.length);
          this.publish({
            type: "message.part.updated",
            provider: "claude",
            threadId: session.threadId,
            turnId: open?.id ?? null,
            messageId,
            text: delta.text,
          });
          return;
        }
        if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          const block = session.stream.blocks.get(index);
          if (!block) return;
          block.text += delta.thinking;
          if (delta.thinking.length === 0) return;
          const open = this.turnForOutput(session);
          if (!open && session.drainUntilResult) return;
          this.publish({
            type: "reasoning.delta",
            provider: "claude",
            threadId: session.threadId,
            turnId: open?.id ?? null,
            reasoningId: `${messageId}:${index}`,
            text: delta.thinking,
          });
        }
        return;
      }
      case "content_block_stop": {
        const block = session.stream.blocks.get(index);
        const messageId = session.stream.messageId;
        session.stream.blocks.delete(index);
        if (!block || block.type !== "thinking" || !messageId) return;
        const open = session.transcript.find((turn) => turn.status === "running") ?? null;
        if (!open && session.drainUntilResult) return;
        this.publishReasoning(session, open, `${messageId}:${index}`, "completed", block.text, block.startedAt, Date.now() - block.startedAt);
        return;
      }
      default:
        return;
    }
  }

  private publishReasoning(
    session: ClaudeSession,
    turn: TranscriptTurn | null,
    reasoningId: string,
    status: "running" | "completed",
    text: string,
    startedAt: number | null,
    durationMs: number | null,
  ): void {
    this.publish({
      type: "reasoning.updated",
      provider: "claude",
      threadId: session.threadId,
      turnId: turn?.id ?? null,
      reasoningId,
      status,
      text,
      startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
      durationMs,
    });
  }

  /**
   * Publish a complete text block's share of its message: whatever its
   * streamed deltas did not already send (usually nothing).
   */
  private publishTextBlock(session: ClaudeSession, turn: TranscriptTurn | null, messageId: string, text: string): void {
    const accounted = session.textAccounted.get(messageId) ?? 0;
    const published = session.textPublished.get(messageId) ?? 0;
    const end = accounted + text.length;
    session.textAccounted.set(messageId, end);
    if (end <= published) return;
    session.textPublished.set(messageId, end);
    this.publish({
      type: "message.part.updated",
      provider: "claude",
      threadId: session.threadId,
      turnId: turn?.id ?? null,
      messageId,
      text: text.slice(Math.max(0, published - accounted)),
    });
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
    const system = message as unknown as Record<string, unknown>;
    if (message.subtype === ("background_tasks_changed" as string)) {
      const tasks = Array.isArray(system["tasks"]) ? (system["tasks"] as Array<Record<string, unknown>>) : [];
      // The level signal for membership; authoritative, but it carries none
      // of `toolName`/`command`/`startedAt` (only the edges below derive
      // those) and usually arrives before `task_started`, with at most a
      // bare description — so every field falls back to what the edges
      // already learned, and `task_started` back-fills the rest.
      const previous = new Map(session.backgroundTasks.map((task) => [task.taskId, task]));
      session.backgroundTasks = tasks
        .filter((task) => task["ambient"] !== true && typeof task["task_id"] === "string")
        .map((task) => {
          const taskId = task["task_id"] as string;
          const known = previous.get(taskId) ?? session.foregroundTasks.get(taskId);
          session.foregroundTasks.delete(taskId);
          const description = typeof task["description"] === "string" ? (task["description"] as string) : "";
          return {
            taskId,
            taskType: typeof task["task_type"] === "string" ? (task["task_type"] as string) : (known?.taskType ?? null),
            description: description || known?.description || session.taskDescriptions.get(taskId) || "",
            toolName: known?.toolName ?? null,
            command: known?.command ?? null,
            startedAt: known?.startedAt ?? null,
          };
        });
      this.publishBackgroundTasks(session);
      return;
    }
    if (message.subtype === ("task_updated" as string)) {
      this.applyTaskPatch(session, system);
      return;
    }
    if (message.subtype === ("model_refusal_fallback" as string)) {
      this.applyRefusalFallback(session, system);
      return;
    }
    if (message.subtype === ("task_started" as string) || message.subtype === ("task_notification" as string)) {
      // Ambient tasks are Claude Code's own housekeeping, not the session's work.
      if (system["ambient"] === true || typeof system["task_id"] !== "string") return;
      const started = message.subtype === ("task_started" as string);
      const status = started ? "started" : system["status"];
      if (status !== "started" && status !== "completed" && status !== "failed" && status !== "stopped") return;
      const taskId = system["task_id"] as string;
      const edgeDescription = typeof system["description"] === "string" ? (system["description"] as string) : "";
      if (started && edgeDescription) session.taskDescriptions.set(taskId, edgeDescription);
      const description =
        edgeDescription ||
        session.taskDescriptions.get(taskId) ||
        session.backgroundTasks.find((task) => task.taskId === taskId)?.description ||
        session.foregroundTasks.get(taskId)?.description ||
        "";
      const taskType = typeof system["task_type"] === "string" ? (system["task_type"] as string) : null;
      const toolUseId = typeof system["tool_use_id"] === "string" ? (system["tool_use_id"] as string) : null;
      // `background_tasks_changed` is the level signal for the live set, but
      // not every claude CLI build sends one for a task auto-backgrounded
      // mid-flight rather than started backgrounded (observed on 2.1.281) —
      // so these edges maintain the set too, whichever arrives, and publish
      // the same event so a client relying on either one stays correct.
      if (started) {
        const call = toolUseId ? session.toolUseCalls.get(toolUseId) : undefined;
        const command = call && typeof call.input["command"] === "string" ? (call.input["command"] as string) : null;
        const existingIndex = session.backgroundTasks.findIndex((task) => task.taskId === taskId);
        if (existingIndex === -1) {
          const entry = { taskId, taskType, description, toolName: call?.name ?? null, command, startedAt: new Date().toISOString() };
          // A foreground task (a subagent, or a Bash call still blocking the
          // turn) is not background work yet: park it until a `task_updated`
          // patch backgrounds it, and record nothing now.
          if (system["is_backgrounded"] === false) {
            session.foregroundTasks.set(taskId, entry);
            return;
          }
          session.backgroundTasks = [...session.backgroundTasks, entry];
          this.publishBackgroundTasks(session);
        } else {
          // Already known (the level signal usually arrives first): back-fill
          // what only this edge carries — the description and the
          // originating tool call — rather than leaving the entry bare.
          const existing = session.backgroundTasks[existingIndex]!;
          const next: BackgroundTaskSummary = {
            ...existing,
            description: existing.description || description,
            taskType: existing.taskType ?? taskType,
            toolName: existing.toolName ?? call?.name ?? null,
            command: existing.command ?? command,
            startedAt: existing.startedAt ?? new Date().toISOString(),
          };
          if (JSON.stringify(next) !== JSON.stringify(existing)) {
            const tasks = [...session.backgroundTasks];
            tasks[existingIndex] = next;
            session.backgroundTasks = tasks;
            this.publishBackgroundTasks(session);
          }
        }
      } else {
        session.taskDescriptions.delete(taskId);
        // Settled while still in the foreground: never background work, and
        // its own tool call already reports the outcome.
        if (session.foregroundTasks.delete(taskId)) return;
        if (session.backgroundTasks.some((task) => task.taskId === taskId)) {
          session.backgroundTasks = session.backgroundTasks.filter((task) => task.taskId !== taskId);
          this.publishBackgroundTasks(session);
        }
      }
      this.publishTaskEdge(session, {
        taskId,
        status,
        description,
        taskType,
        toolUseId,
        summary: typeof system["summary"] === "string" && system["summary"] ? (system["summary"] as string) : null,
      });
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
    const blocks = contentBlocks(message.message as unknown);
    this.indexSdkMessage(
      session,
      message.uuid,
      null,
      blocks.flatMap((block) => (block["type"] === "tool_result" && typeof block["tool_use_id"] === "string" ? [block["tool_use_id"] as string] : [])),
    );
    for (const block of blocks) {
      if (block["type"] !== "tool_result") continue;
      const toolUseId = block["tool_use_id"];
      if (typeof toolUseId !== "string") continue;
      // Replay the call's own name and input: the result block has neither.
      const call = session.toolUseCalls.get(toolUseId);
      session.toolUseCalls.delete(toolUseId);
      if (call && block["is_error"] !== true) this.applyTaskToolResult(session, call, message);
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

  /**
   * The Task tools' structured output (`tool_use_result` on the result's
   * `user` message): `TaskCreate`'s `{ task: { id, subject } }` adds the
   * entry under its assigned id; `TaskList`'s `{ tasks }` is the whole list,
   * so the checklist resyncs to it (e.g. after a resume dropped ours).
   */
  private applyTaskToolResult(
    session: ClaudeSession,
    call: { name: string; input: Record<string, unknown> },
    message: Extract<SDKMessage, { type: "user" }>,
  ): void {
    if (call.name !== "TaskCreate" && call.name !== "TaskList") return;
    const output = (message as unknown as { tool_use_result?: unknown }).tool_use_result;
    if (output === null || typeof output !== "object") return;
    const record = output as Record<string, unknown>;
    if (call.name === "TaskCreate") {
      const task = record["task"] as Record<string, unknown> | null | undefined;
      const id = task && typeof task["id"] === "string" ? (task["id"] as string) : null;
      if (id === null || session.checklist.some((item) => item.id === id)) return;
      const subject =
        typeof call.input["subject"] === "string" && call.input["subject"]
          ? (call.input["subject"] as string)
          : typeof task?.["subject"] === "string"
            ? (task["subject"] as string)
            : id;
      session.checklist = [...session.checklist, { id, subject, status: "pending" }];
      this.publishChecklist(session);
      return;
    }
    if (!Array.isArray(record["tasks"])) return;
    session.checklist = (record["tasks"] as unknown[]).flatMap((raw) => {
      if (raw === null || typeof raw !== "object") return [];
      const task = raw as Record<string, unknown>;
      if (typeof task["id"] !== "string" || typeof task["subject"] !== "string") return [];
      return [{ id: task["id"], subject: task["subject"], status: checklistStatus(task["status"]) }];
    });
    this.publishChecklist(session);
  }

  /** Publishes the live checklist: `plan` from a `TodoWrite` call, else the Task tools' list. */
  private publishChecklist(session: ClaudeSession, plan?: Array<{ step: string; status: string }>): void {
    this.publish({
      type: "turn.plan.updated",
      provider: "claude",
      threadId: session.threadId,
      turnId: session.transcript.find((turn) => turn.status === "running")?.id ?? null,
      raw: { plan: plan ?? session.checklist.map((item) => ({ step: item.subject, status: item.status })) },
    });
  }

  private publishBackgroundTasks(session: ClaudeSession): void {
    this.publish({ type: "background.tasks.changed", provider: "claude", threadId: session.threadId, tasks: session.backgroundTasks });
  }

  private publishTaskEdge(
    session: ClaudeSession,
    edge: {
      taskId: string;
      status: "started" | "completed" | "failed" | "stopped";
      description: string;
      taskType: string | null;
      toolUseId: string | null;
      summary: string | null;
    },
  ): void {
    const open = session.transcript.find((turn) => turn.status === "running") ?? null;
    this.publish({ type: "background.task", provider: "claude", threadId: session.threadId, turnId: open?.id ?? null, ...edge });
  }

  /**
   * `task_updated`, a partial patch to one task. Three fields matter: a
   * renamed `description`; `is_backgrounded`, a foreground task moved to the
   * background mid-flight — the moment it becomes background work; and a
   * terminal `status`, which drops the task from the live set even when no
   * `task_notification` follows (one that does still records the finish,
   * with its summary).
   */
  private applyTaskPatch(session: ClaudeSession, system: Record<string, unknown>): void {
    const taskId = system["task_id"];
    const patch = system["patch"];
    if (typeof taskId !== "string" || patch === null || typeof patch !== "object") return;
    const fields = patch as Record<string, unknown>;
    const description = typeof fields["description"] === "string" && fields["description"] ? (fields["description"] as string) : null;
    const status = fields["status"];
    const terminal = status === "completed" || status === "failed" || status === "killed";
    let parked = session.foregroundTasks.get(taskId);
    if (description !== null) {
      session.taskDescriptions.set(taskId, description);
      if (parked) session.foregroundTasks.set(taskId, (parked = { ...parked, description }));
    }
    let tasks = session.backgroundTasks.map((task) =>
      task.taskId === taskId && description !== null && task.description !== description ? { ...task, description } : task,
    );
    if (fields["is_backgrounded"] === true && parked && !terminal) {
      session.foregroundTasks.delete(taskId);
      if (!tasks.some((task) => task.taskId === taskId)) {
        tasks = [...tasks, parked];
        this.publishTaskEdge(session, {
          taskId,
          status: "started",
          description: parked.description,
          taskType: parked.taskType,
          toolUseId: null,
          summary: null,
        });
      }
    }
    if (terminal) tasks = tasks.filter((task) => task.taskId !== taskId);
    if (JSON.stringify(tasks) !== JSON.stringify(session.backgroundTasks)) {
      session.backgroundTasks = tasks;
      this.publishBackgroundTasks(session);
    }
  }

  /**
   * The running turn, or — when assistant output arrives with none — a turn
   * Claude Code started itself: a finished background task or a Monitor
   * event wakes the session with no prompt of ours (observed: `system init`,
   * then the output, then a `result` with `origin.kind: "task-notification"`).
   * Output from a run we interrupted is dropped until its own `result`.
   */
  private turnForOutput(session: ClaudeSession): TranscriptTurn | null {
    const open = session.transcript.find((turn) => turn.status === "running") ?? null;
    if (open || session.drainUntilResult || session.closed) return open;
    const turn: TranscriptTurn = {
      id: randomUUID(),
      prompt: "",
      items: [],
      status: "running",
      text: "",
      costUsd: 0,
      error: null,
      origin: "background",
    };
    session.transcript.push(turn);
    this.publish({ type: "turn.started", provider: "claude", threadId: session.threadId, turnId: turn.id, origin: "background" });
    return turn;
  }

  /** The pending message was interim after all: publish it as a note. */
  private flushNote(session: ClaudeSession, turn: TranscriptTurn | null): void {
    const pending = session.pendingText;
    session.pendingText = null;
    if (!pending || !pending.text.trim()) return;
    this.publish({
      type: "assistant.note",
      provider: "claude",
      threadId: session.threadId,
      turnId: turn?.id ?? null,
      messageId: pending.messageId,
      text: pending.text,
    });
  }

  private handleAssistant(session: ClaudeSession, message: Extract<SDKMessage, { type: "assistant" }>): void {
    const subagent = message.parent_tool_use_id !== null;
    const open = subagent
      ? (session.transcript.find((turn) => turn.status === "running") ?? null)
      : this.turnForOutput(session);
    if (!subagent && !open && session.drainUntilResult) return;
    const blocks = contentBlocks(message.message as unknown);
    const messageId =
      typeof (message.message as { id?: unknown }).id === "string"
        ? ((message.message as { id: string }).id)
        : (message.uuid ?? randomUUID());
    this.indexSdkMessage(
      session,
      message.uuid,
      messageId,
      blocks.flatMap((block) => (block["type"] === "tool_use" && typeof block["id"] === "string" ? [block["id"] as string] : [])),
    );
    for (const block of blocks) {
      if (block["type"] === "text" && typeof block["text"] === "string" && !subagent) {
        const text = block["text"] as string;
        // A new API message after text we held means that text was interim.
        if (session.pendingText && session.pendingText.messageId !== messageId) this.flushNote(session, open);
        session.pendingText = {
          messageId,
          text: session.pendingText ? `${session.pendingText.text}${text}` : text,
        };
        if (open) {
          open.text += text;
          open.items.push({ kind: "assistant", text });
        }
        this.publishTextBlock(session, open, messageId, text);
      }
      // Thinking the stream did not already report (no partial messages):
      // report it whole, with no duration to give.
      if (block["type"] === "thinking" && !subagent && !session.streamedThinking.has(messageId)) {
        const thinking = typeof block["thinking"] === "string" ? (block["thinking"] as string) : "";
        this.publishReasoning(session, open, `${messageId}:${blocks.indexOf(block)}`, "completed", thinking, null, null);
      }
      if (block["type"] === "tool_use" && typeof block["id"] === "string" && !subagent) {
        // Text followed by a tool call was a note on the way, not the answer.
        this.flushNote(session, open);
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
        // Claude's own live checklist. Published from the call itself (not
        // its result, which just echoes the input back) so the panel updates
        // as soon as the model writes it, same as Claude Code's own UI.
        if (name === "TodoWrite") {
          const plan = todoWritePlan(input);
          if (plan !== null) this.publishChecklist(session, plan);
        }
        // Its Task-tool successor: an update is applied from the call (it
        // names its target), a create only from its result, which carries
        // the id every later update refers to.
        if (name === "TaskUpdate") {
          const taskId = taskUpdateId(input);
          const index = taskId === null ? -1 : session.checklist.findIndex((item) => item.id === taskId);
          if (index !== -1) {
            const current = session.checklist[index]!;
            session.checklist =
              input["status"] === "deleted"
                ? session.checklist.filter((item) => item.id !== taskId)
                : session.checklist.map((item, at) =>
                    at === index
                      ? {
                          ...current,
                          ...(typeof input["subject"] === "string" && input["subject"] ? { subject: input["subject"] as string } : {}),
                          ...(input["status"] === undefined ? {} : { status: checklistStatus(input["status"]) }),
                        }
                      : item,
                  );
            this.publishChecklist(session);
          }
        }
      }
    }
    if (!subagent) {
      const usage = (message.message as unknown as { usage?: Parameters<typeof addFrameUsage>[1] }).usage;
      session.usage = addFrameUsage(session.usage, usage);
    }
  }

  private handleResult(session: ClaudeSession, message: Extract<SDKMessage, { type: "result" }>): void {
    // A run's streaming bookkeeping ends with it.
    const stopFailure = session.lastStopFailure;
    session.lastStopFailure = null;
    session.textPublished.clear();
    session.textAccounted.clear();
    session.streamedThinking.clear();
    session.stream = { messageId: null, blocks: new Map() };
    if (session.drainUntilResult) {
      // The interrupted run's own ending: its turn is already settled.
      session.drainUntilResult = false;
      session.pendingText = null;
      return;
    }
    if (message.subtype === "success") {
      const cost = typeof message.total_cost_usd === "number" ? message.total_cost_usd : 0;
      session.usage = { ...session.usage, costUsd: cost };
      const open = session.transcript.find((turn) => turn.status === "running");
      // A steer that arrived too late to fold into this run is queued as the
      // CLI's next run, announced here; our turn is not over until it is.
      const queued = (message as { queued_turn_count?: unknown }).queued_turn_count;
      if (open && typeof queued === "number" && queued > 0) {
        if (typeof message.result === "string" && message.result) open.text = message.result;
        // A steered run follows: this run's answer is only a note on the way.
        this.flushNote(session, open);
        return;
      }
      // The held message was the answer, recorded from `result` below.
      session.pendingText = null;
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
    session.pendingText = null;
    const errorText = extractResultError(message, stopFailure);
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
    const { windows, blocked, wrapUp, rateLimitType } = mapRateLimitEvent(info);
    this.publish({
      type: "rate-limits.updated",
      provider: "claude",
      threadId: session.threadId,
      windows,
      raw: { rateLimitType, status: info.status },
    });
    if (!blocked && !wrapUp) return;
    const open = session.transcript.find((turn) => turn.status === "running");
    if (!open) return;
    const resetsAt = windows[0]?.resetsAt ?? null;
    const key = `${blocked ? "" : "wrap-up:"}${rateLimitType}:${resetsAt ?? "unknown"}`;
    const announced = session.announcedRateLimits.get(open.id) ?? new Set<string>();
    if (announced.has(key)) return;
    announced.add(key);
    session.announcedRateLimits.set(open.id, announced);
    this.publish({
      type: "thread.state.changed",
      provider: "claude",
      threadId: session.threadId,
      state: blocked ? "rate-limited" : "usage-wrap-up",
      raw: {
        rateLimitType,
        label: windows[0]?.label ?? null,
        resetsAt,
        notice: describePauseUntil(resetsAt, Date.now()) ?? "paused",
      },
    });
  }

  // -- hooks ------------------------------------------------------------------

  /**
   * In-process hooks for what the message stream does not say: the summary
   * a compaction kept, a model switch the CLI made on its own, auto mode
   * refusing a tool call, why a run died on an API error, and native
   * subagents with their last word. They only observe — every callback
   * answers `{}` at once, and the user's own settings hooks still run.
   */
  private sessionHooks(session: ClaudeSession): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const observe = (run: (input: Record<string, unknown>) => void): HookCallbackMatcher[] => [
      {
        hooks: [
          async (input) => {
            try {
              if (!session.closed) run(input as unknown as Record<string, unknown>);
            } catch {
              // An observer never breaks the session.
            }
            return {};
          },
        ],
      },
    ];
    const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
    const openTurnId = (): TurnId | null => session.transcript.find((turn) => turn.status === "running")?.id ?? null;
    return {
      PostCompact: observe((input) => {
        this.publish({
          type: "session.notice",
          provider: "claude",
          threadId: session.threadId,
          turnId: openTurnId(),
          notice: "compacted",
          title: input["trigger"] === "auto" ? "Conversation compacted automatically" : "Conversation compacted",
          detail: text(input["compact_summary"]),
        });
      }),
      PostModelSwitch: observe((input) => {
        // Our own switches (`sdk`) and a resume restoring the model are not news.
        const to = text(input["to_model"]);
        if (input["source"] !== "auto" || !to || to === session.model) return;
        const from = text(input["from_model"]);
        session.model = to;
        this.publish({
          type: "model.changed",
          provider: "claude",
          threadId: session.threadId,
          turnId: openTurnId(),
          from,
          to,
          fromLabel: from === null ? null : claudeModelName(from),
          toLabel: claudeModelName(to),
          reason: "auto",
          scope: "session",
          category: null,
        });
      }),
      PermissionDenied: observe((input) => {
        const tool = text(input["tool_name"]) ?? "a tool call";
        this.publish({
          type: "session.notice",
          provider: "claude",
          threadId: session.threadId,
          turnId: openTurnId(),
          notice: "permission-denied",
          title: `Auto mode denied ${tool}`,
          detail: text(input["reason"]),
        });
      }),
      StopFailure: observe((input) => {
        session.lastStopFailure = describeStopFailure(text(input["error"]), text(input["error_details"]));
      }),
      SubagentStart: observe((input) => this.publishSubagent(session, input, "started")),
      SubagentStop: observe((input) => this.publishSubagent(session, input, "stopped")),
    };
  }

  private publishSubagent(session: ClaudeSession, input: Record<string, unknown>, status: "started" | "stopped"): void {
    const agentId = typeof input["agent_id"] === "string" ? input["agent_id"] : null;
    if (!agentId) return;
    // Claude Code's own internal agents (prompt suggestions, `/btw`) fire
    // the stop hook too, typed as the session's agent — empty, since we
    // run without one. They are not subagents anyone spawned.
    if (typeof input["agent_type"] !== "string" || !input["agent_type"]) return;
    const lastMessage = typeof input["last_assistant_message"] === "string" && input["last_assistant_message"].trim()
      ? input["last_assistant_message"].trim()
      : null;
    this.publish({
      type: "subagent.updated",
      provider: "claude",
      threadId: session.threadId,
      turnId: session.transcript.find((turn) => turn.status === "running")?.id ?? null,
      agentId,
      agentType: input["agent_type"],
      status,
      lastMessage: status === "stopped" ? lastMessage : null,
    });
  }

  // -- refusal fallback -----------------------------------------------------

  /**
   * The CLI re-ran a flagged request on another model (`model_refusal_fallback`).
   * What the refused attempt already streamed is taken back, and a
   * session-scoped switch moves the session — later turns run on the
   * fallback model, the way Claude Code keeps it.
   */
  private applyRefusalFallback(session: ClaudeSession, system: Record<string, unknown>): void {
    const to = typeof system["fallback_model"] === "string" ? (system["fallback_model"] as string) : null;
    if (!to) return;
    const from = typeof system["original_model"] === "string" ? (system["original_model"] as string) : null;
    const scope = system["scope"] === "local" ? "local" : "session";
    this.retract(session, system["retracted_message_uuids"]);
    if (scope === "session") session.model = to;
    this.publish({
      type: "model.changed",
      provider: "claude",
      threadId: session.threadId,
      turnId: session.transcript.find((turn) => turn.status === "running")?.id ?? null,
      from,
      to,
      fromLabel: from === null ? null : claudeModelName(from),
      toLabel: claudeModelName(to),
      reason: "refusal-fallback",
      scope,
      category: typeof system["api_refusal_category"] === "string" ? (system["api_refusal_category"] as string) : null,
    });
  }

  /** Take back streamed output by SDK message uuid (idempotent: unknown uuids are skipped). */
  private retract(session: ClaudeSession, uuids: unknown): void {
    if (!Array.isArray(uuids)) return;
    const messageIds = new Set<string>();
    const toolUseIds = new Set<string>();
    for (const uuid of uuids) {
      const known = typeof uuid === "string" ? session.sdkMessages.get(uuid) : undefined;
      if (!known) continue;
      if (known.messageId) messageIds.add(known.messageId);
      for (const id of known.toolUseIds) toolUseIds.add(id);
    }
    if (messageIds.size === 0 && toolUseIds.size === 0) return;
    if (session.pendingText && messageIds.has(session.pendingText.messageId)) session.pendingText = null;
    this.publish({
      type: "message.retracted",
      provider: "claude",
      threadId: session.threadId,
      turnId: session.transcript.find((turn) => turn.status === "running")?.id ?? null,
      messageIds: [...messageIds],
      toolUseIds: [...toolUseIds],
    });
  }

  /** Remember which API message and tool calls an SDK message carried, for `retract`. */
  private indexSdkMessage(session: ClaudeSession, uuid: string | undefined, messageId: string | null, toolUseIds: string[]): void {
    if (!uuid) return;
    session.sdkMessages.set(uuid, { messageId, toolUseIds });
    // Only the latest turn's messages can be retracted; keep the index bounded.
    if (session.sdkMessages.size > SDK_MESSAGE_INDEX_LIMIT) {
      const oldest = session.sdkMessages.keys().next().value;
      if (oldest !== undefined) session.sdkMessages.delete(oldest);
    }
  }

  /**
   * The CLI's blocking dialogs. Only the refusal-fallback choice is declared
   * (`supportedDialogKinds`); it is asked the way an agent question is —
   * through the answer panel — and answered with the CLI's own result ids.
   */
  private async onUserDialog(
    request: UserDialogRequest,
    options: { signal: AbortSignal },
  ): Promise<UserDialogResult | null> {
    if (request.dialogKind !== REFUSAL_FALLBACK_DIALOG) return { behavior: "cancelled" };
    const session = this.sessionForToolUse(request.toolUseID);
    if (!session || session.closed) return { behavior: "cancelled" };
    const payload = request.payload;
    const original = typeof payload["originalModel"] === "string" ? claudeModelName(payload["originalModel"]) : "The model";
    const fallback = typeof payload["fallbackModel"] === "string" ? claudeModelName(payload["fallbackModel"]) : "the fallback model";
    const category = refusalCategoryLabel(payload["apiRefusalCategory"]);
    const guidance = typeof payload["guidanceText"] === "string" && payload["guidanceText"].trim() ? payload["guidanceText"].trim() : null;
    const question = `${original} flagged this request${category ? ` (${category})` : ""}. Re-run it on ${fallback}?`;
    const retry = `Retry on ${fallback}`;
    const edit = "Edit prompt";
    const input = {
      questions: [
        {
          question,
          header: "Flagged",
          multiSelect: false,
          allowCustomAnswer: false,
          options: [
            { label: retry, description: `Switch this thread to ${fallback} and run the request again.` },
            { label: edit, description: guidance ?? "End the turn so you can rephrase the request." },
          ],
        },
      ],
    };
    const answer = await this.parkInput(session, "RefusalFallback", input, { signal: options.signal });
    // Whatever was chosen, the refused partial is gone once the dialog resolves.
    this.retract(session, payload["retractedMessageUuids"]);
    if (answer.behavior !== "allow") return { behavior: "cancelled" };
    const answers = (answer.updatedInput?.["answers"] ?? {}) as Record<string, unknown>;
    const chosen = answers[question];
    if (chosen === retry) return { behavior: "completed", result: "retry_fallback" };
    if (chosen === edit) return { behavior: "completed", result: "edit_prompt" };
    return { behavior: "cancelled" };
  }

  /**
   * Re-probe usage when the last probe is older than a live context
   * reading's interval, so each reading carries a current cost (and plan
   * windows) mid-turn. Waits briefly: a slow probe costs this reading's
   * freshness, never the reading.
   */
  private async refreshCost(session: ClaudeSession): Promise<void> {
    if (Date.now() - session.usageProbedAt < COST_REFRESH_MS) return;
    await Promise.race([this.probeUsage(session), new Promise((resolve) => setTimeout(resolve, COST_REFRESH_WAIT_MS))]);
  }

  private async probeUsage(session: ClaudeSession): Promise<void> {
    session.usageProbedAt = Date.now();
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
      // The session's running cost, counted per request — unlike a turn's
      // `result`, which only arrives when the turn ends (and never during a
      // long one). A resumed session's restored spend arrives here too.
      if (typeof response?.session?.total_cost_usd === "number") {
        session.usage = { ...session.usage, costUsd: response.session.total_cost_usd };
      }
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
          usedPercent: window.usedPercent,
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
        usageProbedAt: 0,
        sdkMessages: new Map(),
        stream: { messageId: null, blocks: new Map() },
        textPublished: new Map(),
        textAccounted: new Map(),
        streamedThinking: new Set(),
        lastStopFailure: null,
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
    return this.transport.query(session.input, this.queryOptions(session));
  }

  /**
   * Everything a session's `query()` starts with. One builder for a first
   * start and a rebuilt one (after a rollback fork), so a rebuilt session
   * keeps its MCP servers, runtime instructions and effort — it used to come
   * back without them.
   */
  private queryOptions(session: ClaudeSession): ClaudeQueryOptions {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      withTaskTools(makeClaudeEnv({ homePath: this.settings.homePath }, this.baseEnv)),
    )) {
      if (typeof value === "string") env[key] = value;
    }
    return {
      cwd: session.workingDirectory,
      ...(session.model ? { model: session.model } : {}),
      ...(session.resumeSessionId ? { resume: session.resumeSessionId } : {}),
      // Built per query: an in-process server instance connects to one query only, so a rebuilt one needs its own.
      ...(session.mcpServers ? { mcpServers: claudeMcpServers(session.mcpServers) } : {}),
      // Always Claude Code's own prompt: the SDK's default when this is
      // omitted is an *empty* custom prompt (`systemPrompt = ""`), which
      // left sessions without Claude Code's tool and environment guidance.
      // moxen's runtime instructions are appended to it, never in place of it.
      systemPrompt: {
        type: "preset" as const,
        preset: "claude_code" as const,
        ...(session.instructions ? { append: session.instructions } : {}),
      },
      permissionMode: session.basePermissionMode,
      ...(needsAllowDangerouslySkipPermissions(session.basePermissionMode)
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      ...spawnEffortOptions(session.effort),
      env,
      pathToClaudeCodeExecutable: resolveClaudeExecutable(this.settings.binaryPath, this.baseEnv),
      canUseTool: this.handlePermissionRequest,
      hooks: this.sessionHooks(session),
      // Text streams token by token (`stream_event`), and thinking comes back
      // as readable summaries rather than the default, which can be none.
      // All three are settings (`providers.claude.*`) read at spawn.
      includePartialMessages: this.settings.partialMessages,
      extraArgs: { "thinking-display": this.settings.thinkingDisplay },
      // A predicted next prompt after each turn, offered in the composer.
      promptSuggestions: this.settings.promptSuggestions,
      // Option previews in agent questions are written as markdown, which
      // the answer panel renders; HTML would need a browser.
      toolConfig: { askUserQuestion: { previewFormat: "markdown" } },
      // The refusal-fallback choice ("retry on the fallback model, or edit
      // the prompt"): without it declared, a flagged request just ends the
      // turn with a refusal whenever the user turned automatic switching off.
      onUserDialog: this.handleUserDialog,
      supportedDialogKinds: [REFUSAL_FALLBACK_DIALOG],
    };
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

/**
 * Opts the session into Claude Code's task-tracking tools (`TaskCreate` /
 * `TaskUpdate` / `TaskList` / `TaskGet`, or `TodoWrite` under
 * `CLAUDE_CODE_ENABLE_TASKS=0`). Claude Code only provides them by default
 * on older models (up to Opus 4.7 / Sonnet 4.6 / Haiku 4.5); without this, a
 * newer model never writes the checklist the tasks panel renders. An
 * explicit value in the user's own environment (e.g. `0`) wins.
 */
function withTaskTools(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env["CLAUDE_CODE_ENABLE_TODO_TOOLS"] !== undefined) return env;
  return { ...env, CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" };
}

type ChecklistStatus = "pending" | "inProgress" | "completed";

function checklistStatus(raw: unknown): ChecklistStatus {
  return raw === "in_progress" ? "inProgress" : raw === "completed" ? "completed" : "pending";
}

/** A `TaskUpdate` call's target id; the streamed input is the model's raw shape, before Claude Code repairs `id`/`task_id` to `taskId`. */
function taskUpdateId(input: Record<string, unknown>): string | null {
  for (const key of ["taskId", "id", "task_id"]) {
    const value = input[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/** `TodoWriteInput.todos` (`{content, status, activeForm}[]`) → the `{step, status}[]` checklist shape `latestPlan` reads. */
function todoWritePlan(input: Record<string, unknown>): Array<{ step: string; status: string }> | null {
  const todos = input["todos"];
  if (!Array.isArray(todos)) return null;
  const items = todos.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const step = typeof row["content"] === "string" ? row["content"] : null;
    if (step === null) return [];
    return [{ step, status: checklistStatus(row["status"]) }];
  });
  return items;
}

/** A `StopFailure`'s error category and details, in words. */
function describeStopFailure(error: string | null, details: string | null): string {
  const reasons: Record<string, string> = {
    authentication_failed: "Claude could not authenticate",
    oauth_org_not_allowed: "This organization is not allowed to use Claude Code",
    account_on_hold: "The Claude account is on hold",
    verification_required: "The Claude account needs verification",
    billing_error: "Claude reported a billing problem",
    rate_limit: "Claude is rate limited",
    overloaded: "Claude is overloaded",
    invalid_request: "Claude rejected the request",
    model_not_found: "The model is not available",
    server_error: "Claude had a server error",
    max_output_tokens: "The reply hit the output token limit",
    cloud_credential_error: "The cloud provider credentials failed",
  };
  const reason = (error && reasons[error]) ?? "The run ended on an API error";
  return details ? `${reason}: ${details}` : `${reason}.`;
}

/** A failed result's own error text; the hook's reason, then a generic line, when it carries none. */
function extractResultError(message: Extract<SDKMessage, { type: "result" }>, stopFailure: string | null = null): string {
  if (message.subtype === "success") return "";
  const record = message as unknown as Record<string, unknown>;
  for (const key of ["error", "message", "detail"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 500);
  }
  return stopFailure ?? `Claude run failed (${message.subtype}).`;
}

/** The categories and per-tool shares of a `SDKControlGetContextUsageResponse`. */
export function claudeContextCategoriesOf(raw: unknown): Pick<ContextBreakdown, "categories" | "estimated" | "tools"> {
  const record = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const categories = (Array.isArray(record["categories"]) ? record["categories"] : []).flatMap((entry) => {
    const row = entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (row === null || typeof row["name"] !== "string" || typeof row["tokens"] !== "number") return [];
    // Deferred tools (behind tool search) take no room until loaded.
    if (row["kind"] === "deferred" || row["isDeferred"] === true) return [];
    const kind = row["kind"] === "free" || row["kind"] === "buffer" ? row["kind"] : "used";
    return [{ name: row["name"], tokens: row["tokens"], kind } as const];
  });
  const breakdown = record["messageBreakdown"] !== null && typeof record["messageBreakdown"] === "object"
    ? (record["messageBreakdown"] as Record<string, unknown>)
    : null;
  const tools = (Array.isArray(breakdown?.["toolCallsByType"]) ? (breakdown!["toolCallsByType"] as unknown[]) : [])
    .flatMap((entry) => {
      const row = entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
      if (row === null || typeof row["name"] !== "string") return [];
      const tokens = (typeof row["callTokens"] === "number" ? row["callTokens"] : 0) + (typeof row["resultTokens"] === "number" ? row["resultTokens"] : 0);
      return tokens > 0 ? [{ name: row["name"], tokens }] : [];
    })
    .sort((left, right) => right.tokens - left.tokens);
  return { categories, estimated: false, ...(tools.length > 0 ? { tools } : {}) };
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
    servers.map((server): [string, McpServerConfig] => {
      // Hosted inside this process through the SDK: its tools call straight
      // into whoever built the spec, with no child process in between.
      if (server.type === "in-process") return [server.name, sdkMcpServer(server)];
      const alwaysLoad = server.alwaysLoad === true ? { alwaysLoad: true } : {};
      return server.type === "http"
        ? [server.name, { type: "http", url: server.url, headers: { ...server.headers }, ...alwaysLoad }]
        : [server.name, { type: "stdio", command: server.command, args: [...server.args], env: { ...server.env }, ...alwaysLoad }];
    }),
  );
}
