import { createContext, useContext, type ReactNode, type RefObject } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";

import type { ProviderUsageLimits } from "../../../core/catalog/summary.js";
import { useHover } from "../../hooks/useHover.js";
import { contextShares, type AgentThreadRow, type ContextBreakdown, type NativeSubagentRow, type SideTab } from "../../model/sidepanel.js";
import { backgroundTaskKind, backgroundTaskTitle, untilLabel, type BackgroundTaskRow, type ContextUsage } from "../../model/thread.js";
import { formatDuration, formatTokenCount, formatUsd } from "../../model/turns.js";
import { COLOR, SURFACE, truncate } from "../../theme.js";

/** The text width inside the panel frame (border, padding and scrollbar taken off), for rules and bars. */
const PanelWidth = createContext(40);

/** The panel's inner text width, for tabs rendered inside `SidePanelFrame` that live outside this file. */
export function usePanelWidth(): number {
  return useContext(PanelWidth);
}

// Key order is the tab strip's render order (`Object.keys` below): the
// work-in-the-thread tabs first, then the two roll-up tabs.
export const TAB_LABEL: Record<SideTab, string> = { diff: "Diff", git: "Git", context: "Context", agents: "Agents", background: "Background" };

/**
 * Used when the full labels will not fit. Five tabs plus their badges
 * overflow a narrow panel, and the overflow pushes the close control off
 * the right edge — so the strip sheds badges first, then falls back to
 * these, rather than silently losing the ×.
 */
const TAB_SHORT_LABEL: Record<SideTab, string> = { diff: "Diff", git: "Git", context: "Ctx", agents: "Agents", background: "Bkgd" };

/** Category colours, in order; free space and the compaction buffer keep their own. */
const SHARE_COLORS = [COLOR.accent, COLOR.diff, COLOR.command, COLOR.warn, COLOR.user, COLOR.agent, "#f0abfc", "#fda4af"];
const FREE_COLOR = "#3f3f46";
const BUFFER_COLOR = "#71717a";

/** One tab: quiet text until hovered, a raised pill with bright text when open. */
function TabButton({ label, badge, active, onClick }: { label: string; badge: string | null; active: boolean; onClick: () => void }) {
  const { hovered, handlers } = useHover();
  const bg = active ? SURFACE.hover : hovered ? SURFACE.border : SURFACE.base;
  const fg = active ? COLOR.bright : hovered ? COLOR.text : COLOR.dim;
  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1 }} backgroundColor={bg} onMouseDown={onClick} selectable={false} {...handlers}>
      <text fg={fg} bg={bg} selectable={false} attributes={active ? TextAttributes.BOLD : 0}>{label}</text>
      {/* No node at all without a badge: an empty `<text>{""}</text>` still
          measures one cell wide, which put a phantom third space after the
          badgeless tabs (Agents, Background). */}
      {badge === null ? null : (
        <text fg={active ? COLOR.accent : COLOR.faint} bg={bg} selectable={false}>{` ${badge}`}</text>
      )}
    </box>
  );
}

