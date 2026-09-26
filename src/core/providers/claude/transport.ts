/**
 * Transport seam between the Claude driver and the Agent SDK. The driver
 * only ever talks to `ClaudeTransport` + `ClaudeSessionApi`, so tests
 * inject scripted message streams and no test spawns the real CLI.
 * Only this file imports the SDK at runtime.
 */
import { z } from "zod";
import {
  createSdkMcpServer,
  tool as sdkTool,
  forkSession as sdkForkSession,
  getSessionInfo as sdkGetSessionInfo,
  getSessionMessages as sdkGetSessionMessages,
  query as sdkQuery,
  type CanUseTool,
  type EffortLevel,
  type HookCallbackMatcher,
  type HookEvent,
  type McpServerConfig,
  type OnUserDialog,
  type PermissionMode,
  type SDKMessage,
  type SDKUserMessage,
  type SessionMessage,
  type Settings,
  type ToolConfig,
} from "@anthropic-ai/claude-agent-sdk";

import type { InProcessMcpServerSpec } from "../../mcp.js";

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
  /** The reasoning effort the session starts at. */
  readonly effort?: EffortLevel;
  /** Session-scoped flag settings (`ultracode`), above the user's own files. */
  readonly settings?: Settings;
  /** In-process hook callbacks, run alongside the user's own settings hooks. */
  readonly hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /** One predicted next prompt after each turn (`prompt_suggestion`, after the `result`). */
  readonly promptSuggestions?: boolean;
  /** Per-tool settings for built-in tools (`askUserQuestion.previewFormat`). */
  readonly toolConfig?: ToolConfig;
  /** Token-level `stream_event`s alongside the complete messages. */
  readonly includePartialMessages?: boolean;
  /** Raw CLI flags (`--thinking-display`); `null` for a bare flag. */
  readonly extraArgs?: Record<string, string | null>;
  /** Built-in tools on offer; `[]` turns every one off (a side question). */
  readonly tools?: string[];
  /** Cap on model round trips; 1 for a one-shot answer. */
  readonly maxTurns?: number;
  /** With `resume`: continue on a copy under a new id, leaving the original alone. */
  readonly forkSession?: boolean;
  /** False keeps the session off disk: nothing to resume, nothing to clean up. */
  readonly persistSession?: boolean;
  /** Renders the CLI's blocking dialogs; only kinds in `supportedDialogKinds` are ever sent. */
  readonly onUserDialog?: OnUserDialog;
  readonly supportedDialogKinds?: string[];
}

/** What `applyFlagSettings` merges: settings keys, where `null` clears one (and `effortLevel` also takes `max`). */
export type FlagSettings = {
  [K in keyof Settings]?: K extends "effortLevel" ? EffortLevel | null : Settings[K] | null;
};

export interface ClaudeQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  /** Merge session-scoped settings mid-session (`effortLevel`, `ultracode`); `null` clears a key. */
  applyFlagSettings?(settings: FlagSettings): Promise<void>;
  usageExperimental?(options?: { skipBehaviors?: boolean }): Promise<unknown>;
  /** What `/context` reports; `summary` answers from the last response without extra API calls. */
  getContextUsage?(options?: { detail?: "summary" | "full" }): Promise<unknown>;
  /** Every command and skill the CLI resolved for this session's cwd. */
  supportedCommands?(): Promise<ReadonlyArray<{ name: string; description: string; argumentHint: string; builtin?: boolean }>>;
  /** End the CLI process. */
  close?(): void;
  /** Stop a background task; a `task_notification` with status `stopped` follows. */
  stopTask?(taskId: string): Promise<void>;
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
      applyFlagSettings: (flagSettings) => sdk.applyFlagSettings(flagSettings),
      // Without this the driver's `contextUsage` found no method and every
      // Claude context reading came back null.
      getContextUsage: (contextOptions) => sdk.getContextUsage(contextOptions),
      supportedCommands: () => sdk.supportedCommands(),
      close: () => sdk.close(),
      stopTask: (taskId) => sdk.stopTask(taskId),
      ...(usageExperimental ? { usageExperimental } : {}),
    };
  }
}

/**
 * An in-process MCP server as the SDK hosts it (`createSdkMcpServer`): each
 * tool's handler calls the spec's `call` directly, in this process. The SDK
 * takes Zod shapes, so the tools' JSON schemas are converted — they only
 * use flat objects of strings, numbers, booleans and string enums.
 */
export function sdkMcpServer(spec: InProcessMcpServerSpec): McpServerConfig {
  return createSdkMcpServer({
    name: spec.name,
    ...(spec.instructions ? { instructions: spec.instructions } : {}),
    ...(spec.alwaysLoad === true ? { alwaysLoad: true } : {}),
    tools: spec.tools.map((definition) =>
      sdkTool(
        definition.name,
        definition.description,
        zodShape(definition.inputSchema),
        async (args: Record<string, unknown>) => {
          const result = await spec.call(definition.name, args);
          return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
        },
        definition.annotations?.readOnlyHint === true ? { annotations: { readOnlyHint: true } } : undefined,
      ),
    ),
  });
}

/** A flat JSON object schema as a Zod raw shape; anything it does not know accepts any value. */
export function zodShape(schema: Record<string, unknown>): Record<string, z.ZodType> {
  const properties = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(Array.isArray(schema["required"]) ? (schema["required"] as string[]) : []);
  return Object.fromEntries(
    Object.entries(properties).map(([key, property]) => {
      let field: z.ZodType;
      const values = property["enum"];
      if (Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === "string")) {
        field = z.enum(values as [string, ...string[]]);
      } else if (property["type"] === "string") field = z.string();
      else if (property["type"] === "number" || property["type"] === "integer") field = z.number();
      else if (property["type"] === "boolean") field = z.boolean();
      else field = z.unknown();
      if (typeof property["description"] === "string") field = field.describe(property["description"]);
      return [key, required.has(key) ? field : field.optional()];
    }),
  );
}

export interface ForkSessionResult {
  readonly sessionId: string;
}

export interface ClaudeSessionApi {
  getSessionMessages(sessionId: string): Promise<SessionMessage[]>;
  /** A copy of the session, through `upToMessageId` when given, else whole. */
  forkSession(sessionId: string, upToMessageId?: string): Promise<ForkSessionResult>;
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

  async forkSession(sessionId: string, upToMessageId?: string): Promise<ForkSessionResult> {
    const result = await sdkForkSession(sessionId, upToMessageId === undefined ? {} : { upToMessageId });
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
