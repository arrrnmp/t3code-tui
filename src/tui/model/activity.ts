import { createPatch } from "diff";

import type { ActivityEnvelope } from "../../core/types.js";
import { detectFiletype } from "./patch.js";

export interface CommandView {
  kind: "command";
  tool: string;
  command: string;
  workdir: string | null;
  exit: number | null;
  durationMs: number | null;
  outputTail: string | null;
  failed: boolean;
  running: boolean;
}

export interface FileChangeView {
  kind: "file";
  verb: string;
  path: string;
  /** Files touched when one call edits several paths (wire `data.files`). */
  fileCount: number | null;
  added: number | null;
  removed: number | null;
  /** Unified diff patch text ready for the `<diff>` renderable, or null when
      no before/after content exists yet (a just-started edit). */
  diff: string | null;
  /** Lines omitted from `diff` for an oversized new-file write — `added`
      above still reflects the true total, only the rendered patch is capped. */
  diffMore: number;
  filetype: string | undefined;
  running: boolean;
}

export interface ReadView {
  kind: "read";
  path: string;
  /** 1-indexed first line when only a section was read (offset); null for
      whole-file reads. */
  startLine: number | null;
  /** 1-indexed last line (offset + limit - 1); null when unbounded. */
  endLine: number | null;
  running: boolean;
}

export interface ListView {
  kind: "list";
  path: string;
  running: boolean;
}

export interface GrepView {
  kind: "grep";
  pattern: string;
  scope: string | null;
  running: boolean;
}

export interface TodoItem {
  content: string;
  status: string;
}

export interface TodoView {
  kind: "todos";
  title: string;
  items: TodoItem[];
  running: boolean;
}

export interface TaskView {
  kind: "task";
  title: string;
  taskType: string | null;
  model: string | null;
  status: string;
  running: boolean;
}

export interface QuestionView {
  kind: "question";
  title: string;
  detail: string;
  running: boolean;
}

export interface SkillView {
  kind: "skill";
  name: string;
  running: boolean;
}

export interface WebView {
  kind: "web";
  tool: string;
  query: string;
  running: boolean;
}

export interface ImageView {
  kind: "image";
  path: string;
}

export interface ToolView {
  kind: "tool";
  tool: string;
  detail: string;
  running: boolean;
}

export interface NoteView {
  kind: "note";
  text: string;
  tone: string;
}

/** A stretch of the model's reasoning: its readable summary and how long it took. */
export interface ReasoningView {
  kind: "reasoning";
  /** The summary; empty when the provider showed none. */
  text: string;
  startedAt: string | null;
  durationMs: number | null;
  running: boolean;
}

/** The provider moved the thread to another model on its own (a flagged request re-run). */
export interface ModelSwitchView {
  kind: "model-switch";
  from: string | null;
  to: string;
  /** Why it was flagged, in words ("biology"); null when the provider did not say. */
  category: string | null;
  /** `local`: only a subagent's or side question's reply moved — the thread did not. */
  scope: "session" | "local";
  /** `refusal-fallback`: a flagged request re-ran; `auto`: any other switch the provider made itself. */
  reason: "refusal-fallback" | "auto";
}

/** Something the provider did to the session: compacted it, or refused a tool call in auto mode. */
export interface NoticeView {
  kind: "notice";
  notice: "compacted" | "permission-denied" | "other";
  title: string;
  /** The compaction summary, or why the call was refused. */
  detail: string | null;
}

/** A plan usage limit stopped the turn, or (`wrapUp`) was met with a small allowance to finish on. */
export interface UsageLimitView {
  kind: "usage-limit";
  /** The window that ran out ("Session", "Weekly"). */
  label: string | null;
  resetsAt: string | null;
  /** The turn carries on to a stopping point, on an allowance drawn from the weekly limit. */
  wrapUp: boolean;
}

export type ActivityView =
  | CommandView
  | FileChangeView
  | ReadView
  | ListView
  | GrepView
  | TodoView
  | TaskView
  | QuestionView
  | SkillView
  | WebView
  | ImageView
  | ToolView
  | NoteView
  | ModelSwitchView
  | UsageLimitView
  | ReasoningView
  | NoticeView;

