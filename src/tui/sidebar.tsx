import { useHover } from "./hooks/useHover.js";
import type { SidebarGroup, SidebarMode, SidebarSections, SidebarThread } from "./model/sidebar.js";
import { COLOR, MARKER, rule, spread, STATUS_COLOR, SURFACE, truncate } from "./theme.js";

const MODE_LABEL: Record<SidebarMode, string> = {
  flat: "all",
  grouped: "by project",
  project: "one project",
};

/** Draft/attachment dot: a plain bullet stays inside its cell on every font. */
const DRAFT_DOT = "•";

/** "+" glyph plus its own left/right padding — mirrored as a left spacer so
    the view-switcher pills stay centered despite the button's real width. */
const NEW_THREAD_BUTTON_WIDTH = 3;

/** Settled threads scroll within this many rows instead of growing the sidebar. */
const SETTLED_SCROLL_ROWS = 10;

const STATUS_GLYPH: Record<string, string> = {
  running: "●",
  blocked: "!",
  active: "○",
  snoozed: "z",
  settled: "",
};

/** Needs the user: pending approval or question (answerable elsewhere). */
const WAITING_GLYPH = "?";

function ActiveCard({
  row,
  width,
  open,
  marked,
  compact,
  onOpen,
}: {
  row: SidebarThread;
  width: number;
  open: boolean;
  /** The thread holds an unsent draft or attachments — dot by the badge. */
  marked: boolean;
  /**
   * Grouped mode: the project header already names the project, so the card
   * collapses to one row — title left, age + status right.
   */
  compact?: boolean;
  onOpen: () => void;
}) {
  const glyph = STATUS_GLYPH[row.status] ?? "";
  const body = width - 2;
  const { hovered, handlers } = useHover();

  if (compact === true) {
    const tail = `${row.age.length > 0 ? `${row.age} ` : ""}${glyph}${row.waiting ? " ?" : ""}${marked ? ` ${DRAFT_DOT}` : ""}`;
    return (
      <box
        style={{ flexDirection: "row", width, height: 1, flexShrink: 0 }}
        onMouseDown={onOpen}
        selectable={false}
        backgroundColor={open ? SURFACE.user : hovered ? SURFACE.border : SURFACE.raised}
        {...handlers}
      >
        <text fg={open ? COLOR.accent : COLOR.faint} selectable={false}>{open ? MARKER : " "}</text>
        <text fg={open ? COLOR.bright : COLOR.text} selectable={false}>
          {` ${truncate(row.title, Math.max(0, body - tail.length - 2))}`.padEnd(Math.max(0, body - tail.length))}
        </text>
        <text fg={COLOR.dim} selectable={false}>{row.age.length > 0 ? `${row.age} ` : ""}</text>
        <text fg={STATUS_COLOR[row.status] ?? COLOR.dim} selectable={false}>{glyph}</text>
        <text fg={row.waiting ? COLOR.warn : COLOR.faint} selectable={false}>{row.waiting ? WAITING_GLYPH : ""}</text>
        <text fg={marked ? COLOR.warn : COLOR.faint} selectable={false}>{marked ? DRAFT_DOT : ""}</text>
      </box>
    );
  }

  return (
    <box
      style={{ flexDirection: "column", width, flexShrink: 0 }}
      onMouseDown={onOpen}
      selectable={false}
      backgroundColor={open ? SURFACE.user : hovered ? SURFACE.border : SURFACE.raised}
      {...handlers}
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
        <text fg={open ? COLOR.accent : COLOR.faint} selectable={false}>{open ? MARKER : " "}</text>
        <text fg="#09090b" bg={row.badgeColor} selectable={false}>{` ${row.badge}`}</text>
        <text fg={marked ? COLOR.warn : "#09090b"} bg={row.badgeColor} selectable={false}>{marked ? DRAFT_DOT : " "}</text>
        <text fg={COLOR.dim} selectable={false}>{spread(` ${row.projectTitle}`, row.age, body - 4)}</text>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
        <text fg={open ? COLOR.accent : COLOR.faint} selectable={false}>{open ? MARKER : " "}</text>
        <text fg={open ? COLOR.bright : COLOR.text} selectable={false}>{` ${truncate(row.title, body - 4)}`.padEnd(body - 1 - (row.waiting ? 1 : 0))}</text>
        <text fg={STATUS_COLOR[row.status] ?? COLOR.dim} selectable={false}>{glyph}</text>
        <text fg={row.waiting ? COLOR.warn : COLOR.faint} selectable={false}>{row.waiting ? WAITING_GLYPH : ""}</text>
      </box>
    </box>
  );
}

