/**
 * What the side panel's Agents and Context tabs show, read off state the
 * app already holds: the shell's threads (delegated tasks are threads with
 * a `parentThreadId`), the open thread's recorded `subagent` rows (a
 * provider's native subagents), and a context breakdown.
 */
import type { ActivityEnvelope, MessageEnvelope, ThreadEnvelope } from "../../core/types.js";
import type { QueryResult } from "../../server/api.js";

/** What fills the context window, as the `thread.context` query reports it. */
export type ContextBreakdown = NonNullable<QueryResult<"thread.context">["breakdown"]>;
import { threadStatus, type ThreadStatus } from "./shell.js";
import type { ContextUsage } from "./thread.js";

export type SideTab = "diff" | "git" | "context" | "agents" | "background";

export interface AgentThreadRow {
  threadId: string;
  title: string;
  status: ThreadStatus;
  /** The model it runs on: its catalog name where known, else `instance/model`. */
  model: string | null;
  /** When its latest turn started, for the running clock. */
  startedAt: string | null;
  /** Its latest turn's outcome, once settled. */
  outcome: "completed" | "error" | "interrupted" | null;
}

/** The open thread's delegated tasks, newest first. */
export function agentThreads(
  threads: readonly ThreadEnvelope[],
  parentThreadId: string | null,
  now: number = Date.now(),
  modelName: (instanceId: string, model: string) => string | null = () => null,
): AgentThreadRow[] {
  if (parentThreadId === null) return [];
  return threads
    .filter((thread) => thread.parentThreadId === parentThreadId && thread.archivedAt == null && thread.deletedAt == null)
    .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""))
    .map((thread) => {
      const turn = thread.latestTurn ?? null;
      return {
        threadId: thread.id,
        title: String(thread.title ?? thread.id),
        status: threadStatus(thread, now),
        model: thread.modelSelection
          ? (modelName(thread.modelSelection.instanceId, thread.modelSelection.model) ?? `${thread.modelSelection.instanceId}/${thread.modelSelection.model}`)
          : null,
        startedAt: turn?.startedAt ?? turn?.requestedAt ?? null,
        outcome: turn === null || turn.state === "running" ? null : turn.state,
      };
    });
}

export interface NativeSubagentRow {
  agentId: string;
  agentType: string;
  /** What it was asked to do: the `description` of the Agent call that spawned it. */
  description: string | null;
  running: boolean;
  lastMessage: string | null;
  /** When it started. */
  at: string;
  /** When it stopped, once it has. */
  stoppedAt: string | null;
}

/** Claude's Agent tool (once Task), and OpenCode's `subagent`. */
const AGENT_TOOLS = new Set(["Agent", "Task", "subagent"]);

/**
 * The provider's own subagents in this thread (Claude's Agent tool,
 * OpenCode's `subagent`), latest state per agent, newest first. OpenCode
 * names the description as the subagent starts; Claude's is paired below.
 *
 * The start hook names the agent type but not the call that spawned it, so
 * each subagent is paired with the Agent calls of its turn and type in
 * order: the first Explore started in a turn is that turn's first Explore
 * call. That is where its description comes from. A background subagent
 * is also a background task under the same id, whose start names the call
 * exactly and whose end is a second word on when it stopped — the stop
 * hook's row was lost for any agent that outlived its turn before the
 * session watcher recorded it.
 */