/** The panel's tab strip: every tab, each with a small live badge, and a close control. */
export function SideTabBar({
  tab,
  badges,
  onTab,
  onClose,
  focused,
  left,
  width,
}: {
  tab: SideTab;
  badges: Partial<Record<SideTab, string | null>>;
  onTab: (tab: SideTab) => void;
  onClose: () => void;
  /** Frame focus: the gap line takes the frame's border colour (it IS the top border there). */
  focused?: boolean;
  /**
   * Seated in the frame's own top line (the app passes `left: 2` with the
   * inner width): absolute over the border so Threads / chat / side frames
   * stay continuous, with a column of border visible on each side. The gap
   * before × is drawn back in as `─` text of exactly the leftover width
   * (same colour, focus included) — a border-styled box never rendered
   * there, but repeated text always does (like Heading rules). Omitted
   * renders as a plain row (the render-check harness).
   */
  left?: number;
  width?: number;
}) {
  const { hovered, handlers } = useHover();
  const overlay = left !== undefined && width !== undefined;
  const tabKeys = Object.keys(TAB_LABEL) as SideTab[];
  const closeWidth = 3;
  // Exact cells the buttons take: pad + label + (" " + badge) + pad. All
  // labels/badges are narrow ASCII, so string length is cell width.
  const measure = (labels: Record<SideTab, string>, withBadges: boolean): number =>
    tabKeys.reduce(
      (total, key) =>
        total + 1 + labels[key].length + (!withBadges || badges[key] == null ? 0 : String(badges[key]).length + 1) + 1,
      0,
    );
  const available = overlay ? Math.max(0, (width ?? 0) - closeWidth) : Number.POSITIVE_INFINITY;
  // Shed labels before badges: a badge is live information (how many
  // diffs, how much context, how many tasks running) while a label is
  // mostly recognisable from its first letters. Only when the short
  // labels still overflow do the badges go.
  const fits = (labels: Record<SideTab, string>, withBadges: boolean): boolean => measure(labels, withBadges) <= available;
  const [labels, showBadges] = fits(TAB_LABEL, true)
    ? ([TAB_LABEL, true] as const)
    : fits(TAB_SHORT_LABEL, true)
      ? ([TAB_SHORT_LABEL, true] as const)
      : ([TAB_SHORT_LABEL, false] as const);
  const tabsWidth = measure(labels, showBadges);
  const gapWidth = overlay ? Math.max(0, (width ?? 0) - tabsWidth - closeWidth) : 0;
  return (
    <box
      style={
        overlay
          ? { position: "absolute", top: 0, left, width, height: 1, flexDirection: "row", flexShrink: 0, zIndex: 3 }
          : { flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }
      }
    >
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
        {tabKeys.map((key) => (
          <TabButton
            key={key}
            label={labels[key]}
            badge={showBadges ? (badges[key] ?? null) : null}
            active={key === tab}
            onClick={() => onTab(key)}
          />
        ))}
      </box>
      {overlay && gapWidth > 0 ? (
        <text fg={focused === true ? SURFACE.borderFocus : SURFACE.border} selectable={false}>
          {"─".repeat(gapWidth)}
        </text>
      ) : null}
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1 }} backgroundColor={hovered ? SURFACE.border : SURFACE.base} onMouseDown={onClose} selectable={false} {...handlers}>
        <text fg={hovered ? COLOR.danger : COLOR.dim} bg={hovered ? SURFACE.border : SURFACE.base} selectable={false}>
          {"×"}
        </text>
      </box>
    </box>
  );
}

/** The bordered body every non-diff tab renders in (the Diff tab brings its own). */
export function SidePanelFrame({
  width,
  height,
  focused,
  scrollRef,
  onFocus,
  footer,
  children,
}: {
  width: number;
  /**
   * Terminal height, making the frame exactly viewport-tall so a tall tab
   * scrolls internally and the footer + bottom border pin on-screen.
   * Without a definite height the frame sizes to its content and pushes
   * both below the fold (flexGrow alone does not bound it). Omitted in
   * fixed-height harnesses, where the parent bounds it instead.
   */
  height?: number;
  focused: boolean;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onFocus: () => void;
  /** Fixed bottom status line (counts, actions) above the bottom border —
      every tab gets one, like the diff panel's own `+N −M` line. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <box
      style={{ width, ...(height === undefined ? {} : { height }), flexGrow: 1, flexDirection: "column", borderStyle: "rounded", backgroundColor: SURFACE.panel, paddingLeft: 1, paddingRight: 1 }}
      border={["top", "right", "bottom", "left"]}
      borderColor={focused ? SURFACE.borderFocus : SURFACE.border}
      onMouseDown={onFocus}
    >
      <scrollbox
        ref={scrollRef}
        style={{ flexGrow: 1 }}
        verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: COLOR.accent, backgroundColor: SURFACE.border } }}
      >
        {/* Width minus padding (4) minus the scrollbar column (1): rows that
            fill their container exactly (heading rules, padded counts) would
            otherwise overflow by that one column whenever the tab scrolls,
            and the shrink eats a boundary space. */}
        <PanelWidth.Provider value={Math.max(10, width - 5)}>{children}</PanelWidth.Provider>
      </scrollbox>
      {footer === undefined || footer === null ? null : (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }} backgroundColor={SURFACE.panel}>
          {footer}
        </box>
      )}
    </box>
  );
}

