import type { ReactNode, RefObject } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";

import { useHover } from "../../hooks/useHover.js";
import { useAnimTick } from "../../hooks/useAnimTick.js";
import { markModalDismissed } from "../../model/modalDismiss.js";
import { describeActivity, fileRowCounts, formatMs, readRangeLabel } from "../../model/activity.js";
import { findPatchFile, type PatchFile } from "../../model/patch.js";
import { formatBytes, renderMessage } from "../../model/message.js";
import { isUsageContinue, taskNotifications, untilLabel, type TaskNotificationView, type TimelineEntry } from "../../model/thread.js";
import { clockTime, formatDuration, proportionalTarget, runningThought, thoughtDuration, segmentWork, summarizeWork, type TurnGroup } from "../../model/turns.js";
import { isWaiting, workingMs } from "../../model/waits.js";
import { COLOR, DIFF_BG, MARKER, pulseColor, SPINNER_FRAMES, SURFACE, truncate, markdownSyntaxStyle } from "../../theme.js";

const syntaxStyle = markdownSyntaxStyle;

/** PowerShell rows use the vendored `powershell` grammar
    (`parsers-config.json`); everything else gets `bash`, which also covers
    zsh/ksh/sh/git-bash and is the closest approximation for `cmd.exe`. */
function commandFiletype(tool: string): string {
  return /powershell|pwsh/i.test(tool) ? "powershell" : "bash";
}

/** `https://github.com/x/y` → `github.com` — the short host a fetched-URL
    row carries in its header; the full URL stays clickable below it. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || truncate(url, 48);
  } catch {
    return truncate(url, 48);
  }
}

const MAX_COMMAND_LINES = 3;
const MAX_TODO_ROWS = 6;
/** Shared empty turn-patch list so rows without backfilled diffs share one reference. */
const EMPTY_PATCH_FILES: readonly PatchFile[] = [];
/** Work rows sit nearly full-bleed; only the message blocks carry deep padding. */
const GUTTER = 1;
/** No scroll-changed event exists on `<scrollbox>`, so "is the pane scrolled
    away from bottom" is polled at this interval instead. */
const SCROLL_POSITION_POLL_MS = 300;
const JUMP_TO_BOTTOM_LABEL = "Jump to bottom (↓)";

function clampInfo(value: string, maxLines: number): { text: string; truncated: boolean } {
  const rows = value.split("\n");
  if (rows.length <= maxLines) return { text: value, truncated: false };
  return { text: [...rows.slice(0, maxLines), `… ${rows.length - maxLines} more lines`].join("\n"), truncated: true };
}

function clamp(value: string, maxLines: number): string {
  return clampInfo(value, maxLines).text;
}

/** One flat row, no box and no background of its own: tool calls read as
    transcript lines, with the glyph rail carrying the only colour. */
function ToolChip({
  rail,
  glyph,
  title,
  titleBold = false,
  time,
  running,
  children,
  onToggle,
  expanded = false,
}: {
  rail: string;
  glyph: string;
  title: string;
  /** Claude Code weights the file-change header (`Update(path)`) bolder than
      a plain tool title — every other kind stays at the regular weight. */
  titleBold?: boolean;
  time: string;
  running: boolean;
  children: React.ReactNode;
  /** Makes the header row expand/collapse its body (long commands). The
      header brightens on hover and carries a ▸/▾ indicator while set. */
  onToggle?: () => void;
  expanded?: boolean;
}) {
  const { hovered, handlers } = useHover();
  const toggleable = onToggle !== undefined;
  return (
    <box
      style={{
        flexDirection: "column",
        marginLeft: GUTTER,
        marginTop: 1,
        flexShrink: 0,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <box
        style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
        {...(toggleable
          ? {
              onMouseDown: () => {
                // Expanding reflows the chat pane on the same click — same
                // swallow window as every other inline toggle so the
                // mouse-up half can't open message actions on a row that
                // shifted under the cursor.
                markModalDismissed();
                onToggle();
              },
              ...handlers,
            }
          : {})}
      >
        <text fg={rail} selectable={false}>{`${glyph} `}</text>
        <text
          fg={toggleable && hovered ? COLOR.bright : running ? COLOR.warn : COLOR.tool}
          attributes={titleBold ? TextAttributes.BOLD : 0}
          selectable={false}
        >
          {title}
        </text>
        <text fg={COLOR.faint} selectable={false}>{time.length === 0 ? "" : `  ·  ${time}`}</text>
        {toggleable ? (
          <text fg={COLOR.faint} selectable={false}>{expanded ? " ▾" : " ▸"}</text>
        ) : null}
      </box>
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2 }}>
        {children}
      </box>
    </box>
  );
}

function TodoRows({ items }: { items: { content: string; status: string }[] }) {
  const visible = items.slice(0, MAX_TODO_ROWS);
  return (
    <>
      {visible.map((item, index) => {
        const done = item.status === "completed";
        const active = item.status === "inProgress";
        const glyph = done ? "✓" : active ? "●" : item.status === "pending" ? "○" : "!";
        const color = done ? COLOR.added : active ? COLOR.warn : item.status === "pending" ? COLOR.dim : COLOR.danger;
        return (
          <box key={index} style={{ flexDirection: "row" }}>
            <text fg={color}>{`${glyph} `}</text>
            <text fg={done ? COLOR.dim : COLOR.text}>{truncate(item.content, 72)}</text>
          </box>
        );
      })}
      {items.length > visible.length ? (
        <text fg={COLOR.faint}>{`… ${items.length - visible.length} more`}</text>
      ) : null}
    </>
  );
}

