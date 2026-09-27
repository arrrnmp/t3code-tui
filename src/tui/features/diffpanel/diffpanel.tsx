import type { RefObject } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";

import { useHover } from "../../hooks/useHover.js";
import { useAnimTick } from "../../hooks/useAnimTick.js";
import type { PatchFile } from "../../model/patch.js";
import { shortPath } from "../../model/patch.js";
import { COLOR, DIFF_BG, MARKER, SPINNER_FRAMES, SURFACE, markdownSyntaxStyle } from "../../theme.js";

/** Loading skeleton: braille spinner + a shimmer bar sweeping a dim track. Mounted only while fetching. */
function DiffLoading({ width }: { width: number }) {
  const tick = useAnimTick(true, 150);
  const frame = SPINNER_FRAMES[Math.floor(tick / 150) % SPINNER_FRAMES.length] ?? "⠋";
  const barWidth = Math.max(8, Math.min(24, width - 4));
  const pos = Math.floor(tick / 150) % barWidth;
  const bar = `${"░".repeat(pos)}▓${"░".repeat(Math.max(0, barWidth - pos - 1))}`;
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text fg={COLOR.dim}>{` ${frame} loading patch…`}</text>
      <text fg={COLOR.faint}>{` ${bar}`}</text>
    </box>
  );
}

// The shared markdown+code style (theme.ts): `<diff>` highlights each hunk
// with the file's own grammar, so a markdown file yields `markup.*`
// captures. The old code-only table had no `markup.*` entries and every
// token fell back to the default — white text on the red/green rows.
const syntaxStyle = markdownSyntaxStyle;

/** One file of a patch: a foldable header with its counts over the highlighted hunks. The Git tab's commit view reuses it. */
export function FileSection({
  file,
  width,
  selected,
  collapsed,
  onToggle,
}: {
  file: PatchFile;
  width: number;
  selected: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const counts = `+${file.additions} -${file.deletions}`;
  const label = `${collapsed ? "▸" : "▾"} ${shortPath(file.path, width - counts.length - 4)}`;
  const { hovered, handlers } = useHover();

  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginBottom: 1 }}>
      {/* Rows collapse to zero height beside a flexGrow sibling without this. */}
      <box
        style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
        backgroundColor={hovered ? SURFACE.border : SURFACE.raised}
        onMouseDown={onToggle}
        selectable={false}
        {...handlers}
      >
        <text fg={selected ? COLOR.accent : COLOR.faint} selectable={false}>{selected ? MARKER : " "}</text>
        <text fg={selected ? COLOR.bright : COLOR.text} selectable={false}>
          {`${label.padEnd(Math.max(0, width - counts.length - 2))}`}
        </text>
        <text fg={COLOR.added} selectable={false}>{`+${file.additions}`}</text>
        <text fg={COLOR.removed} selectable={false}>{` -${file.deletions}`}</text>
      </box>
      {collapsed ? null : file.binary ? (
        <text fg={COLOR.dim}>{"   binary file"}</text>
      ) : (
        <diff
          diff={file.patch}
          view="unified"
          fg={COLOR.text}
          filetype={file.filetype ?? "text"}
          syntaxStyle={syntaxStyle()}
          showLineNumbers
          wrapMode="word"
          // `<diff>` defaults to non-selectable like every other Renderable —
          // this is the one exception, since diff content is exactly what a
          // user drags across to copy.
          selectable

          addedBg={DIFF_BG.added}
          removedBg={DIFF_BG.removed}
          addedContentBg={DIFF_BG.added}
          removedContentBg={DIFF_BG.removed}
          lineNumberFg={COLOR.faint}
          addedLineNumberBg={DIFF_BG.addedLineNumber}
          removedLineNumberBg={DIFF_BG.removedLineNumber}
        />
      )}
    </box>
  );
}

export function DiffPanel({
  files,
  loading,
  fileIndex,
  collapsed,
  width,
  turnCount,
  turnTotal,
  height,
  focused,
  scrollRef,
  onToggleFile,
  onFocus,
  onHeaderClick,
}: {
  files: readonly PatchFile[];
  loading: boolean;
  fileIndex: number;
  collapsed: ReadonlySet<string>;
  width: number;
  turnCount: number | null;
  /** How many turns have diffs — the header's right-hand meta. */
  turnTotal: number;
  /**
   * Terminal height (app only): pins the frame viewport-tall so long diffs
   * scroll internally and the `+N −M` footer stays on-screen — same trap as
   * SidePanelFrame (flexGrow alone sizes to content).
   */
  height?: number;
  focused: boolean;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onToggleFile: (index: number) => void;
  onFocus: () => void;
  /** Opens the diff-turn picker modal. */
  onHeaderClick: () => void;
}) {
  const inner = width - 2;
  const added = files.reduce((total, file) => total + file.additions, 0);
  const removed = files.reduce((total, file) => total + file.deletions, 0);
  const { hovered: headerHovered, handlers: headerHandlers } = useHover();

  return (
    <box
      style={{ width, ...(height === undefined ? {} : { height }), flexDirection: "column", borderStyle: "rounded", backgroundColor: SURFACE.panel }}
      borderColor={focused ? SURFACE.borderFocus : SURFACE.border}
      onMouseDown={onFocus}
    >
      {/* The border `title` prop is decorative with no click support, so the
          header is a real row instead: same copy as the old title, plus a
          ▾ affordance and a hover brighten to read as clickable. */}
      <box
        style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}
        backgroundColor={headerHovered ? SURFACE.border : SURFACE.panel}
        onMouseDown={onHeaderClick}
        selectable={false}
        {...headerHandlers}
      >
        <text fg={headerHovered ? COLOR.bright : COLOR.dim} bg={headerHovered ? SURFACE.border : SURFACE.panel} selectable={false}>
          {turnCount === null ? " Diff" : ` Diff turn ${turnCount}`}
        </text>
        <text fg={COLOR.faint} bg={headerHovered ? SURFACE.border : SURFACE.panel} selectable={false}>
          {`${turnTotal} turn${turnTotal === 1 ? "" : "s"} ▾ `}
        </text>
      </box>
      {loading ? (
        <DiffLoading width={inner} />
      ) : files.length === 0 ? (
        <text fg={COLOR.dim}>{" no file changes in this turn"}</text>
      ) : (
        <scrollbox
          ref={scrollRef}
          style={{ flexGrow: 1 }}
          focused={focused}
          stickyStart="top"
          contentOptions={{ paddingRight: 1 }}
          verticalScrollbarOptions={{
            showArrows: false,
            trackOptions: { foregroundColor: focused ? COLOR.accent : COLOR.dim, backgroundColor: SURFACE.border },
          }}
        >
          {files.map((file, position) => (
            <FileSection
              key={file.path}
              file={file}
              width={inner}
              selected={position === fileIndex}
              collapsed={collapsed.has(file.path)}
              onToggle={() => onToggleFile(position)}
            />
          ))}
        </scrollbox>
      )}
      {/* Bottom status line, like every other tab's footer: the counts in
          their own colours (green/red) instead of one monochrome title. */}
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between", paddingLeft: 1, paddingRight: 1 }} backgroundColor={SURFACE.panel}>
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
          <text fg={COLOR.added} bg={SURFACE.panel} selectable={false}>{`+${added}`}</text>
          <text fg={COLOR.removed} bg={SURFACE.panel} selectable={false}>{` -${removed}`}</text>
        </box>
        <text fg={COLOR.faint} bg={SURFACE.panel} selectable={false}>{"click a file to fold"}</text>
      </box>
    </box>
  );
}