/** A section title, its short meta, and a rule to the panel's edge. */
export function Heading({ text, meta }: { text: string; meta?: string }) {
  const width = useContext(PanelWidth);
  const tail = meta === undefined ? " " : ` ${meta} `;
  const rule = Math.max(0, width - text.length - tail.length);
  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
      <text fg={COLOR.bright} attributes={TextAttributes.BOLD}>{text}</text>
      <text fg={COLOR.dim}>{tail}</text>
      <text fg={SURFACE.border}>{"─".repeat(rule)}</text>
    </box>
  );
}

/** What a section says while it has nothing to show: one glyph, one line. */
function Empty({ glyph, text }: { glyph: string; text: string }) {
  return (
    <box style={{ flexDirection: "row", flexShrink: 0, paddingLeft: 1 }}>
      <text fg={COLOR.faint}>{`${glyph} `}</text>
      <text fg={COLOR.dim} wrapMode="word">{text}</text>
    </box>
  );
}

function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const { hovered, handlers } = useHover();
  return (
    <box
      style={{ flexDirection: "column", flexShrink: 0 }}
      backgroundColor={onClick !== undefined && hovered ? SURFACE.border : SURFACE.panel}
      {...(onClick !== undefined ? { onMouseDown: onClick, ...handlers } : {})}
      selectable={false}
    >
      {children}
    </box>
  );
}

/** Inline action label for panel rows and footers (exported for app-built footers). */
export function ActionText({ label, color = COLOR.accent, onClick }: { label: string; color?: string; onClick: () => void }) {
  const { hovered, handlers } = useHover();
  return (
    <text fg={hovered ? COLOR.bright : color} onMouseDown={onClick} selectable={false} {...handlers}>
      {label}
    </text>
  );
}

// -- Diff (nothing open) ------------------------------------------------------

/** The Diff tab before any turn is open: which turns have changes, or that none do yet. */
export function DiffEmptyTab({ turns, onPick }: { turns: number; onPick: () => void }) {
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <Heading text="Diff" meta={turns === 0 ? "no changes yet" : `${turns} turn${turns === 1 ? "" : "s"} with changes`} />
      {turns === 0 ? (
        <Empty glyph="±" text="Turns that change files show their diff here." />
      ) : (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
          <ActionText label="Pick a turn" onClick={onPick} />
          <text fg={COLOR.faint}>{"  or click a diff row in the chat"}</text>
        </box>
      )}
    </box>
  );
}

// -- Agents -------------------------------------------------------------------

const AGENT_GLYPH: Record<string, string> = { running: "●", blocked: "!", settled: "✓", active: "○", snoozed: "◌" };