function ActivityRow({ entry, now, turnFiles = [], onOpenUrl }: { entry: TimelineEntry; now: number; turnFiles?: readonly PatchFile[]; onOpenUrl?: ((url: string) => void) | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (entry.activity === null) return null;
  const view = describeActivity(entry.activity);
  const time = clockTime(entry.at, now);

  if (view.kind === "command") {
    const rail = view.failed ? COLOR.danger : view.running ? COLOR.warn : COLOR.command;
    const meta: string[] = [];
    if (view.exit !== null) meta.push(`exit ${view.exit}`);
    if (view.durationMs !== null) meta.push(formatMs(view.durationMs));
    if (view.workdir !== null) meta.push(view.workdir.replace(/\\/g, "/").split("/").pop() ?? view.workdir);
    if (view.running) meta.push("running");
    const command = clampInfo(view.command, MAX_COMMAND_LINES);
    return (
      <ToolChip
        rail={rail}
        glyph="$"
        title={view.tool}
        time={time}
        running={view.running}
        {...(command.truncated ? { onToggle: () => setExpanded((current) => !current), expanded } : {})}
      >
        <code
          content={expanded ? view.command : command.text}
          filetype={commandFiletype(view.tool)}
          syntaxStyle={syntaxStyle()}
          // Neutral base so the grammar's own token colors read as
          // highlighting — a green base washed every plain word green.
          fg={view.failed ? COLOR.danger : COLOR.text}
          wrapMode="word"
        />
        {meta.length === 0 ? null : <text fg={COLOR.faint}>{meta.join("  ·  ")}</text>}
        {view.outputTail === null ? null : (
          <text fg={COLOR.danger}>{clamp(view.outputTail, MAX_COMMAND_LINES)}</text>
        )}
      </ToolChip>
    );
  }

  if (view.kind === "file") {
    // Backfill the inline diff from the turn's checkpoint patch when the
    // activity carries no content of its own (stripped input). An
    // input-derived diff always wins — it is that exact call's hunks, while
    // the turn patch is the file's net effect for the whole turn (shared by
    // every same-file row when one turn edits a file twice).
    const overlay = view.diff === null ? findPatchFile(turnFiles, view.path) : null;
    const patchText = view.diff ?? overlay?.patch ?? null;
    const filetype = view.filetype ?? overlay?.filetype;
    // Counts follow the same precedence so the subtitle always describes the
    // hunks below it: exact per-edit counts, else the checkpoint nets (which
    // match checkpoint-backfilled hunks), else the overlay's own counts.
    const { added, removed } = fileRowCounts(view, entry.editStats, overlay);
    const stats = [
      added === null || added === 0 ? null : `Added ${added} line${added === 1 ? "" : "s"}`,
      removed === null || removed === 0 ? null : `removed ${removed} line${removed === 1 ? "" : "s"}`,
    ].filter((part): part is string => part !== null);
    const title = `${view.verb}(${view.path})${view.fileCount === null ? "" : `  +${view.fileCount - 1} more`}`;
    return (
      <ToolChip rail={COLOR.agent} glyph="✎" title={title} titleBold time={time} running={view.running}>
        {stats.length === 0 && !view.running ? null : (
          <text fg={COLOR.faint}>{stats.length > 0 ? `└ ${stats.join(", ")}` : "writing…"}</text>
        )}
        {patchText === null ? null : (
          <diff
            diff={patchText}
            view="unified"
            fg={COLOR.text}
            filetype={filetype ?? "text"}
            syntaxStyle={syntaxStyle()}
            showLineNumbers
            wrapMode="word"
            addedBg={DIFF_BG.added}
            removedBg={DIFF_BG.removed}
            addedContentBg={DIFF_BG.added}
            removedContentBg={DIFF_BG.removed}
            lineNumberFg={COLOR.faint}
            addedLineNumberBg={DIFF_BG.addedLineNumber}
            removedLineNumberBg={DIFF_BG.removedLineNumber}
          />
        )}
        {view.diffMore === 0 ? null : <text fg={COLOR.faint}>{`… ${view.diffMore} more lines`}</text>}
      </ToolChip>
    );
  }

  if (view.kind === "read") {
    const range = readRangeLabel(view.startLine, view.endLine);
    return (
      <ToolChip
        rail={COLOR.agent}
        glyph="▤"
        title={`Read(${view.path})${range === null ? "" : ` ${range}`}`}
        titleBold
        time={time}
        running={view.running}
      >
        {null}
      </ToolChip>
    );
  }

  if (view.kind === "list") {
    return (
      <ToolChip rail={COLOR.agent} glyph="≡" title={`List(${view.path})`} titleBold time={time} running={view.running}>
        {null}
      </ToolChip>
    );
  }

  if (view.kind === "grep") {
    return (
      <ToolChip rail={COLOR.agent} glyph="⌕" title="grep" time={time} running={view.running}>
        <text fg={COLOR.command}>{view.pattern}</text>
        {view.scope === null ? null : <text fg={COLOR.faint}>{view.scope}</text>}
      </ToolChip>
    );
  }

  if (view.kind === "todos") {
    const done = view.items.filter((item) => item.status === "completed").length;
    return (
      <ToolChip
        rail={COLOR.diff}
        glyph="☑"
        title={`${view.title} ${done}/${view.items.length}`}
        time={time}
        running={view.running}
      >
        <TodoRows items={view.items} />
      </ToolChip>
    );
  }

  if (view.kind === "task") {
    const meta = [view.taskType, view.model, view.running ? "running" : view.status]
      .filter((part): part is string => part !== null && part.length > 0)
      .join("  ·  ");
    return (
      <ToolChip rail={view.running ? COLOR.warn : COLOR.diff} glyph="◆" title="task" time={time} running={view.running}>
        <text fg={COLOR.tool}>{truncate(view.title, 72)}</text>
        {meta.length === 0 ? null : <text fg={COLOR.faint}>{meta}</text>}
      </ToolChip>
    );
  }

  if (view.kind === "question") {
    return (
      <ToolChip rail={COLOR.warn} glyph="?" title="question" time={time} running={view.running}>
        <text fg={COLOR.tool}>{truncate(view.title, 72)}</text>
        {view.detail.length === 0 ? null : (
          <text fg={COLOR.dim}>{clamp(view.detail, 2)}</text>
        )}
      </ToolChip>
    );
  }

  if (view.kind === "skill") {
    return (
      <ToolChip rail={COLOR.diff} glyph="★" title="skill" time={time} running={view.running}>
        <text fg={COLOR.tool}>{view.name}</text>
      </ToolChip>
    );
  }

  if (view.kind === "web") {
    const name = view.tool.toLowerCase();
    const url = /^https?:\/\//i.test(view.query) ? view.query : null;
    const title =
      name === "webfetch"
        ? `Fetched ${url === null ? truncate(view.query, 48) : hostOf(url)}`
        : name === "websearch" || name === "mcp-websearch"
          ? `Searched for "${truncate(view.query, 48)}"`
          : view.tool;
    return (
      <ToolChip rail={COLOR.agent} glyph="○" title={truncate(title, 72)} time={time} running={view.running}>
        {url === null || onOpenUrl === undefined ? null : (
          <text fg={COLOR.accent} attributes={TextAttributes.UNDERLINE} selectable={false} onMouseDown={() => onOpenUrl(url)}>
            {truncate(url, 72)}
          </text>
        )}
      </ToolChip>
    );
  }

  if (view.kind === "image") {
    return (
      <ToolChip rail={COLOR.diff} glyph="▣" title="image" time={time} running={false}>
        <text fg={COLOR.diff}>{view.path}</text>
      </ToolChip>
    );
  }

  if (view.kind === "reasoning") {
    const started = view.startedAt === null ? Number.NaN : Date.parse(view.startedAt);
    const elapsed = view.running
      ? Number.isNaN(started) ? null : Math.max(0, now - started)
      : view.durationMs;
    const title = view.running
      ? `Thinking…${elapsed === null || elapsed < 1000 ? "" : ` ${formatDuration(elapsed)}`}`
      : elapsed === null ? "Thought" : `Thought for ${thoughtDuration(elapsed)}`;
    const hasText = view.text.length > 0;
    return (
      <ToolChip
        rail={view.running ? COLOR.warn : COLOR.faint}
        glyph="✻"
        title={title}
        time={time}
        running={view.running}
        {...(hasText && !view.running ? { onToggle: () => setExpanded((current) => !current), expanded } : {})}
      >
        {view.running && hasText ? (
          // Streaming: the whole block in place, like the live reply — a
          // tail window re-cut on every delta and read as jitter.
          <text fg={COLOR.dim} attributes={TextAttributes.ITALIC} wrapMode="word">{view.text.trim()}</text>
        ) : expanded && hasText ? (
          <text fg={COLOR.dim} wrapMode="word">{view.text}</text>
        ) : null}
      </ToolChip>
    );
  }

  if (view.kind === "model-switch") {
    const flagged = view.from === null ? "The model" : view.from;
    const why = view.category === null ? "" : ` (${view.category})`;
    const detail =
      view.reason === "auto"
        ? `${view.from === null ? "The provider" : `${view.from} was unavailable, so the provider`} moved the thread to ${view.to} on its own.`
        : view.scope === "local"
          ? `${flagged} flagged a subagent's request${why}; that reply came from ${view.to}.`
          : `${flagged} flagged this request${why}, so it re-ran on ${view.to}. The thread stays on ${view.to}.`;
    return (
      <ToolChip rail={COLOR.warn} glyph="↻" title={`Switched to ${view.to}`} titleBold time={time} running={false}>
        <text fg={COLOR.dim}>{detail}</text>
      </ToolChip>
    );
  }

  if (view.kind === "notice") {
    // A compaction summary is long: folded until asked for. A refusal
    // reason is short: shown under the title.
    const foldable = view.notice === "compacted" && view.detail !== null;
    return (
      <ToolChip
        rail={view.notice === "permission-denied" ? COLOR.danger : COLOR.diff}
        glyph={view.notice === "compacted" ? "⇣" : view.notice === "permission-denied" ? "⊘" : "•"}
        title={view.title}
        time={time}
        running={false}
        {...(foldable ? { onToggle: () => setExpanded((current) => !current), expanded } : {})}
      >
        {view.detail === null ? null : foldable ? (
          expanded ? <text fg={COLOR.dim} wrapMode="word">{view.detail}</text> : null
        ) : (
          <text fg={COLOR.dim}>{clamp(view.detail, 2)}</text>
        )}
      </ToolChip>
    );
  }

  if (view.kind === "usage-limit") {
    // A system line, not a tool call: the provider stopped (or is wrapping
    // up) the turn. The banner over the composer carries the actions; this
    // is the record of when it happened and when it lifts.
    const resets = view.resetsAt === null ? null : new Date(view.resetsAt);
    const known = resets !== null && !Number.isNaN(resets.getTime());
    const passed = known && resets.getTime() <= now;
    const window = view.label === null ? "Plan" : view.label;
    const tone = view.wrapUp ? COLOR.warn : COLOR.danger;
    return (
      <box style={{ flexDirection: "column", marginLeft: GUTTER, marginTop: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}>
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
          <text fg={tone}>{"◔ "}</text>
          <text fg={tone} attributes={TextAttributes.BOLD}>{view.wrapUp ? "Usage limit reached, wrapping up" : "Usage limit reached"}</text>
          <text fg={COLOR.dim}>{`  ·  ${window} limit`}</text>
          {!known ? (
            <text fg={COLOR.faint}>{"  ·  resets when the provider allows"}</text>
          ) : (
            <>
              <text fg={COLOR.dim}>{passed ? "  ·  reset at " : "  ·  resets "}</text>
              <text fg={passed ? COLOR.dim : COLOR.warn}>{clockTime(view.resetsAt ?? "", now)}</text>
              {passed ? null : <text fg={COLOR.faint}>{` (${untilLabel(resets, now)})`}</text>}
            </>
          )}
          {time.length === 0 ? null : <text fg={COLOR.faint}>{`  ·  ${time}`}</text>}
        </box>
        {view.wrapUp ? (
          <text fg={COLOR.dim} wrapMode="word">{"  Finishing the current step on a small allowance from the weekly limit, instead of stopping mid-edit."}</text>
        ) : null}
      </box>
    );
  }

  if (view.kind === "tool") {
    return (
      <ToolChip rail={COLOR.tool} glyph="•" title={truncate(view.tool, 48)} time={time} running={view.running}>
        {view.detail.length === 0 ? null : (
          <text fg={COLOR.dim}>{truncate(clamp(view.detail, 2), 160)}</text>
        )}
      </ToolChip>
    );
  }

  return (
    <box style={{ flexDirection: "row", marginLeft: GUTTER + 2, height: 1, flexShrink: 0 }}>
      <text fg={view.tone === "error" ? COLOR.danger : COLOR.faint}>{"· "}</text>
      <text fg={view.tone === "error" ? COLOR.danger : COLOR.dim}>{view.text}</text>
    </box>
  );
}

function MessageBody({
  entry,
  homeDir,
  background,
}: {
  entry: TimelineEntry;
  homeDir: string | undefined;
  /** The card background behind this body — must match the caller's own
      background so the blank separator and image row never seam against it. */
  background: string;
}) {
  const rendered = entry.message === null ? { text: entry.text, images: [] } : renderMessage(entry.message, homeDir);

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      {rendered.text.length === 0 ? null : (
        <markdown
          content={rendered.text}
          fg={COLOR.text}
          syntaxStyle={syntaxStyle()}
          streaming={entry.streaming}
          // `<markdown>` defaults to non-selectable like every Renderable —
          // message bodies are exactly the content a user drags to copy.
          selectable
        />
      )}
      {rendered.images.length === 0 ? null : (
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          <box style={{ height: 1, flexShrink: 0 }} backgroundColor={background} />
          <box style={{ flexDirection: "row", flexWrap: "wrap", flexShrink: 0, columnGap: 3, rowGap: 0 }}>
            {rendered.images.map((image) => (
              <box key={image.contextId} style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                <text fg={COLOR.diff} bg={background}>
                  {`▣ ${image.label}${image.sizeBytes === null ? "" : ` (${formatBytes(image.sizeBytes)})`}`}
                </text>
              </box>
            ))}
          </box>
        </box>
      )}
    </box>
  );
}

function SpeakerHeader({
  label,
  time,
  extra,
  extraColor,
  color,
  background,
}: {
  label: string;
  time: string;
  /** Trailing segment after the time — the turn's total duration, for a
      finished reply's header only. */
  extra?: string | undefined;
  /** The trailing segment's colour; faint unless it is news (a queued message). */
  extraColor?: string | undefined;
  color: string;
  background: string;
}) {
  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
      <text fg={color} bg={background}>{label}</text>
      <text fg={COLOR.faint} bg={background}>{time.length === 0 ? "" : `  ·  ${time}`}</text>
      {extra === undefined || extra.length === 0 ? null : (
        <text fg={extraColor ?? COLOR.faint} bg={background}>{`  ·  ${extra}`}</text>
      )}
    </box>
  );
}

