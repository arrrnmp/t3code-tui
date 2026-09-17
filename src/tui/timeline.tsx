import type { RefObject } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { SyntaxStyle, TextAttributes } from "@opentui/core";

import { useHover } from "./hooks/useHover.js";
import { markModalDismissed } from "./model/modalDismiss.js";
import { describeActivity, fileRowCounts, formatMs } from "./model/activity.js";
import { findPatchFile, type PatchFile } from "./model/patch.js";
import { formatBytes, renderMessage } from "./model/message.js";
import type { TimelineEntry } from "./model/thread.js";
import { clockTime, formatDuration, proportionalTarget, stackWorkEntries, type TurnGroup, type WorkBlock } from "./model/turns.js";
import { CODE_SYNTAX_TOKENS, COLOR, DIFF_BG, MARKER, pulseColor, SPINNER, SURFACE, truncate } from "./theme.js";

/**
 * `SyntaxStyle.create()` registers no token styles, which paints every
 * markdown construct — headings, lists, bold, links, code — in the same
 * default colour. These names are the `<markdown>` renderable's fixed
 * vocabulary (marked.js token groups for inline styles, tree-sitter capture
 * groups from `@opentui/core/assets/markdown/highlights.scm` for block-level
 * ones like headings/lists/quotes); an explicit table is required per level
 * since the renderable's group-name fallback only strips to the first
 * dot-segment (`markup.heading.3` → `markup`, not `markup.heading`).
 *
 * Fenced code blocks render through a nested `CodeRenderable` that reuses
 * this same `syntaxStyle` but highlights with language-grammar groups
 * (`keyword`, `string`, `function`, ...) instead of `markup.*` ones — merge
 * in `CODE_SYNTAX_TOKENS` (the same table `diffpanel.tsx` uses for diffs) so
 * a ```js fence gets real syntax highlighting, not plain default-colour text.
 */
const MARKDOWN_SYNTAX_TOKENS = {
  ...CODE_SYNTAX_TOKENS,
  default: { fg: COLOR.text },
  conceal: { fg: COLOR.faint },
  "markup.heading": { fg: COLOR.bright, bold: true },
  "markup.heading.1": { fg: COLOR.accent, bold: true, underline: true },
  "markup.heading.2": { fg: COLOR.accent, bold: true },
  "markup.heading.3": { fg: COLOR.bright, bold: true },
  "markup.heading.4": { fg: COLOR.text, bold: true },
  "markup.heading.5": { fg: COLOR.dim, bold: true },
  "markup.heading.6": { fg: COLOR.dim, italic: true },
  "markup.strong": { fg: COLOR.bright, bold: true },
  "markup.italic": { italic: true },
  "markup.strikethrough": { fg: COLOR.dim, dim: true },
  "markup.raw": { fg: COLOR.command },
  "markup.raw.block": { fg: COLOR.command },
  "markup.link": { fg: COLOR.dim },
  "markup.link.label": { fg: COLOR.accent, underline: true },
  "markup.link.url": { fg: COLOR.dim },
  "markup.list": { fg: COLOR.accent },
  "markup.list.checked": { fg: COLOR.added },
  "markup.list.unchecked": { fg: COLOR.dim },
  "markup.quote": { fg: COLOR.dim, italic: true },
  // Shared by markdown's own decoration marks (table pipes, `hr`) *and*
  // code's template-literal interpolation braces (`${...}`) — one group
  // name, two contexts; `dim` reads fine as de-emphasis in both rather than
  // vanishing against the panel background like `faint` did for `${}`.
  "punctuation.special": { fg: COLOR.dim },
  label: { fg: COLOR.dim },
  "keyword.directive": { fg: COLOR.warn },
  "string.escape": { fg: COLOR.dim },
} as const;

let cachedSyntaxStyle: SyntaxStyle | null = null;
function syntaxStyle(): SyntaxStyle {
  cachedSyntaxStyle ??= SyntaxStyle.fromStyles(MARKDOWN_SYNTAX_TOKENS);
  return cachedSyntaxStyle;
}

