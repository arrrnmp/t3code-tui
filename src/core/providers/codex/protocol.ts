/**
 * Codex app-server method names + defensive payload readers. Method shapes
 * were confirmed against the upstream protocol package (not vendored);
 * every payload is read defensively because the CLI moves faster than any
 * pinned schema.
 */
export const CODEX_METHODS = {
  initialize: "initialize",
  initialized: "initialized",
  threadStart: "thread/start",
  threadResume: "thread/resume",
  threadRead: "thread/read",
  threadRollback: "thread/rollback",
  threadRevert: "thread/revert",
  threadCompactStart: "thread/compact/start",
  turnStart: "turn/start",
  turnSteer: "turn/steer",
  turnInterrupt: "turn/interrupt",
  feedbackUpload: "feedback/upload",
  accountRead: "account/read",
  modelList: "model/list",
  skillsList: "skills/list",
  rateLimitsRead: "account/rateLimits/read",
  rateLimitResetCreditConsume: "account/rateLimitResetCredit/consume",
  mcpServerReload: "config/mcpServer/reload",
  // server → client
  commandExecutionApproval: "item/commandExecution/requestApproval",
  fileChangeApproval: "item/fileChange/requestApproval",
  permissionsApproval: "item/permissions/requestApproval",
  requestUserInput: "item/tool/requestUserInput",
  elicitationRequest: "mcpServer/elicitation/request",
  dynamicToolCall: "item/tool/call",
  // notifications
  agentMessageDelta: "item/agentMessage/delta",
  commandOutputDelta: "item/commandExecution/outputDelta",
  itemStarted: "item/started",
  itemCompleted: "item/completed",
  turnStarted: "turn/started",
  turnCompleted: "turn/completed",
  turnFailed: "turn/failed",
  turnInterrupted: "turn/interrupted",
  threadCompacted: "thread/compacted",
  tokenUsageUpdated: "thread/tokenUsage/updated",
  rateLimitsUpdated: "account/rateLimits/updated",
  accountUpdated: "account/updated",
} as const;

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return null;
  return value as string[];
}

export type CodexTurnState = "completed" | "interrupted" | "failed" | "running";

export function codexTurnStateOf(value: unknown): CodexTurnState {
  const record = asRecord(value);
  const raw = record ? asString(record["status"] ?? record["state"]) : null;
  if (raw === "completed") return "completed";
  if (raw === "interrupted") return "interrupted";
  if (raw === "failed" || raw === "error") return "failed";
  return "running";
}

export interface CodexTokenBreakdown {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheCreate: number;
  readonly output: number;
  readonly reasoning: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Read a cumulative token breakdown from either naming convention. */
export function codexTokenBreakdownOf(value: unknown): CodexTokenBreakdown {
  const record = asRecord(value) ?? {};
  return {
    input: num(record["inputTokens"] ?? record["input_tokens"]),
    cacheRead: num(record["cachedInputTokens"] ?? record["cache_read_input_tokens"]),
    cacheCreate: num(record["cacheCreationTokens"] ?? record["cache_creation_input_tokens"]),
    output: num(record["outputTokens"] ?? record["output_tokens"]),
    reasoning: num(record["reasoningTokens"] ?? record["reasoning_tokens"]),
  };
}

export interface CodexRateWindow {
  readonly usedPercent: number | null;
  readonly resetsAt: number | null;
  readonly windowDurationMins: number | null;
}

export function codexRateWindowOf(value: unknown): CodexRateWindow | null {
  const record = asRecord(value);
  if (!record) return null;
  const used = record["usedPercent"] ?? record["utilization"];
  return {
    usedPercent: typeof used === "number" && Number.isFinite(used) ? used : null,
    resetsAt:
      typeof record["resetsAt"] === "number" && Number.isFinite(record["resetsAt"])
        ? (record["resetsAt"] as number)
        : null,
    windowDurationMins:
      typeof record["windowDurationMins"] === "number" ? (record["windowDurationMins"] as number) : null,
  };
}