/**
 * "Your delegated tasks settled", written into the thread by moxen: one
 * compact block per task instead of a "you" prompt holding the raw
 * notification text the agent reads.
 */
function TaskNotificationBlock({ entry, tasks, now }: { entry: TimelineEntry; tasks: readonly TaskNotificationView[]; now: number }) {
  const header = tasks.length === 1 ? null : `${tasks.length} agents settled`;
  return (
    <box
      border={["left"]}
      borderStyle="heavy"
      borderColor={COLOR.diff}
      style={{ flexDirection: "column", flexGrow: 1, marginTop: 1, flexShrink: 0, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}
      backgroundColor={SURFACE.panel}
    >
      {header === null ? null : (
        <SpeakerHeader label={header} time={clockTime(entry.at, now)} color={COLOR.diff} background={SURFACE.panel} />
      )}
      {tasks.map((task, index) => {
        const glyph = task.status === "completed" ? "✓" : task.status === "failed" ? "✗" : task.status === "interrupted" ? "■" : "●";
        const glyphColor = task.status === "completed" ? COLOR.added : task.status === "failed" ? COLOR.danger : COLOR.warn;
        const verb = task.status === "completed" ? "finished" : task.status === "failed" ? "failed" : task.status === "interrupted" ? "was stopped" : "is running";
        const facts = [
          task.durationMs === null ? null : formatDuration(Math.max(1000, task.durationMs)),
          task.model,
          header === null ? clockTime(entry.at, now) : null,
        ].filter((fact): fact is string => fact !== null);
        const footer = [
          task.filesChanged === null || task.filesChanged === 0 ? null : `+${task.additions ?? 0} −${task.deletions ?? 0} · ${task.filesChanged} file${task.filesChanged === 1 ? "" : "s"}`,
          task.branch === null ? null : `branch ${task.branch}`,
        ].filter((fact): fact is string => fact !== null);
        return (
          <box key={task.taskId} style={{ flexDirection: "column", flexShrink: 0, marginTop: index === 0 && header === null ? 0 : 1 }} backgroundColor={SURFACE.panel}>
            <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
              <text fg={glyphColor} bg={SURFACE.panel}>{`${glyph} `}</text>
              <text fg={COLOR.bright} bg={SURFACE.panel} attributes={TextAttributes.BOLD}>{`Agent "${truncate(task.title, 60)}" ${verb}`}</text>
              <text fg={COLOR.faint} bg={SURFACE.panel}>{facts.length === 0 ? "" : `  ·  ${facts.join("  ·  ")}`}</text>
            </box>
            {task.headline === null ? null : (
              <text fg={COLOR.text} bg={SURFACE.panel} wrapMode="word">{`  ${task.headline}`}</text>
            )}
            {footer.length === 0 ? null : <text fg={COLOR.dim} bg={SURFACE.panel}>{`  ${footer.join("  ·  ")}`}</text>}
          </box>
        );
      })}
    </box>
  );
}

/**
 * The continue moxen sent after a usage limit reset: one quiet line where a
 * "you" prompt would be — the agent reads the full instruction, the user
 * only needs to know why the thread picked up again.
 */
function ContinueNotice({ entry, now }: { entry: TimelineEntry; now: number }) {
  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1, paddingLeft: 1 }}>
      <text fg={COLOR.warn}>{"↻ "}</text>
      <text fg={COLOR.dim}>{"Continued after the usage limit reset"}</text>
      <text fg={COLOR.faint}>{`  ·  ${clockTime(entry.at, now)}`}</text>
    </box>
  );
}

