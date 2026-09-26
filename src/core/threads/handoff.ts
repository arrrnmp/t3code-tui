/**
 * The handoff document: a thread written up for a *new* agent session to
 * continue from.
 *
 * This is not the TUI's markdown export. That one is for a person reading
 * back a thread, and it is built from the TUI's own projections, so neither
 * the CLI nor the server can produce it. This is built from the ledger
 * alone — any client, and the server, can make the same one — and it is
 * written for the reader who matters here: an agent with none of the
 * original context, who must pick up exactly where the last one stopped.
 *
 * So it leads with what that reader needs first (the goal, where it
 * stopped, what is already on disk, what the user asked for that never got
 * sent) and only then the conversation. Prompts and replies stay verbatim
 * for recent turns, where the detail is; older turns shrink to a line each
 * so a long thread still fits a context window.
 */
import type { ThreadStore } from "./store.js";
import type { StoredActivity, StoredMessage, StoredThread, StoredTurn } from "./types.js";

/** Turns kept word for word; older ones become a one-line summary each. */
const VERBATIM_TURNS = 12;
/** Past this, verbatim turns shrink too, oldest first, until it fits. */
const TARGET_CHARS = 60_000;
/** Tool calls listed per turn before "+N more". */
const MAX_TOOL_LINES = 40;

function oneLine(text: string, max = 140): string {
  const line = text.split(/\r?\n/u).map((row) => row.trim()).find((row) => row.length > 0) ?? "";
  const single = line.replace(/\s+/gu, " ");
  return single.length <= max ? single : `${single.slice(0, max)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Tool calls in one turn, one line each, newest state per call. */
function toolLines(activities: readonly StoredActivity[]): string[] {
  const byCall = new Map<string, string>();
  for (const activity of activities) {
    const payload = activity.payload;
    const callId = typeof payload?.toolCallId === "string" ? payload.toolCallId : null;
    if (callId === null || callId.startsWith("reasoning:")) continue;
    const status = typeof payload?.status === "string" ? payload.status : "";
    const failed = status === "failed" || status === "error";
    byCall.set(callId, `${failed ? "✗ " : ""}${oneLine(activity.summary, 200)}`);
  }
  return [...byCall.values()];
}

interface TurnBlock {
  readonly turn: StoredTurn;
  readonly prompts: readonly StoredMessage[];
  readonly replies: readonly StoredMessage[];
  readonly tools: readonly string[];
}

function verbatim(block: TurnBlock, index: number): string {
  const lines: string[] = [`### Turn ${index + 1}${block.turn.status === "completed" ? "" : ` (${block.turn.status})`}`];
  for (const prompt of block.prompts) lines.push("", "**User:**", "", prompt.text.trim());
  if (block.tools.length > 0) {
    lines.push("", "**Work:**");
    for (const tool of block.tools.slice(0, MAX_TOOL_LINES)) lines.push(`- ${tool}`);
    if (block.tools.length > MAX_TOOL_LINES) lines.push(`- …and ${block.tools.length - MAX_TOOL_LINES} more tool calls`);
  }
  for (const reply of block.replies) lines.push("", "**Assistant:**", "", reply.text.trim());
  if (block.turn.status === "failed" && block.turn.error) lines.push("", `_Failed: ${oneLine(block.turn.error, 300)}_`);
  return lines.join("\n");
}

function summarized(block: TurnBlock, index: number): string {
  const asked = block.prompts[0] ? oneLine(block.prompts[0].text, 120) : "(no prompt)";
  const answered = block.replies.at(-1) ? oneLine(block.replies.at(-1)!.text, 120) : block.turn.status;
  const work = block.tools.length > 0 ? ` · ${block.tools.length} tool call${block.tools.length === 1 ? "" : "s"}` : "";
  return `- Turn ${index + 1}: asked "${asked}" → ${answered}${work}`;
}

/** The latest checklist the thread was working through, if any. */
function openPlan(activities: readonly StoredActivity[]): string[] {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]!;
    if (activity.kind !== "turn.plan.updated" || !Array.isArray(activity.payload?.plan)) continue;
    return (activity.payload.plan as unknown[]).flatMap((row) => {
      const record = asRecord(row);
      const step = typeof record?.step === "string" ? record.step : null;
      if (step === null) return [];
      const status = typeof record?.status === "string" ? record.status : "pending";
      const mark = status === "completed" ? "[x]" : status === "inProgress" || status === "in_progress" ? "[~]" : "[ ]";
      return [`- ${mark} ${step}`];
    });
  }
  return [];
}

function stoppedBecause(last: TurnBlock | undefined, activities: readonly StoredActivity[]): string {
  if (last === undefined) return "The thread had not run a turn yet.";
  const limit = activities.find(
    (activity) => activity.turnId === last.turn.id && (activity.kind === "usage.limit" || activity.kind === "usage.wrap-up"),
  );
  if (limit) {
    const label = typeof limit.payload?.label === "string" ? `${limit.payload.label} ` : "";
    return `It stopped on a plan usage limit (${label}window), mid-task. Nothing about the work itself went wrong.`;
  }
  if (last.turn.status === "failed") return `Its last turn failed: ${oneLine(last.turn.error ?? "no error recorded", 300)}`;
  if (last.turn.status === "interrupted") return "Its last turn was interrupted before it finished.";
  if (last.turn.status === "running" || last.turn.status === "queued") return "Its last turn had not finished.";
  return "Its last turn finished; carry on from the last request.";
}

export interface HandoffOptions {
  readonly projectTitle?: string | null;
}