export function nativeSubagents(activities: readonly ActivityEnvelope[]): NativeSubagentRow[] {
  const byAgent = new Map<string, NativeSubagentRow>();
  // Agent calls per `turn|type`, oldest first, by call id — a call writes a
  // row as it starts and again as it ends, and counts once.
  const calls = new Map<string, Map<string, string | null>>();
  const claimed = new Map<string, number>();
  const descriptions = new Map<string, string | null>();
  const taskCalls = new Map<string, string>();
  const taskEnds = new Map<string, { at: string; summary: string | null }>();
  for (const activity of activities) {
    const payload = (activity.payload ?? {}) as Record<string, unknown>;
    if (activity.kind.startsWith("background.") && typeof payload.taskId === "string") {
      if (activity.kind === "background.started" && typeof payload.toolUseId === "string") taskCalls.set(payload.taskId, payload.toolUseId);
      if (activity.kind === "background.completed" || activity.kind === "background.failed" || activity.kind === "background.stopped") {
        taskEnds.set(payload.taskId, { at: activity.createdAt, summary: typeof payload.summary === "string" && payload.summary.trim() ? payload.summary.trim() : null });
      }
      continue;
    }
    if (activity.kind !== "subagent") {
      const data = (payload.data ?? {}) as Record<string, unknown>;
      if (typeof data.tool !== "string" || !AGENT_TOOLS.has(data.tool) || typeof payload.toolCallId !== "string") continue;
      const input = (((data.state ?? {}) as Record<string, unknown>).input ?? {}) as Record<string, unknown>;
      const named = typeof input.subagent_type === "string" && input.subagent_type ? input.subagent_type : typeof input.agent === "string" && input.agent ? input.agent : null;
      const type = named ?? "general-purpose";
      const key = `${activity.turnId ?? ""}|${type}`;
      const byCall = calls.get(key) ?? new Map<string, string | null>();
      const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : null;
      byCall.set(payload.toolCallId, description);
      calls.set(key, byCall);
      descriptions.set(payload.toolCallId, description);
      continue;
    }
    const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
    if (agentId === null) continue;
    const previous = byAgent.get(agentId);
    // Every spawned subagent starts. A stop with no start is one of Claude
    // Code's internal agents (a prompt suggestion, `/btw`), recorded before
    // the driver learned to drop them.
    if (previous === undefined && payload.status !== "started") continue;
    const agentType = typeof payload.agentType === "string" ? payload.agentType : (previous?.agentType ?? "agent");
    let description = previous?.description ?? (typeof payload.description === "string" && payload.description.trim() ? payload.description.trim() : null);
    if (previous === undefined && description === null) {
      const key = `${activity.turnId ?? ""}|${agentType}`;
      const index = claimed.get(key) ?? 0;
      claimed.set(key, index + 1);
      description = [...(calls.get(key)?.values() ?? [])][index] ?? null;
    }
    const running = payload.status !== "stopped";
    byAgent.set(agentId, {
      agentId,
      agentType,
      description,
      running,
      lastMessage: typeof payload.lastMessage === "string" ? payload.lastMessage : (previous?.lastMessage ?? null),
      at: previous?.at ?? activity.createdAt,
      stoppedAt: running ? null : activity.createdAt,
    });
  }
  for (const [agentId, row] of byAgent) {
    const call = taskCalls.get(agentId);
    const exact = call === undefined ? undefined : descriptions.get(call);
    const end = row.running ? taskEnds.get(agentId) : undefined;
    byAgent.set(agentId, {
      ...row,
      ...(exact ? { description: exact } : {}),
      ...(end === undefined ? {} : { running: false, stoppedAt: end.at, lastMessage: row.lastMessage ?? end.summary }),
    });
  }
  return [...byAgent.values()].sort((left, right) => right.at.localeCompare(left.at));
}

export interface ContextShare {
  name: string;
  tokens: number;
  /** Of the whole window (or of what is used, when the window size is unknown). */
  percent: number;
  kind: "used" | "free" | "buffer";
}

/** Categories with their share of the window, largest used first, free space and buffer last. */
export function contextShares(
  categories: ReadonlyArray<{ name: string; tokens: number; kind: "used" | "free" | "buffer" }>,
  maxTokens: number | null,
  usedTokens: number,
): ContextShare[] {
  const whole = maxTokens !== null && maxTokens > 0 ? maxTokens : Math.max(1, usedTokens);
  const rank = { used: 0, buffer: 1, free: 2 } as const;
  return categories
    .filter((category) => category.tokens > 0)
    .map((category) => ({ ...category, percent: (category.tokens / whole) * 100 }))
    .sort((left, right) => rank[left.kind] - rank[right.kind] || right.tokens - left.tokens);
}

export interface PlanUsageGauge {
  short: string;
  percent: number;
}

const CHARS_PER_TOKEN = 4;

function charsOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/**
 * The tool a call row names, as the harness recorded it (`data.tool`).
 * MCP tools drop their `mcp__server__` prefix. Never guessed from the
 * summary: that is prose, and guessing made "This" and turn ids "tools".
 */
function activityToolName(payload: Record<string, unknown>): string {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const name = typeof data.tool === "string" ? data.tool : typeof data.toolName === "string" ? data.toolName : null;
  if (name === null || name.length === 0) return "Other";
  return /^mcp__[^_]+(?:_[^_]+)*__(.+)$/u.exec(name)?.[1] ?? name;
}

/**
 * What fills the window when the provider only reports the total (Claude's
 * `/context` summary without categories, or no live session at all).
 * Estimated from the transcript itself — text size at ~4 chars/token per
 * role — scaled to the real total, exactly like the OpenCode breakdown.
 * Whatever the messages do not account for is the system prompt and tools.
 * Null when there is no reading to scale against.
 */