function PromptBlock({
  entry,
  homeDir,
  now,
  onOpenActions,
}: {
  entry: TimelineEntry;
  homeDir: string | undefined;
  now: number;
  /** Opens the message-actions modal — on mouse *up* (not down), so a
      text-selection drag ending on the prompt doesn't trigger it; the app
      additionally ignores the gesture when a live selection exists. */
  onOpenActions: () => void;
}) {
  // Hover brightens the border + speaker label (never the background, so the
  // card keeps its tint and the interior never seams) to signal the card is
  // clickable. Same treatment on ReplyBlock.
  const { hovered, handlers } = useHover();
  return (
    <box
      border={["left"]}
      borderStyle="heavy"
      borderColor={hovered ? COLOR.bright : COLOR.user}
      style={{
        flexDirection: "column",
        flexGrow: 1,
        marginTop: 1,
        // No marginBottom: the next element's own marginTop (or the turn
        // wrapper's, if this is the last thing in it) provides the gap —
        // stacking both here and there doubled it.
        flexShrink: 0,
        // Matches the composer's own left/right padding (2/2) so message
        // text doesn't sit closer to its border than the draft does.
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
      }}
      backgroundColor={SURFACE.user}
      onMouseUp={onOpenActions}
      {...handlers}
    >
      <SpeakerHeader
        label="you"
        time={clockTime(entry.at, now)}
        color={hovered ? COLOR.bright : COLOR.user}
        background={SURFACE.user}
      />
      <box style={{ height: 1, flexShrink: 0 }} backgroundColor={SURFACE.user} />
      <MessageBody entry={entry} homeDir={homeDir} background={SURFACE.user} />
    </box>
  );
}