export async function buildHandoff(store: ThreadStore, threadId: string, options: HandoffOptions = {}): Promise<string> {
  const thread = (await store.readThreadRecord(threadId)) as StoredThread | null;
  if (!thread) throw new Error(`No thread ${threadId}.`);
  const [turns, messages, activities, checkpoints] = await Promise.all([
    store.readTurns(threadId),
    store.readMessages(threadId),
    store.readActivities(threadId),
    store.readCheckpoints(threadId),
  ]);

  // A turn has reached the agent once it produced something. One that is
  // queued, or was promoted to `running` by a settle but never ran (the
  // runner held it for a usage reset, or its process went away), carries
  // only the user's message: that is a request still to do, not history.
  const produced = new Set([
    ...messages.filter((message) => message.role === "assistant").map((message) => message.turnId),
    ...activities.filter((activity) => typeof activity.payload?.toolCallId === "string").map((activity) => activity.turnId ?? ""),
  ]);
  const terminal = (turn: StoredTurn): boolean => turn.status === "completed" || turn.status === "failed" || turn.status === "interrupted";
  const reached = (turn: StoredTurn): boolean => terminal(turn) || produced.has(turn.id);
  const sent = turns.filter(reached);
  const blocks: TurnBlock[] = sent.map((turn) => ({
    turn,
    prompts: messages.filter((message) => message.turnId === turn.id && message.role === "user"),
    replies: messages.filter((message) => message.turnId === turn.id && message.role === "assistant" && message.text.trim().length > 0),
    tools: toolLines(activities.filter((activity) => activity.turnId === turn.id)),
  }));
  const unsent = turns
    .filter((turn) => !reached(turn))
    .flatMap((turn) => messages.filter((message) => message.id === turn.messageId && message.origin !== "usage-continue"));

  // Files the thread changed, summed across every turn's checkpoint.
  const files = new Map<string, { additions: number; deletions: number }>();
  for (const checkpoint of checkpoints) {
    for (const file of checkpoint.files ?? []) {
      const known = files.get(file.path) ?? { additions: 0, deletions: 0 };
      files.set(file.path, { additions: known.additions + file.additions, deletions: known.deletions + file.deletions });
    }
  }

  const firstPrompt = blocks.find((block) => block.prompts.length > 0)?.prompts[0]?.text.trim() ?? null;
  const lastPrompt = [...blocks].reverse().find((block) => block.prompts.length > 0)?.prompts.at(-1)?.text.trim() ?? null;
  const plan = openPlan(activities);
  const where = thread.env.branch ? `${thread.env.path} (branch ${thread.env.branch})` : thread.env.path;

  const head: string[] = [
    `# Continuing: ${thread.title}`,
    "",
    "You are picking up a thread another session started and could not finish. Below is its record, written by Moxen from the thread's ledger — you have none of the original context beyond this. Read \"Where it stopped\" first.",
    "",
    `- Working directory: ${where}`,
    ...(options.projectTitle ? [`- Project: ${options.projectTitle}`] : []),
    `- Model it ran on: ${thread.modelSelection.instanceId}/${thread.modelSelection.model}`,
    `- Turns so far: ${blocks.length}`,
    "",
    "## Where it stopped",
    "",
    stoppedBecause(blocks.at(-1), activities),
  ];
  if (firstPrompt !== null && firstPrompt !== lastPrompt) head.push("", "The thread began with:", "", `> ${oneLine(firstPrompt, 400)}`);
  if (lastPrompt !== null) head.push("", "The last request, verbatim:", "", lastPrompt);
  if (plan.length > 0) head.push("", "Its checklist when it stopped (`[x]` done, `[~]` in progress, `[ ]` open):", "", ...plan);
  if (unsent.length > 0) {
    head.push("", "The user queued these and they were never sent — treat them as part of the task, in this order:", "");
    unsent.forEach((message, index) => head.push(`${index + 1}. ${message.text.trim()}`));
  }
  if (files.size > 0) {
    head.push("", "## Files already changed in this thread", "", "These edits are on disk now. Check the working tree before redoing anything — some work may be partly done.", "");
    for (const [path, stat] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      head.push(`- ${path} +${stat.additions} −${stat.deletions}`);
    }
  }
  const tail = [
    "",
    "---",
    "",
    "Continue the task from \"Where it stopped\". Do not start over: verify what is already done, then finish what is left.",
  ].join("\n");

  // Keep the most recent turns verbatim, shrinking older ones until the
  // document fits: the latest turns are where the unfinished work is.
  let verbatimFrom = Math.max(0, blocks.length - VERBATIM_TURNS);
  const render = (): string => {
    const older = blocks.slice(0, verbatimFrom).map((block, index) => summarized(block, index));
    const recent = blocks.slice(verbatimFrom).map((block, index) => verbatim(block, verbatimFrom + index));
    const conversation = [
      "",
      "## Conversation",
      ...(older.length > 0 ? ["", "Earlier turns, in brief:", "", ...older] : []),
      ...recent.flatMap((block) => ["", block]),
    ];
    return [...head, ...conversation].join("\n") + tail;
  };
  let document = render();
  while (document.length > TARGET_CHARS && verbatimFrom < blocks.length - 1) {
    verbatimFrom += 1;
    document = render();
  }
  return document;
}

/** The new thread's title: the old one, marked, without piling up marks. */
export function continuedTitle(title: string): string {
  const base = title.replace(/\s+\(continued(?: \d+)?\)$/u, "");
  const match = /\(continued(?: (\d+))?\)$/u.exec(title);
  if (match === null) return `${base} (continued)`;
  const next = match[1] === undefined ? 2 : Number(match[1]) + 1;
  return `${base} (continued ${next})`;
}
