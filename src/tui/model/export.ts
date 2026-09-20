import type { T3Thread } from "../../types.js";
import { describeActivity, readRangeLabel } from "./activity.js";
import { formatDuration } from "./turns.js";
import type {
  ContextUsage,
  PendingUserInputRequest,
  PlanSnapshot,
  TimelineEntry,
  TurnCheckpoint,
} from "./thread.js";
import type { TurnGroup } from "./turns.js";

export interface ExportProject {
  title: string;
  workspaceRoot: string | null;
}

export interface FormatThreadExportOptions {
  thread: T3Thread | null;
  threadId: string;
  project: ExportProject | null;
  groups: TurnGroup[];
  plan: PlanSnapshot | null;
  pending: PendingUserInputRequest[];
  contextUsage: ContextUsage | null;
  exportedAt?: string;
}

/**
 * Token-saving caps: prompts and replies carry the substance another agent
 * needs to continue, so they get a generous budget; tool rows collapse to
 * one line each (the wire strips tool input anyway, and per-file +/- counts
 * already summarize edits). Truncation is always marked with the dropped
 * char count so the reader knows content was cut, not absent.
 */
export const EXPORT_MAX_BODY_CHARS = 6000;
export const EXPORT_MAX_TOOL_LINE_CHARS = 200;
export const EXPORT_MAX_STATE_CHARS = 1200;