function ReplyBlock({
  entry,
  model,
  modelColor,
  homeDir,
  duration,
  now,
  onOpenActions,
}: {
  entry: TimelineEntry;
  model: string;
  modelColor?: string | null | undefined;
  homeDir: string | undefined;
  /** Total elapsed time for the turn this reply closes; omitted while the
      turn is still the live one. */
  duration?: string | undefined;
  now: number;
  /**
   * Clicks the closing reply open the same actions modal as prompts (copy
   * plus revert resolve through the entry's turn). Omitted for superseded
   * intermediate replies, which stay display-only. Same mouse-up +
   * live-selection semantics as PromptBlock.
   */
  onOpenActions?: () => void;
}) {
  const { hovered, handlers } = useHover();
  return (
    <box
      border={["left"]}
      borderStyle="heavy"
      borderColor={onOpenActions === undefined ? COLOR.agent : hovered ? COLOR.bright : COLOR.agent}
      style={{
        flexDirection: "column",
        flexGrow: 1,
        marginTop: 1,
        // No marginBottom — see the same note on PromptBlock.
        flexShrink: 0,
        // Matches the composer's own left/right padding (2/2) so message
        // text doesn't sit closer to its border than the draft does.
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
      }}
      backgroundColor={SURFACE.agent}
      {...(onOpenActions === undefined ? {} : { onMouseUp: onOpenActions, ...handlers })}
    >
      <SpeakerHeader
        label={model}
        time={clockTime(entry.at, now)}
        extra={duration}
        color={hovered ? COLOR.bright : (modelColor ?? COLOR.agent)}
        background={SURFACE.agent}
      />
      <box style={{ height: 1, flexShrink: 0 }} backgroundColor={SURFACE.agent} />
      <MessageBody entry={entry} homeDir={homeDir} background={SURFACE.agent} />
    </box>
  );
}