export function estimateContextBreakdown(
  usage: ContextUsage | null | undefined,
  messages: readonly MessageEnvelope[],
  activities: readonly ActivityEnvelope[],
): ContextBreakdown | null {
  if (usage === null || usage === undefined) return null;
  const chars = { user: 0, assistant: 0, reasoning: 0, tools: 0 };
  const perTool = new Map<string, number>();
  for (const message of messages) {
    if (message.role === "user") chars.user += charsOf(message.text);
    else if (message.role === "assistant") chars.assistant += charsOf(message.text);
    else chars.user += charsOf(message.text);
  }
  // Only tool and reasoning rows are context: both carry `toolCallId`, and
  // each call writes a row as it starts and again as it ends, so the
  // newest row per id stands for the call. Everything else in the ledger
  // (turn bookkeeping, notices, plans) is our own record, never sent back
  // to the model — `turn.started` carries the prompt, which the messages
  // already count.
  const calls = new Map<string, Record<string, unknown>>();
  for (const activity of activities) {
    if (activity.kind === "subagent") continue;
    const payload = (activity.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.toolCallId === "string") calls.set(payload.toolCallId, payload);
  }
  for (const payload of calls.values()) {
    if (payload.itemType === "reasoning") {
      chars.reasoning += charsOf(payload.text);
      continue;
    }
    const toolChars = charsOf(payload);
    if (toolChars === 0) continue;
    chars.tools += toolChars;
    const name = activityToolName(payload);
    perTool.set(name, (perTool.get(name) ?? 0) + toolChars);
  }
  const estimated = {
    user: chars.user / CHARS_PER_TOKEN,
    assistant: chars.assistant / CHARS_PER_TOKEN,
    reasoning: chars.reasoning / CHARS_PER_TOKEN,
    tools: chars.tools / CHARS_PER_TOKEN,
  };
  const messageTotal = estimated.user + estimated.assistant + estimated.reasoning + estimated.tools;
  const scale = messageTotal > usage.usedTokens && messageTotal > 0 ? usage.usedTokens / messageTotal : 1;
  const round = (value: number): number => Math.round(value * scale);
  const used = [
    { name: "User messages", tokens: round(estimated.user) },
    { name: "Assistant messages", tokens: round(estimated.assistant) },
    { name: "Reasoning", tokens: round(estimated.reasoning) },
    { name: "Tool calls", tokens: round(estimated.tools) },
  ];
  const accounted = used.reduce((sum, row) => sum + row.tokens, 0);
  const categories: ContextBreakdown["categories"] = [
    { name: "System prompt & tools", tokens: Math.max(0, usage.usedTokens - accounted), kind: "used" },
    ...used.filter((row) => row.tokens > 0).map((row) => ({ ...row, kind: "used" as const })),
    ...(usage.maxTokens !== null ? [{ name: "Free space", tokens: Math.max(0, usage.maxTokens - usage.usedTokens), kind: "free" as const }] : []),
  ];
  const tools = [...perTool.entries()]
    .map(([name, toolChars]) => ({ name, tokens: Math.round((toolChars / CHARS_PER_TOKEN) * scale) }))
    .filter((row) => row.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens);
  return {
    usedTokens: usage.usedTokens,
    maxTokens: usage.maxTokens,
    cachedInputTokens: usage.cachedInputTokens,
    autoCompactThreshold: usage.autoCompactThreshold,
    compactsAutomatically: usage.compactsAutomatically,
    ...(usage.costUsd === null ? {} : { costUsd: usage.costUsd }),
    categories,
    estimated: true,
    ...(tools.length > 0 ? { tools } : {}),
  };
}

/**
 * The live provider breakdown when it names what fills the window,
 * otherwise the transcript estimate above — so a total-only reading still
 * shows user/assistant/reasoning/tools shares instead of "reports the total
 * only". Null when neither exists.
 */
export function effectiveContextBreakdown(
  live: ContextBreakdown | null | undefined,
  fallback: ContextUsage | null | undefined,
  messages: readonly MessageEnvelope[],
  activities: readonly ActivityEnvelope[],
): ContextBreakdown | null {
  if (live !== null && live !== undefined && live.categories.length > 0) return live;
  return estimateContextBreakdown(fallback, messages, activities);
}

const SHORT_BY_KIND: Record<string, string> = { session: "5h", weekly: "wk", monthly: "mo" };

/**
 * The footer's compact reading of a provider's plan usage: the session
 * window and the main weekly one always, any other window (a per-model
 * weekly limit) only once it is past 70% — the point where it can bite.
 */
export function planUsageGauges(
  limits: { windows: ReadonlyArray<{ id: string; kind: string; label: string; usedPercent: number }> } | null | undefined,
): PlanUsageGauge[] {
  if (limits === null || limits === undefined) return [];
  const gauges: PlanUsageGauge[] = [];
  const seenKinds = new Set<string>();
  for (const window of limits.windows) {
    const main = !seenKinds.has(window.kind) && SHORT_BY_KIND[window.kind] !== undefined;
    if (main) {
      seenKinds.add(window.kind);
      gauges.push({ short: SHORT_BY_KIND[window.kind]!, percent: window.usedPercent });
    } else if (window.usedPercent >= 70) {
      // "Weekly – Opus" → "Opus".
      const name = window.label.split(/[–-]/u).pop()?.trim() || window.label;
      gauges.push({ short: name, percent: window.usedPercent });
    }
  }
  return gauges;
}
