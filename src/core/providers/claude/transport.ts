/**
 * Transport seam between the Claude driver and the Agent SDK. The driver
 * only ever talks to `ClaudeTransport` + `ClaudeSessionApi`, so tests
 * inject scripted message streams and no test spawns the real CLI.
 * Only this file imports the SDK at runtime.
 */
import {
  forkSession as sdkForkSession,
  getSessionInfo as sdkGetSessionInfo,
  getSessionMessages as sdkGetSessionMessages,
  query as sdkQuery,
  type CanUseTool,
  type McpServerConfig,
  type PermissionMode,
  type SDKMessage,
  type SDKUserMessage,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeQueryOptions {
  readonly cwd: string;
  readonly model?: string;
  readonly permissionMode: PermissionMode;
  readonly allowDangerouslySkipPermissions?: boolean;
  readonly resume?: string;
  readonly mcpServers?: Record<string, McpServerConfig>;
  /** Claude Code's own prompt with moxen's runtime instructions appended. */
  readonly systemPrompt?: { readonly type: "preset"; readonly preset: "claude_code"; readonly append?: string };
  readonly env?: Record<string, string>;
  readonly pathToClaudeCodeExecutable?: string;
  readonly canUseTool?: CanUseTool;
  readonly abortController?: AbortController;
  readonly stderr?: (data: string) => void;
}

export interface ClaudeQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  usageExperimental?(options?: { skipBehaviors?: boolean }): Promise<unknown>;
  /** What `/context` reports; `summary` answers from the last response without extra API calls. */
  getContextUsage?(options?: { detail?: "summary" | "full" }): Promise<unknown>;
  /** Every command and skill the CLI resolved for this session's cwd. */
  supportedCommands?(): Promise<ReadonlyArray<{ name: string; description: string; argumentHint: string; builtin?: boolean }>>;
  /** End the CLI process. */
  close?(): void;
}

export interface ClaudeTransport {
  query(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: ClaudeQueryOptions,
  ): ClaudeQuery;
}

export class SdkTransport implements ClaudeTransport {
  query(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: ClaudeQueryOptions,
  ): ClaudeQuery {
    const { env, ...rest } = options;
    const sdk = sdkQuery({
      prompt,
      options: { ...rest, ...(env === undefined ? {} : { env }) },
    });
    const usageExperimental =
      typeof (sdk as unknown as Record<string, unknown>).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET ===
      "function"
        ? (sdk as unknown as {
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: (
              options?: { skipBehaviors?: boolean },
            ) => Promise<unknown>;
          }).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET.bind(sdk)
        : undefined;
    return {
      [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
        return sdk[Symbol.asyncIterator]();
      },
      interrupt: () => sdk.interrupt(),
      setPermissionMode: (mode) => sdk.setPermissionMode(mode),
      setModel: (model) => sdk.setModel(model),
      // Without this the driver's `contextUsage` found no method and every
      // Claude context reading came back null.
      getContextUsage: (contextOptions) => sdk.getContextUsage(contextOptions),
      supportedCommands: () => sdk.supportedCommands(),
      close: () => sdk.close(),
      ...(usageExperimental ? { usageExperimental } : {}),
    };
  }
}

export interface ForkSessionResult {
  readonly sessionId: string;
}

export interface ClaudeSessionApi {
  getSessionMessages(sessionId: string): Promise<SessionMessage[]>;
  forkSession(sessionId: string, upToMessageId: string): Promise<ForkSessionResult>;
  /**
   * Whether the CLI still has this session on disk. Resuming one it has
   * lost fails the first turn, so a persisted id is checked before use.
   */
  sessionExists(sessionId: string): Promise<boolean>;
}

export class SdkSessionApi implements ClaudeSessionApi {
  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    return await sdkGetSessionMessages(sessionId);
  }

  async forkSession(sessionId: string, upToMessageId: string): Promise<ForkSessionResult> {
    const result = await sdkForkSession(sessionId, { upToMessageId });
    return { sessionId: result.sessionId };
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    return (await sdkGetSessionInfo(sessionId)) !== undefined;
  }
}

/**
 * Title/summary side-channel (`claude -p --output-format json`) is
 * intentionally deferred to cutover, when thread-title generation needs it.
 */
