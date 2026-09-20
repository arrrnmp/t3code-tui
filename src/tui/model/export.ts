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
 * Token-saving structure without losing content: prompts, replies, plans,
 * and questions are always complete — detail is what lets another agent
 * continue. Savings come from shape, not cuts: one line per tool call (the
 * wire strips tool input anyway, and per-file +/- counts already summarize
 * edits), plan checklists rendered once, no payload or output dumps, no
 * diff bodies.
 */

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
 * One tool call on one line: the verb plus the complete identifying detail
 * (full command, path, pattern, query), with exit/duration/counts where
 * known. Never a payload or output dump — but nothing is cut either:
 * multi-line input folds to single-spaced text on the same line.
 */
export function exportToolLine(entry: TimelineEntry): string | null {
  const activity = entry.activity;
  if (activity === null) return null;
  let view: ReturnType<typeof describeActivity>;
  try {
    view = describeActivity(activity);
  } catch {
    const summary = activity.summary.trim().replace(/\s+/gu, " ");
    return summary.length > 0 ? summary : null;
  }
  // Single-spaced but complete: folding whitespace keeps every character
  // while holding the one-line-per-tool structure.
  const full = (value: string): string => value.trim().replace(/\s+/gu, " ");
  switch (view.kind) {
    case "command": {
      const command = full(view.command);
      const exit = view.exit === null ? "" : view.exit === 0 ? " · exit 0" : ` · exit ${view.exit}`;
      const tail = view.running ? " · running" : "";
      return `$ ${command}${exit}${tail}`;
    }
    case "file": {
      const counts =
        view.added !== null || view.removed !== null
          ? ` (+${view.added ?? 0} −${view.removed ?? 0})`
          : "";
      const files = view.fileCount !== null ? ` · ${view.fileCount} files` : "";
      const tail = view.running ? " · running" : "";
      return `${view.verb} ${view.path}${counts}${files}${tail}`;
    }
    case "read": {
      const range = readRangeLabel(view.startLine, view.endLine);
      const tail = view.running ? " · running" : "";
      return `Read ${view.path}${range === null ? "" : ` ${range}`}${tail}`;
    }
    case "list":
      return `List ${view.path}${view.running ? " · running" : ""}`;
    case "grep": {
      const scope = view.scope === null ? "" : ` in ${view.scope}`;
      const tail = view.running ? " · running" : "";
      return `Grep "${view.pattern}"${scope}${tail}`;
    }
    case "todos":
      // The live checklist renders once in "State to continue", never per row.
      return null;
    case "task": {
      const taskType = view.taskType === null ? "" : ` · ${view.taskType}`;
      const model = view.model === null ? "" : ` · ${view.model}`;
      const tail = view.running ? " · running" : "";
      return `Task ${view.title} (${view.status}${taskType}${model})${tail}`;
    }
    case "question": {
      const detail = full(view.detail);
      const tail = view.running ? " · running" : "";
      return `${view.title}${detail.length > 0 ? `: ${detail}` : ""}${tail}`;
    }
    case "skill":
      return `Skill ${view.name}${view.running ? " · running" : ""}`;
    case "web": {
      const query = full(view.query);
      const tail = view.running ? " · running" : "";
      return `Web ${view.tool}: ${query}${tail}`;
    }
    case "image":
      return `Saw image ${view.path}`;
    case "tool": {
      const detail = full(view.detail);
      const tail = view.running ? " · running" : "";
      return `${view.tool}${detail.length > 0 ? `: ${detail}` : ""}${tail}`;
    }
    case "note": {
      const text = full(view.text);
      return text.length > 0 ? `Note: ${text}` : null;
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
  // Prompts and replies are complete — never truncated.
  lines.push("## State to continue", "");
  const firstPrompt = groups.flatMap((group) => group.prompts).find((entry) => entry.text.trim().length > 0);
  lines.push(`Goal: ${firstPrompt === undefined ? "_(no user prompt yet)_" : firstPrompt.text.trim()}`, "");
  const lastReply = [...groups].reverse().map((group) => group.reply).find((reply) => reply !== null && reply !== undefined && reply.text.trim().length > 0);
  lines.push(`Latest reply: ${lastReply === null || lastReply === undefined ? "_(none yet)_" : lastReply.text.trim()}`, "");
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
        lines.push(text.length > 0 ? text : "_(empty prompt)_", "");
      }
    }
    const toolLines = group.work.flatMap((entry) => {
      if (entry.kind !== "activity") return [];
      const line = exportToolLine(entry);
      return line === null ? [] : [line];
    });
    // Intermediate assistant messages (between tool batches) carry reasoning
    // the closing reply may not repeat — keep them with the work, complete.
    const workNotes = group.work.flatMap((entry) =>
      entry.kind !== "assistant" || entry.text.trim().length === 0 ? [] : [entry.text.trim()],
    );
    if (toolLines.length > 0 || workNotes.length > 0) {
      lines.push(`### Work (${toolLines.length} tool${toolLines.length === 1 ? "" : "s"})`, "");
      for (const line of toolLines) lines.push(`- ${line}`);
      for (const note of workNotes) lines.push(`- note: ${note.replace(/\s+/gu, " ")}`);
      lines.push("");
    }
    lines.push("### Reply", "");
    const reply = group.reply?.text.trim() ?? "";
    if (reply.length > 0) lines.push(reply, "");
    else if (group.live !== null && group.live.text.trim().length > 0)
      lines.push(`_(still running: ${group.live.text.trim().replace(/\s+/gu, " ")})_`, "");
    else lines.push("_(no reply)_", "");
    const files = filesLine(group.diff?.checkpoint ?? null);
    if (files !== null) lines.push(`Files: ${files}`, "");
    const proposed = group.proposedPlan?.proposedPlan ?? null;
    if (proposed !== null && proposed.planMarkdown.trim().length > 0) {
      lines.push("### Proposed plan", "", "```md", proposed.planMarkdown.trim(), "```", "");
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