export function AgentsTab({
  threads,
  subagents,
  width,
  now,
  onOpen,
  onNudge,
}: {
  threads: readonly AgentThreadRow[];
  subagents: readonly NativeSubagentRow[];
  width: number;
  now: number;
  onOpen: (threadId: string) => void;
  onNudge: (threadId: string, title: string) => void;
}) {
  const inner = Math.max(10, width - 4);
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <Heading text="Delegated threads" meta={threads.length === 0 ? "none yet" : `${threads.length}`} />
      {threads.length === 0 ? (
        <Empty glyph="○" text="Tasks this thread delegates appear here, each a thread you can open and nudge." />
      ) : (
        threads.map((agent) => {
          const running = agent.status === "running";
          const glyph = running ? "●" : agent.outcome === "error" ? "✗" : agent.outcome === "interrupted" ? "■" : (AGENT_GLYPH[agent.status] ?? "○");
          const color = running ? COLOR.warn : agent.outcome === "error" ? COLOR.danger : agent.outcome === "completed" ? COLOR.added : COLOR.dim;
          const elapsed = running && agent.startedAt !== null ? formatDuration(Math.max(1000, now - Date.parse(agent.startedAt))) : null;
          return (
            <Row key={agent.threadId} onClick={() => onOpen(agent.threadId)}>
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                <text fg={color}>{`${glyph} `}</text>
                <text fg={COLOR.text}>{truncate(agent.title, Math.max(4, inner - 12))}</text>
                {elapsed === null ? null : <text fg={COLOR.faint}>{`  ${elapsed}`}</text>}
              </box>
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                <text fg={COLOR.faint}>{`  ${truncate(agent.model ?? "", Math.max(4, inner - 14))}  `}</text>
                <ActionText label="nudge" onClick={() => onNudge(agent.threadId, agent.title)} />
              </box>
            </Row>
          );
        })
      )}
      <Heading text="Subagents in this thread" meta={subagents.length === 0 ? "none yet" : `${subagents.length}`} />
      {subagents.length === 0 ? (
        <Empty glyph="○" text="The provider's own subagents (Claude's Agent tool) appear here." />
      ) : (
        subagents.map((agent) => (
          <Row key={agent.agentId}>
            <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
              <text fg={agent.running ? COLOR.warn : COLOR.added}>{agent.running ? "● " : "✓ "}</text>
              <text fg={COLOR.text}>{agent.agentType}</text>
              <text fg={COLOR.faint}>{agent.running ? "  running" : "  done"}</text>
            </box>
            {agent.lastMessage === null ? null : <text fg={COLOR.dim}>{`  ${truncate(agent.lastMessage.replace(/\s+/g, " "), inner * 2)}`}</text>}
          </Row>
        ))
      )}
    </box>
  );
}

// -- Context ------------------------------------------------------------------

/**
 * A full-width bar split into filled/empty cells. Any non-zero fraction gets
 * at least one filled cell so tiny-but-real shares (the 4k `TaskCreate` row
 * under a 415k `Bash`) stay visible instead of rendering as all-track and
 * reading as a gap in the column.
 */
function meter(width: number, fraction: number): { filled: string; empty: string } {
  const clamped = Math.max(0, Math.min(1, fraction));
  const cells = clamped <= 0 ? 0 : Math.max(1, Math.min(width, Math.round(width * clamped)));
  return { filled: "█".repeat(cells), empty: "░".repeat(Math.max(0, width - cells)) };
}

/**
 * One full-width bar row: always spans `width` cells so every bar in the
 * tab (window, tools, plan) starts and ends on the same columns. Labels and
 * values live on the row above via `space-between`, never beside the bar —
 * beside-the-bar labels forced every group into its own label/bar/value
 * arithmetic and the right edges never lined up.
 */
function BarRow({ width, fraction, filledColor }: { width: number; fraction: number; filledColor: string }) {
  const bar = meter(width, fraction);
  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
      <text fg={filledColor}>{bar.filled}</text>
      <text fg={FREE_COLOR}>{bar.empty}</text>
    </box>
  );
}

