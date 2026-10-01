/**
 * A thread's native subagents (Claude's Agent tool, OpenCode's `subagent`
 * tool), kept on the thread
 * record so the shell — which reads records, never activity ledgers — can
 * list them under their thread the way it lists delegated threads.
 *
 * Folded from the same activity rows the thread's own views read:
 * `subagent` rows (the start and stop hooks) and, for a background
 * subagent, its `background.*` task rows (same id as the agent, and the
 * only place its description and end reliably arrive). A stop with no
 * start is one of Claude Code's internal agents (prompt suggestions,
 * `/btw`) and is ignored. Bounded: every running one, plus the latest
 * finished, `KEEP` in all.
 */
import { readClaudeSubagent } from "../providers/claude/subagents.js";
import type { SubagentHistoryItem } from "../providers/spi.js";
import type { ActivityEnvelope, MessageEnvelope } from "../types.js";
import { toolActivityRow } from "./toolactivity.js";
import type { StoredNativeSubagent, StoredThread } from "./types.js";
import type { ThreadStore } from "./store.js";

const KEEP = 6;

const ENDED: Record<string, StoredNativeSubagent["status"]> = {
  "background.completed": "completed",
  "background.failed": "failed",
  "background.stopped": "stopped",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** The list after one activity row, or null when the row changes nothing. */
export function applySubagentActivity(
  list: readonly StoredNativeSubagent[],
  row: { readonly kind: string; readonly payload?: unknown; readonly createdAt: string },
): StoredNativeSubagent[] | null {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const index = (agentId: string) => list.findIndex((entry) => entry.agentId === agentId);
  let next: StoredNativeSubagent[] | null = null;
  if (row.kind === "subagent") {
    const agentId = text(payload.agentId);
    const agentType = text(payload.agentType);
    if (agentId === null) return null;
    const at = index(agentId);
    if (payload.status === "started") {
      if (agentType === null) return null;
      const prior = at < 0 ? null : list[at]!;
      const entry: StoredNativeSubagent = {
        agentId,
        agentType,
        description: prior?.description ?? text(payload.description),
        status: "running",
        startedAt: prior?.startedAt ?? row.createdAt,
        stoppedAt: null,
      };
      next = at < 0 ? [...list, entry] : list.map((existing, position) => (position === at ? entry : existing));
    } else if (payload.status === "stopped" && at >= 0 && list[at]!.status === "running") {
      next = list.map((existing, position) => (position === at ? { ...existing, status: "completed", stoppedAt: row.createdAt } : existing));
    }
  } else if (row.kind.startsWith("background.")) {
    const agentId = text(payload.taskId);
    if (agentId === null) return null;
    const at = index(agentId);
    const agent = payload.taskType === "local_agent" || payload.toolName === "Agent";
    if (row.kind === "background.started" && (agent || at >= 0)) {
      const description = text(payload.description);
      next =
        at < 0
          ? [...list, { agentId, agentType: "subagent", description, status: "running", startedAt: row.createdAt, stoppedAt: null }]
          : list.map((existing, position) => (position === at ? { ...existing, description: existing.description ?? description } : existing));
    } else if (ENDED[row.kind] !== undefined && at >= 0 && list[at]!.status === "running") {
      next = list.map((existing, position) => (position === at ? { ...existing, status: ENDED[row.kind]!, stoppedAt: row.createdAt } : existing));
    }
  }
  if (next === null) return null;
  // Every running one stays; finished ones make room, oldest first.
  const finished = next.filter((entry) => entry.status !== "running").sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const excess = Math.max(0, next.length - KEEP);
  const dropped = new Set(finished.slice(0, excess).map((entry) => entry.agentId));
  return next.filter((entry) => !dropped.has(entry.agentId));
}

/** Folds a just-recorded activity row into the thread record, under its lock. Best effort. */
export async function recordNativeSubagent(
  store: ThreadStore,
  threadId: string,
  row: { readonly kind: string; readonly payload?: unknown; readonly createdAt: string },
): Promise<void> {
  if (row.kind !== "subagent" && !row.kind.startsWith("background.")) return;
  await store
    .withThreadLock(threadId, async () => {
      const thread = await store.readThreadRecord(threadId);
      if (thread === null) return;
      const next = applySubagentActivity(thread.nativeSubagents ?? [], row);
      if (next === null) return;
      await store.writeThreadRecord({ ...thread, nativeSubagents: next } satisfies StoredThread);
    })
    .catch(() => undefined);
}

// -- transcript ---------------------------------------------------------------

/** What a native subagent did, in the envelope shapes a thread's own transcript uses. */
export interface SubagentTranscript {
  /** False when the provider keeps no transcript moxen can read (not Claude, or no session yet). */
  readonly available: boolean;
  readonly agent: StoredNativeSubagent | null;
  readonly messages: MessageEnvelope[];
  readonly activities: ActivityEnvelope[];
}

function blocks(message: unknown): Record<string, unknown>[] {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.filter((block): block is Record<string, unknown> => block !== null && typeof block === "object") : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : "")).join("\n");
}

/** Reads a subagent's history from a live driver that keeps it (OpenCode). */
export type SubagentHistoryReader = (agentId: string) => Promise<readonly SubagentHistoryItem[] | null>;

/**
 * A native subagent's conversation as one turn: its prompt, its tool calls
 * (mapped exactly as the live driver's are, so they render the same), its
 * thinking, and its reply. Claude keeps per-subagent transcripts on disk;
 * OpenCode keeps each subagent as a child session its live driver reads
 * (`readHistory`).
 */