/** OpenTUI ships a `powershell` grammar (`.ps1`/`.psm1`) alongside `bash`
    (which also covers zsh/ksh/sh/git-bash) but nothing batch-specific, so a
    Windows `cmd.exe` row still gets the closest approximation rather than
    the previous plain, unhighlighted text. */
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
    return (
      <ToolChip rail={COLOR.agent} glyph="▤" title={`Read(${view.path})`} titleBold time={time} running={view.running}>
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
  t3Home,
  background,
}: {
  entry: TimelineEntry;
  t3Home: string | undefined;
  /** The card background behind this body — must match the caller's own
      background so the blank separator and image row never seam against it. */
  background: string;
}) {
  const rendered = entry.message === null ? { text: entry.text, images: [] } : renderMessage(entry.message, t3Home);

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
  color,
  background,
}: {
  label: string;
  time: string;
  /** Trailing segment after the time — the turn's total duration, for a
      finished reply's header only. */
  extra?: string | undefined;
  color: string;
  background: string;
}) {
  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
      <text fg={color} bg={background}>{label}</text>
      <text fg={COLOR.faint} bg={background}>{time.length === 0 ? "" : `  ·  ${time}`}</text>
      {extra === undefined || extra.length === 0 ? null : (
        <text fg={COLOR.faint} bg={background}>{`  ·  ${extra}`}</text>
      )}
    </box>
  );
}

function PromptBlock({
  entry,
  t3Home,
  now,
  onOpenActions,
}: {
  entry: TimelineEntry;
  t3Home: string | undefined;
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
      <SpeakerHeader label="you" time={clockTime(entry.at, now)} color={hovered ? COLOR.bright : COLOR.user} background={SURFACE.user} />
      <box style={{ height: 1, flexShrink: 0 }} backgroundColor={SURFACE.user} />
      <MessageBody entry={entry} t3Home={t3Home} background={SURFACE.user} />
    </box>
  );
}