export function ContextTab({
  breakdown,
  fallback,
  live,
  usageLimits,
  providerName,
  width,
  now,
}: {
  breakdown: ContextBreakdown | null;
  /** The last recorded reading, when no live breakdown is available. */
  fallback: ContextUsage | null;
  live: boolean;
  usageLimits: ProviderUsageLimits | null;
  providerName: string | null;
  width: number;
  now: number;
}) {
  const inner = Math.max(10, width - 5);
  const used = breakdown?.usedTokens ?? fallback?.usedTokens ?? null;
  const max = breakdown?.maxTokens ?? fallback?.maxTokens ?? null;
  const shares = breakdown === null ? [] : contextShares(breakdown.categories, max, breakdown.usedTokens);
  const barWidth = inner;
  // The window as one stacked bar: each category its own colour, in order.
  let colorIndex = 0;
  const segments = shares.map((share) => {
    const color = share.kind === "free" ? FREE_COLOR : share.kind === "buffer" ? BUFFER_COLOR : SHARE_COLORS[colorIndex++ % SHARE_COLORS.length]!;
    return { ...share, color, cells: Math.max(share.tokens > 0 ? 1 : 0, Math.round((share.percent / 100) * barWidth)) };
  });
  // Rounding leaves the bar a few cells short or long: the free space (or
  // else the largest share) absorbs the difference, so it spans the width.
  const drift = barWidth - segments.reduce((total, segment) => total + segment.cells, 0);
  const absorber = segments.find((segment) => segment.kind === "free") ?? segments.reduce<(typeof segments)[number] | undefined>((largest, segment) => (largest === undefined || segment.cells > largest.cells ? segment : largest), undefined);
  if (absorber !== undefined && shares.reduce((total, share) => total + share.percent, 0) >= 99.5) absorber.cells = Math.max(1, absorber.cells + drift);
  const threshold = breakdown?.autoCompactThreshold ?? fallback?.autoCompactThreshold ?? null;
  const cost = breakdown?.costUsd ?? fallback?.costUsd ?? null;
  const processed = fallback?.totalProcessedTokens ?? null;

  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <Heading text="Context usage" meta={live ? "live" : "last reading"} />
      {used === null ? (
        <Empty glyph="○" text="No reading yet: one arrives with the thread's first turn." />
      ) : (
        <>
          <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
            <text fg={COLOR.bright}>{formatTokenCount(used)}</text>
            {max === null ? (
              <text fg={COLOR.dim}>{" tokens in context"}</text>
            ) : (
              <>
                <text fg={COLOR.dim}>{` / ${formatTokenCount(max)} · ${Math.round((used / max) * 100)}%`}</text>
                {cost === null ? null : (
                  <>
                    <text fg={COLOR.dim}>{" · "}</text>
                    <text fg={COLOR.text}>{formatUsd(cost)}</text>
                  </>
                )}
              </>
            )}
          </box>
          {segments.length > 0 ? (
            <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
              {segments.map((segment) => (
                <text key={segment.name} fg={segment.color}>{(segment.kind === "free" ? "░" : "█").repeat(segment.cells)}</text>
              ))}
            </box>
          ) : max !== null ? (
            <box style={{ flexDirection: "row", height: 1, flexShrink: 0, marginTop: 1 }}>
              <text fg={COLOR.accent}>{meter(barWidth, used / max).filled}</text>
              <text fg={FREE_COLOR}>{meter(barWidth, used / max).empty}</text>
            </box>
          ) : null}
          {threshold === null || max === null ? null : (
            <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
              <text fg={COLOR.dim}>{"Auto-compact window: "}</text>
              <text fg={COLOR.text}>{`${formatTokenCount(threshold)} (${Math.round((threshold / max) * 100)}%)`}</text>
            </box>
          )}
          {processed === null ? null : (
            <text fg={COLOR.dim}>{`${formatTokenCount(processed)} tokens processed`}</text>
          )}
          {segments.length === 0 ? (
            <text fg={COLOR.dim} wrapMode="word">{`${providerName ?? "This provider"} reports the total only, not what fills it.`}</text>
          ) : (
            <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
              <text fg={COLOR.dim}>{breakdown?.estimated === true ? "Estimated usage by category" : "Usage by category"}</text>
              {segments.map((segment) => (
                <box key={segment.name} style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
                  <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                    <text fg={segment.color}>{segment.kind === "free" ? "░ " : "█ "}</text>
                    <text fg={segment.kind === "used" ? COLOR.text : COLOR.dim}>{truncate(segment.name, Math.max(4, inner - 16))}</text>
                  </box>
                  <text fg={COLOR.dim}>{`${formatTokenCount(segment.tokens)} · ${segment.percent.toFixed(1)}%`}</text>
                </box>
              ))}
            </box>
          )}
          {breakdown?.tools === undefined || breakdown.tools.length === 0 ? null : (
            <>
              <Heading text="Heaviest tools" />
              {breakdown.tools.slice(0, 6).map((tool) => {
                // Each tool's share against the heaviest one, as a
                // full-width bar under its own label row — every bar spans
                // `inner`, so they all start and end on the same columns.
                const heaviest = breakdown.tools?.[0]?.tokens ?? tool.tokens;
                return (
                  <box key={tool.name} style={{ flexDirection: "column", flexShrink: 0 }}>
                    <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
                      <text fg={COLOR.text}>{truncate(tool.name, Math.max(4, inner - 10))}</text>
                      <text fg={COLOR.dim}>{formatTokenCount(tool.tokens)}</text>
                    </box>
                    <BarRow width={inner} fraction={heaviest > 0 ? tool.tokens / heaviest : 0} filledColor={COLOR.command} />
                  </box>
                );
              })}
            </>
          )}
        </>
      )}
      <Heading text="Plan usage" {...(providerName === null ? {} : { meta: providerName })} />
      {usageLimits === null || usageLimits.windows.length === 0 ? (
        <text fg={COLOR.dim} wrapMode="word">
          {usageLimits?.unavailable?.message ?? "No subscription usage reported for this provider."}
        </text>
      ) : (
        usageLimits.windows.map((window) => {
          const fraction = window.usedPercent / 100;
          const color = fraction >= 0.9 ? COLOR.danger : fraction >= 0.7 ? COLOR.warn : COLOR.accent;
          const resets = window.resetsAt === null ? null : new Date(window.resetsAt);
          const resetLabel =
            resets === null || Number.isNaN(resets.getTime()) ? null : `↻ ${untilLabel(resets, now).replace(/^in /u, "")}`;
          return (
            <box key={window.id} style={{ flexDirection: "column", flexShrink: 0 }}>
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0, justifyContent: "space-between" }}>
                <text fg={COLOR.text}>{truncate(window.label, Math.max(4, inner - 20))}</text>
                <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                  <text fg={COLOR.dim}>{`${Math.round(window.usedPercent)}%`}</text>
                  {resetLabel === null ? null : <text fg={COLOR.faint}>{` · ${resetLabel}`}</text>}
                </box>
              </box>
              <BarRow width={inner} fraction={fraction} filledColor={color} />
            </box>
          );
        })
      )}
    </box>
  );
}