function SettledRow({
  row,
  width,
  open,
  marked,
  onOpen,
}: {
  row: SidebarThread;
  width: number;
  open: boolean;
  marked: boolean;
  onOpen: () => void;
}) {
  const { hovered, handlers } = useHover();
  return (
    <box
      style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
      onMouseDown={onOpen}
      selectable={false}
      backgroundColor={hovered ? SURFACE.border : SURFACE.panel}
      {...handlers}
    >
      <text fg={open ? COLOR.accent : COLOR.faint} selectable={false}>{open ? MARKER : " "}</text>
      <text fg={COLOR.faint} selectable={false}>{row.badge}</text>
      <text fg={marked ? COLOR.warn : COLOR.faint} selectable={false}>{marked ? DRAFT_DOT : " "}</text>
      <text fg={open ? COLOR.text : COLOR.dim} selectable={false}>{spread(row.title, row.age, width - 4 - (row.waiting ? 1 : 0))}</text>
      <text fg={row.waiting ? COLOR.warn : COLOR.faint} selectable={false}>{row.waiting ? WAITING_GLYPH : ""}</text>
    </box>
  );
}

/** A view-switcher segment styled like a real button: quiet by default, a
    filled pill when selected, and a lighter fill on hover so the row reads
    as clickable rather than as plain inline text. */
function ModePillButton({
  label,
  selected,
  spaced,
  onSelect,
}: {
  label: string;
  selected: boolean;
  /** A trailing gap to the next pill; the last one skips it. */
  spaced: boolean;
  onSelect: () => void;
}) {
  const { hovered, handlers } = useHover();
  const background = selected ? SURFACE.raised : hovered ? SURFACE.border : SURFACE.panel;
  const color = selected ? COLOR.bright : hovered ? COLOR.text : COLOR.faint;
  return (
    <box
      style={{
        flexDirection: "row",
        height: 1,
        flexShrink: 0,
        marginRight: spaced ? 1 : 0,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      backgroundColor={background}
      onMouseDown={onSelect}
      selectable={false}
      {...handlers}
    >
      <text fg={color} bg={background} selectable={false}>{label}</text>
    </box>
  );
}

/** Compact "+" add button — the only UI path to start a new thread now that
    `n` isn't advertised. Kept to a single glyph so it fits beside the view
    switcher without crowding it. */
function NewThreadButton({ onClick }: { onClick: () => void }) {
  const { hovered, handlers } = useHover();
  const background = hovered ? SURFACE.raised : SURFACE.panel;
  return (
    <box
      style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}
      backgroundColor={background}
      onMouseDown={onClick}
      selectable={false}
      {...handlers}
    >
      <text fg={hovered ? COLOR.bright : COLOR.dim} bg={background} selectable={false}>{"+"}</text>
    </box>
  );
}

/** One row of the grouped-mode project header — its own component so the
    hover hook's call count stays fixed regardless of how many groups render. */
function GroupHeaderRow({
  group,
  titleBudget,
  onToggle,
}: {
  group: SidebarGroup;
  titleBudget: number;
  onToggle: () => void;
}) {
  const { hovered, handlers } = useHover();
  return (
    <box
      style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}
      backgroundColor={hovered ? SURFACE.border : SURFACE.panel}
      onMouseDown={onToggle}
      selectable={false}
      {...handlers}
    >
      <text fg={COLOR.dim} selectable={false}>{group.collapsed ? "▸ " : "▾ "}</text>
      <text fg="#09090b" bg={group.badgeColor} selectable={false}>{` ${group.badge} `}</text>
      <text fg={COLOR.text} selectable={false}>
        {` ${truncate(group.projectTitle, titleBudget)}`.padEnd(titleBudget + 1)}
      </text>
      <text fg={COLOR.faint} selectable={false}>{group.threads.length}</text>
    </box>
  );
}