function ReplyBlock({
  entry,
  model,
  modelColor,
  t3Home,
  duration,
  now,
  onOpenActions,
}: {
  entry: TimelineEntry;
  model: string;
  modelColor?: string | null | undefined;
  t3Home: string | undefined;
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
      <MessageBody entry={entry} t3Home={t3Home} background={SURFACE.agent} />
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
  const steps = group.work.length;
  if (steps === 0) return null;
  const started = Date.parse(group.startedAt);
  const durationMs = open && !Number.isNaN(started) ? Math.max(0, now - started) : group.durationMs;
  const { hovered, handlers } = useHover();

  return (
    <box
      style={{ flexDirection: "row", marginLeft: GUTTER, marginTop: 1, height: 1, flexShrink: 0 }}
      onMouseDown={onToggle}
      {...handlers}
    >
      <text fg={hovered ? COLOR.bright : open ? COLOR.warn : COLOR.dim} selectable={false}>
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
 * `WorkFold`/`ToolStack` rather than opening a modal, since this is a
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
          // Same reflow hazard as WorkFold/ToolStack: expanding pushes chat
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

/** Consecutive runs of one tool fold into a stack; anything else breaks it. */
function workStackKey(entry: TimelineEntry): string | null {
  if (entry.kind !== "activity" || entry.activity === null) return null;
  const view = describeActivity(entry.activity);
  switch (view.kind) {
    case "command":
      return `command:${view.tool}`;
    case "file":
      return `file:${view.verb}`;
    case "read":
      return "read";
    case "list":
      return "list";
    case "grep":
      return "grep";
    case "todos":
      return `todos:${view.title}`;
    case "task":
      return "task";
    case "question":
      return "question";
    case "skill":
      return "skill";
    case "web":
      return `web:${view.tool}`;
    case "image":
      return "image";
    case "tool":
      return `tool:${view.tool}`;
    case "note":
      return null;
  }
}

function stackSummary(entries: TimelineEntry[]): { label: string; total: string | null } {
  const last = entries[entries.length - 1];
  let label = "calls";
  if (last !== undefined && last.kind === "activity" && last.activity !== null) {
    const view = describeActivity(last.activity);
    label =
      view.kind === "command"
        ? view.tool
        : view.kind === "file"
          ? view.verb
          : view.kind === "todos"
            ? view.title
            : view.kind === "web" || view.kind === "tool"
              ? view.tool
              : view.kind;
  }
  let totalMs = 0;
  let timed = 0;
  for (const entry of entries) {
    if (entry.kind !== "activity" || entry.activity === null) continue;
    const view = describeActivity(entry.activity);
    if (view.kind === "command" && view.durationMs !== null) {
      totalMs += view.durationMs;
      timed += 1;
    }
  }
  return { label, total: timed === 0 ? null : formatDuration(totalMs) };
}

function ToolStack({
  entries,
  renderEntry,
  peekLast = true,
}: {
  entries: TimelineEntry[];
  renderEntry: (entry: TimelineEntry) => React.ReactNode;
  /**
   * Collapsed preview: `true` renders header + last row (a live stack whose
   * latest call is still in flight, or the turn's final block with nothing
   * after it); `false` renders header only (a superseded stack — a newer
   * tool of another type, or an assistant reply, has landed since).
   */
  peekLast?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { hovered, handlers } = useHover();
  const summary = stackSummary(entries);
  const visible = expanded ? entries : peekLast ? entries.slice(-1) : [];

  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <box
        style={{ flexDirection: "row", marginLeft: GUTTER, marginTop: 1, height: 1, flexShrink: 0 }}
        onMouseDown={() => {
          // Expanding/collapsing a tool stack reflows the chat pane on the
          // same click, so the mouse-up half can land on a message row that
          // just shifted under the cursor — same swallow window as a modal
          // dismiss so it doesn't open message actions unintentionally.
          markModalDismissed();
          setExpanded((current) => !current);
        }}
        {...handlers}
      >
        <text fg={hovered ? COLOR.text : COLOR.dim} selectable={false}>
          {`${expanded ? "▾" : "▸"} ${summary.label} ×${entries.length}`}
        </text>
        {summary.total === null ? null : <text fg={COLOR.faint} selectable={false}>{`  ·  ${summary.total}`}</text>}
      </box>
      {visible.map((entry) => (
        <box key={entry.id} style={{ flexDirection: "column", flexShrink: 0 }}>
          {renderEntry(entry)}
        </box>
      ))}
    </box>
  );
}

/** Whether a work entry is still in flight (its latest activity row runs). */
function entryRunning(entry: TimelineEntry): boolean {
  if (entry.kind !== "activity" || entry.activity === null) return false;
  const view = describeActivity(entry.activity);
  return "running" in view ? view.running === true : false;
}

function TurnBlock({  group,
  model,
  modelColor,
  t3Home,
  open,
  now,
  workExpanded,
  expandedTurn,
  onToggleWork,
  onOpenDiff,
  onOpenMessageActions,
  onOpenUrl,
  turnFiles,
}: {
  group: TurnGroup;
  model: string;
  modelColor?: string | null | undefined;
  t3Home: string | undefined;
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
    for (const block of stackWorkEntries(group.work, workStackKey)) {
      if (block.kind === "single") consider(block.entry);
      else for (const row of block.entries) consider(row);
    }
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
          label={`${model} · working`}
          time={clockTime(entry.at, now)}
          color={COLOR.dim}
          background={SURFACE.base}
        />
        <box style={{ height: 1, flexShrink: 0 }} backgroundColor={SURFACE.base} />
        <MessageBody entry={entry} t3Home={t3Home} background={SURFACE.base} />
      </box>
    );

  // A stale streaming fragment on a finished turn is its closing text;
  // on a live turn only finished messages close.
  const closing = group.reply ?? (!open ? group.live : null);
  const live = open ? group.live : null;

  const workBlocks = stackWorkEntries(group.work, workStackKey);
  // Stacked-collapse rule: only the turn's latest stack keeps its last row
  // visible. An earlier stack — superseded by a different tool type, or by
  // an assistant reply that closed the turn — folds to its header only.
  // The latest stack keeps its last row while it is the final word (live
  // turn, or finished with no closing reply yet); once a closing reply
  // lands, it too folds header-only.
  const renderWorkBlock = (block: WorkBlock<TimelineEntry>, key: string, peekLast: boolean) =>
    block.kind === "single" ? (
      <box key={key} style={{ flexDirection: "column", flexShrink: 0 }}>
        {renderWorkEntry(block.entry)}
      </box>
    ) : (
      <ToolStack key={key} entries={block.entries} renderEntry={renderWorkEntry} peekLast={peekLast} />
    );
  const stackPeekable = (block: WorkBlock<TimelineEntry>, index: number): boolean => {
    if (block.kind !== "stack") return true;
    if (index !== workBlocks.length - 1) return false;
    if (closing !== null) return false;
    const last = block.entries[block.entries.length - 1];
    if (last !== undefined && entryRunning(last)) return true;
    return live === null;
  };
  // Folding the "Worked for..." row is only reachable once a turn has
  // finished (it stays force-expanded while `open`), so the fold's own peek
  // is the *last* activity the turn produced — the same row that was already
  // visible right up until the user folded it, not the section going blank.
  const peekBlock = workBlocks[workBlocks.length - 1];

  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginBottom: 1 }}>
      {group.prompts.map((entry) => (
        <PromptBlock key={entry.id} entry={entry} t3Home={t3Home} now={now} onOpenActions={() => onOpenMessageActions(entry)} />
      ))}

      <WorkFold group={group} open={open} now={now} expanded={workExpanded} onToggle={() => onToggleWork(group.id)} />
      {workExpanded
        // Live and finished turns stack alike: `Bash ×20` reads as one
        // header plus its running (or latest) row, with earlier stacks
        // header-only once a newer tool type takes over. Rows render
        // strictly below the toggle, pushing the reply down.
        ? workBlocks.map((block, index) => renderWorkBlock(block, `${group.id}-w${index}`, stackPeekable(block, index)))
        : peekBlock === undefined
          ? null
          : renderWorkBlock(peekBlock, `${group.id}-peek`, stackPeekable(peekBlock, workBlocks.length - 1))}

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
              color={COLOR.dim}
              background={SURFACE.base}
            />
            <MessageBody entry={live} t3Home={t3Home} background={SURFACE.base} />
          </box>
        </box>
      )}

      {closing === null ? null : (
        <ReplyBlock
          entry={closing}
          model={model}
          modelColor={modelColor}
          t3Home={t3Home}
          duration={open ? undefined : formatDuration(group.durationMs)}
          now={now}
          onOpenActions={() => onOpenMessageActions(closing)}
        />
      )}

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
 * Live turn marker for the chat pane's bottom bar: "thinking" before the model
 * has produced anything, "working" once there is visible work, with a live
 * elapsed clock. It lives in the border bar — the same look as the pane
 * chrome — instead of occupying a transcript row, so the last line of the
 * scrollback is always real content.
 */
