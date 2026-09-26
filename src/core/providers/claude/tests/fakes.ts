/**
 * Scripted doubles for the Claude transport layer. No test using these
 * spawns the real CLI.
 */
import type {
  CanUseTool,
  PermissionMode,
  SDKMessage,
  SDKUserMessage,
  SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  ClaudeQuery,
  ClaudeQueryOptions,
  ClaudeSessionApi,
  ClaudeTransport,
  FlagSettings,
  ForkSessionResult,
} from "../transport.js";

export class FakeQuery implements ClaudeQuery {
  interrupted = 0;
  readonly permissionModes: PermissionMode[] = [];
  readonly models: Array<string | undefined> = [];
  usageProbeResponse: unknown = null;
  /** What `supportedCommands` answers. */
  supportedCommandsResponse: Array<{ name: string; description: string; argumentHint: string; builtin?: boolean }> = [];
  closed = false;

  async supportedCommands(): Promise<Array<{ name: string; description: string; argumentHint: string; builtin?: boolean }>> {
    return this.supportedCommandsResponse;
  }

  close(): void {
    this.closed = true;
  }

  /** What `getContextUsage` answers; the details asked for are recorded. */
  contextUsageResponse: unknown = null;
  readonly contextUsageRequests: Array<{ detail?: string } | undefined> = [];
  private readonly backlog: SDKMessage[];
  private readonly takers: Array<(result: IteratorResult<SDKMessage>) => void> = [];
  private notifyPrompt: () => void = () => undefined;
  private readonly promptGate = new Promise<void>((resolve) => {
    this.notifyPrompt = resolve;
  });

  constructor(
    initial: SDKMessage[],
    readonly options: ClaudeQueryOptions,
    prompt?: AsyncIterable<SDKUserMessage> | string,
  ) {
    this.backlog = [...initial];
    // Like the live session, turn traffic only flows after a prompt. The
    // gate latches: multi-turn scripts stay test-driven via push().
    if (typeof prompt === "string" || prompt === undefined) this.notifyPrompt();
    else void this.drainPrompt(prompt);
  }

  /** Text of every user message the driver streamed in, in order. */
  readonly prompts: string[] = [];
  /** The messages themselves, content blocks and all. */
  readonly messages: SDKUserMessage[] = [];

  private async drainPrompt(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of prompt) {
      this.messages.push(message);
      const content = (message.message as { content?: unknown }).content;
      const text = Array.isArray(content)
        ? content.map((block) => (block as { text?: string }).text ?? "").join("")
        : String(content ?? "");
      this.prompts.push(text);
      this.notifyPrompt();
    }
  }

  /** Deliver one more message, exactly like the live CLI would. */
  push(message: SDKMessage): void {
    const taker = this.takers.shift();
    if (taker) taker({ value: message, done: false });
    else this.backlog.push(message);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    let first = true;
    for (;;) {
      const next = this.backlog.shift();
      if (next) {
        if (!first) await this.promptGate;
        first = false;
        yield next;
        continue;
      }
      const result = await new Promise<IteratorResult<SDKMessage>>((resolve) => {
        this.takers.push(resolve);
      });
      if (result.done) return;
      yield result.value as SDKMessage;
    }
  }

  /** End the stream, the way a spent CLI query does. */
  end(): void {
    this.ended = true;
    const taker = this.takers.shift();
    if (taker) taker({ value: undefined, done: true });
  }

  ended = false;

  /**
   * The live `interrupt()` ends the query for good — the iterator finishes
   * and no later prompt is ever read. The fake used to keep yielding, which
   * is why a session left dead by an interrupt looked healthy in tests.
   */
  async interrupt(): Promise<undefined> {
    this.interrupted += 1;
    this.end();
    return undefined;
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionModes.push(mode);
  }

  async setModel(model?: string): Promise<void> {
    this.models.push(model);
  }

  /** Every `applyFlagSettings` call, in order. */
  readonly flagSettings: FlagSettings[] = [];

  async applyFlagSettings(settings: FlagSettings): Promise<void> {
    this.flagSettings.push(settings);
  }

  async getContextUsage(options?: { detail?: "summary" | "full" }): Promise<unknown> {
    this.contextUsageRequests.push(options);
    return this.contextUsageResponse;
  }

  async usageExperimental(): Promise<unknown> {
    return this.usageProbeResponse;
  }
}

export class FakeTransport implements ClaudeTransport {
  readonly created: FakeQuery[] = [];
  /** Handed to every query's `supportedCommands`. */
  commands: Array<{ name: string; description: string; argumentHint: string; builtin?: boolean }> = [];

  constructor(
    private scripts: SDKMessage[][],
    private probeResponses: unknown[] = [],
  ) {}

