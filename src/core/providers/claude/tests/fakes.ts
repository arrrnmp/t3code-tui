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
  ForkSessionResult,
} from "../transport.js";

export class FakeQuery implements ClaudeQuery {
  interrupted = 0;
  readonly permissionModes: PermissionMode[] = [];
  readonly models: Array<string | undefined> = [];
  usageProbeResponse: unknown = null;
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

  private async drainPrompt(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const _message of prompt) {
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

  async interrupt(): Promise<undefined> {
    this.interrupted += 1;
    return undefined;
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionModes.push(mode);
  }

  async setModel(model?: string): Promise<void> {
    this.models.push(model);
  }

  async usageExperimental(): Promise<unknown> {
    return this.usageProbeResponse;
  }
}

export class FakeTransport implements ClaudeTransport {
  readonly created: FakeQuery[] = [];

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
    this.created.push(fake);
    return fake;
  }
}

export class FakeSessionApi implements ClaudeSessionApi {
  readonly forks: Array<{ sessionId: string; upToMessageId: string }> = [];

  constructor(
    private history: SessionMessage[] = [],
    private forkResult: string = "forked-session",
  ) {}

  async getSessionMessages(_sessionId: string): Promise<SessionMessage[]> {
    return this.history;
  }

  async forkSession(sessionId: string, upToMessageId: string): Promise<ForkSessionResult> {
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