function WorkFold({
  group,
  open,
  now,
  expanded,
  onToggle,
}: {
  group: TurnGroup;
  /** The turn is still in flight: present tense, live elapsed clock. */
  open: boolean;
  now: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Live fold throbs warn→bright on its own 500ms clock; finished folds
  // stay static so only the in-flight turn moves. Hooks stay above the
  // empty-steps return so order never shifts when work lands.
  const { hovered, handlers } = useHover();
  const pulseTick = useAnimTick(open, 500);
  const steps = group.work.length;
  if (steps === 0) return null;
  const started = Date.parse(group.startedAt);
  // The open fold's clock stops while the turn waits on the user, the same
  // way the settled "Worked for" leaves those waits out.
  const durationMs = open && !Number.isNaN(started) ? workingMs(group.waits, started, now) : group.durationMs;
  const foldFg = open ? pulseColor(pulseTick, COLOR.warn, COLOR.bright, 1800) : hovered ? COLOR.bright : COLOR.dim;

  return (
    <box
      style={{ flexDirection: "row", marginLeft: GUTTER, marginTop: 1, height: 1, flexShrink: 0 }}
      onMouseDown={onToggle}
      {...handlers}
    >
      <text fg={foldFg} selectable={false}>
        {`${expanded ? "▾" : "▸"} ${open ? "Working" : "Worked"} for ${formatDuration(durationMs)}`}
      </text>
      <text fg={COLOR.faint} selectable={false}>
        {`  ·  ${steps} step${steps === 1 ? "" : "s"}  ·  ${clockTime(group.startedAt, now)}`}
      </text>
    </box>
  );
}

/**
 * A plan proposed while the thread ran in plan-approval mode — no separate
 * assistant reply exists for that turn, so this stands in for one. Collapsed
 * by default since a plan's markdown body can run long; expands inline like
 * `WorkFold`/`WorkSummary` rather than opening a modal, since this is a
 * read-only view (approval happens outside the thread's own transcript).
 */
function PlanCard({ entry, now }: { entry: TimelineEntry; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const plan = entry.proposedPlan;
  const { hovered, handlers } = useHover();
  if (plan === null) return null;
  const implemented = plan.implementedAt !== null;

  return (
    <box style={{ flexDirection: "column", marginLeft: GUTTER, marginTop: 1, flexShrink: 0 }}>
      <box
        style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
        onMouseDown={() => {
          // Same reflow hazard as WorkFold/WorkSummary: expanding pushes chat
          // content down on the same click, so the mouse-up half can land on
          // a message row that just shifted under the cursor.
          markModalDismissed();
          setExpanded((current) => !current);
        }}
        {...handlers}
      >
        <text fg={hovered ? COLOR.bright : COLOR.diff} selectable={false}>{`${expanded ? "▾" : "▸"} ◈ `}</text>
        <text fg={implemented ? COLOR.dim : COLOR.diff} selectable={false}>
          {implemented ? "Plan implemented" : "Plan proposed"}
        </text>
        <text fg={COLOR.faint} selectable={false}>{`  ·  ${clockTime(entry.at, now)}`}</text>
      </box>
      {expanded ? (
        <box
          border={["left"]}
          borderStyle="heavy"
          borderColor={COLOR.diff}
          style={{
            flexDirection: "column",
            flexGrow: 1,
            marginTop: 1,
            flexShrink: 0,
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 1,
            paddingBottom: 1,
          }}
          backgroundColor={SURFACE.panel}
        >
          <markdown content={plan.planMarkdown} fg={COLOR.text} syntaxStyle={syntaxStyle()} selectable />
        </box>
      ) : null}
    </box>
  );
}

function TurnDiffRow({
  entry,
  expanded,
  onOpen,
}: {
  entry: TimelineEntry;
  expanded: boolean;
  onOpen: (turnCount: number) => void;
}) {
  const { hovered, handlers } = useHover();
  const checkpoint = entry.checkpoint;
  if (checkpoint === null) return null;
  const added = checkpoint.files.reduce((total, file) => total + file.additions, 0);
  const removed = checkpoint.files.reduce((total, file) => total + file.deletions, 0);

  return (
    <box
      style={{ flexDirection: "row", marginTop: 1, marginLeft: GUTTER, height: 1, flexShrink: 0 }}
      onMouseDown={() => onOpen(checkpoint.checkpointTurnCount)}
      {...handlers}
    >
      <text fg={hovered ? COLOR.bright : COLOR.diff} selectable={false}>{`${expanded ? "▾" : "▸"} diff `}</text>
      <text fg={COLOR.dim} selectable={false}>{`${checkpoint.files.length} file${checkpoint.files.length === 1 ? "" : "s"} `}</text>
      <text fg={COLOR.added} selectable={false}>{`+${added}`}</text>
      <text fg={COLOR.removed} selectable={false}>{` -${removed}`}</text>
    </box>
  );
}

/**
 * One message-closed tool segment inside an expanded Worked fold: the
 * aggregate summary ("Ran 2 commands, read 1 file") with the segment's own
 * expand toggle — the flat tools appear between the summary and the message
 * that closed them. Same reflow hazard as WorkFold, same mouse-up swallow.
 */
function WorkSegment({
  summary,
  width,
  tools,
  message,
}: {
  summary: string | null;
  width: number;
  /** Flat tool rows, shown when the segment has no summary or is expanded. */
  tools: ReactNode;
  /** The assistant message closing the segment (always visible, never folded). */
  message: ReactNode | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { hovered, handlers } = useHover();
  if (summary === null) {
    return (
      <>
        {tools}
        {message}
      </>
    );
  }
  return (
    <>
      <box
        style={{ flexDirection: "row", marginLeft: GUTTER, marginTop: 1, height: 1, flexShrink: 0 }}
        onMouseDown={() => {
          markModalDismissed();
          setExpanded((current) => !current);
        }}
        {...handlers}
      >
        <text fg={hovered ? COLOR.bright : COLOR.dim} selectable={false}>
          {`${expanded ? "▾" : "▸"} ${truncate(summary, Math.max(20, width - 8))}`}
        </text>
      </box>
      {expanded ? tools : null}
      {message}
    </>
  );
}

function TurnBlock({  group,
  model,
  modelColor,
  homeDir,
  open,
  now,
  workExpanded,
  expandedTurn,
  onToggleWork,
  onOpenDiff,
  onOpenMessageActions,
  onOpenUrl,
  turnFiles,
  width,
}: {
  group: TurnGroup;
  model: string;
  modelColor?: string | null | undefined;
  homeDir: string | undefined;
  /** The turn is still in flight on the server — the finished-signal gate. */
  open: boolean;
  now: number;
  workExpanded: boolean;
  expandedTurn: number | null;
  onToggleWork: (id: string) => void;
  onOpenDiff: (turnCount: number) => void;
  onOpenMessageActions: (entry: TimelineEntry) => void;
  /** Opens a fetched URL in the browser (web rows render it clickable). */
  onOpenUrl: (url: string) => void;
  /** Chat pane width, for truncating the folded work-summary row. */
  width: number;
  /** This turn's checkpoint patch files (empty until backfilled) — rows
      without their own diff render the matching file's hunks from here. */
  turnFiles: readonly PatchFile[];
}) {
  // A superseded (not-final) assistant reply gets the same card treatment as
  // the closing reply — border, padding, blank separator line — just dimmer,
  // so "past" answers read as a finished thought instead of a smushed aside.
  // Turn-diff hunks attach to the FIRST row per file only: the patch is the
  // file's net effect for the whole turn, so repeating it under every same-
  // file edit would wallpaper the transcript with identical hunks (one turn
  // routinely edits a file a dozen times). Later rows keep their stats.
  const overlayRowIds = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<string>();
    const consider = (entry: TimelineEntry) => {
      if (entry.kind !== "activity" || entry.activity === null) return;
      let path: string | null = null;
      try {
        const view = describeActivity(entry.activity);
        if (view.kind !== "file" || view.diff !== null) return;
        path = view.path.toLowerCase();
      } catch {
        return;
      }
      if (seen.has(path)) return;
      seen.add(path);
      first.add(entry.id);
    };
    for (const entry of group.work) consider(entry);
    return first;
  }, [group]);
  const renderWorkEntry = (entry: TimelineEntry) =>
    entry.kind === "activity" ? (
      <ActivityRow entry={entry} now={now} turnFiles={overlayRowIds.has(entry.id) ? turnFiles : EMPTY_PATCH_FILES} onOpenUrl={onOpenUrl} />
    ) : (
      <box
        border={["left"]}
        borderStyle="heavy"
        borderColor={COLOR.faint}
        style={{
          flexDirection: "column",
          flexGrow: 1,
          marginLeft: GUTTER,
          marginTop: 1,
          // No marginBottom — see the note on PromptBlock/ReplyBlock.
          flexShrink: 0,
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
        }}
        backgroundColor={SURFACE.base}
      >
        <SpeakerHeader
          // Intermediate messages read present-tense only while the turn is
          // still live — on a finished turn they are plain past messages.
          // Either way they keep the model's own color: dimming them grey
          // made the last answer read as inactive the moment tools followed.
          label={open ? `${model} · working` : model}
          time={clockTime(entry.at, now)}
          color={modelColor ?? COLOR.agent}
          background={SURFACE.base}
        />
        <box style={{ height: 1, flexShrink: 0 }} backgroundColor={SURFACE.base} />
        <MessageBody entry={entry} homeDir={homeDir} background={SURFACE.base} />
      </box>
    );

  // A stale streaming fragment on a finished turn is its closing text. A
  // live turn has no closing reply yet: its latest message stays in line
  // with the work, where it was written, rather than pinned below it.
  const closing = open ? null : (group.reply ?? group.live);
  const live = open ? group.live : null;
  // A thought still running renders last; finished, it takes its place in line.
  const thought = open ? runningThought(group) : null;
  const inLine = open && group.reply !== null ? [...group.work, group.reply].sort((left, right) => left.at.localeCompare(right.at)) : group.work;
  const work = thought === null ? inLine : inLine.filter((entry) => entry !== thought);

  // Fold rule: the Worked fold always hides the work when collapsed. Once
  // expanded, tools stay flat only until an assistant message lands after
  // them — every message (intermediate or closing) bounds the tools before
  // it into its own expandable summary segment, and only the still-open
  // trailing tools render flat. The live turn can't fold anyway (it stays
  // force-expanded). While open, the closing reply is stale by definition
  // (newer tools already landed after it), so it must not bound the
  // trailing tools — the newest calls stay visible until the turn ends.
  const segments = workExpanded ? segmentWork(work, open ? null : closing) : [];

  const renderToolRow = (entry: TimelineEntry) => (
    <box key={entry.id} style={{ flexDirection: "column", flexShrink: 0 }}>
      {renderWorkEntry(entry)}
    </box>
  );

  return (
    // No marginBottom: every block inside a turn (and the next turn's prompt)
    // carries its own marginTop, and the scrollbox pads the last turn — a
    // wrapper margin here stacked with the next prompt's into a double gap.
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      {group.prompts.map((entry) => {
        if (isUsageContinue(entry.message)) return <ContinueNotice key={entry.id} entry={entry} now={now} />;
        const tasks = taskNotifications(entry.message);
        return tasks === null ? (
          <PromptBlock key={entry.id} entry={entry} homeDir={homeDir} now={now} onOpenActions={() => onOpenMessageActions(entry)} />
        ) : (
          <TaskNotificationBlock key={entry.id} entry={entry} tasks={tasks} now={now} />
        );
      })}

      <WorkFold group={group} open={open} now={now} expanded={workExpanded} onToggle={() => onToggleWork(group.id)} />
      {segments.map((segment, index) => {
        const closingBoundary =
          segment.message !== null && closing !== null && segment.message.id === closing.id;
        // Only a message-closed segment folds into a summary — the still-open
        // trailing tools always render flat until a message lands after them.
        const segmentSummary = segment.message === null ? null : summarizeWork(segment.tools);
        return (
          <WorkSegment
            key={`${group.id}-seg${index}`}
            summary={segmentSummary}
            width={width}
            tools={segment.tools.map((entry) => renderToolRow(entry))}
            message={
              segment.message === null || closingBoundary ? null : (
                <box key={segment.message.id} style={{ flexDirection: "column", flexShrink: 0 }}>
                  {renderWorkEntry(segment.message)}
                </box>
              )
            }
          />
        );
      })}

      {group.proposedPlan === null ? null : <PlanCard entry={group.proposedPlan} now={now} />}

      {live === null ? null : (
        <box
          style={{
            flexDirection: "row",
            marginLeft: GUTTER,
            marginTop: 1,
            flexShrink: 0,
            paddingRight: 2,
          }}
          backgroundColor={SURFACE.base}
        >
          <text fg={COLOR.faint} bg={SURFACE.base}>{`${MARKER} `}</text>
          <box style={{ flexDirection: "column", flexGrow: 1 }}>
            <SpeakerHeader
              label={`${model} · writing`}
              time={clockTime(live.at, now)}
              color={modelColor ?? COLOR.agent}
              background={SURFACE.base}
            />
            <MessageBody entry={live} homeDir={homeDir} background={SURFACE.base} />
            {open ? <LiveCaret /> : null}
          </box>
        </box>
      )}

      {closing === null ? null : (
        <ReplyBlock
          entry={closing}
          model={model}
          modelColor={modelColor}
          homeDir={homeDir}
          duration={open ? undefined : formatDuration(group.durationMs)}
          now={now}
          onOpenActions={() => onOpenMessageActions(closing)}
        />
      )}

      {thought === null ? null : renderToolRow(thought)}

      {group.diff === null ? null : (
        <TurnDiffRow
          entry={group.diff}
          expanded={group.diff.checkpoint?.checkpointTurnCount === expandedTurn}
          onOpen={onOpenDiff}
        />
      )}
    </box>
  );
}

/**
 * Live turn state for the chat pane's bottom bar: "thinking" before the model
 * has produced anything or while a thought runs, "working" otherwise, with a live
 * elapsed clock. It lives in the border bar — the same look as the pane
 * chrome — instead of occupying a transcript row, so the last line of the
 * scrollback is always real content.
 */
function runStatus(
  group: TurnGroup | undefined,
  now: number,
  turnStartedAt: string | null,
): { busy: boolean; thinking: boolean; waiting: boolean; elapsedMs: number } | null {
  if (group === undefined) return null;
  // The server's own turn-start timestamp is the ground truth for the live
  // clock — grouped-entry timing is a fallback for when it isn't wired up
  // yet, not a second source that can silently drift from it.
  const anchor = turnStartedAt === null ? Date.parse(group.startedAt) : Date.parse(turnStartedAt);
  const started = Number.isNaN(anchor) ? Date.parse(group.startedAt) : anchor;
  // Paused while the turn waits on the user: an open question or permission
  // prompt is the user's move, not work the agent is doing.
  const elapsedMs = Number.isNaN(started) ? 0 : workingMs(group.waits, started, now);
  const busy = group.work.length > 0 || group.reply !== null || group.live !== null;
  // A thought running now says "thinking" again, whatever came before it.
  return { busy, thinking: runningThought(group) !== null, waiting: isWaiting(group.waits), elapsedMs };
}

/**
 * Bottom-bar live badge with its own 100ms clock: braille spinner + dim→accent
 * throb. The elapsed text still advances on the 1s `now` tick — only the
 * frame and glow need the fast clock. Mounted only while a turn runs.
 */
function LiveBadge({
  busy,
  thinking,
  waiting,
  elapsedMs,
}: {
  busy: boolean;
  thinking: boolean;
  waiting: boolean;
  elapsedMs: number;
}) {
  // Waiting on the user: no spinner and no throb — nothing is running, and
  // a pulsing badge would say otherwise. The clock stays put until answered.
  const tick = useAnimTick(!waiting, 100);
  const frame = SPINNER_FRAMES[Math.floor(tick / 100) % SPINNER_FRAMES.length] ?? "⠋";
  return (
    // A real overlay instead of `bottomTitle`: the border prop shares one
    // color with the top title, so it can't pulse independently.
    <box style={{ position: "absolute", bottom: -1, right: 2, height: 1, flexShrink: 0 }}>
      <text fg={waiting ? COLOR.warn : pulseColor(tick, COLOR.dim, COLOR.accent, 2400)} bg={SURFACE.base}>
        {waiting
          ? ` ◆ waiting for you · ${formatDuration(elapsedMs)} `
          : ` ${frame} ${busy && !thinking ? "working" : "thinking"}… ${formatDuration(elapsedMs)} `}
      </text>
    </box>
  );
}

/** Blinking block caret ending the live streaming reply. Mounted only on the live turn. */
function LiveCaret() {
  const tick = useAnimTick(true, 530);
  const visible = Math.floor(tick / 530) % 2 === 0;
  return (
    <text fg={COLOR.accent} bg={SURFACE.base}>
      {visible ? "▊" : " "}
    </text>
  );
}


export function Timeline({
  groups,
  title,
  subtitle,
  modelForTurn,
  homeDir,
  expandedTurn,
  expandedWork,
  scrollRef,
  onFocus,
  onOpenDiff,
  onToggleWork,
  onOpenMessageActions,
  onOpenUrl,
  focused,
  width,
  sessionStatus,
  now,
  turnStartedAt,
  turnFileDiffs,
  gitFiles,
}: {
  groups: TurnGroup[];
  title: string;
  subtitle: string;
  /** The model that ran a given turn — each turn keeps its own, so a
      mid-thread model switch never relabels earlier replies. */
  modelForTurn: (turnId: string | null) => { name: string; color: string | null };
  homeDir: string | undefined;
  expandedTurn: number | null;
  expandedWork: ReadonlySet<string>;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onFocus: () => void;
  onOpenDiff: (turnCount: number) => void;
  onToggleWork: (id: string) => void;
  onOpenMessageActions: (entry: TimelineEntry) => void;
  /** Opens a fetched URL in the browser (web rows render it clickable). */
  onOpenUrl: (url: string) => void;
  focused: boolean;
  width: number;
  sessionStatus: string;
  now: number;
  /** The server's own anchor for the running turn (`latestTurn.startedAt` /
      `requestedAt`) — keeps the live clock from resetting on a mid-turn nudge
      even if local grouping ever falls behind. */
  turnStartedAt: string | null;
  /** Backfilled checkpoint patches by checkpoint turn count (empty until the
      app fetches them) — rows without their own diff render from here. */
  turnFileDiffs: ReadonlyMap<number, PatchFile[]>;
  /** Live working-tree hunks for the running turn's bare rows. Only ever
      consulted when no checkpoint patch exists — historical turns must not
      render current-tree content. */
  gitFiles: readonly PatchFile[];
}) {
  const lastId = groups[groups.length - 1]?.id;
  const running = sessionStatus === "running" || sessionStatus === "starting";
  const live = running ? runStatus(groups[groups.length - 1], now, turnStartedAt) : null;

  const [atBottom, setAtBottom] = useState(true);
  // Jump pill breathes accent→bright only while visible (off-screen = zero cost).
  const pillTick = useAnimTick(!atBottom, 800);
  useEffect(() => {
    const timer = setInterval(() => {
      const pane = scrollRef.current;
      if (pane === null) return;
      const bottom = pane.scrollTop + pane.viewport.height >= pane.scrollHeight - 1;
      setAtBottom((current) => (current === bottom ? current : bottom));
    }, SCROLL_POSITION_POLL_MS);
    return () => clearInterval(timer);
  }, [scrollRef]);
  const jumpToBottomWidth = JUMP_TO_BOTTOM_LABEL.length + 4;
  const jumpToBottomLeft = Math.max(0, Math.floor((width - jumpToBottomWidth) / 2));
  const scrollToBottom = () => {
    const pane = scrollRef.current;
    if (pane === null) return;
    pane.scrollTo(pane.scrollHeight);
  };

  return (
    <box
      style={{ flexDirection: "column", flexGrow: 1, borderStyle: "rounded", backgroundColor: SURFACE.base }}
      borderColor={focused ? SURFACE.borderFocus : SURFACE.border}
      title={` ${truncate(title, Math.max(10, width - 24))} `}
      titleColor={focused ? COLOR.bright : COLOR.dim}
      bottomTitle={live === null ? ` ${subtitle} ` : ""}
      bottomTitleAlignment="right"
      onMouseDown={onFocus}
    >
      {live === null ? null : <LiveBadge busy={live.busy} thinking={live.thinking} waiting={live.waiting} elapsedMs={live.elapsedMs} />}
      {atBottom ? null : (
        // Single-row square pill with 2-col padding per side — no rounded
        // border, so it reads as a flat chip rather than a modal.
        <box
          style={{
            position: "absolute",
            bottom: 1,
            left: jumpToBottomLeft,
            width: jumpToBottomWidth,
            height: 1,
            flexDirection: "row",
            justifyContent: "center",
            paddingLeft: 2,
            paddingRight: 2,
            zIndex: 15,
          }}
          backgroundColor={SURFACE.raised}
          onMouseDown={scrollToBottom}
          selectable={false}
        >
          <text fg={pulseColor(pillTick, COLOR.accent, COLOR.bright, 1600)} bg={SURFACE.raised} selectable={false}>{JUMP_TO_BOTTOM_LABEL}</text>
        </box>
      )}
      <scrollbox
        ref={scrollRef}
        style={{ flexGrow: 1 }}
        contentOptions={{ paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}
        stickyScroll
        stickyStart="bottom"
        verticalScrollbarOptions={{
          showArrows: false,
          // Always accent: a dim 1-glyph thumb against a long transcript is
          // effectively invisible, focused or not — the pane border already
          // carries the focus signal.
          trackOptions: { foregroundColor: COLOR.accent, backgroundColor: SURFACE.border },
        }}
      >
        {groups.map((group, index) => {
          // The finished signal: only the last group of a running session is
          // live. Everything else folds, stacks, and past-tenses.
          const open = running && group.id === lastId;
          const diffTurnCount = group.diff?.checkpoint?.checkpointTurnCount;
          // Checkpoint hunks win wherever present (loaded-empty included):
          // the working tree may already hold later turns' edits.
          const checkpointFiles = diffTurnCount === undefined ? undefined : turnFileDiffs.get(diffTurnCount);
          const turnModel = modelForTurn(group.turnId);
          return (
            <TurnBlock
              key={group.id}
              group={group}
              model={turnModel.name}
              modelColor={turnModel.color}
              homeDir={homeDir}
              open={open}
              now={now}
              // The turn in flight stays open so live tool calls remain visible.
              workExpanded={expandedWork.has(group.id) || open}
              expandedTurn={expandedTurn}
              turnFiles={checkpointFiles ?? (open ? gitFiles : EMPTY_PATCH_FILES)}
              onToggleWork={(id) => {
                const willExpand = !expandedWork.has(id);
                onToggleWork(id);
                if (!willExpand) return;
                // Expanding appends rows *below* the Worked toggle, pushing
                // the reply down — pin the turn toward the top so the newly
                // revealed tool calls appear below it (scroll down to see
                // them, never up). Deferred a frame so the rows have mounted
                // and `scrollHeight` already includes them.
                setTimeout(() => {
                  const pane = scrollRef.current;
                  if (pane === null) return;
                  pane.scrollTo(proportionalTarget(index, groups.length, pane.scrollHeight, pane.viewport.height));
                }, 30);
              }}
              onOpenDiff={onOpenDiff}
              onOpenMessageActions={onOpenMessageActions}
              onOpenUrl={onOpenUrl}
              width={width}
            />
          );
        })}
      </scrollbox>
    </box>
  );
}