/**
 * Checklist-bookkeeping tools: OpenCode's `todowrite`/`todoread`, Claude's
 * `TodoWrite` and its `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`
 * successors. The checklist they maintain already renders as the tasks
 * panel (fed by `turn.plan.updated`), so each call maps to a `todos` view,
 * which `isPlanActivity` keeps out of the transcript.
 */
const CHECKLIST_TOOLS: ReadonlySet<string> = new Set(["todowrite", "todoread", "todo", "taskcreate", "taskupdate", "tasklist", "taskget"]);

/** Tool verbs rendered as a `$ <shell>` command card. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "shell", "exec", "powershell", "pwsh", "monitor"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Where the open thread's files live (its worktree, then its project) and
 * the user's home: display paths are made relative to them. Set by the app
 * as the open thread changes; empty until then.
 */
let pathRoots: { roots: string[]; home: string | null } = { roots: [], home: null };

export function setPathRoots(roots: ReadonlyArray<string | null | undefined>, home: string | null): void {
  const clean = roots.flatMap((root) => (typeof root === "string" && root.length > 0 ? [slashes(root).replace(/\/+$/u, "")] : []));
  pathRoots = { roots: clean, home: home === null ? null : slashes(home).replace(/\/+$/u, "") };
}

function slashes(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Past this many characters a path outside the project keeps its head and tail: "~/.claude/…/memory/notes.md". */
const LONG_PATH = 48;

function collapseMiddle(path: string): string {
  if (path.length <= LONG_PATH) return path;
  const parts = path.split("/");
  if (parts.length <= 4) return path;
  return [...parts.slice(0, 2), "…", ...parts.slice(-2)].join("/");
}

/**
 * A file path as a row shows it: relative inside the thread's worktree or
 * project, "~/…" under home, absolute elsewhere — so a file outside the
 * project never reads as one inside it. Relative inputs stay as they are.
 */
function shortenPath(value: string): string {
  const normalized = slashes(value);
  if (!/^([a-z]:)?\//iu.test(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  for (const root of pathRoots.roots) {
    if (lower.startsWith(`${root.toLowerCase()}/`)) return normalized.slice(root.length + 1);
  }
  const home = pathRoots.home;
  if (home !== null && lower.startsWith(`${home.toLowerCase()}/`)) return collapseMiddle(`~${normalized.slice(home.length)}`);
  if (pathRoots.roots.length === 0) {
    // No thread context (tests, early frames): the old best guess.
    const marker = normalized.lastIndexOf("/src/");
    if (marker !== -1) return normalized.slice(marker + 1);
    return normalized.split("/").slice(-2).join("/");
  }
  return collapseMiddle(normalized);
}

function shortInputPath(input: Record<string, unknown>): string | null {
  const raw = asString(input.path);
  return raw === null ? null : shortenPath(raw);
}

/**
 * A row's file path before display shortening (`shortenPath` keeps the last
 * two segments for headers, which no longer resolves on disk). Same
 * precedence as the file/read branches of `describeActivity` — checkpoint
 * file list, tool input, path-like title, `detail` echo — but unshortened,
 * for disk reads (content-cache snapshots, overlay matching). Null when the
 * row names no file at all.
 */
export function activityFilePath(activity: ActivityEnvelope): string | null {
  const payload = asRecord(activity.payload) ?? {};
  const data = asRecord(payload.data) ?? {};
  const state = asRecord(data.state) ?? {};
  const input = asRecord(state.input) ?? asRecord(data.input) ?? {};
  const files = Array.isArray(data.files) ? data.files : [];
  const firstFile = asString(asRecord(files[0])?.path);
  const inputPath = asString(input.file_path) ?? asString(input.filePath);
  const title = asString(payload.title) ?? asString(activity.summary) ?? "";
  const titlePath = looksLikePath(title) ? title : null;
  return firstFile ?? inputPath ?? titlePath;
}

/** Titles double as paths on completed rows (`src\tui\app.tsx`) but are bare
    verbs while running (`edit`), so only treat them as paths with evidence. */
function looksLikePath(value: string): boolean {
  return value.includes("/") || value.includes("\\") || /\.[a-zA-Z0-9]{1,8}$/.test(value.trim());
}

/**
 * OpenCode's nameless list/read rows dump `<path>…</path><type>file|directory
 * </type>` result XML in `detail` with an empty `data`. The tags lead the
 * dump, so they survive truncation.
 */
function parseListingDetail(detail: string | null): { path: string; directory: boolean } | null {
  if (detail === null) return null;
  const match = /<path>([\s\S]*?)<\/path>\s*<type>(file|directory)<\/type>/.exec(detail);
  if (match === null) return null;
  const path = (match[1] ?? "").trim();
  if (path.length === 0) return null;
  return { path, directory: match[2] === "directory" };
}

/** One human line for a tool call's input — never a raw output dump. */
function summarizeInput(input: Record<string, unknown>): string {
  const questions = input.questions;
  if (Array.isArray(questions)) {
    const first = asRecord(questions[0]);
    const head = first === null ? null : asString(first.question);
    return head === null
      ? `${questions.length} questions`
      : `${questions.length} question${questions.length === 1 ? "" : "s"}: ${head}`;
  }
  for (const key of [
    "filePath",
    "file_path",
    "path",
    "pattern",
    "command",
    "query",
    "url",
    "prompt",
    "name",
    "title",
    "text",
  ]) {
    const value = asString(input[key]);
    if (value !== null) return key === "filePath" || key === "file_path" || key === "path" ? shortenPath(value) : value;
  }
  return "";
}

function lastLines(value: string, maxLines: number): string {
  const rows = value.split("\n").map((row) => row.trimEnd()).filter((row) => row.trim().length > 0);
  return rows.slice(-maxLines).join("\n");
}

/** First non-empty line — the result summary (`Found 2 matches`) of a
    stripped grep dump whose pattern didn't survive. */
function firstLine(value: string | null): string | null {
  if (value === null) return null;
  const line = value.split("\n").map((row) => row.trim()).find((row) => row.length > 0);
  return line ?? null;
}

/** Longest common directory of file paths (forward-slash form) — null
    when the paths share nothing (different roots). */
function commonDir(paths: readonly string[]): string | null {
  const dirs = paths.map((value) =>
    value
      .replace(/\\/g, "/")
      .split("/")
      .filter((part) => part.length > 0)
      .slice(0, -1),
  );
  const first = dirs[0] ?? [];
  let common = 0;
  while (common < first.length && dirs.every((parts) => parts[common] === first[common])) common++;
  if (common === 0) return null;
  return first.slice(0, common).join("/");
}

/**
 * 1-indexed section bounds from a Read call's `offset`/`limit` (both
 * harnesses share the same semantics: offset starts at line 1, limit caps
 * the row count). Whole-file reads resolve to nulls so the row stays a bare `Read(path)`; `offset: 700, limit: 101` becomes L700-L800
 * and an unbounded `offset: 700` becomes L700+.
 */
function readRange(input: Record<string, unknown>): { startLine: number | null; endLine: number | null } {
  const offset = asNumber(input.offset);
  const limit = asNumber(input.limit);
  const startLine =
    offset !== null && offset >= 1 ? Math.floor(offset) : limit !== null && limit > 0 ? 1 : null;
  const endLine =
    startLine !== null && limit !== null && limit > 0 ? startLine + Math.floor(limit) - 1 : null;
  return { startLine, endLine };
}

/** `L700-L800`, `L700+`, or null for whole-file reads — the Read row suffix. */
export function readRangeLabel(startLine: number | null, endLine: number | null): string | null {
  if (startLine === null) return null;
  return endLine === null ? `L${startLine}+` : `L${startLine}-L${endLine}`;
}

/** A pre-computed unified diff a provider already attached to the tool call
    (OpenCode's `state.metadata.diff`/`filediff.patch`) — prefer this over
    diffing ourselves since it's scoped to exactly what the provider changed. */
function providedDiff(data: Record<string, unknown>): string | null {
  const state = asRecord(data.state) ?? {};
  const metadata = asRecord(state.metadata) ?? {};
  const direct = asString(metadata.diff);
  if (direct !== null) return direct;
  const filediff = asRecord(metadata.filediff);
  return filediff === null ? null : asString(filediff.patch);
}

/** `old_string`/`new_string` are arbitrary substrings of a file, so their
    last line almost never ends in `\n` — feeding that straight to `diff`
    treats the final line as changed (a "\ No newline at end of file" marker)
    even when it's identical, showing every edit's last context line as both
    removed and added. Padding both sides the same way avoids that noise
    without changing what the patch reports as actually changed. */
function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function countChangedLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

/** New-file writes can dump an entire file inline; cap the *content* fed to
    the differ (not the resulting patch text) so every hunk this produces
    stays well-formed instead of getting cut off mid-hunk. */
const MAX_CREATED_FILE_LINES = 40;

function buildFileDiff(
  fileName: string,
  oldString: string | null,
  newString: string | null,
  data: Record<string, unknown>,
): { diff: string | null; added: number | null; removed: number | null; diffMore: number } {
  const fromProvider = providedDiff(data);
  if (fromProvider !== null) {
    const { added, removed } = countChangedLines(fromProvider);
    return { diff: fromProvider, added, removed, diffMore: 0 };
  }
  if (oldString === null && newString === null) return { diff: null, added: null, removed: null, diffMore: 0 };

  // A pure creation (no `oldString`) has nothing to diff against, so every
  // line is "added" by construction — skip the differ and report the true
  // total directly rather than the truncated count below.
  if (oldString === null) {
    const lines = (newString ?? "").split("\n");
    const capped = lines.length > MAX_CREATED_FILE_LINES;
    const shown = capped ? lines.slice(0, MAX_CREATED_FILE_LINES).join("\n") : (newString ?? "");
    const diff = createPatch(fileName, "", withTrailingNewline(shown), undefined, undefined, { context: 3 });
    return { diff, added: lines.length, removed: null, diffMore: capped ? lines.length - MAX_CREATED_FILE_LINES : 0 };
  }

  const diff = createPatch(
    fileName,
    withTrailingNewline(oldString),
    withTrailingNewline(newString ?? ""),
    undefined,
    undefined,
    { context: 3 },
  );
  const { added, removed } = countChangedLines(diff);
  return { diff, added, removed, diffMore: 0 };
}

/**
 * Human-friendly titles for tool calls that would otherwise show their raw
 * identifier verbatim through the generic `kind:"tool"` fallback below —
 * Claude's own meta/orchestration tools, keyed lowercase. Read/Grep/Glob/
 * TodoWrite/AskUserQuestion/Skill/WebFetch/WebSearch already get a real
 * dedicated view above and never reach this table.
 */
const FRIENDLY_TOOL_TITLES: Record<string, string> = {
  toolsearch: "Searching for tools",
  notebookedit: "Editing notebook",
  bashoutput: "Checking background output",
  killshell: "Stopping background shell",
  slashcommand: "Running command",
  enterplanmode: "Entering plan mode",
  exitplanmode: "Exiting plan mode",
  agent: "Delegating to subagent",
  schedulewakeup: "Scheduling wakeup",
  listagents: "Listing agents",
  sendmessage: "Messaging agent",
  reportfindings: "Reporting findings",
  enterworktree: "Entering worktree",
  exitworktree: "Exiting worktree",
  designsync: "Syncing design",
  croncreate: "Scheduling cron job",
  cronlist: "Listing cron jobs",
  crondelete: "Deleting cron job",
  remotetrigger: "Triggering remote job",
  pushnotification: "Sending notification",
  monitor: "Monitoring process",
  taskoutput: "Checking task output",
  taskstop: "Stopping task",
};

/**
 * `ToolSearch` rows used to print their query verbatim, so loading two
 * tools by name read as `Searching for tool / select:EnterPlanMode,ExitPlanMode`
 * — wire syntax in the transcript. The query has three documented forms and
 * each says something different: `select:A,B` names tools outright (nothing
 * is being *searched*), a leading `+term` pins a required word, and anything
 * else is a keyword search.
 */
function toolSearchView(input: Record<string, unknown>, running: boolean): ActivityView {
  const query = (asString(input.query) ?? "").trim();
  if (query.length === 0) return { kind: "tool", tool: "Searching for tools", detail: "", running };
  if (query.toLowerCase().startsWith("select:")) {
    const names = query
      .slice("select:".length)
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    // Loading only the checklist tools is as much bookkeeping as calling them.
    if (names.length > 0 && names.every((name) => CHECKLIST_TOOLS.has(name.toLowerCase()))) {
      return { kind: "todos", title: "Loaded checklist tools", items: [], running };
    }
    if (names.length > 0) {
      return { kind: "tool", tool: running ? "Loading tools" : "Loaded tools", detail: names.join(", "), running };
    }
  }
  const terms = query
    .split(/\s+/)
    .map((term) => (term.startsWith("+") ? term.slice(1) : term))
    .filter((term) => term.length > 0);
  return { kind: "tool", tool: "Searching for tools", detail: terms.join(" ") || query, running };
}

/** `mcp__linear__create_issue` → `linear: create_issue` — the raw
    double-underscore server/tool encoding reads poorly verbatim. */
function friendlyToolTitle(name: string): string {
  const known = FRIENDLY_TOOL_TITLES[name.toLowerCase()];
  if (known !== undefined) return known;
  const mcpMatch = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  if (mcpMatch !== null) return `${mcpMatch[1]}: ${mcpMatch[2]}`;
  return name;
}

function isRunning(payload: Record<string, unknown>): boolean {
  return payload.status === "inProgress";
}

/**
 * Shapes observed on the wire, not the
 * idealized contract. Two tool families exist side by side:
 * - Harness-managed tools: `data: { tool, state: { status, input, output,
 *   metadata, time } }` plus a top-level `title`. Started rows have an
 *   empty `input`.
 * - Provider-native tools: `data: { toolName, input, result }` with the
 *   `ToolName: {json}` call echoed in `detail`.
 * - `turn.plan.updated` carries `{ plan: [{ step, status }] }`.
 * - subagent tasks carry `{ taskId, title, taskType, model, status }`.
 */
export function describeActivity(activity: ActivityEnvelope): ActivityView {
  const payload = asRecord(activity.payload) ?? {};
  const data = asRecord(payload.data) ?? {};
  const state = asRecord(data.state) ?? {};
  const input = asRecord(state.input) ?? asRecord(data.input) ?? {};
  const running = isRunning(payload);
  const tool = asString(data.tool) ?? asString(data.toolName) ?? null;
  const title = asString(payload.title) ?? asString(activity.summary) ?? activity.kind;

  if (activity.kind === "model.changed") {
    const to = asString(payload.toLabel) ?? asString(payload.to) ?? "another model";
    return {
      kind: "model-switch",
      from: asString(payload.fromLabel) ?? asString(payload.from),
      to,
      category: refusalCategory(payload.category),
      scope: payload.scope === "local" ? "local" : "session",
      reason: payload.reason === "auto" ? "auto" : "refusal-fallback",
    };
  }
  if (activity.kind === "notice") {
    const notice = payload.notice === "compacted" || payload.notice === "permission-denied" ? payload.notice : "other";
    return { kind: "notice", notice, title: asString(activity.summary) ?? "Notice", detail: asString(payload.detail) };
  }
  if (activity.kind === "usage.limit" || activity.kind === "usage.wrap-up") {
    return { kind: "usage-limit", label: asString(payload.label), resetsAt: asString(payload.resetsAt), wrapUp: activity.kind === "usage.wrap-up" };
  }
  if (payload.itemType === "reasoning") {
    return {
      kind: "reasoning",
      text: typeof payload.text === "string" ? payload.text.trim() : "",
      startedAt: asString(payload.startedAt),
      durationMs: asNumber(payload.durationMs),
      running,
    };
  }

  const itemType = payload.itemType;
  if (itemType === "command_execution") {
    const command = asString(input.command) ?? asString(data.command) ?? title;
    const metadata = asRecord(state.metadata) ?? {};
    const time = asRecord(state.time) ?? {};
    const exit = asNumber(metadata.exit);
    const start = asNumber(time.start);
    const end = asNumber(time.end);
    const output = asString(state.output) ?? asString(payload.detail) ?? "";
    return {
      kind: "command",
      tool: tool ?? "bash",
      command,
      workdir: asString(input.workdir),
      exit,
      durationMs: start !== null && end !== null && end >= start ? end - start : null,
      outputTail: !running && exit !== null && exit !== 0 && output.length > 0 ? lastLines(output, 3) : null,
      failed: exit !== null && exit !== 0,
      running,
    };
  }

  if (itemType === "file_change") {
    // The subscription strips `state.input` (and usually `data.tool`) from
    // tool payloads: completed rows keep only `title`, `detail`, and
    // `data.files[].path`. Resolve the path from the files list first so
    // in-flight rows ("edit" title) still show the file, and only treat the
    // title as a path when it actually looks like one.
    const files = Array.isArray(data.files) ? data.files : [];
    const firstFile = asString(asRecord(files[0])?.path);
    const inputPath = asString(input.file_path) ?? asString(input.filePath);
    const titlePath = looksLikePath(title) ? title : null;
    // In-flight rows ("edit" title, empty input) genuinely have no path yet;
    // completed provider-native rows recover it from the `detail` echo.
    const filePath = firstFile ?? inputPath ?? titlePath ?? "…";
    const oldString = asString(input.old_string) ?? asString(input.oldString);
    const newString = asString(input.new_string) ?? asString(input.newString) ?? asString(input.content);
    const path = filePath === "…" ? filePath : shortenPath(filePath);
    const rawVerb = (tool ?? (looksLikePath(title) ? "edit" : title)).toLowerCase();
    // `apply_patch` is OpenCode's patch-based edit tool — same "changed this
    // file" verb as Claude's Edit/MultiEdit, just a different name.
    const verb =
      rawVerb === "edit" || rawVerb === "multiedit" || rawVerb === "apply_patch"
        ? "Update"
        : rawVerb.charAt(0).toUpperCase() + rawVerb.slice(1);
    const { diff, added, removed, diffMore } = buildFileDiff(path, oldString, newString, data);
    return {
      kind: "file",
      verb,
      path,
      fileCount: files.length > 1 ? files.length : null,
      added,
      removed,
      diff,
      diffMore,
      filetype: filePath === "…" ? undefined : detectFiletype(filePath),
      running,
    };
  }

  if (itemType === "image_view") {
    const imagePath = asString(data.imagePath) ?? asString(payload.detail) ?? "(image)";
    return { kind: "image", path: imagePath.split(/[\\/]/).pop() ?? imagePath };
  }

  if (itemType === "web_search") {
    return {
      kind: "web",
      tool: tool ?? "web",
      query: asString(input.query) ?? asString(input.url) ?? title,
      running,
    };
  }

  if (itemType === "dynamic_tool_call" || itemType === "collab_agent_tool_call") {
    const display = tool ?? "tool";
    const name = display.toLowerCase();
    // Harnesses may namespace their tools (`default.bash`, `ns.read`) —
    // match branches on the trailing segment so namespaced calls get the
    // same mapped views instead of the raw generic fallback. Clean names
    // are unaffected (the trailing segment is the whole name).
    const short = name.split(/[^a-z]+/).filter((part) => part.length > 0).pop() ?? name;
    if (short === "read") {
      // Claude's real Read tool call uses the snake_case `file_path` param
      // (same as Edit/Write); only checking `filePath` here always missed it
      // and silently fell back to the generic "Tool call" title instead.
      // In-flight rows have no path anywhere (empty input, bare title), so
      // they render `Read(…)` until the completed row resolves — a bare
      // title like "Tool call" is never a path and must not leak in.
      const readPath =
        asString(input.file_path) ?? asString(input.filePath) ?? (looksLikePath(title) ? title : null) ?? "…";
      return {
        kind: "read",
        path: readPath === "…" ? readPath : shortenPath(readPath),
        ...readRange(input),
        running,
      };
    }
    if (short === "grep") {
      return {
        kind: "grep",
        pattern: asString(input.pattern) ?? title,
        scope: asString(input.include) ?? shortInputPath(input),
        running,
      };
    }
    if (short === "glob") {
      return {
        kind: "grep",
        pattern: asString(input.pattern) ?? title,
        scope: shortInputPath(input),
        running,
      };
    }
    // Provider-native shell calls (`Bash` as a `dynamic_tool_call`, possibly
    // namespaced like `default.bash`) never pass through the harness-managed
    // `command_execution` branch above, so without this they fall into the
    // generic raw tool fallback. Map them to the same `$ bash` command view
    // the timeline already renders.
    if (SHELL_TOOLS.has(short)) {
      return {
        kind: "command",
        tool: short,
        command: asString(input.command) ?? title,
        workdir: asString(input.workdir) ?? asString(input.cwd),
        exit: null,
        durationMs: null,
        outputTail: null,
        failed: false,
        running,
      };
    }
    if (CHECKLIST_TOOLS.has(short)) {
      return { kind: "todos", title, items: decodeTodos(input.todos), running };
    }
    // OpenCode's own web tools (`webfetch`/`websearch`/`mcp-websearch`) and
    // Claude's `WebFetch`/`WebSearch` normally arrive under the dedicated
    // `web_search` itemType above, but fall back here if a build ever routes
    // them through the generic tool-call path instead.
    if (short === "webfetch" || short === "websearch") {
      return {
        kind: "web",
        tool: display,
        query: asString(input.url) ?? asString(input.query) ?? title,
        running,
      };
    }
    if (short === "question" || short === "askuserquestion") {
      const questions = input.questions;
      const first = Array.isArray(questions) ? asRecord(questions[0]) : null;
      const count = Array.isArray(questions) ? questions.length : 0;
      return {
        kind: "question",
        title: count > 0 ? `Asked ${count} question${count === 1 ? "" : "s"}` : title,
        detail: asString(first?.question) ?? asString(payload.detail) ?? "",
        running,
      };
    }
    if (short === "skill") {
      return { kind: "skill", name: asString(input.name) ?? title, running };
    }
    // OpenCode's list/read rows arrive nameless (`data: {}`) with a
    // `<path>…</path><type>file|directory</type>` result dump in `detail` —
    // without this they render as a raw XML dump under a bare path title.
    // Only nameless rows take this path; a named tool keeps its own branch.
    if (display === "tool") {
      // Stripped wire rows also lose the tool NAME — but the server title
      // often names it (`grep`, `Bash`) while `detail` carries the result
      // dump. Route those titles to the mapped views (degraded: pattern /
      // command only survive when the input wasn't stripped) instead of
      // the raw dump. Path-like titles stay on the listing path below —
      // a file that happens to end in a tool word must still resolve.
      if (!looksLikePath(title)) {
        const titled = title
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((part) => part.length > 0)
          .pop() ?? "";
        if (titled === "grep" || titled === "glob") {
          return {
            kind: "grep",
            // The pattern only survives when the input wasn't stripped;
            // otherwise headline the dump's own summary line instead of a
            // bare row.
            pattern: asString(input.pattern) ?? firstLine(asString(payload.detail)) ?? "",
            scope: asString(input.include) ?? shortInputPath(input),
            running,
          };
        }
        if (SHELL_TOOLS.has(titled)) {
          return {
            kind: "command",
            tool: titled,
            command: asString(input.command) ?? "",
            workdir: asString(input.workdir) ?? asString(input.cwd),
            exit: null,
            durationMs: null,
            outputTail: null,
            failed: false,
            running,
          };
        }
      }
      // Same stripped shape, but the server titled the completed row with
      // the grep pattern itself instead of the verb — the pattern survives
      // in the title even though the input didn't. The detail signature
      // alone decides here: deliberately no path guard, because patterns
      // routinely contain backslashes (`\bname\b`), slashes (`and/or`),
      // and dots (`foo.ts`) that look path-like but aren't. Verb-titled
      // rows above already claimed their own branches first. A zero-match
      // dump (`No files found`) carries the pattern the same way. The server
      // truncates long result lists, so the header may carry a trailing
      // note (`Found 100 matches (more matches available)`).
      {
        const head = firstLine(asString(payload.detail));
        if (head !== null && (/^found \d+ match/i.test(head) || /^no (files|matches|results?) found$/i.test(head))) {
          return { kind: "grep", pattern: title, scope: null, running };
        }
      }
      // Nameless glob dumps are bare path lists with no header and no XML
      // — collapse them to their common directory instead of the raw dump.
      // Path-titled rows stay out: that's a file's own content being read,
      // not a match list (verb-titled shell rows already routed above, and
      // an `ls`-titled one reads honestly as a listing either way).
      if (!looksLikePath(title)) {
        const dumpLines = (asString(payload.detail) ?? "")
          .split("\n")
          .map((row) => row.trim())
          .filter((row) => row.length > 0)
          .slice(0, 30);
        if (dumpLines.length > 0 && dumpLines.every(looksLikePath)) {
          const dir = commonDir(dumpLines);
          if (dir !== null) return { kind: "list", path: shortenPath(dir), running };
        }
      }
      const listing = parseListingDetail(asString(payload.detail));
      if (listing !== null) {
        const rawPath = looksLikePath(title) ? title : listing.path;
        const path = shortenPath(rawPath);
        // The input may have arrived later via backfill — a listing row
        // whose offset survived (or recovered) still earns its range.
        return listing.directory
          ? { kind: "list", path, running }
          : { kind: "read", path, ...readRange(input), running };
      }
    }
    // Unknown tool shape: never render a bare "tool" with nothing after it.
    // Fall back to the input's own name, then the server's title, and echo
    // whatever detail the projection carried so the row says what ran —
    // unless the tool already maps to a friendly title (ExitPlanMode & co.),
    // whose raw `Name: {json}` echo would only dump wire JSON under it.
    const fallbackName = asString(input.name) ?? title;
    const fallbackTool = display === "tool" ? fallbackName : display;
    if (fallbackTool.toLowerCase() === "toolsearch") return toolSearchView(input, running);
    const friendlyTitle = friendlyToolTitle(fallbackTool);
    const fallbackDetail =
      summarizeInput(input) || (friendlyTitle === fallbackTool ? (asString(payload.detail) ?? "") : "");
    return { kind: "tool", tool: friendlyTitle, detail: fallbackDetail, running };
  }

  // The agent's question arrives twice: once as an `AskUserQuestion` tool
  // call (started/updated/completed rows with stripped input, rendering as
  // bare "Tool call started / AskUserQuestion: {}" noise) and once as a
  // `user-input.requested` activity carrying the real questions. The
  // transcript keeps only this one — the tool rows are filtered out of
  // `timeline()` in thread.ts.
  if (activity.kind === "user-input.requested") {
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    const first = asRecord(questions[0]);
    const head = first === null ? null : asString(first.question);
    return {
      kind: "question",
      title:
        questions.length > 0
          ? `Asked ${questions.length} question${questions.length === 1 ? "" : "s"}`
          : "Question",
      detail: head ?? "",
      running: false,
    };
  }

  if (typeof payload.taskId === "string") {    return {
      kind: "task",
      title: asString(payload.title) ?? activity.summary,
      taskType: asString(payload.taskType),
      model: asString(payload.model),
      status: asString(payload.status) ?? activity.kind,
      running: activity.kind === "task.started" || activity.kind === "background.started",
    };
  }

  const plan = payload.plan;
  if (Array.isArray(plan)) {
    return {
      kind: "todos",
      title: "Plan",
      items: plan.flatMap((row) => {
        const record = asRecord(row);
        if (record === null) return [];
        const step = asString(record.step);
        if (step === null) return [];
        return [{ content: step, status: asString(record.status) ?? "pending" }];
      }),
      running,
    };
  }

  return { kind: "note", text: String(activity.summary), tone: String(activity.tone ?? "info") };
}

/** "bio" → "biology": the classifier categories a flagged request carries, in words. */
function refusalCategory(raw: unknown): string | null {
  const category = asString(raw)?.toLowerCase() ?? null;
  if (category === "bio") return "biology";
  if (category === "cyber") return "cybersecurity";
  return category;
}

function decodeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    const record = asRecord(row);
    const content = record === null ? null : asString(record.content);
    if (content === null) return [];
    return [{ content, status: record === null ? "pending" : (asString(record.status) ?? "pending") }];
  });
}

/**
 * Subtitle counts for a file row, matching whatever diff actually renders
 * below it. Exact per-edit counts win whenever the row carries its own
 * content; the turn checkpoint's net counts cover content-less rows whose
 * hunks (if any) backfill from that same checkpoint patch; overlay counts
 * cover the live working-tree case, which has neither. Without this order
 * a row renders its own exact hunks under another edit's totals.
 */
export function fileRowCounts(
  view: FileChangeView,
  editStats: { added: number; removed: number } | null,
  overlay: { additions: number; deletions: number } | null,
): { added: number | null; removed: number | null } {
  return {
    added: view.added ?? editStats?.added ?? overlay?.additions ?? null,
    removed: view.removed ?? editStats?.removed ?? overlay?.deletions ?? null,
  };
}

export function formatMs(durationMs: number): string {
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}