// -- Background ---------------------------------------------------------------

const KIND_LABEL: Record<string, string> = { shell: "Shell", monitor: "Monitor", agent: "Agent", task: "Task" };

export function BackgroundTab({
  tasks,
  width,
  now,
  onOpen,
  onStop,
}: {
  tasks: readonly BackgroundTaskRow[];
  width: number;
  now: number;
  onOpen: () => void;
  onStop: (taskId: string) => void;
}) {
  const inner = Math.max(10, width - 4);
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <Heading text="Running in the background" meta={tasks.length === 0 ? "none yet" : `${tasks.length}`} />
      {tasks.length === 0 ? (
        <Empty glyph="○" text="Background commands, Monitor watches and background subagents appear here while they run." />
      ) : (
        tasks.map((task) => {
          const started = task.startedAt === null ? null : formatDuration(Math.max(1000, now - Date.parse(task.startedAt)));
          return (
            <Row key={task.taskId} onClick={onOpen}>
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                <text fg={COLOR.warn}>{"● "}</text>
                <text fg={COLOR.dim}>{`${KIND_LABEL[backgroundTaskKind(task)] ?? "Task"} · `}</text>
                <text fg={COLOR.text}>{truncate(backgroundTaskTitle(task), Math.max(4, inner - 22))}</text>
                {started === null ? null : <text fg={COLOR.faint}>{`  ${started}`}</text>}
              </box>
              <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                <text fg={COLOR.faint}>{`  ${truncate(task.command?.split("\n")[0] ?? "", Math.max(4, inner - 10))}  `}</text>
                <ActionText label="stop" color={COLOR.danger} onClick={() => onStop(task.taskId)} />
              </box>
            </Row>
          );
        })
      )}
    </box>
  );
}