  query(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: ClaudeQueryOptions,
  ): ClaudeQuery {
    const fake = new FakeQuery(
      this.scripts.shift() ?? [],
      options,
      typeof prompt === "string" ? undefined : prompt,
    );
    fake.usageProbeResponse = this.probeResponses.shift() ?? null;
    fake.supportedCommandsResponse = this.commands;
    this.created.push(fake);
    return fake;
  }
}

export class FakeSessionApi implements ClaudeSessionApi {
  readonly forks: Array<{ sessionId: string; upToMessageId: string | undefined }> = [];

  /** Session ids `sessionExists` reports; everything else reads as gone. */
  readonly existing = new Set<string>();

  constructor(
    private history: SessionMessage[] = [],
    private forkResult: string = "forked-session",
  ) {}

  async sessionExists(sessionId: string): Promise<boolean> {
    return this.existing.has(sessionId);
  }

  async getSessionMessages(_sessionId: string): Promise<SessionMessage[]> {
    return this.history;
  }

  async forkSession(sessionId: string, upToMessageId?: string): Promise<ForkSessionResult> {
    this.forks.push({ sessionId, upToMessageId });
    return { sessionId: this.forkResult };
  }
}

export function permissionCallbackOptions(toolUseID = "tu-1"): Parameters<CanUseTool>[2] {
  return {
    toolUseID,
    requestId: `req-${toolUseID}`,
    signal: new AbortController().signal,
  };
}

function asMessage(value: unknown): SDKMessage {
  return value as unknown as SDKMessage;
}

export function initMessage(overrides: Record<string, unknown> = {}): SDKMessage {
  return asMessage({
    type: "system",
    subtype: "init",
    session_id: "session-1",
    apiKeySource: "none",
    model: "test-model",
    ...overrides,
  });
}

export function assistantText(
  text: string,
  usage: Record<string, number> = { input_tokens: 10, output_tokens: 5 },
  overrides: Record<string, unknown> = {},
): SDKMessage {
  return asMessage({
    type: "assistant",
    message: {
      content: [{ type: "text", text }],
      usage,
    },
    parent_tool_use_id: null,
    uuid: "assistant-1",
    session_id: "session-1",
    ...overrides,
  });
}

export function assistantToolUse(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown> = {},
): SDKMessage {
  return asMessage({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: toolUseId, name: toolName, input }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    parent_tool_use_id: null,
    uuid: `assistant-${toolUseId}`,
    session_id: "session-1",
  });
}

export function successResult(
  text: string,
  costUsd = 0.012,
  overrides: Record<string, unknown> = {},
): SDKMessage {
  return asMessage({
    type: "result",
    subtype: "success",
    result: text,
    total_cost_usd: costUsd,
    usage: { input_tokens: 10, output_tokens: 5 },
    is_error: false,
    num_turns: 1,
    permission_denials: [],
    uuid: "result-1",
    session_id: "session-1",
    ...overrides,
  });
}

export function errorResult(subtype = "error_during_execution", error = "boom"): SDKMessage {
  return asMessage({
    type: "result",
    subtype,
    error,
    is_error: true,
    duration_ms: 1,
    uuid: "result-err",
    session_id: "session-1",
  });
}

export function compactBoundary(preTokens = 100, postTokens = 20): SDKMessage {
  return asMessage({
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { trigger: "manual", pre_tokens: preTokens, post_tokens: postTokens },
    uuid: "compact-1",
    session_id: "session-1",
  });
}

/** The CLI re-running a flagged request on a fallback model. */
export function refusalFallback(overrides: Record<string, unknown> = {}): SDKMessage {
  return asMessage({
    type: "system",
    subtype: "model_refusal_fallback",
    trigger: "refusal",
    direction: "retry",
    scope: "session",
    original_model: "claude-fable-5-1",
    fallback_model: "claude-opus-5",
    request_id: null,
    api_refusal_category: "bio",
    retracted_message_uuids: [],
    content: "Re-running on Opus 5.",
    uuid: "fallback-1",
    session_id: "session-1",
    ...overrides,
  });
}

export function rateLimitEvent(info: Record<string, unknown>): SDKMessage {
  return asMessage({
    type: "rate_limit_event",
    rate_limit_info: info,
    uuid: "rl-1",
    session_id: "session-1",
  });
}

export function historyUser(uuid: string, text: string): SessionMessage {
  return {
    type: "user",
    uuid,
    session_id: "session-1",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    parent_agent_id: null,
  };
}

export function historyToolResult(uuid: string): SessionMessage {
  return {
    type: "user",
    uuid,
    session_id: "session-1",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu-1", content: "ok" }],
    },
    parent_tool_use_id: null,
    parent_agent_id: null,
  };
}
