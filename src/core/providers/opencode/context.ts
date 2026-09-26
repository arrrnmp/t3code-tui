/**
 * What fills an OpenCode session's context window. OpenCode reports the
 * total (the last reply's input + cache + output tokens) but no breakdown,
 * so the shares are estimated from the messages themselves — text size at
 * ~4 characters a token per role — and scaled to the real total. Whatever
 * the messages do not account for is the system prompt and tool schemas.
 */
import type { ContextBreakdown, ContextWindowUsage } from "../spi.js";

type Message = { readonly info: Record<string, unknown>; readonly parts: ReadonlyArray<Record<string, unknown>> };

const CHARS_PER_TOKEN = 4;

function size(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export function opencodeContextBreakdown(usage: ContextWindowUsage, messages: readonly Message[]): ContextBreakdown {
  const chars = { user: 0, assistant: 0, reasoning: 0, tools: 0 };
  const perTool = new Map<string, number>();
  for (const message of messages) {
    const role = message.info["role"];
    for (const part of message.parts) {
      const type = part["type"];
      if (type === "text") chars[role === "user" ? "user" : "assistant"] += size(part["text"]);
      else if (type === "reasoning") chars.reasoning += size(part["text"]);
      else if (type === "tool") {
        const state = (part["state"] ?? {}) as Record<string, unknown>;
        const toolChars = size(state["input"]) + size(state["output"]);
        chars.tools += toolChars;
        const name = typeof part["tool"] === "string" ? part["tool"] : "tool";
        perTool.set(name, (perTool.get(name) ?? 0) + toolChars);
      }
    }
  }
  const estimated = {
    user: chars.user / CHARS_PER_TOKEN,
    assistant: chars.assistant / CHARS_PER_TOKEN,
    reasoning: chars.reasoning / CHARS_PER_TOKEN,
    tools: chars.tools / CHARS_PER_TOKEN,
  };
  const messageTotal = estimated.user + estimated.assistant + estimated.reasoning + estimated.tools;
  // Never more than the real reading: scale down when the estimate runs over.
  const scale = messageTotal > usage.usedTokens && messageTotal > 0 ? usage.usedTokens / messageTotal : 1;
  const round = (value: number) => Math.round(value * scale);
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
  return { ...usage, categories, estimated: true, ...(tools.length > 0 ? { tools } : {}) };
}