export function Sidebar({
  sections,
  openThreadId,
  markedThreadIds,
  settledExpanded,
  width,
  onOpenThread,
  onToggleSettled,
  onShowMore,
  onSelectMode,
  onToggleProject,
  onCycleProject,
  onNewThread,
}: {
  sections: SidebarSections;
  openThreadId: string | null;
  markedThreadIds: ReadonlySet<string>;
  settledExpanded: boolean;
  width: number;
  onOpenThread: (threadId: string) => void;
  onToggleSettled: () => void;
  onShowMore: () => void;
  /** Jump straight to a view by clicking its label (`s` still cycles). */
  onSelectMode: (mode: SidebarMode) => void;
  /** Collapse/expand one project group. */
  onToggleProject: (projectId: string) => void;
  /** Arrows, project row click, or `[` / `]`: move between projects. */
  onCycleProject: (direction: 1 | -1) => void;
  /** The only UI path to start a new thread now that `n` isn't advertised. */
  onNewThread: () => void;
}) {
  const remaining = sections.settledTotal - sections.settled.length;
  const prevProjectHover = useHover();
  const nextProjectHover = useHover();
  const settledToggleHover = useHover();
  const showMoreHover = useHover();
  const activeCard = (row: SidebarThread, compact = false) => (
    <ActiveCard
      key={row.thread.id}
      row={row}
      width={width - 2}
      open={row.thread.id === openThreadId}
      marked={markedThreadIds.has(row.thread.id)}
      compact={compact}
      onOpen={() => onOpenThread(row.thread.id)}
    />
  );

  return (
    <box
      style={{ width, flexDirection: "column", borderStyle: "rounded", backgroundColor: SURFACE.panel }}
      borderColor={SURFACE.border}
      title=" Threads "
      titleColor={COLOR.dim}
    >
      {/* View switcher, centered: each pill jumps straight to its view (`s`
          still cycles). Kept off the scroll list so thread clicks never
          bubble into it. The "+" sits as a normal trailing sibling now — a
          left spacer matching its own width keeps the pills genuinely
          centered instead of skewed by the button's width on one side. */}
      <box
        style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1, alignItems: "center" }}
        backgroundColor={SURFACE.panel}
      >
        <box style={{ width: NEW_THREAD_BUTTON_WIDTH, flexShrink: 0 }} backgroundColor={SURFACE.panel} />
        <box style={{ flexDirection: "row", flexGrow: 1, justifyContent: "center" }} backgroundColor={SURFACE.panel}>
          {(Object.keys(MODE_LABEL) as SidebarMode[]).map((mode, index, all) => (
            <ModePillButton
              key={mode}
              label={MODE_LABEL[mode]}
              selected={mode === sections.mode}
              spaced={index < all.length - 1}
              onSelect={() => onSelectMode(mode)}
            />
          ))}
        </box>
        <NewThreadButton onClick={onNewThread} />
      </box>
      <box style={{ height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
        <text fg={COLOR.rule} bg={SURFACE.panel}>{` ${rule(Math.max(0, width - 4))}`}</text>
      </box>
      {sections.mode === "project" ? (
        <box
          style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}
          backgroundColor={SURFACE.panel}
        >
          <box
            style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
            backgroundColor={prevProjectHover.hovered ? SURFACE.border : SURFACE.panel}
            onMouseDown={() => onCycleProject(-1)}
            selectable={false}
            {...prevProjectHover.handlers}
          >
            <text fg={COLOR.dim} selectable={false}>{"‹ "}</text>
          </box>
          <box
            style={{ flexDirection: "row", height: 1, flexGrow: 1, justifyContent: "center" }}
            backgroundColor={nextProjectHover.hovered ? SURFACE.border : SURFACE.panel}
            onMouseDown={() => onCycleProject(1)}
            selectable={false}
            {...nextProjectHover.handlers}
          >
            <text fg={COLOR.accent} selectable={false}>
              {truncate(sections.projectTitle ?? "unknown project", width - 10)}
            </text>
          </box>
          <box
            style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
            backgroundColor={nextProjectHover.hovered ? SURFACE.border : SURFACE.panel}
            onMouseDown={() => onCycleProject(1)}
            selectable={false}
            {...nextProjectHover.handlers}
          >
            <text fg={COLOR.dim} selectable={false}>{" ›"}</text>
          </box>
        </box>
      ) : null}
      <scrollbox
        style={{ flexGrow: 1 }}
        contentOptions={{ paddingRight: 1 }}
        stickyStart="top"
        verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: COLOR.dim, backgroundColor: SURFACE.border } }}
      >
        {sections.mode === "grouped"
          ? sections.groups.map((group, groupIndex) => {
              const count = String(group.threads.length);
              // Budget after the row's own 1-col left/right padding, the
              // arrow, and the badge chip — the title fills what's left.
              const titleBudget = Math.max(0, width - 4 - 2 - 4 - count.length - 1);
              return (
                <box
                  key={group.projectId}
                  style={{ flexDirection: "column", flexShrink: 0, marginTop: groupIndex === 0 ? 0 : 1 }}
                >
                  <GroupHeaderRow group={group} titleBudget={titleBudget} onToggle={() => onToggleProject(group.projectId)} />
                  {group.collapsed ? null : group.threads.map((row) => activeCard(row, true))}
                </box>
              );
            })
          : sections.active.map((row) => activeCard(row, sections.mode === "project"))}
        {sections.mode === "project" && sections.active.length === 0 ? (
          <text fg={COLOR.faint}>{" no threads in this project"}</text>
        ) : null}
      </scrollbox>

      {/* Anchored beneath the active list so expanding grows the section upward.
          The rule above it turns whatever gap the active list leaves into a
          deliberate break instead of a stray blank void. */}
      <box style={{ flexDirection: "column", flexShrink: 0, backgroundColor: SURFACE.panel }}>
        <box style={{ height: 1, flexShrink: 0 }} backgroundColor={SURFACE.panel}>
          <text fg={COLOR.rule} bg={SURFACE.panel}>{` ${rule(Math.max(0, width - 4))}`}</text>
        </box>
        <box
          style={{ flexDirection: "row", height: 1, flexShrink: 0 }}
          backgroundColor={settledToggleHover.hovered ? SURFACE.border : SURFACE.panel}
          onMouseDown={onToggleSettled}
          selectable={false}
          {...settledToggleHover.handlers}
        >
          <text fg={COLOR.dim} selectable={false}>{` Settled ${sections.settledTotal}`.padEnd(width - 4)}</text>
          <text fg={COLOR.faint} selectable={false}>{settledExpanded ? " v " : " ^ "}</text>
        </box>
        {settledExpanded ? (
          <scrollbox
            style={{ height: Math.min(SETTLED_SCROLL_ROWS, sections.settled.length), flexShrink: 0 }}
            contentOptions={{ paddingRight: 1 }}
            stickyStart="top"
            verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: COLOR.dim, backgroundColor: SURFACE.border } }}
          >
            {sections.settled.map((row) => (
              <SettledRow
                key={row.thread.id}
                row={row}
                width={width - 2}
                open={row.thread.id === openThreadId}
                marked={markedThreadIds.has(row.thread.id)}
                onOpen={() => onOpenThread(row.thread.id)}
              />
            ))}
            {remaining > 0 ? (
              <text
                fg={showMoreHover.hovered ? COLOR.text : COLOR.faint}
                selectable={false}
                onMouseDown={onShowMore}
                {...showMoreHover.handlers}
              >
                {` + ${remaining} more`}
              </text>
            ) : null}
          </scrollbox>
        ) : null}
      </box>
    </box>
  );
}