export async function subagentTranscript(
  store: ThreadStore,
  threadId: string,
  agentId: string,
  readHistory?: SubagentHistoryReader,
): Promise<SubagentTranscript> {
  const thread = await store.readThreadRecord(threadId);
  const agent = thread?.nativeSubagents?.find((entry) => entry.agentId === agentId) ?? null;
  if (thread !== null && thread.providerSessions?.["opencode"] !== undefined && readHistory !== undefined) {
    const history = await readHistory(agentId).catch(() => null);
    if (history !== null) return { available: true, agent, ...historyEnvelopes(threadId, agentId, history, agent?.startedAt ?? thread.createdAt) };
  }
  const sessionId = thread?.providerSessions?.["claude"];
  if (thread === null || sessionId === undefined) return { available: false, agent, messages: [], activities: [] };
  const transcript = await readClaudeSubagent(sessionId, agentId, thread.env.path);
  const turnId = `subagent:${agentId}`;
  const base = Date.parse(agent?.startedAt ?? thread.createdAt);
  const messages: MessageEnvelope[] = [];
  const activities: ActivityEnvelope[] = [];
  const calls = new Map<string, { name: string; input: Record<string, unknown>; at: string; output: string | null; isError: boolean }>();
  transcript.forEach((entry, index) => {
    // Timestamps order the rows; a line without one keeps its place.
    const at = entry.timestamp ?? new Date(base + index).toISOString();
    blocks(entry.message).forEach((block, part) => {
      const id = `${entry.uuid}:${part}`;
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        messages.push({
          id,
          role: entry.type === "assistant" ? "assistant" : "user",
          text: block.text,
          turnId,
          streaming: false,
          createdAt: at,
          updatedAt: at,
          // The parent agent wrote this prompt, not the user.
          ...(entry.type === "assistant" ? {} : { origin: "subagent-prompt" }),
        });
      } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
        activities.push({
          id,
          threadId,
          turnId,
          kind: "reasoning",
          summary: "Thought",
          tone: "info",
          createdAt: at,
          payload: { itemType: "reasoning", toolCallId: `reasoning:${id}`, status: "completed", text: block.thinking, durationMs: null },
        });
      } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
        const input = block.input !== null && typeof block.input === "object" ? (block.input as Record<string, unknown>) : {};
        calls.set(block.id, { name: block.name, input, at, output: null, isError: false });
      } else if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const call = calls.get(block.tool_use_id);
        if (call !== undefined) calls.set(block.tool_use_id, { ...call, output: resultText(block.content), isError: block.is_error === true });
      }
    });
  });
  for (const [toolUseId, call] of calls) {
    const row = toolActivityRow({
      type: call.output === null ? "tool.execute.started" : "tool.execute.completed",
      provider: "claude",
      threadId,
      turnId,
      tool: call.name,
      raw: { toolUseId, input: call.input, output: call.output, isError: call.isError },
    });
    if (row === null) continue;
    activities.push({ id: `tool:${toolUseId}`, threadId, turnId, kind: row.kind, summary: row.summary, tone: "tool", createdAt: call.at, payload: row.payload });
  }
  return { available: true, agent, messages, activities };
}

/** Driver-read history (OpenCode) in the envelope shapes, its tools mapped as live ones are. */
function historyEnvelopes(
  threadId: string,
  agentId: string,
  history: readonly SubagentHistoryItem[],
  startedAt: string,
): { messages: MessageEnvelope[]; activities: ActivityEnvelope[] } {
  const turnId = `subagent:${agentId}`;
  const base = Date.parse(startedAt);
  const messages: MessageEnvelope[] = [];
  const activities: ActivityEnvelope[] = [];
  history.forEach((item, index) => {
    const at = item.at ?? new Date((Number.isNaN(base) ? 0 : base) + index).toISOString();
    if (item.kind === "tool") {
      const row = toolActivityRow({ type: "tool.execute.completed", provider: "opencode", threadId, turnId, tool: item.tool, raw: item.raw });
      if (row !== null) activities.push({ id: `tool:${item.id}`, threadId, turnId, kind: row.kind, summary: row.summary, tone: "tool", createdAt: at, payload: row.payload });
    } else if (item.kind === "reasoning") {
      activities.push({
        id: item.id,
        threadId,
        turnId,
        kind: "reasoning",
        summary: "Thought",
        tone: "info",
        createdAt: at,
        payload: { itemType: "reasoning", toolCallId: `reasoning:${item.id}`, status: "completed", text: item.text, durationMs: null },
      });
    } else {
      messages.push({
        id: item.id,
        role: item.kind === "prompt" ? "user" : "assistant",
        text: item.text,
        turnId,
        streaming: false,
        createdAt: at,
        updatedAt: at,
        ...(item.kind === "prompt" ? { origin: "subagent-prompt" } : {}),
      });
    }
  });
  return { messages, activities };
}

/**
 * The subagent list for a thread that had them before the record kept one:
 * folded once from its activity ledger, then kept up by `recordNativeSubagent`.
 * An empty list is written too, so the ledger is read once per thread.
 */
export async function backfillNativeSubagents(store: ThreadStore, threadId: string): Promise<void> {
  await store
    .withThreadLock(threadId, async () => {
      const thread = await store.readThreadRecord(threadId);
      if (thread === null || thread.nativeSubagents !== undefined) return;
      const rows = await store.readActivities(threadId);
      const list = rows.reduce<StoredNativeSubagent[]>((current, row) => applySubagentActivity(current, row) ?? current, []);
      await store.writeThreadRecord({ ...thread, nativeSubagents: list });
    })
    .catch(() => undefined);
}