function truncateMarked(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n…(truncated ${value.length - max} chars)`;
}

/** First non-empty line, single-spaced, capped — turn headings. */
function headLine(value: string, max = 100): string {
  const line = value.split(/\r?\n/u).map((row) => row.trim()).find((row) => row.length > 0) ?? "";
  const single = line.replace(/\s+/gu, " ");
  return single.length <= max ? single : `${single.slice(0, max)}…`;
}

function shortTurnId(turnId: string | null): string {
  return turnId ?? "no-turn-id";
}

/**
 * One tool call on one line: the verb plus the one argument that identifies
 * the call (command, path, pattern, query), with exit/duration/counts where
 * known. Never a payload or output dump.
 */
export function exportToolLine(entry: TimelineEntry): string | null {
  const activity = entry.activity;
  if (activity === null) return null;
  let view: ReturnType<typeof describeActivity>;
  try {
    view = describeActivity(activity);
  } catch {
    const summary = activity.summary.trim().replace(/\s+/gu, " ");
    return summary.length > 0 ? summary.slice(0, EXPORT_MAX_TOOL_LINE_CHARS) : null;
  }
  const cap = (value: string): string =>
    value.length <= EXPORT_MAX_TOOL_LINE_CHARS ? value : `${value.slice(0, EXPORT_MAX_TOOL_LINE_CHARS)}…`;
  switch (view.kind) {
    case "command": {
      const first = view.command.split("\n")[0]?.trim() ?? "";
      const extraLines = view.command.split("\n").length - 1;
      const exit = view.exit === null ? "" : view.exit === 0 ? " · exit 0" : ` · exit ${view.exit}`;
      const tail = view.running ? " · running" : "";
      const more = extraLines > 0 ? ` · +${extraLines} lines` : "";
      return cap(`$ ${first}${more}${exit}${tail}`);
    }
    case "file": {
      const counts =
        view.added !== null || view.removed !== null
          ? ` (+${view.added ?? 0} −${view.removed ?? 0})`
          : "";
      const files = view.fileCount !== null ? ` · ${view.fileCount} files` : "";
      const tail = view.running ? " · running" : "";
      return cap(`${view.verb} ${view.path}${counts}${files}${tail}`);
    }
    case "read": {
      const range = readRangeLabel(view.startLine, view.endLine);
      const tail = view.running ? " · running" : "";
      return cap(`Read ${view.path}${range === null ? "" : ` ${range}`}${tail}`);
    }
    case "list":
      return cap(`List ${view.path}${view.running ? " · running" : ""}`);
    case "grep": {
      const scope = view.scope === null ? "" : ` in ${view.scope}`;
      const tail = view.running ? " · running" : "";
      return cap(`Grep "${view.pattern}"${scope}${tail}`);
    }
    case "todos":
      // The live checklist renders once in "State to continue", never per row.
      return null;
    case "task": {
      const taskType = view.taskType === null ? "" : ` · ${view.taskType}`;
      const model = view.model === null ? "" : ` · ${view.model}`;
      const tail = view.running ? " · running" : "";
      return cap(`Task ${view.title} (${view.status}${taskType}${model})${tail}`);
    }
    case "question": {
      const detail = view.detail.trim().replace(/\s+/gu, " ");
      const tail = view.running ? " · running" : "";
      return cap(`${view.title}${detail.length > 0 ? `: ${detail}` : ""}${tail}`);
    }
    case "skill":
      return cap(`Skill ${view.name}${view.running ? " · running" : ""}`);
    case "web": {
      const query = view.query.trim().replace(/\s+/gu, " ");
      const tail = view.running ? " · running" : "";
      return cap(`Web ${view.tool}: ${query}${tail}`);
    }
    case "image":
      return cap(`Saw image ${view.path}`);
    case "tool": {
      const detail = view.detail.trim().replace(/\s+/gu, " ");
      const tail = view.running ? " · running" : "";
      return cap(`${view.tool}${detail.length > 0 ? `: ${detail}` : ""}${tail}`);
    }
    case "note": {
      const text = view.text.trim().replace(/\s+/gu, " ");
      return text.length > 0 ? cap(`Note: ${text}`) : null;
    }
  }
}

function filesLine(checkpoint: TurnCheckpoint | null): string | null {
  if (checkpoint === null || checkpoint.files.length === 0) return null;
  return checkpoint.files.map((file) => `${file.path} (+${file.additions} −${file.deletions})`).join(", ");
}

/** Net per-path edits across every turn checkpoint, for "State to continue". */
function cumulativeFiles(groups: TurnGroup[]): { path: string; added: number; removed: number }[] {
  const totals = new Map<string, { added: number; removed: number }>();
  for (const group of groups) {
    const files = group.diff?.checkpoint?.files ?? [];
    for (const file of files) {
      const slot = totals.get(file.path) ?? { added: 0, removed: 0 };
      slot.added += file.additions;
      slot.removed += file.deletions;
      totals.set(file.path, slot);
    }
  }
  return [...totals]
    .map(([path, counts]) => ({ path, ...counts }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function planChecklist(plan: PlanSnapshot | null): string[] {
  if (plan === null) return [];
  return plan.items.map((item) => {
    const done = /complete|done/i.test(item.status);
    return `- [${done ? "x" : " "}] ${item.content}`;
  });
}

/**
 * Whole thread as one markdown handover another agent can continue from:
 * compact header, "State to continue" (goal, last reply, open questions,
 * plan checklist, cumulative file edits), then one section per turn with
 * full prompts/replies and one line per tool call. Pure — file writing
 * lives in the hook.
 */
export function formatThreadExport(options: FormatThreadExportOptions): string {
  const { thread, threadId, project, groups, plan, pending, contextUsage } = options;
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const title = thread?.title ?? "(untitled thread)";
  const modelSelection = thread?.modelSelection;
  const model = modelSelection === undefined ? null : `${modelSelection.instanceId}/${modelSelection.model}`;
  const session = thread?.session;
  const sessionStatus = typeof session?.status === "string" ? session.status : null;

  let messageCount = 0;
  let toolCount = 0;
  let fileAdded = 0;
  let fileRemoved = 0;
  let fileTurns = 0;
  for (const group of groups) {
    messageCount += group.prompts.length + group.work.filter((entry) => entry.kind !== "activity").length;
    if (group.reply !== null) messageCount += 1;
    for (const entry of group.work) {
      if (entry.kind === "activity" && exportToolLine(entry) !== null) toolCount += 1;
    }
    const files = group.diff?.checkpoint?.files ?? [];
    if (files.length > 0) {
      fileTurns += 1;
      for (const file of files) {
        fileAdded += file.additions;
        fileRemoved += file.deletions;
      }
    }
  }

  const lines: string[] = [];
  lines.push(`# Thread export: ${title}`, "");
  lines.push(`- id: \`${threadId}\``);
  if (project !== null) {
    lines.push(`- project: ${project.title}${project.workspaceRoot === null ? "" : ` (\`${project.workspaceRoot}\`)`}`);
  }
  if (typeof thread?.branch === "string" && thread.branch.length > 0) lines.push(`- branch: \`${thread.branch}\``);
  if (model !== null) lines.push(`- model: \`${model}\``);
  if (thread?.runtimeMode !== undefined) lines.push(`- runtime: \`${String(thread.runtimeMode)}\``);
  if (thread?.interactionMode !== undefined) lines.push(`- interaction: \`${String(thread.interactionMode)}\``);
  if (sessionStatus !== null) lines.push(`- session: ${sessionStatus}`);
  if (typeof thread?.createdAt === "string") lines.push(`- created: ${thread.createdAt}`);
  if (typeof thread?.updatedAt === "string") lines.push(`- updated: ${thread.updatedAt}`);
  if (contextUsage !== null) {
    const max = contextUsage.maxTokens === null ? "?" : String(contextUsage.maxTokens);
    lines.push(`- context: ${contextUsage.usedTokens}/${max} tokens`);
  }
  lines.push(`- exported: ${exportedAt}`);
  lines.push(
    `- turns: ${groups.length} · messages: ${messageCount} · tool calls: ${toolCount} · files changed: ${fileTurns} turn${fileTurns === 1 ? "" : "s"} (+${fileAdded} −${fileRemoved})`,
  );
  lines.push("");

  // State to continue: everything a fresh agent needs before the transcript.
  lines.push("## State to continue", "");
  const firstPrompt = groups.flatMap((group) => group.prompts).find((entry) => entry.text.trim().length > 0);
  lines.push(`Goal: ${firstPrompt === undefined ? "_(no user prompt yet)_" : truncateMarked(firstPrompt.text.trim(), EXPORT_MAX_STATE_CHARS)}`, "");
  const lastReply = [...groups].reverse().map((group) => group.reply).find((reply) => reply !== null && reply !== undefined && reply.text.trim().length > 0);
  lines.push(`Latest reply: ${lastReply === null || lastReply === undefined ? "_(none yet)_" : truncateMarked(lastReply.text.trim(), EXPORT_MAX_STATE_CHARS)}`, "");
  if (pending.length > 0) {
    lines.push("Open questions (answer these first):");
    for (const request of pending) {
      for (const question of request.questions) {
        lines.push(`- ${question.header}: ${question.question}`);
        for (const option of question.options) {
          lines.push(`  - ${option.label}${option.description === null ? "" : ` — ${option.description}`}`);
        }
      }
    }
    lines.push("");
  }
  const checklist = planChecklist(plan);
  if (checklist.length > 0) {
    lines.push("Plan checklist:", ...checklist, "");
  }
  const cumulative = cumulativeFiles(groups);
  if (cumulative.length > 0) {
    lines.push("Files changed (all turns):");
    for (const file of cumulative) lines.push(`- ${file.path} (+${file.added} −${file.removed})`);
    lines.push("");
  }

  groups.forEach((group, index) => {
    const promptHead = group.prompts.length > 0 ? headLine(group.prompts[0]?.text ?? "") : "(no prompt)";
    const turnNo = index + 1;
    lines.push(`## T${turnNo} · ${promptHead.length > 0 ? promptHead : "(empty prompt)"} · ${shortTurnId(group.turnId)} · ${group.startedAt} · ${formatDuration(group.durationMs)}`, "");
    if (group.prompts.length > 0) {
      lines.push("### User", "");
      for (const prompt of group.prompts) {
        const text = prompt.text.trim();
        lines.push(text.length > 0 ? truncateMarked(text, EXPORT_MAX_BODY_CHARS) : "_(empty prompt)_", "");
      }
    }
    const toolLines = group.work.flatMap((entry) => {
      if (entry.kind !== "activity") return [];
      const line = exportToolLine(entry);
      return line === null ? [] : [line];
    });
    // Intermediate assistant messages (between tool batches) carry reasoning
    // the closing reply may not repeat — keep them with the work, truncated.
    const workNotes = group.work.flatMap((entry) =>
      entry.kind !== "assistant" || entry.text.trim().length === 0 ? [] : [entry.text.trim()],
    );
    if (toolLines.length > 0 || workNotes.length > 0) {
      lines.push(`### Work (${toolLines.length} tool${toolLines.length === 1 ? "" : "s"})`, "");
      for (const line of toolLines) lines.push(`- ${line}`);
      for (const note of workNotes) lines.push(`- note: ${truncateMarked(note.replace(/\s+/gu, " "), EXPORT_MAX_TOOL_LINE_CHARS)}`);
      lines.push("");
    }
    lines.push("### Reply", "");
    const reply = group.reply?.text.trim() ?? "";
    if (reply.length > 0) lines.push(truncateMarked(reply, EXPORT_MAX_BODY_CHARS), "");
    else if (group.live !== null && group.live.text.trim().length > 0)
      lines.push(`_(still running: ${truncateMarked(group.live.text.trim().replace(/\s+/gu, " "), EXPORT_MAX_TOOL_LINE_CHARS)})_`, "");
    else lines.push("_(no reply)_", "");
    const files = filesLine(group.diff?.checkpoint ?? null);
    if (files !== null) lines.push(`Files: ${files}`, "");
    const proposed = group.proposedPlan?.proposedPlan ?? null;
    if (proposed !== null && proposed.planMarkdown.trim().length > 0) {
      lines.push("### Proposed plan", "", "```md", truncateMarked(proposed.planMarkdown.trim(), EXPORT_MAX_BODY_CHARS), "```", "");
    }
  });

  lines.push(`_Exported ${exportedAt} from thread \`${threadId}\` — continue from "State to continue" above._`, "");
  return lines.join("\n");
}

/** `Message delay and scheduling` + `t-now` → `message-delay-and-scheduling-t-now.md`. */
export function defaultExportFilename(thread: { id: string; title: string } | null, threadId: string): string {
  const slug =
    thread === null
      ? "thread"
      : thread.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
          .slice(0, 40) || "thread";
  const short = threadId.replace(/[^a-zA-Z0-9]+/gu, "").slice(0, 8) || "export";
  return `${slug}-${short}.md`;
}