function runStatusLine(
  group: TurnGroup | undefined,
  now: number,
  turnStartedAt: string | null,
): { text: string; elapsedMs: number } | null {
  if (group === undefined) return null;
  // The server's own turn-start timestamp is the ground truth for the live
  // clock — grouped-entry timing is a fallback for when it isn't wired up
  // yet, not a second source that can silently drift from it.
  const anchor = turnStartedAt === null ? Date.parse(group.startedAt) : Date.parse(turnStartedAt);
  const started = Number.isNaN(anchor) ? Date.parse(group.startedAt) : anchor;
  const elapsedMs = Number.isNaN(started) ? 0 : Math.max(0, now - started);
  const frame = SPINNER[Math.floor(elapsedMs / 1000) % SPINNER.length] ?? "◐";
  const busy = group.work.length > 0 || group.reply !== null || group.live !== null;
  return { text: `${frame} ${busy ? "working" : "thinking"}… ${formatDuration(elapsedMs)}`, elapsedMs };
}

export function Timeline({
  groups,
  title,
  subtitle,
  model,
  modelColor,
  t3Home,
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
  model: string;
  modelColor?: string | null | undefined;
  t3Home: string | undefined;
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
  const live = running ? runStatusLine(groups[groups.length - 1], now, turnStartedAt) : null;

  const [atBottom, setAtBottom] = useState(true);
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
      {live === null ? null : (
        // A real overlay instead of `bottomTitle`: the border prop shares one
        // color with the top title, so it can't pulse independently.
        <box style={{ position: "absolute", bottom: -1, right: 2, height: 1, flexShrink: 0 }}>
          <text fg={pulseColor(live.elapsedMs, COLOR.dim, COLOR.accent)} bg={SURFACE.base}>
            {` ${live.text} `}
          </text>
        </box>
      )}
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
          <text fg={COLOR.accent} bg={SURFACE.raised} selectable={false}>{JUMP_TO_BOTTOM_LABEL}</text>
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
          return (
            <TurnBlock
              key={group.id}
              group={group}
              model={model}
              modelColor={modelColor}
              t3Home={t3Home}
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
            />
          );
        })}
      </scrollbox>
    </box>
  );
}
